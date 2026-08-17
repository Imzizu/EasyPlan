const { createClerkClient } = require("@clerk/backend");

const FREE_LIMIT = 3;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731";
const FALLBACK_PUBLISHABLE_KEY =
  "pk_test_aW4tbGFtYi03OTY2LmNsZXJrLmFjY291bnRzLmRldiQ";

const SYSTEM_PROMPT = `You are EasyPlan's form compiler. You do not write UI, HTML, CSS, Markdown, or commentary. You extract interview questions from a pasted LLM grill and map each one onto a fixed catalog of form fields.

Return ONLY a JSON object. No markdown fences. No prose before or after.

SCHEMA
{
  "title": "string, optional short title if the grill has one, else empty string",
  "intro": "string, optional one-line context, else empty string",
  "questions": [
    {
      "id": "q1",
      "type": "mcq | multi | yesno | toggle | text | textarea",
      "prompt": "the question text only, no numbering, no type labels",
      "helper": "optional clarifying sentence copied or tightened from the source, else empty string",
      "required": true,
      "options": [{"id": "a", "label": "exact option text"}],
      "allowOther": false,
      "placeholder": "optional hint for text fields, else empty string",
      "maxLength": 0
    }
  ]
}

FIELD CATALOG — pick exactly one type per question
- mcq: single choice. Use when the source is multiple choice, A/B/C, numbered options, or "pick one".
- multi: select all that apply. Use for checkboxes, "which of the following", "select any", feature lists.
- yesno: binary Yes / No. Use for explicit yes/no or true/false questions.
- toggle: on/off preference with no extra explanation needed. Use when the source is a toggle, switch, or "should X be on/off".
- text: one-line answer. Use for short answer, name, one sentence, a URL, a stack, a single noun phrase.
- textarea: multi-line answer. Use for long answer, describe, explain, walk through a workflow.

MAPPING RULES
1. Extract EVERY question in source order. Never invent a question. Never drop a question.
2. Strip leading numbers, bullets, and type tags such as [Multiple choice] from prompt.
3. Copy option labels verbatim. Do not rewrite, reorder, or invent options.
4. ids: questions q1, q2, q3... Options a, b, c... in order.
5. If an option is Other / Other: / Other (please specify) / Something else, set allowOther true and still include that option.
6. yesno and toggle: options may be empty. Do not invent Yes/No options unless the source used custom labels such as "Ship it / Cut it".
7. text/textarea: options must be []. maxLength 80 for text, 800 for textarea, or 0 for no limit.
8. required is true unless the source marks the question optional.
9. Ignore greetings, instructions to the user, closings, and any PLAN.md content. Only questions.
10. If the paste has no questions, return {"title":"","intro":"","questions":[]}.
11. type must be one of the six catalog values. Never output html, markdown, code, or unknown types.

Output valid JSON only.`;

function getClerk() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    const err = new Error("Server is missing CLERK_SECRET_KEY.");
    err.status = 500;
    throw err;
  }
  return createClerkClient({
    secretKey,
    publishableKey:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
      process.env.CLERK_PUBLISHABLE_KEY ||
      FALLBACK_PUBLISHABLE_KEY,
  });
}

function authorizedParties(req) {
  const parties = new Set();
  const fromEnv = process.env.CLERK_AUTHORIZED_PARTIES || "";
  fromEnv
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => parties.add(item));

  const origin = req.headers.origin;
  if (origin) parties.add(origin);

  const proto = String(req.headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const host = req.headers.host;
  if (host) parties.add(proto + "://" + host);

  parties.add("http://localhost:3000");
  parties.add("http://localhost:5173");
  parties.add("http://localhost:5500");
  parties.add("http://127.0.0.1:3000");
  return Array.from(parties);
}

function toWebRequest(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();
  const host = req.headers.host || "localhost";
  const url = proto + "://" + host + (req.url || "/api/compile");
  const headers = new Headers();
  Object.entries(req.headers).forEach(([key, value]) => {
    if (value == null) return;
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  });
  return new Request(url, { method: req.method, headers });
}

function readBuildCount(user) {
  const raw = user && user.privateMetadata ? user.privateMetadata.build_count : 0;
  const count = Number(raw);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function remainingBuilds(buildCount) {
  return Math.max(0, FREE_LIMIT - buildCount);
}

function quotaPayload(buildCount) {
  return {
    buildCount,
    remainingBuilds: remainingBuilds(buildCount),
    freeLimit: FREE_LIMIT,
  };
}

async function authenticate(req) {
  const clerk = getClerk();
  const state = await clerk.authenticateRequest(toWebRequest(req), {
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey:
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
      process.env.CLERK_PUBLISHABLE_KEY ||
      FALLBACK_PUBLISHABLE_KEY,
    authorizedParties: authorizedParties(req),
  });

  const signedIn = Boolean(state.isAuthenticated || state.isSignedIn);
  if (!signedIn) {
    const err = new Error("Unauthorized. Please sign in.");
    err.status = 401;
    throw err;
  }

  const auth = typeof state.toAuth === "function" ? state.toAuth() : null;
  const userId = auth && auth.userId;
  if (!userId) {
    const err = new Error("Unauthorized. Please sign in.");
    err.status = 401;
    throw err;
  }

  return { clerk, userId };
}

function extractJson(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("The model returned an empty response.");
  }

  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("The model did not return JSON I could read.");
  }
  text = text.slice(start, end + 1);
  text = text.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("The model returned JSON that could not be parsed.");
  }
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Credentials", "true");
}

async function callOpenRouter(apiKey, model, sourceText, referer) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        "Compile this pasted grill into the JSON schema. Use only the field catalog. Do not invent questions.\n\n---GRILL START---\n" +
        sourceText +
        "\n---GRILL END---",
    },
  ];

  const attempts = [
    {
      model,
      temperature: 0.1,
      max_tokens: 4000,
      reasoning: { effort: "none" },
      response_format: { type: "json_object" },
      plugins: [{ id: "response-healing" }],
      messages,
    },
    {
      model,
      temperature: 0.1,
      max_tokens: 4000,
      reasoning: { effort: "none" },
      response_format: { type: "json_object" },
      messages,
    },
    {
      model,
      temperature: 0.1,
      max_tokens: 4000,
      messages,
    },
  ];

  let payload = null;
  let lastError = "";

  for (let i = 0; i < attempts.length; i += 1) {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": referer || "https://easyplan.local",
        "X-OpenRouter-Title": "EasyPlan",
      },
      body: JSON.stringify(attempts[i]),
    });

    try {
      payload = await response.json();
    } catch (err) {
      lastError = "OpenRouter returned a non-JSON error.";
      continue;
    }

    if (response.ok) break;

    lastError =
      (payload && ((payload.error && payload.error.message) || payload.message)) ||
      "OpenRouter request failed (" + response.status + ").";

    if (response.status !== 400 || i === attempts.length - 1) {
      const error = new Error(lastError);
      error.status = response.status >= 400 && response.status < 600 ? response.status : 502;
      throw error;
    }
  }

  if (!payload || !payload.choices) {
    const error = new Error(lastError || "OpenRouter did not return a completion.");
    error.status = 502;
    throw error;
  }

  const content = payload.choices[0] && payload.choices[0].message
    ? payload.choices[0].message.content
    : null;
  return extractJson(typeof content === "string" ? content : JSON.stringify(content));
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { clerk, userId } = await authenticate(req);
    const user = await clerk.users.getUser(userId);
    const buildCount = readBuildCount(user);

    if (req.method === "GET") {
      res.status(200).json(quotaPayload(buildCount));
      return;
    }

    const body = parseBody(req);
    const sourceText = String(body.sourceText || body.paste || "").trim();
    if (!sourceText) {
      res.status(400).json({ error: "Paste the grill before building a form." });
      return;
    }

    const customKey = String(body.apiKey || body.customApiKey || "").trim();
    const usingCustomKey = Boolean(customKey);

    if (!usingCustomKey && buildCount >= FREE_LIMIT) {
      res.status(403).json({
        error:
          "Free tier limit reached (3/3 builds). Please add your OpenRouter API key in Settings.",
        ...quotaPayload(buildCount),
      });
      return;
    }

    const apiKey = usingCustomKey ? customKey : process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "Server is missing OPENROUTER_API_KEY." });
      return;
    }

    const model = String(body.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
    const referer =
      req.headers.origin ||
      (req.headers.host
        ? String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim() +
          "://" +
          req.headers.host
        : "");

    const form = await callOpenRouter(apiKey, model, sourceText, referer);

    let nextCount = buildCount;
    if (!usingCustomKey) {
      nextCount = buildCount + 1;
      try {
        await clerk.users.updateUserMetadata(userId, {
          privateMetadata: { build_count: nextCount },
        });
      } catch (err) {
        console.error("Failed to increment build_count", err);
        nextCount = buildCount;
      }
    }

    res.status(200).json({
      form,
      ...quotaPayload(nextCount),
    });
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    const message = err && err.message ? err.message : "Compile failed.";
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  }
};

module.exports.config = {
  maxDuration: 60,
};

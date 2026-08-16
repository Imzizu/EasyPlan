var EP = window.EP || (window.EP = {});

EP.ALLOWED_TYPES = ["mcq", "multi", "yesno", "toggle", "text", "textarea"];

EP.SYSTEM_PROMPT = `You are EasyPlan's form compiler. You do not write UI, HTML, CSS, Markdown, or commentary. You extract interview questions from a pasted LLM grill and map each one onto a fixed catalog of form fields.

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

EP.getSettings = function getSettings() {
  const keys = EP.CONFIG.storageKeys;
  return {
    apiKey: (localStorage.getItem(keys.apiKey) || EP.CONFIG.defaultApiKey).trim(),
    model: (localStorage.getItem(keys.model) || EP.CONFIG.defaultModel).trim(),
  };
};

EP.saveSettings = function saveSettings(apiKey, model) {
  const keys = EP.CONFIG.storageKeys;
  localStorage.setItem(keys.apiKey, (apiKey || "").trim());
  localStorage.setItem(keys.model, (model || EP.CONFIG.defaultModel).trim());
};

EP.extractJson = function extractJson(raw) {
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
};

EP.slugId = function slugId(value, fallback) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
};

EP.normalizeForm = function normalizeForm(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The model returned an unexpected shape.");
  }

  const source = Array.isArray(data.questions)
    ? data.questions
    : Array.isArray(data.fields)
      ? data.fields
      : [];

  const typeAliases = {
    mcq: "mcq",
    "multiple-choice": "mcq",
    multiplechoice: "mcq",
    radio: "mcq",
    choice: "mcq",
    single: "mcq",
    select: "mcq",
    multi: "multi",
    multiselect: "multi",
    "multi-select": "multi",
    checkbox: "multi",
    checkboxes: "multi",
    yesno: "yesno",
    "yes-no": "yesno",
    boolean: "yesno",
    confirm: "yesno",
    toggle: "toggle",
    switch: "toggle",
    text: "text",
    short: "text",
    "short-answer": "text",
    input: "text",
    textarea: "textarea",
    long: "textarea",
    "long-answer": "textarea",
    paragraph: "textarea",
  };

  const usedIds = new Set();
  const questions = [];

  source.forEach((item, index) => {
    if (!item || typeof item !== "object") return;

    const rawType = String(item.type || "text")
      .toLowerCase()
      .replace(/\s+/g, "-");
    let type = typeAliases[rawType] || "text";
    if (!EP.ALLOWED_TYPES.includes(type)) type = "text";

    const prompt = String(item.prompt || item.question || item.label || "")
      .replace(/^\s*\d+[\).:\-]\s*/, "")
      .replace(/^\s*\[[^\]]+\]\s*/, "")
      .trim();
    if (!prompt) return;

    let id = EP.slugId(item.id, "q" + (index + 1));
    if (usedIds.has(id)) id = id + "-" + (index + 1);
    usedIds.add(id);

    const optionSource = Array.isArray(item.options) ? item.options : [];
    const usedOpt = new Set();
    const options = optionSource
      .map((opt, optIndex) => {
        if (opt == null) return null;
        const label =
          typeof opt === "string"
            ? opt.trim()
            : String(opt.label || opt.text || opt.value || "").trim();
        if (!label) return null;
        let oid = EP.slugId(
          typeof opt === "object" ? opt.id || opt.value : "",
          String.fromCharCode(97 + optIndex)
        );
        if (usedOpt.has(oid)) oid = oid + "-" + (optIndex + 1);
        usedOpt.add(oid);
        return { id: oid, label };
      })
      .filter(Boolean);

    const otherPattern = /^(other\b|something else|none of the above|custom)/i;
    const hasOtherOption = options.some((opt) => otherPattern.test(opt.label));
    const allowOther = Boolean(item.allowOther) || hasOtherOption;

    if ((type === "mcq" || type === "multi") && options.length < 2) {
      type = options.length === 0 ? "text" : type;
    }

    if (type === "yesno" || type === "toggle" || type === "text" || type === "textarea") {
      if (!(type === "yesno" && options.length === 2)) {
        if (type !== "yesno" && type !== "toggle") {
          /* keep empty options for text fields */
        }
      }
    }

    let maxLength = Number(item.maxLength);
    if (!Number.isFinite(maxLength) || maxLength < 0) maxLength = 0;
    if (type === "text" && !maxLength) maxLength = 160;
    if (type === "textarea" && !maxLength) maxLength = 1200;

    questions.push({
      id,
      type,
      prompt,
      helper: String(item.helper || item.description || "").trim(),
      required: item.required !== false,
      options: type === "mcq" || type === "multi" || (type === "yesno" && options.length === 2)
        ? options
        : type === "toggle" && options.length
          ? options.slice(0, 2)
          : [],
      allowOther,
      placeholder: String(item.placeholder || "").trim(),
      maxLength,
    });
  });

  return {
    title: String(data.title || "").trim(),
    intro: String(data.intro || "").trim(),
    questions,
  };
};

EP.getSessionToken = async function getSessionToken() {
  if (!window.Clerk || !window.Clerk.session) return "";
  try {
    return (await window.Clerk.session.getToken()) || "";
  } catch (err) {
    return "";
  }
};

EP.applyQuota = function applyQuota(payload) {
  if (!payload || typeof payload !== "object") return;
  if (typeof payload.remainingBuilds === "number") {
    EP.state.remainingBuilds = payload.remainingBuilds;
  }
  if (typeof payload.buildCount === "number") {
    EP.state.buildCount = payload.buildCount;
  }
  if (typeof payload.freeLimit === "number") {
    EP.state.freeLimit = payload.freeLimit;
  }
  if (typeof EP.updateQuotaLabel === "function") EP.updateQuotaLabel();
};

EP.fetchQuota = async function fetchQuota() {
  const token = await EP.getSessionToken();
  if (!token) return null;

  const response = await fetch(EP.CONFIG.compileEndpoint, {
    method: "GET",
    headers: { Authorization: "Bearer " + token },
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    return null;
  }

  if (!response.ok) return null;
  EP.applyQuota(payload);
  return payload;
};

EP.compileForm = async function compileForm(sourceText, onStatus) {
  const paste = String(sourceText || "").trim();
  if (!paste) throw new Error("Paste the grill before building a form.");

  if (!window.Clerk || !window.Clerk.isSignedIn || !window.Clerk.session) {
    throw new Error("Sign in to build a form.");
  }

  const settings = EP.getSettings();
  if (onStatus) onStatus("Reading the grill");

  const token = await EP.getSessionToken();
  if (!token) throw new Error("Sign in to build a form.");

  if (onStatus) onStatus("Asking the compiler");

  const response = await fetch(EP.CONFIG.compileEndpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sourceText: paste,
      model: settings.model,
      apiKey: settings.apiKey || "",
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    throw new Error("The compiler returned a non-JSON error.");
  }

  EP.applyQuota(payload);

  if (!response.ok) {
    throw new Error(
      (payload && (payload.error || payload.message)) ||
        "Compile failed (" + response.status + ")."
    );
  }

  if (onStatus) onStatus("Setting the form");

  const parsed = payload.form || payload;
  const form = EP.normalizeForm(parsed);

  if (!form.questions.length) {
    throw new Error("No questions were found in that paste. Check the grill and try again.");
  }

  return form;
};

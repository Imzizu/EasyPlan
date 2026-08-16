var EP = window.EP || (window.EP = {});

EP.isAnswered = function isAnswered(question, answer) {
  if (!answer) return false;
  if (question.type === "multi") return Array.isArray(answer.values) && answer.values.length > 0;
  if (question.type === "toggle") return answer.value === "on" || answer.value === "off";
  if (question.type === "mcq" || question.type === "yesno") {
    if (!answer.value) return false;
    if (question.allowOther && EP.isOtherLabel(question, answer.value)) {
      return Boolean(String(answer.other || "").trim());
    }
    return true;
  }
  return Boolean(String(answer.value || "").trim());
};

EP.isOtherLabel = function isOtherLabel(question, optionId) {
  const opt = (question.options || []).find((item) => item.id === optionId);
  if (!opt) return false;
  return /^(other\b|something else|none of the above|custom)/i.test(opt.label);
};

EP.formatAnswer = function formatAnswer(question, answer) {
  if (!EP.isAnswered(question, answer)) return "";

  if (question.type === "multi") {
    const labels = (answer.values || []).map((id) => {
      const opt = (question.options || []).find((item) => item.id === id);
      const label = opt ? opt.label : id;
      if (opt && EP.isOtherLabel(question, id) && answer.other) {
        return label + ": " + answer.other.trim();
      }
      return label;
    });
    return labels.join(", ");
  }

  if (question.type === "toggle") {
    if ((question.options || []).length >= 2) {
      return answer.value === "on" ? question.options[0].label : question.options[1].label;
    }
    return answer.value === "on" ? "On" : "Off";
  }

  if (question.type === "mcq" || question.type === "yesno") {
    const opt = (question.options || []).find((item) => item.id === answer.value);
    const label = opt ? opt.label : answer.value;
    if (opt && EP.isOtherLabel(question, answer.value) && answer.other) {
      return label + ": " + answer.other.trim();
    }
    if (!opt && (answer.value === "yes" || answer.value === "no")) {
      return answer.value === "yes" ? "Yes" : "No";
    }
    return label;
  }

  return String(answer.value || "").trim();
};

EP.buildMarkdown = function buildMarkdown(form, answers, options) {
  const opts = options || {};
  const lines = [];

  if (opts.withPrefix && opts.prefix) {
    lines.push(String(opts.prefix).trim());
    lines.push("");
  }

  const title = form.title ? form.title : "Grill Responses";
  lines.push("# " + title);
  lines.push("");

  if (form.intro) {
    lines.push(form.intro);
    lines.push("");
  }

  form.questions.forEach((question, index) => {
    const answer = answers[question.id];
    const formatted = EP.formatAnswer(question, answer);
    lines.push("## " + (index + 1) + ". " + question.prompt);
    lines.push("");
    lines.push("**Answer:** " + (formatted || "_Not answered_"));
    lines.push("");
  });

  return lines.join("\n").trim() + "\n";
};

EP.escapeHtml = function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

EP.renderMarkdown = function renderMarkdown(source) {
  const escaped = EP.escapeHtml(source);
  const lines = escaped.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  const inline = (text) =>
    text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/_(.+?)_/g, "<em>$1</em>");

  lines.forEach((line) => {
    if (line.startsWith("### ")) {
      closeList();
      html.push("<h3>" + inline(line.slice(4)) + "</h3>");
      return;
    }
    if (line.startsWith("## ")) {
      closeList();
      html.push("<h2>" + inline(line.slice(3)) + "</h2>");
      return;
    }
    if (line.startsWith("# ")) {
      closeList();
      html.push("<h1>" + inline(line.slice(2)) + "</h1>");
      return;
    }
    if (line.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push("<li>" + inline(line.slice(2)) + "</li>");
      return;
    }
    if (!line.trim()) {
      closeList();
      return;
    }
    closeList();
    html.push("<p>" + inline(line) + "</p>");
  });

  closeList();
  return html.join("");
};

EP.copyText = async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
};

EP.downloadText = function downloadText(text, filename) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "easyplan-responses.md";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

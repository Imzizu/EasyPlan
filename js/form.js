var EP = window.EP || (window.EP = {});

EP.STAMPS = {
  mcq: "Choice",
  multi: "Choose many",
  yesno: "Yes / No",
  toggle: "Toggle",
  text: "Short",
  textarea: "Long",
};

EP.createEl = function createEl(tag, className, attrs) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (attrs) {
    Object.keys(attrs).forEach((key) => {
      if (key === "text") el.textContent = attrs[key];
      else if (key === "html") el.innerHTML = attrs.html;
      else if (attrs[key] !== undefined && attrs[key] !== null) el.setAttribute(key, attrs[key]);
    });
  }
  return el;
};

EP.emptyAnswer = function emptyAnswer(question) {
  if (question.type === "multi") return { values: [], other: "" };
  if (question.type === "toggle") return { value: "", other: "" };
  return { value: "", other: "" };
};

EP.renderForm = function renderForm(form, answers, handlers) {
  const root = document.getElementById("form-list");
  const nav = document.getElementById("form-nav");
  root.innerHTML = "";
  nav.innerHTML = "";

  form.questions.forEach((question, index) => {
    const answer = answers[question.id] || EP.emptyAnswer(question);
    const card = EP.renderQuestion(question, answer, index, handlers);
    root.appendChild(card);

    const navBtn = EP.createEl("button", "nav-dot", {
      type: "button",
      "data-target": question.id,
      "aria-label": "Jump to question " + (index + 1),
    });
    navBtn.innerHTML =
      "<span>" + String(index + 1).padStart(2, "0") + "</span>";
    navBtn.addEventListener("click", () => {
      const target = document.getElementById("q-" + question.id);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    nav.appendChild(navBtn);
  });

  EP.syncNav(form, answers);
};

EP.renderQuestion = function renderQuestion(question, answer, index, handlers) {
  const card = EP.createEl("article", "q-card", {
    id: "q-" + question.id,
    "data-id": question.id,
    "data-type": question.type,
  });

  const head = EP.createEl("header", "q-head");
  const indexEl = EP.createEl("div", "q-index", {
    text: String(index + 1).padStart(2, "0"),
  });
  const stamp = EP.createEl("span", "q-stamp", {
    text: EP.STAMPS[question.type] || question.type,
  });
  if (question.required) stamp.classList.add("is-required");
  head.append(indexEl, stamp);

  const prompt = EP.createEl("h2", "q-prompt", { text: question.prompt });
  card.append(head, prompt);

  if (question.helper) {
    card.appendChild(EP.createEl("p", "q-helper", { text: question.helper }));
  }

  const body = EP.createEl("div", "q-body");
  if (question.type === "mcq") EP.renderMcq(body, question, answer, handlers);
  else if (question.type === "multi") EP.renderMulti(body, question, answer, handlers);
  else if (question.type === "yesno") EP.renderYesNo(body, question, answer, handlers);
  else if (question.type === "toggle") EP.renderToggle(body, question, answer, handlers);
  else if (question.type === "textarea") EP.renderTextarea(body, question, answer, handlers);
  else EP.renderText(body, question, answer, handlers);

  card.appendChild(body);

  const error = EP.createEl("p", "q-error", {
    id: "err-" + question.id,
    hidden: "",
    text: "This one still needs an answer.",
  });
  card.appendChild(error);
  return card;
};

EP.otherField = function otherField(question, answer, visible, handlers) {
  const wrap = EP.createEl("div", "other-wrap" + (visible ? " is-open" : ""));
  wrap.hidden = !visible;

  const field = EP.createEl("label", "float-field");
  const input = EP.createEl("input", "float-input", {
    type: "text",
    id: "other-" + question.id,
    placeholder: " ",
    maxlength: "160",
    value: answer.other || "",
    autocomplete: "off",
  });
  const label = EP.createEl("span", "float-label", { text: "Specify other" });
  field.append(input, label);
  wrap.appendChild(field);

  input.addEventListener("input", () => {
    handlers.onOther(question.id, input.value);
  });
  return wrap;
};

EP.renderMcq = function renderMcq(body, question, answer, handlers) {
  const group = EP.createEl("div", "choice-grid", { role: "radiogroup" });
  question.options.forEach((opt) => {
    const id = question.id + "-" + opt.id;
    const label = EP.createEl("label", "choice-card");
    const input = EP.createEl("input", "", {
      type: "radio",
      name: question.id,
      id,
      value: opt.id,
    });
    input.checked = answer.value === opt.id;
    const mark = EP.createEl("span", "choice-mark");
    const text = EP.createEl("span", "choice-text", { text: opt.label });
    label.append(input, mark, text);
    input.addEventListener("change", () => handlers.onChange(question.id, opt.id));
    group.appendChild(label);
  });
  body.appendChild(group);

  const showOther = question.allowOther && EP.isOtherLabel(question, answer.value);
  body.appendChild(EP.otherField(question, answer, showOther, handlers));
};

EP.renderMulti = function renderMulti(body, question, answer, handlers) {
  const group = EP.createEl("div", "choice-grid", { role: "group" });
  const selected = new Set(answer.values || []);
  question.options.forEach((opt) => {
    const id = question.id + "-" + opt.id;
    const label = EP.createEl("label", "choice-card");
    const input = EP.createEl("input", "", {
      type: "checkbox",
      name: question.id,
      id,
      value: opt.id,
    });
    input.checked = selected.has(opt.id);
    const mark = EP.createEl("span", "choice-mark is-check");
    const text = EP.createEl("span", "choice-text", { text: opt.label });
    label.append(input, mark, text);
    input.addEventListener("change", () => {
      const next = Array.from(group.querySelectorAll("input[type=checkbox]"))
        .filter((box) => box.checked)
        .map((box) => box.value);
      handlers.onMulti(question.id, next);
    });
    group.appendChild(label);
  });
  body.appendChild(group);

  const showOther =
    question.allowOther &&
    (answer.values || []).some((id) => EP.isOtherLabel(question, id));
  body.appendChild(EP.otherField(question, answer, showOther, handlers));
};

EP.renderYesNo = function renderYesNo(body, question, answer, handlers) {
  const pair = (question.options || []).length === 2
    ? question.options
    : [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ];

  const group = EP.createEl("div", "yesno-row", { role: "radiogroup" });
  pair.forEach((opt, idx) => {
    const btn = EP.createEl("button", "yesno-btn" + (idx === 0 ? " is-yes" : " is-no"), {
      type: "button",
      "aria-pressed": answer.value === opt.id ? "true" : "false",
    });
    btn.innerHTML = "<span>" + EP.escapeHtml(opt.label) + "</span>";
    if (answer.value === opt.id) btn.classList.add("is-on");
    btn.addEventListener("click", () => handlers.onChange(question.id, opt.id));
    group.appendChild(btn);
  });
  body.appendChild(group);
};

EP.renderToggle = function renderToggle(body, question, answer, handlers) {
  const onLabel =
    (question.options && question.options[0] && question.options[0].label) || "On";
  const offLabel =
    (question.options && question.options[1] && question.options[1].label) || "Off";
  const isOn = answer.value === "on";

  const row = EP.createEl("div", "toggle-row");
  const btn = EP.createEl("button", "toggle-switch" + (isOn ? " is-on" : ""), {
    type: "button",
    role: "switch",
    "aria-checked": isOn ? "true" : "false",
  });
  btn.innerHTML = '<span class="toggle-knob"></span>';
  const labels = EP.createEl("div", "toggle-labels");
  labels.innerHTML =
    '<span class="' +
    (isOn ? "is-active" : "") +
    '">' +
    EP.escapeHtml(onLabel) +
    '</span><span class="' +
    (!isOn && answer.value === "off" ? "is-active" : "") +
    '">' +
    EP.escapeHtml(offLabel) +
    "</span>";

  btn.addEventListener("click", () => {
    handlers.onChange(question.id, isOn ? "off" : "on");
  });

  row.append(btn, labels);
  body.appendChild(row);
};

EP.renderText = function renderText(body, question, answer, handlers) {
  const field = EP.createEl("label", "float-field");
  const input = EP.createEl("input", "float-input", {
    type: "text",
    id: "input-" + question.id,
    placeholder: " ",
    autocomplete: "off",
    value: answer.value || "",
  });
  if (question.maxLength) input.maxLength = question.maxLength;
  const label = EP.createEl("span", "float-label", {
    text: question.placeholder || "Your answer",
  });
  field.append(input, label);

  const meta = EP.createEl("div", "field-meta");
  const counter = EP.createEl("span", "char-count");
  const updateCount = () => {
    if (!question.maxLength) {
      counter.textContent = "";
      return;
    }
    counter.textContent = input.value.length + " / " + question.maxLength;
  };
  updateCount();
  meta.appendChild(counter);

  input.addEventListener("input", () => {
    updateCount();
    handlers.onChange(question.id, input.value);
  });

  body.append(field, meta);
};

EP.renderTextarea = function renderTextarea(body, question, answer, handlers) {
  const field = EP.createEl("label", "float-field is-area");
  const input = EP.createEl("textarea", "float-input", {
    id: "input-" + question.id,
    placeholder: " ",
    rows: "5",
  });
  input.value = answer.value || "";
  if (question.maxLength) input.maxLength = question.maxLength;
  const label = EP.createEl("span", "float-label", {
    text: question.placeholder || "Write it out",
  });
  field.append(input, label);

  const meta = EP.createEl("div", "field-meta");
  const counter = EP.createEl("span", "char-count");
  const updateCount = () => {
    if (!question.maxLength) {
      counter.textContent = "";
      return;
    }
    counter.textContent = input.value.length + " / " + question.maxLength;
  };
  updateCount();
  meta.appendChild(counter);

  input.addEventListener("input", () => {
    updateCount();
    handlers.onChange(question.id, input.value);
  });

  body.append(field, meta);
};

EP.syncNav = function syncNav(form, answers) {
  const dots = document.querySelectorAll(".nav-dot");
  form.questions.forEach((question, index) => {
    const dot = dots[index];
    if (!dot) return;
    const done = EP.isAnswered(question, answers[question.id]);
    dot.classList.toggle("is-done", done);
  });
};

EP.markInvalid = function markInvalid(questionId, invalid) {
  const card = document.getElementById("q-" + questionId);
  const err = document.getElementById("err-" + questionId);
  if (card) card.classList.toggle("is-invalid", invalid);
  if (err) err.hidden = !invalid;
};

EP.clearInvalid = function clearInvalid() {
  document.querySelectorAll(".q-card.is-invalid").forEach((card) => {
    card.classList.remove("is-invalid");
  });
  document.querySelectorAll(".q-error").forEach((err) => {
    err.hidden = true;
  });
};

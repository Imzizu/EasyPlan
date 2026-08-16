var EP = window.EP || (window.EP = {});

EP.state = {
  view: "intake",
  paste: "",
  form: null,
  answers: {},
  prefix: EP.DEFAULT_PREFIX,
  copyWithPrefix: true,
  previewMode: "rendered",
  remainingBuilds: null,
  buildCount: 0,
  freeLimit: EP.CONFIG.freeLimit || 3,
};

EP.qs = (sel, root) => (root || document).querySelector(sel);
EP.qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

EP.init = function init() {
  EP.restore();
  EP.bind();
  EP.renderIntake();
  if (EP.state.form && EP.state.form.questions && EP.state.form.questions.length) {
    EP.showView("form");
    EP.mountForm();
  } else {
    EP.showView("intake");
  }
  EP.bootClerk();
};

EP.waitForClerk = function waitForClerk() {
  if (window.Clerk) return Promise.resolve(window.Clerk);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.Clerk) {
        clearInterval(timer);
        resolve(window.Clerk);
      } else if (Date.now() - started > 15000) {
        clearInterval(timer);
        reject(new Error("Clerk failed to load."));
      }
    }, 40);
  });
};

EP.bootClerk = async function bootClerk() {
  try {
    const clerk = await EP.waitForClerk();
    await clerk.load({
      fallbackRedirectUrl: window.location.origin,
      ui: { ClerkUI: window.__internal_ClerkUICtor },
    });
    EP.renderAuth();
    clerk.addListener(() => EP.renderAuth());
  } catch (err) {
    const root = EP.qs("#clerk-auth");
    if (root) {
      root.innerHTML = "";
      const note = document.createElement("span");
      note.className = "clerk-quota";
      note.textContent = "Auth unavailable";
      root.appendChild(note);
    }
    console.error(err);
  }
};

EP.renderAuth = function renderAuth() {
  const clerk = window.Clerk;
  const root = EP.qs("#clerk-auth");
  if (!root || !clerk || !clerk.loaded) return;

  const userId = clerk.user && clerk.user.id ? clerk.user.id : null;
  if (userId === EP._authUserId && root.childElementCount) return;

  const existing = EP.qs("#clerk-user-button");
  if (existing && typeof clerk.unmountUserButton === "function") {
    try {
      clerk.unmountUserButton(existing);
    } catch (err) {
      /* ignore unmount races */
    }
  }

  EP._authUserId = userId;
  root.innerHTML = "";

  if (clerk.isSignedIn) {
    const quota = document.createElement("span");
    quota.id = "clerk-quota";
    quota.className = "clerk-quota";
    quota.textContent = "…";
    const mount = document.createElement("div");
    mount.id = "clerk-user-button";
    mount.className = "clerk-user";
    root.append(quota, mount);
    clerk.mountUserButton(mount);
    EP.refreshQuota();
    return;
  }

  EP.state.remainingBuilds = null;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "btn-sign-in";
  btn.className = "btn btn-ink";
  btn.textContent = "Sign in";
  btn.addEventListener("click", () =>
    clerk.openSignIn({ fallbackRedirectUrl: window.location.origin })
  );
  root.appendChild(btn);
};

EP.updateQuotaLabel = function updateQuotaLabel() {
  const el = EP.qs("#clerk-quota");
  if (!el) return;
  if (typeof EP.state.remainingBuilds !== "number") {
    el.textContent = "…";
    return;
  }
  const limit = EP.state.freeLimit || 3;
  const left = EP.state.remainingBuilds;
  el.textContent = left + " / " + limit + " free";
};

EP.refreshQuota = function refreshQuota() {
  if (!window.Clerk || !window.Clerk.isSignedIn) return;
  EP.updateQuotaLabel();
  EP.fetchQuota()
    .then(() => EP.updateQuotaLabel())
    .catch(() => {});
};

EP.restore = function restore() {
  const keys = EP.CONFIG.storageKeys;
  const paste = localStorage.getItem(keys.paste);
  const prefix = localStorage.getItem(keys.prefix);
  const copyPref = localStorage.getItem(keys.copyWithPrefix);
  const formRaw = localStorage.getItem(keys.form);
  const answersRaw = localStorage.getItem(keys.answers);

  if (paste) EP.state.paste = paste;
  if (prefix !== null) EP.state.prefix = prefix;
  if (copyPref !== null) EP.state.copyWithPrefix = copyPref === "true";

  try {
    if (formRaw) EP.state.form = JSON.parse(formRaw);
  } catch (err) {
    EP.state.form = null;
  }
  try {
    if (answersRaw) EP.state.answers = JSON.parse(answersRaw);
  } catch (err) {
    EP.state.answers = {};
  }
};

EP.persist = function persist() {
  const keys = EP.CONFIG.storageKeys;
  localStorage.setItem(keys.paste, EP.state.paste || "");
  localStorage.setItem(keys.prefix, EP.state.prefix || "");
  localStorage.setItem(keys.copyWithPrefix, String(EP.state.copyWithPrefix));
  if (EP.state.form) localStorage.setItem(keys.form, JSON.stringify(EP.state.form));
  else localStorage.removeItem(keys.form);
  localStorage.setItem(keys.answers, JSON.stringify(EP.state.answers || {}));
};

EP.bind = function bind() {
  const paste = EP.qs("#grill-paste");
  paste.value = EP.state.paste || "";
  EP.updatePasteMeta();

  paste.addEventListener("input", () => {
    EP.state.paste = paste.value;
    EP.qs("#paste-field").classList.remove("is-invalid");
    EP.qs("#paste-error").hidden = true;
    EP.updatePasteMeta();
    EP.persist();
  });

  EP.qs("#btn-copy-template").addEventListener("click", () => EP.copyTemplate());
  EP.qs("#btn-sample").addEventListener("click", () => EP.loadSample());
  EP.qs("#btn-clear-paste").addEventListener("click", () => EP.clearPaste());
  EP.qs("#btn-build").addEventListener("click", () => EP.buildForm());
  EP.qs("#btn-how").addEventListener("click", () => EP.openDialog("dlg-how"));
  EP.qs("#btn-settings").addEventListener("click", () => EP.openSettings());
  EP.qs("#btn-template-top").addEventListener("click", () => EP.copyTemplate());

  EP.qs("#btn-back").addEventListener("click", () => EP.backToPaste());
  EP.qs("#btn-new").addEventListener("click", () => EP.confirmNew());
  EP.qs("#btn-preview").addEventListener("click", () => EP.openPreview());
  EP.qs("#btn-copy").addEventListener("click", () => EP.copyResponse());
  EP.qs("#btn-download").addEventListener("click", () => EP.downloadResponse());

  const prefix = EP.qs("#prefix-input");
  prefix.value = EP.state.prefix;
  prefix.addEventListener("input", () => {
    EP.state.prefix = prefix.value;
    EP.persist();
  });

  const toggle = EP.qs("#copy-prefix-toggle");
  EP.setPrefixToggle(EP.state.copyWithPrefix);
  toggle.addEventListener("click", () => {
    EP.setPrefixToggle(!EP.state.copyWithPrefix);
    EP.persist();
  });

  EP.qs("#preview-rendered").addEventListener("click", () => EP.setPreviewMode("rendered"));
  EP.qs("#preview-raw").addEventListener("click", () => EP.setPreviewMode("raw"));
  EP.qs("#btn-preview-copy").addEventListener("click", () => EP.copyResponse());
  EP.qs("#btn-preview-download").addEventListener("click", () => EP.downloadResponse());

  EP.qs("#btn-save-settings").addEventListener("click", () => EP.saveSettingsFromDialog());
  EP.qs("#btn-reset-settings").addEventListener("click", () => EP.resetSettings());
  EP.qs("#btn-toggle-key").addEventListener("click", () => {
    const input = EP.qs("#settings-key");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    EP.qs("#btn-toggle-key").textContent = show ? "Hide" : "Show";
  });

  EP.qs("#btn-confirm-ok").addEventListener("click", () => {
    const action = EP.qs("#dlg-confirm").dataset.action;
    EP.closeDialog("dlg-confirm");
    if (action === "new") EP.resetAll();
    if (action === "rebuild") EP.runCompile();
    if (action === "copy") EP.copyResponse(true);
    if (action === "download") EP.downloadResponse(true);
  });

  EP.qsa("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => EP.closeDialog(btn.getAttribute("data-close")));
  });

  EP.qsa(".dialog-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop && backdrop.dataset.lock !== "true") {
        EP.closeDialog(backdrop.id);
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const open = EP.qsa(".dialog-backdrop.is-open").pop();
      if (open && open.dataset.lock !== "true") EP.closeDialog(open.id);
    }
  });
};

EP.renderIntake = function renderIntake() {
  EP.qs("#template-text").textContent = EP.GRILLME_TEMPLATE;
  EP.qs("#grill-paste").value = EP.state.paste || "";
  EP.updatePasteMeta();
};

EP.updatePasteMeta = function updatePasteMeta() {
  const value = EP.qs("#grill-paste").value || "";
  const count = value.trim().length;
  EP.qs("#paste-count").textContent = count + " character" + (count === 1 ? "" : "s");
};

EP.showView = function showView(name) {
  EP.state.view = name;
  EP.qs("#view-intake").hidden = name !== "intake";
  EP.qs("#view-form").hidden = name !== "form";
  EP.qs("#dock").hidden = name !== "form";
  document.body.dataset.view = name;
};

EP.copyTemplate = async function copyTemplate() {
  try {
    await EP.copyText(EP.GRILLME_TEMPLATE);
    EP.toast("Grill prompt copied.");
  } catch (err) {
    EP.openError("Could not copy the template.", err.message);
  }
};

EP.loadSample = function loadSample() {
  EP.qs("#grill-paste").value = EP.SAMPLE_GRILL;
  EP.state.paste = EP.SAMPLE_GRILL;
  EP.qs("#paste-field").classList.remove("is-invalid");
  EP.qs("#paste-error").hidden = true;
  EP.updatePasteMeta();
  EP.persist();
  EP.toast("Sample grill loaded.");
};

EP.clearPaste = function clearPaste() {
  EP.qs("#grill-paste").value = "";
  EP.state.paste = "";
  EP.updatePasteMeta();
  EP.persist();
  EP.qs("#grill-paste").focus();
};

EP.buildForm = function buildForm() {
  if (!window.Clerk || !window.Clerk.loaded) {
    EP.toast("Authentication is still loading. Try again in a moment.");
    return;
  }
  if (!window.Clerk.isSignedIn) {
    EP.toast("Sign in first to build a form.");
    window.Clerk.openSignIn({ fallbackRedirectUrl: window.location.origin });
    return;
  }

  const paste = (EP.qs("#grill-paste").value || "").trim();
  EP.state.paste = paste;
  if (!paste) {
    EP.qs("#paste-field").classList.add("is-invalid");
    EP.qs("#paste-error").hidden = false;
    EP.qs("#grill-paste").focus();
    return;
  }
  EP.qs("#paste-field").classList.remove("is-invalid");
  EP.qs("#paste-error").hidden = true;
  EP.persist();

  if (EP.state.form && EP.state.form.questions && EP.state.form.questions.length) {
    EP.openConfirm(
      "Replace the current form?",
      "Building again will clear answers already entered on this grill.",
      "rebuild"
    );
    return;
  }

  EP.runCompile();
};

EP.runCompile = async function runCompile() {
  EP.openDialog("dlg-busy", true);
  EP.qs("#busy-status").textContent = "Warming the press";
  try {
    const form = await EP.compileForm(EP.state.paste, (status) => {
      EP.qs("#busy-status").textContent = status;
    });
    EP.state.form = form;
    EP.state.answers = {};
    form.questions.forEach((q) => {
      EP.state.answers[q.id] = EP.emptyAnswer(q);
    });
    EP.persist();
    EP.closeDialog("dlg-busy");
    EP.showView("form");
    EP.mountForm();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    EP.closeDialog("dlg-busy");
    EP.openError("The form could not be built.", err.message || String(err));
  }
};

EP.mountForm = function mountForm() {
  const form = EP.state.form;
  if (!form) return;

  EP.qs("#form-kicker").textContent = form.title || "Answer the grill";
  EP.qs("#prefix-input").value = EP.state.prefix;
  EP.setPrefixToggle(EP.state.copyWithPrefix);

  EP.renderForm(form, EP.state.answers, {
    onChange: (id, value) => EP.setAnswer(id, { value }),
    onMulti: (id, values) => EP.setAnswer(id, { values }),
    onOther: (id, other) => EP.setAnswer(id, { other }),
  });

  EP.updateProgress();
};

EP.setAnswer = function setAnswer(id, patch) {
  const question = EP.state.form.questions.find((item) => item.id === id);
  if (!question) return;
  const current = EP.state.answers[id] || EP.emptyAnswer(question);
  EP.state.answers[id] = Object.assign({}, current, patch);

  if (question.allowOther) {
    const card = document.getElementById("q-" + id);
    const other = card && card.querySelector(".other-wrap");
    if (other) {
      const selected =
        question.type === "multi"
          ? (EP.state.answers[id].values || []).some((optId) => EP.isOtherLabel(question, optId))
          : EP.isOtherLabel(question, EP.state.answers[id].value);
      other.hidden = !selected;
      other.classList.toggle("is-open", selected);
    }
  }

  EP.markInvalid(id, false);
  EP.syncNav(EP.state.form, EP.state.answers);
  EP.updateProgress();
  EP.persist();

  if (question.type === "yesno" || question.type === "toggle") {
    EP.remountQuestion(question);
  }
};

EP.remountQuestion = function remountQuestion(question) {
  const existing = document.getElementById("q-" + question.id);
  if (!existing) return;
  const index = EP.state.form.questions.findIndex((item) => item.id === question.id);
  const next = EP.renderQuestion(question, EP.state.answers[question.id], index, {
    onChange: (id, value) => EP.setAnswer(id, { value }),
    onMulti: (id, values) => EP.setAnswer(id, { values }),
    onOther: (id, other) => EP.setAnswer(id, { other }),
  });
  existing.replaceWith(next);
};

EP.updateProgress = function updateProgress() {
  const questions = EP.state.form ? EP.state.form.questions : [];
  const total = questions.length;
  const done = questions.filter((q) => EP.isAnswered(q, EP.state.answers[q.id])).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  EP.qs("#progress-label").textContent = done + " / " + total + " answered";
  EP.qs("#progress-bar").style.width = pct + "%";
  EP.qs("#progress-bar").parentElement.setAttribute("aria-valuenow", String(done));
  EP.qs("#progress-bar").parentElement.setAttribute("aria-valuemax", String(total));
};

EP.setPrefixToggle = function setPrefixToggle(on) {
  EP.state.copyWithPrefix = Boolean(on);
  const btn = EP.qs("#copy-prefix-toggle");
  btn.classList.toggle("is-on", EP.state.copyWithPrefix);
  btn.setAttribute("aria-checked", EP.state.copyWithPrefix ? "true" : "false");
  EP.qs("#prefix-field").classList.toggle("is-dim", !EP.state.copyWithPrefix);
};

EP.currentMarkdown = function currentMarkdown() {
  return EP.buildMarkdown(EP.state.form, EP.state.answers, {
    withPrefix: EP.state.copyWithPrefix,
    prefix: EP.state.prefix,
  });
};

EP.missingRequired = function missingRequired() {
  if (!EP.state.form) return [];
  return EP.state.form.questions.filter(
    (q) => q.required && !EP.isAnswered(q, EP.state.answers[q.id])
  );
};

EP.guardIncomplete = function guardIncomplete(force, action) {
  const missing = EP.missingRequired();
  EP.clearInvalid();
  if (!missing.length || force) return true;
  missing.forEach((q) => EP.markInvalid(q.id, true));
  const first = document.getElementById("q-" + missing[0].id);
  if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
  EP.openConfirm(
    "A few answers are still open",
    missing.length +
      " required question" +
      (missing.length === 1 ? "" : "s") +
      " have no answer. Continue anyway and mark those as not answered?",
    action
  );
  return false;
};

EP.copyResponse = async function copyResponse(force) {
  if (!EP.guardIncomplete(force, "copy")) return;
  try {
    await EP.copyText(EP.currentMarkdown());
    EP.toast("Response copied.");
  } catch (err) {
    EP.openError("Could not copy.", err.message);
  }
};

EP.downloadResponse = function downloadResponse(force) {
  if (!EP.guardIncomplete(force, "download")) return;
  const stamp = new Date().toISOString().slice(0, 10);
  EP.downloadText(EP.currentMarkdown(), "easyplan-responses-" + stamp + ".md");
  EP.toast("Markdown downloaded.");
};

EP.openPreview = function openPreview() {
  const md = EP.currentMarkdown();
  EP.qs("#preview-render").innerHTML = EP.renderMarkdown(md);
  EP.qs("#preview-source").textContent = md;
  EP.setPreviewMode(EP.state.previewMode);
  EP.openDialog("dlg-preview");
};

EP.setPreviewMode = function setPreviewMode(mode) {
  EP.state.previewMode = mode;
  EP.qs("#preview-rendered").classList.toggle("is-on", mode === "rendered");
  EP.qs("#preview-raw").classList.toggle("is-on", mode === "raw");
  EP.qs("#preview-render").hidden = mode !== "rendered";
  EP.qs("#preview-source").hidden = mode !== "raw";
};

EP.backToPaste = function backToPaste() {
  EP.showView("intake");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

EP.confirmNew = function confirmNew() {
  EP.openConfirm(
    "Start over?",
    "This clears the current form and answers. The pasted grill stays until you erase it.",
    "new"
  );
};

EP.resetAll = function resetAll() {
  EP.state.form = null;
  EP.state.answers = {};
  EP.persist();
  EP.showView("intake");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

EP.openSettings = function openSettings() {
  const settings = EP.getSettings();
  EP.qs("#settings-key").value = settings.apiKey;
  EP.qs("#settings-model").value = settings.model;
  EP.openDialog("dlg-settings");
};

EP.saveSettingsFromDialog = function saveSettingsFromDialog() {
  EP.saveSettings(EP.qs("#settings-key").value, EP.qs("#settings-model").value);
  EP.closeDialog("dlg-settings");
  EP.toast("Settings saved on this machine.");
};

EP.resetSettings = function resetSettings() {
  EP.saveSettings("", EP.CONFIG.defaultModel);
  EP.qs("#settings-key").value = "";
  EP.qs("#settings-model").value = EP.CONFIG.defaultModel;
  EP.toast("Defaults restored. No API key is stored.");
};

EP.openDialog = function openDialog(id, locked) {
  const dlg = EP.qs("#" + id);
  dlg.classList.add("is-open");
  dlg.dataset.lock = locked ? "true" : "false";
  dlg.setAttribute("aria-hidden", "false");
  const focusable = dlg.querySelector("button, [href], input, textarea, select");
  if (focusable && !locked) focusable.focus();
};

EP.closeDialog = function closeDialog(id) {
  const dlg = EP.qs("#" + id);
  if (!dlg) return;
  dlg.classList.remove("is-open");
  dlg.dataset.lock = "false";
  dlg.setAttribute("aria-hidden", "true");
};

EP.openConfirm = function openConfirm(title, body, action) {
  EP.qs("#confirm-title").textContent = title;
  EP.qs("#confirm-body").textContent = body;
  EP.qs("#dlg-confirm").dataset.action = action;
  EP.openDialog("dlg-confirm");
};

EP.openError = function openError(title, body) {
  EP.qs("#error-title").textContent = title;
  EP.qs("#error-body").textContent = body;
  EP.openDialog("dlg-error");
};

EP.toast = function toast(message) {
  const el = EP.qs("#toast");
  el.textContent = message;
  el.classList.add("is-on");
  clearTimeout(EP._toastTimer);
  EP._toastTimer = setTimeout(() => el.classList.remove("is-on"), 2200);
};

document.addEventListener("DOMContentLoaded", EP.init);

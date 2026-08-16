var EP = window.EP || (window.EP = {});

EP.CONFIG = {
  defaultApiKey: "",
  defaultModel: "deepseek/deepseek-v4-flash-0731",
  endpoint: "https://openrouter.ai/api/v1/chat/completions",
  compileEndpoint: "/api/compile",
  freeLimit: 3,
  referer: typeof location !== "undefined" ? location.origin : "https://easyplan.local",
  appTitle: "EasyPlan",
  storageKeys: {
    apiKey: "easyplan.apiKey",
    model: "easyplan.model",
    prefix: "easyplan.prefix",
    copyWithPrefix: "easyplan.copyWithPrefix",
    paste: "easyplan.paste",
    form: "easyplan.form",
    answers: "easyplan.answers",
  },
};

EP.DEFAULT_PREFIX = "Here is my response, please create the Plan based on this:";

EP.GRILLME_TEMPLATE = `To create the plan, please ask me 8--12 multiple choice, toggle, or short-answer questions to nail down my features and get clarifications. More if needed. Format clearly with question types.`;

EP.SAMPLE_GRILL = `Understood. I will grill you so I can write a thorough PLAN.md.

Please answer the following:

1. [Multiple choice] What is the primary product surface?
   A) Browser web app
   B) Native mobile
   C) Desktop app
   D) Multi-platform from day one

2. [Yes/No] Do you need user accounts and authentication in the first version?

3. [Multiple select] Which capabilities are must-have for v1?
   - Live collaboration
   - Offline use
   - Payments / billing
   - File uploads
   - Admin dashboard
   - Other

4. [Toggle] Should the first release stay single-player / single-workspace?

5. [Short answer] Who is the primary user, in one sentence?

6. [Long answer] Describe the one workflow that must feel magical. What does the user do, and what should happen?

7. [Multiple choice] How should data live?
   A) Entirely on the user's device
   B) Cloud-hosted with accounts
   C) Local-first, optional sync later
   D) Not sure yet

8. [Yes/No] Are you okay shipping a deliberately narrow v1 and cutting nice-to-haves?

9. [Short answer] Name any tools, APIs, or visual references the build should follow.

10. [Multiple choice] What is the visual tone?
    A) Quiet and editorial
    B) Loud and playful
    C) Dense and utilitarian
    D) I will decide later

Answer in whatever format is convenient.`;

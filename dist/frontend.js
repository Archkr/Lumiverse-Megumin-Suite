// src/defaults.ts
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
var DEFAULT_PROFILE = {
  mode: "v7-core",
  personality: "engine",
  toggles: {
    ooc: false,
    control: false,
    v7_ooc: true,
    v7_pcsolo: true,
    v7_culture: true,
    v7_scene: true,
    v7_intro: true,
    promptPreview: false
  },
  disableUtilityPrefill: false,
  aiTags: [],
  aiGeneratedOptions: [],
  aiRule: "",
  customStyles: [],
  activeStyleId: null,
  dnRatio: { enabled: false, dialogue: 50 },
  onomatopoeia: { enabled: false, useStyling: false },
  addons: [],
  blocks: [],
  model: "cot-v1-english",
  userNotes: "",
  userWordCount: "",
  userLanguage: "",
  userPronouns: "off",
  banList: [],
  banListBackend: "direct",
  thinkEffort: "unspecified",
  customThinkEffort: "100",
  thinkingV2: false,
  storyPlan: {
    enabled: false,
    backend: "direct",
    triggerMode: "manual",
    autoFreq: 10,
    currentPlan: ""
  },
  imageGen: {
    enabled: false,
    generatorBackend: "direct",
    connectionId: "",
    selectedModel: "",
    selectedSampler: "euler",
    scheduler: "",
    selectedLora: "",
    selectedLora2: "",
    selectedLora3: "",
    selectedLora4: "",
    selectedLoraWt: 1,
    selectedLoraWt2: 1,
    selectedLoraWt3: 1,
    selectedLoraWt4: 1,
    imgWidth: 1024,
    imgHeight: 1024,
    customNegative: "bad quality, blurry, worst quality, low quality",
    customSeed: -1,
    steps: 20,
    cfg: 7,
    denoise: 0.5,
    clipSkip: 1,
    promptStyle: "standard",
    promptPerspective: "scene",
    promptExtra: "",
    triggerMode: "manual",
    autoGenFreq: 1,
    previewPrompt: false
  },
  memoryCore: {
    enabled: false,
    architecture: "raw_short_long",
    workingLimit: 30,
    shortTermLimit: 70,
    backend: "direct",
    scannerEngine: "tfidf",
    triggerMode: "manual",
    autoFreq: 10,
    shortTermChunks: [],
    longTermVault: []
  },
  npcBank: {
    enabled: false,
    sendPortraitsToAi: false,
    npcs: []
  }
};
function mergeProfile(raw) {
  const base = clone(DEFAULT_PROFILE);
  if (!raw || typeof raw !== "object")
    return base;
  const input = raw;
  const merged = { ...base, ...input };
  merged.toggles = { ...base.toggles, ...input.toggles || {} };
  merged.dnRatio = { ...base.dnRatio, ...input.dnRatio || {} };
  merged.onomatopoeia = { ...base.onomatopoeia, ...input.onomatopoeia || {} };
  merged.storyPlan = { ...base.storyPlan, ...input.storyPlan || {} };
  merged.imageGen = { ...base.imageGen, ...input.imageGen || {} };
  merged.memoryCore = {
    ...base.memoryCore,
    ...input.memoryCore || {},
    shortTermChunks: input.memoryCore?.shortTermChunks || [],
    longTermVault: input.memoryCore?.longTermVault || []
  };
  merged.npcBank = {
    ...base.npcBank,
    ...input.npcBank || {},
    npcs: input.npcBank?.npcs || []
  };
  return merged;
}

// src/image-data.ts
var RESOLUTIONS = [
  { label: "1024 x 1024 (SDXL 1:1)", w: 1024, h: 1024 },
  { label: "1152 x 896 (SDXL Landscape)", w: 1152, h: 896 },
  { label: "896 x 1152 (SDXL Portrait)", w: 896, h: 1152 },
  { label: "1216 x 832 (SDXL Landscape)", w: 1216, h: 832 },
  { label: "832 x 1216 (SDXL Portrait)", w: 832, h: 1216 },
  { label: "1344 x 768 (SDXL Landscape)", w: 1344, h: 768 },
  { label: "768 x 1344 (SDXL Portrait)", w: 768, h: 1344 },
  { label: "512 x 512 (SD 1.5 1:1)", w: 512, h: 512 },
  { label: "768 x 512 (SD 1.5 Landscape)", w: 768, h: 512 },
  { label: "512 x 768 (SD 1.5 Portrait)", w: 512, h: 768 }
];

// src/frontend.ts
var ctxRef = null;
var appMount = null;
var floatWidget = null;
var removeStyle = null;
var cleanupTagInterceptor = null;
var pending = new Map;
var seq = 0;
var state = {
  ready: false,
  visible: false,
  saving: false,
  activeTab: 0,
  context: null,
  profile: clone(DEFAULT_PROFILE),
  logic: null,
  engines: [],
  customEngines: [],
  imageConnections: [],
  status: "Loading..."
};
var tabs = [
  { title: "Engines", short: "Eng", render: renderEngines },
  { title: "Style", short: "Style", render: renderStyle },
  { title: "Add-ons", short: "Add", render: renderAddons },
  { title: "Output", short: "Out", render: renderOutput },
  { title: "Story", short: "Story", render: renderStory },
  { title: "Ban List", short: "Ban", render: renderBanList },
  { title: "Image", short: "Image", render: renderImage },
  { title: "NPC Bank", short: "NPC", render: renderNpc },
  { title: "Memory", short: "Mem", render: renderMemory },
  { title: "Dev", short: "Dev", render: renderDev }
];
function setup(ctx) {
  ctxRef = ctx;
  removeStyle = ctxRef.dom.addStyle(styles());
  appMount = ctxRef.ui.mountApp({ className: "megumin-suite-app", position: "app-overlay" });
  appMount.setVisible(false);
  floatWidget = ctxRef.ui.createFloatWidget({
    width: 52,
    height: 52,
    initialPosition: { x: 24, y: 160 },
    snapToEdge: true,
    tooltip: "Megumin Suite",
    chromeless: true
  });
  floatWidget.root.className = "meg-float";
  floatWidget.root.innerHTML = `<button class="meg-float-btn" title="Megumin Suite" type="button">M</button>`;
  floatWidget.root.querySelector("button")?.addEventListener("click", () => openApp());
  const unsubscribeBackend = ctxRef.onBackendMessage((payload) => {
    const response = payload;
    if (!response?.requestId)
      return;
    const waiter = pending.get(response.requestId);
    if (!waiter)
      return;
    pending.delete(response.requestId);
    if (response.type === "rpc:error")
      waiter.reject(new Error(response.error || "Megumin request failed"));
    else
      waiter.resolve(response.payload);
  });
  cleanupTagInterceptor = ctxRef.messages?.registerTagInterceptor?.({ tagName: "megumin-image", removeFromMessage: true }, (payload) => renderMeguminImageTag(payload));
  bootstrap().catch((err) => {
    state.status = err.message;
    render();
  });
  return () => {
    unsubscribeBackend?.();
    cleanupTagInterceptor?.();
    floatWidget?.destroy?.();
    appMount?.destroy?.();
    removeStyle?.();
    ctxRef?.dom.cleanup?.();
  };
}
async function request(type, payload) {
  if (!ctxRef)
    throw new Error("Megumin frontend is not ready");
  const requestId = `meg-${Date.now()}-${++seq}`;
  const promise = new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
  ctxRef.sendToBackend({ type, requestId, payload });
  return promise;
}
async function bootstrap() {
  const data = await request("bootstrap");
  state.context = data.context;
  state.profile = mergeProfile(data.profile);
  state.logic = data.logic;
  state.engines = data.engines || [];
  state.customEngines = data.customEngines || [];
  state.imageConnections = data.imageConnections || [];
  state.ready = true;
  state.status = "Ready";
  render();
}
function openApp() {
  state.visible = true;
  appMount?.setVisible(true);
  render();
}
function closeApp() {
  state.visible = false;
  appMount?.setVisible(false);
}
function root() {
  return appMount.root;
}
function render() {
  if (!appMount || !state.visible)
    return;
  const current = tabs[state.activeTab] || tabs[0];
  root().innerHTML = `
    <div class="meg-shell">
      <aside class="meg-dock">
        ${tabs.map((tab, index) => `<button type="button" class="meg-dock-btn ${index === state.activeTab ? "active" : ""}" data-tab="${index}" title="${tab.title}"><span>${escapeHtml(tab.short)}</span></button>`).join("")}
      </aside>
      <main class="meg-window">
        <section class="meg-hero">
          <div>
            <div class="meg-status">${escapeHtml(scopeLabel())}</div>
            <h1>Megumin Suite</h1>
            <p>${escapeHtml(current.title)} controls for ${escapeHtml(state.context?.characterName || "the active chat")}.</p>
          </div>
          <div class="meg-actions">
            <span class="meg-save ${state.saving ? "saving" : ""}">${escapeHtml(state.status)}</span>
            <button type="button" class="meg-btn subtle" data-action="refresh">Refresh</button>
            <button type="button" class="meg-btn subtle danger" data-action="reset">Reset</button>
            <button type="button" class="meg-btn primary" data-action="close">Close</button>
          </div>
        </section>
        <section class="meg-content">
          ${current.render()}
        </section>
      </main>
    </div>`;
  wire(root());
}
function scopeLabel() {
  return state.context?.chatId ? `Chat Profile: ${state.context.chatId}` : "Global Profile";
}
function wire(container) {
  container.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = Number(button.dataset.tab || 0);
      render();
    });
  });
  container.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", () => handleAction(el));
  });
  container.querySelectorAll("[data-bind]").forEach((input) => {
    input.addEventListener("change", () => {
      const path = input.dataset.bind;
      const value = readInputValue(input);
      setPath(state.profile, path, value);
      saveProfileSoon();
      render();
    });
    if (input.tagName === "TEXTAREA" || input.type === "text" || input.type === "number" || input.type === "range") {
      input.addEventListener("input", () => {
        const path = input.dataset.bind;
        setPath(state.profile, path, readInputValue(input));
        saveProfileSoon();
      });
    }
  });
}
function readInputValue(input) {
  if (input instanceof HTMLInputElement && input.type === "checkbox")
    return input.checked;
  if (input instanceof HTMLInputElement && (input.type === "number" || input.type === "range"))
    return Number(input.value);
  return input.value;
}
var saveTimer = null;
function saveProfileSoon() {
  if (saveTimer)
    window.clearTimeout(saveTimer);
  state.saving = true;
  state.status = "Saving...";
  saveTimer = window.setTimeout(async () => {
    try {
      const data = await request("profile:save", { profile: state.profile });
      state.profile = mergeProfile(data.profile);
      state.status = "Saved";
    } catch (err) {
      state.status = err instanceof Error ? err.message : "Save failed";
    } finally {
      state.saving = false;
      render();
    }
  }, 250);
}
async function handleAction(el) {
  const action = el.dataset.action;
  try {
    if (action === "close")
      return closeApp();
    if (action === "refresh") {
      state.status = "Refreshing...";
      render();
      await bootstrap();
      return;
    }
    if (action === "reset") {
      if (!confirm("Reset this Megumin profile to defaults?"))
        return;
      const data = await request("profile:reset");
      state.profile = mergeProfile(data.profile);
      state.status = "Reset";
      render();
      return;
    }
    if (action === "toggle") {
      const path = el.dataset.path;
      setPath(state.profile, path, !getPath(state.profile, path));
      saveProfileSoon();
      render();
      return;
    }
    if (action === "select") {
      setPath(state.profile, el.dataset.path, el.dataset.value);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "toggle-array") {
      const path = el.dataset.path;
      const value = el.dataset.value;
      const current = [...getPath(state.profile, path) || []];
      setPath(state.profile, path, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "select-resolution") {
      state.profile.imageGen.imgWidth = Number(el.dataset.w || state.profile.imageGen.imgWidth);
      state.profile.imageGen.imgHeight = Number(el.dataset.h || state.profile.imageGen.imgHeight);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "story-generate")
      return runTask("Generating story plan...", "story:generate");
    if (action === "ban-analyze")
      return runTask("Analyzing style...", "banlist:analyze");
    if (action === "memory-process")
      return runTask("Processing memory...", "memory:process");
    if (action === "npc-scan")
      return runTask("Scanning NPCs...", "npc:scan");
    if (action === "image-manual") {
      const prompt = root().querySelector("#meg-manual-image-prompt")?.value || "";
      return runTask("Generating image...", "image:manual", { prompt });
    }
    if (action === "npc-portrait")
      return runTask(`Generating portrait...`, "npc:portrait", { name: el.dataset.name });
    if (action === "ban-remove") {
      state.profile.banList = state.profile.banList.filter((item) => item !== el.dataset.value);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "ban-add") {
      const raw = root().querySelector("#ban-manual")?.value || "";
      const additions = raw.split(/\n+/).map((item) => item.trim()).filter(Boolean);
      for (const item of additions)
        if (!state.profile.banList.includes(item))
          state.profile.banList.push(item);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "npc-remove") {
      state.profile.npcBank.npcs = state.profile.npcBank.npcs.filter((item) => item.name !== el.dataset.name);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "dev-save")
      return saveDevEngine();
    if (action === "dev-delete")
      return deleteDevEngine(el.dataset.id || "");
  } catch (err) {
    state.status = err instanceof Error ? err.message : String(err);
    render();
  }
}
async function runTask(status, type, payload) {
  state.status = status;
  render();
  const data = await request(type, payload);
  if (data.profile)
    state.profile = mergeProfile(data.profile);
  if (data.imageConnections)
    state.imageConnections = data.imageConnections;
  state.status = "Done";
  render();
}
async function saveDevEngine() {
  const id = root().querySelector("#dev-id")?.value.trim();
  const label = root().querySelector("#dev-label")?.value.trim();
  const p1 = root().querySelector("#dev-p1")?.value || "";
  const p4 = root().querySelector("#dev-p4")?.value || "";
  const p6 = root().querySelector("#dev-p6")?.value || "";
  if (!id || !label)
    throw new Error("Engine id and label are required");
  const data = await request("engine:save", { engine: { id, label, color: "#a855f7", p1, p4, p6 } });
  state.engines = data.engines;
  state.customEngines = data.customEngines;
  state.status = "Engine saved";
  render();
}
async function deleteDevEngine(id) {
  if (!id || !confirm(`Delete ${id}?`))
    return;
  const data = await request("engine:delete", { id });
  state.engines = data.engines;
  state.customEngines = data.customEngines;
  state.status = "Engine deleted";
  render();
}
function renderEngines() {
  return `
    <div class="meg-grid">
      ${state.engines.map((engine) => card({
    title: engine.label || engine.id,
    sub: engine.id,
    active: state.profile.mode === engine.id,
    color: engine.color || "#10b981",
    action: "select",
    path: "mode",
    value: engine.id
  })).join("")}
    </div>
    <div class="meg-panel">
      <h2>Engine Toggles</h2>
      ${toggleRow("OOC Protocol", "v7_ooc", "Keep the V7 out-of-character directive active.")}
      ${toggleRow("PC Solo Physicality", "v7_pcsolo", "Allow observable body language when the user character is alone.")}
      ${toggleRow("Cultural Anchoring", "v7_culture", "Use era-specific culture and real-world specificity in suitable scenes.")}
      ${toggleRow("Scene Choreography", "v7_scene", "Keep crowd management and camera-focus rules active.")}
      ${toggleRow("Intro Protocol", "v7_intro", "Preserve V7 opening-scene behavior.")}
    </div>`;
}
function renderStyle() {
  const personalities = state.logic?.personalities || [];
  return `
    <div class="meg-panel">
      <h2>Personality Core</h2>
      <div class="meg-grid compact">
        ${personalities.map((item) => card({ title: item.label, sub: item.content, active: state.profile.personality === item.id, action: "select", path: "personality", value: item.id })).join("")}
      </div>
    </div>
    <div class="meg-panel">
      <h2>Writing Rule</h2>
      <textarea class="meg-textarea tall" data-bind="aiRule" placeholder="Custom style or authoring rule...">${escapeHtml(state.profile.aiRule)}</textarea>
    </div>
    <div class="meg-panel two">
      ${inputField("Language", "userLanguage", state.profile.userLanguage, "English")}
      ${inputField("Word Count", "userWordCount", state.profile.userWordCount, "600")}
      ${selectField("Pronouns", "userPronouns", state.profile.userPronouns, [
    ["off", "Off"],
    ["male", "Male"],
    ["female", "Female"]
  ])}
      ${selectField("Thinking Effort", "thinkEffort", state.profile.thinkEffort, [
    ["unspecified", "Unspecified"],
    ["50", "50 words"],
    ["100", "100 words"],
    ["200", "200 words"],
    ["custom", "Custom"]
  ])}
    </div>`;
}
function renderAddons() {
  const addons = state.logic?.addons || [];
  return `
    <div class="meg-panel">
      <h2>Add-ons</h2>
      <div class="meg-grid">
        ${addons.map((item) => multiCard(item.label, item.content, state.profile.addons.includes(item.id), "addons", item.id)).join("")}
      </div>
    </div>`;
}
function renderOutput() {
  const blocks = state.logic?.blocks || [];
  const models = state.logic?.models || [];
  return `
    <div class="meg-panel">
      <h2>Output Blocks</h2>
      <div class="meg-grid compact">
        ${blocks.map((item) => multiCard(item.label, item.content, state.profile.blocks.includes(item.id), "blocks", item.id)).join("")}
      </div>
    </div>
    <div class="meg-panel">
      <h2>Chain of Thought</h2>
      <div class="meg-grid compact">
        ${models.map((item) => card({ title: item.label || item.id, sub: item.id, active: state.profile.model === item.id, action: "select", path: "model", value: item.id })).join("")}
      </div>
      ${toggleRow("Gemini Thinking", "thinkingV2", "Inject the triple think opener used by the original Suite.")}
      ${toggleGeneric("Dialogue/Narration Ratio", "dnRatio.enabled", state.profile.dnRatio.enabled, "Control the dialogue-to-narration balance.")}
      ${rangeField("Dialogue %", "dnRatio.dialogue", state.profile.dnRatio.dialogue, 0, 100)}
      ${toggleGeneric("Onomatopoeia", "onomatopoeia.enabled", state.profile.onomatopoeia.enabled, "Require sound words where physically appropriate.")}
    </div>`;
}
function renderStory() {
  return `
    <div class="meg-panel">
      <h2>Story Planner</h2>
      ${toggleGeneric("Enabled", "storyPlan.enabled", state.profile.storyPlan.enabled, "Inject the current plan and tracker into Megumin prompts.")}
      ${selectField("Trigger", "storyPlan.triggerMode", state.profile.storyPlan.triggerMode, [["manual", "Manual"], ["frequency", "Frequency"]])}
      ${inputField("Auto Frequency", "storyPlan.autoFreq", String(state.profile.storyPlan.autoFreq), "10", "number")}
      <button class="meg-btn primary" type="button" data-action="story-generate">Generate Plan Now</button>
      <textarea class="meg-textarea xl" data-bind="storyPlan.currentPlan">${escapeHtml(state.profile.storyPlan.currentPlan)}</textarea>
    </div>`;
}
function renderBanList() {
  return `
    <div class="meg-panel">
      <h2>Dynamic Ban List</h2>
      <button class="meg-btn primary" type="button" data-action="ban-analyze">Analyze Chat</button>
      <div class="meg-tags">
        ${state.profile.banList.length ? state.profile.banList.map((item) => `<button type="button" class="meg-tag" data-action="ban-remove" data-value="${escapeHtml(item)}">${escapeHtml(item)} x</button>`).join("") : `<span class="meg-muted">No phrases banned yet.</span>`}
      </div>
      <textarea class="meg-textarea" placeholder="Add one phrase per line" id="ban-manual"></textarea>
      <button class="meg-btn subtle" type="button" data-action="ban-add">Add Phrases</button>
    </div>`;
}
function renderImage() {
  return `
    <div class="meg-panel">
      <h2>Image Generation</h2>
      ${toggleGeneric("Enabled", "imageGen.enabled", state.profile.imageGen.enabled, "Allow Megumin to generate scene images.")}
      ${selectField("Trigger", "imageGen.triggerMode", state.profile.imageGen.triggerMode, [["manual", "Manual"], ["always", "Always"], ["frequency", "Frequency"], ["conditional", "Conditional"]])}
      ${selectField("Connection", "imageGen.connectionId", state.profile.imageGen.connectionId, [["", "Default"], ...state.imageConnections.map((c) => [String(c.id), `${c.name} (${c.provider})`])])}
      ${selectField("Style", "imageGen.promptStyle", state.profile.imageGen.promptStyle, [["standard", "Standard"], ["illustrious", "Illustrious tags"], ["sdxl", "SDXL prose"]])}
      ${selectField("Perspective", "imageGen.promptPerspective", state.profile.imageGen.promptPerspective, [["scene", "Scene"], ["pov", "POV"], ["character", "Character"]])}
      <div class="meg-row-wrap">${RESOLUTIONS.map((res) => `<button type="button" class="meg-chip" data-action="select-resolution" data-w="${res.w}" data-h="${res.h}">${escapeHtml(res.label)}</button>`).join("")}</div>
      ${inputField("Width", "imageGen.imgWidth", String(state.profile.imageGen.imgWidth), "1024", "number")}
      ${inputField("Height", "imageGen.imgHeight", String(state.profile.imageGen.imgHeight), "1024", "number")}
      ${inputField("Steps", "imageGen.steps", String(state.profile.imageGen.steps), "20", "number")}
      ${inputField("CFG", "imageGen.cfg", String(state.profile.imageGen.cfg), "7", "number")}
      ${inputField("Sampler", "imageGen.selectedSampler", state.profile.imageGen.selectedSampler, "euler")}
      <textarea class="meg-textarea" data-bind="imageGen.customNegative">${escapeHtml(state.profile.imageGen.customNegative)}</textarea>
      <textarea id="meg-manual-image-prompt" class="meg-textarea" placeholder="Optional manual image prompt..."></textarea>
      <button class="meg-btn primary" type="button" data-action="image-manual">Generate Image</button>
    </div>`;
}
function renderNpc() {
  return `
    <div class="meg-panel">
      <h2>NPC Bank</h2>
      ${toggleGeneric("Enabled", "npcBank.enabled", state.profile.npcBank.enabled, "Capture and inject significant NPC dossiers.")}
      ${toggleGeneric("Send Portraits To AI", "npcBank.sendPortraitsToAi", state.profile.npcBank.sendPortraitsToAi, "Use generated portraits as multimodal context when relevant.")}
      <button class="meg-btn primary" type="button" data-action="npc-scan">Scan Last Message</button>
    </div>
    <div class="meg-list">
      ${state.profile.npcBank.npcs.length ? state.profile.npcBank.npcs.map(renderNpcCard).join("") : `<div class="meg-panel"><span class="meg-muted">No NPCs saved yet.</span></div>`}
    </div>`;
}
function renderNpcCard(npc) {
  return `
    <article class="meg-panel npc">
      ${npc.pfpImageUrl ? `<img class="npc-img" src="${escapeHtml(npc.pfpImageUrl)}" alt="">` : `<div class="npc-img placeholder">${escapeHtml(npc.name.slice(0, 1))}</div>`}
      <div>
        <h2>${escapeHtml(npc.name)}</h2>
        <p>${escapeHtml([npc.age, npc.sex, npc.occupation].filter(Boolean).join(" | "))}</p>
        <p>${escapeHtml(npc.appearance || npc.background || "No dossier details yet.")}</p>
        <button class="meg-btn subtle" type="button" data-action="npc-portrait" data-name="${escapeHtml(npc.name)}">Portrait</button>
        <button class="meg-btn subtle danger" type="button" data-action="npc-remove" data-name="${escapeHtml(npc.name)}">Remove</button>
      </div>
    </article>`;
}
function renderMemory() {
  const mem = state.profile.memoryCore;
  return `
    <div class="meg-panel">
      <h2>Memory Core</h2>
      ${toggleGeneric("Enabled", "memoryCore.enabled", mem.enabled, "Archive older messages and inject relevant memory.")}
      ${selectField("Architecture", "memoryCore.architecture", mem.architecture, [["raw_short_long", "Raw + Short + Long"], ["raw_long", "Raw + Long"]])}
      ${selectField("Trigger", "memoryCore.triggerMode", mem.triggerMode, [["manual", "Manual"], ["frequency", "Frequency"]])}
      ${inputField("Working Limit", "memoryCore.workingLimit", String(mem.workingLimit), "30", "number")}
      ${inputField("Short-Term Limit", "memoryCore.shortTermLimit", String(mem.shortTermLimit), "70", "number")}
      <button class="meg-btn primary" type="button" data-action="memory-process">Apply & Extract Pending</button>
    </div>
    <div class="meg-grid compact">
      ${statCard("Short-Term", String(mem.shortTermChunks.length), "AI summaries")}
      ${statCard("Long-Term", String(mem.longTermVault.length), "raw vault entries")}
      ${statCard("Saved", `~${estimateTokensSaved()}`, "estimated tokens")}
    </div>
    <div class="meg-panel">
      <h2>Vault</h2>
      ${(mem.longTermVault || []).slice(-20).reverse().map((chunk) => `<details><summary>${escapeHtml(chunk.id)}</summary><pre>${escapeHtml(chunk.text || chunk.summary || "")}</pre></details>`).join("") || `<span class="meg-muted">No vault entries yet.</span>`}
    </div>`;
}
function renderDev() {
  return `
    <div class="meg-panel">
      <h2>Visual Engine Builder</h2>
      <input id="dev-id" class="meg-input" placeholder="engine_id">
      <input id="dev-label" class="meg-input" placeholder="Display name">
      <textarea id="dev-p1" class="meg-textarea tall" placeholder="Prompt 1"></textarea>
      <textarea id="dev-p4" class="meg-textarea tall" placeholder="Prompt 4"></textarea>
      <textarea id="dev-p6" class="meg-textarea tall" placeholder="Prompt 6"></textarea>
      <button class="meg-btn primary" type="button" data-action="dev-save">Save Engine</button>
    </div>
    <div class="meg-list">
      ${state.customEngines.map((engine) => `<div class="meg-panel row"><strong>${escapeHtml(engine.label || engine.id)}</strong><button class="meg-btn subtle danger" type="button" data-action="dev-delete" data-id="${escapeHtml(engine.id)}">Delete</button></div>`).join("")}
    </div>`;
}
function estimateTokensSaved() {
  const chars = [...state.profile.memoryCore.shortTermChunks, ...state.profile.memoryCore.longTermVault].reduce((total, chunk) => total + (chunk.text || chunk.summary || "").length, 0);
  return Math.ceil(chars / 4);
}
function toggleRow(label, key, desc) {
  return toggleGeneric(label, `toggles.${key}`, !!state.profile.toggles[key], desc);
}
function toggleGeneric(label, path, active, desc) {
  return `<button type="button" class="meg-toggle ${active ? "active" : ""}" data-action="toggle" data-path="${path}">
    <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(desc)}</small></span><i></i>
  </button>`;
}
function card(input) {
  return `<button type="button" class="meg-card ${input.active ? "active" : ""}" data-action="${input.action}" data-path="${input.path || ""}" data-value="${escapeHtml(input.value || "")}" style="--accent:${input.color || "#10b981"}">
    <strong>${escapeHtml(input.title)}</strong><span>${escapeHtml(input.sub || "")}</span>
  </button>`;
}
function multiCard(title, sub, active, path, value) {
  return `<button type="button" class="meg-card ${active ? "active" : ""}" data-action="toggle-array" data-path="${path}" data-value="${escapeHtml(value)}">
    <strong>${escapeHtml(title)}</strong><span>${escapeHtml(strip(sub).slice(0, 180))}</span>
  </button>`;
}
function statCard(title, value, sub) {
  return `<div class="meg-panel stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(title)}</span><small>${escapeHtml(sub)}</small></div>`;
}
function inputField(label, path, value, placeholder = "", type = "text") {
  return `<label class="meg-field"><span>${escapeHtml(label)}</span><input class="meg-input" type="${type}" data-bind="${path}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"></label>`;
}
function rangeField(label, path, value, min, max) {
  return `<label class="meg-field"><span>${escapeHtml(label)}</span><input class="meg-input" type="range" min="${min}" max="${max}" data-bind="${path}" value="${value}"><b>${value}</b></label>`;
}
function selectField(label, path, value, options) {
  return `<label class="meg-field"><span>${escapeHtml(label)}</span><select class="meg-input" data-bind="${path}">
    ${options.map(([id, text]) => `<option value="${escapeHtml(id)}" ${id === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}
  </select></label>`;
}
function getPath(target, path) {
  return path.split(".").reduce((value, key) => value?.[key], target);
}
function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object")
      cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}
function strip(html) {
  return String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function renderMeguminImageTag(payload) {
  if (!ctxRef || !payload?.messageId)
    return;
  const bubble = ctxRef.dom.findMessageElement(payload.messageId);
  if (!bubble)
    return;
  const id = payload.attrs?.["image-id"] || "";
  const src = payload.attrs?.src || (id ? `/api/v1/images/${id}` : "");
  const prompt = payload.attrs?.prompt || "";
  if (!src || bubble.querySelector(`[data-megumin-image="${CSS.escape(id || src)}"]`))
    return;
  const html = `
    <div class="meg-inline-image" data-megumin-image="${escapeHtml(id || src)}">
      <img src="${escapeHtml(src)}" alt="Megumin generated image">
      <div><strong>Megumin Image</strong><span>${escapeHtml(prompt)}</span></div>
    </div>`;
  ctxRef.dom.inject(bubble, html, "beforeend");
}
function styles() {
  return `
.meg-float { width:52px;height:52px; }
.meg-float-btn { width:52px;height:52px;border-radius:16px;border:1px solid rgba(245,158,11,.45);background:#18181b;color:#f59e0b;font-weight:900;font-size:22px;box-shadow:0 12px 34px rgba(0,0,0,.35);cursor:pointer; }
.meg-float-btn:hover { transform:translateY(-1px); background:#232329; }
.meg-shell { position:fixed; inset:0; display:grid; grid-template-columns:76px minmax(0,1fr); background:#0d0e10; color:#f4f4f5; font-family:Inter, ui-sans-serif, system-ui, sans-serif; z-index:1; }
.meg-dock { padding:16px 10px; display:flex; flex-direction:column; gap:8px; background:#111215; border-right:1px solid #2a2c32; }
.meg-dock-btn { height:44px; border:1px solid #2a2c32; background:#181a1f; color:#a1a1aa; border-radius:8px; cursor:pointer; font-weight:800; }
.meg-dock-btn.active { color:#111; background:#f59e0b; border-color:#f59e0b; }
.meg-window { min-width:0; display:flex; flex-direction:column; height:100vh; }
.meg-hero { min-height:168px; display:flex; align-items:end; justify-content:space-between; gap:24px; padding:28px 34px; background:linear-gradient(115deg,#15171d,#20242b 45%,#111215); border-bottom:1px solid #2a2c32; }
.meg-hero h1 { margin:0; font-size:42px; line-height:1; letter-spacing:0; }
.meg-hero p { margin:8px 0 0; color:#a1a1aa; }
.meg-status { color:#f59e0b; font-size:12px; font-weight:900; text-transform:uppercase; }
.meg-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:end; }
.meg-save { color:#a1a1aa; font-size:13px; }
.meg-save.saving { color:#f59e0b; }
.meg-content { padding:24px 34px 42px; overflow:auto; display:flex; flex-direction:column; gap:18px; }
.meg-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; }
.meg-grid.compact { grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); }
.meg-panel { background:#17191e; border:1px solid #2a2c32; border-radius:8px; padding:16px; color:#f4f4f5; }
.meg-panel h2 { margin:0 0 12px; font-size:17px; letter-spacing:0; }
.meg-panel.two { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; }
.meg-panel.row { display:flex; align-items:center; justify-content:space-between; gap:14px; }
.meg-panel.stat strong { display:block; font-size:28px; color:#f59e0b; }
.meg-panel.stat span { font-weight:800; }
.meg-panel.stat small, .meg-muted { color:#a1a1aa; }
.meg-card { min-height:116px; text-align:left; display:flex; flex-direction:column; gap:8px; padding:14px; border-radius:8px; border:1px solid #2a2c32; background:#111215; color:#f4f4f5; cursor:pointer; overflow:hidden; }
.meg-card strong { font-size:15px; }
.meg-card span { color:#a1a1aa; font-size:12px; line-height:1.35; }
.meg-card.active { border-color:var(--accent,#f59e0b); box-shadow:0 0 0 1px var(--accent,#f59e0b) inset; }
.meg-toggle { width:100%; display:flex; justify-content:space-between; gap:16px; align-items:center; border:1px solid #2a2c32; background:#111215; color:#f4f4f5; border-radius:8px; padding:12px 14px; margin:8px 0; cursor:pointer; text-align:left; }
.meg-toggle small { display:block; color:#a1a1aa; margin-top:3px; }
.meg-toggle i { width:38px; height:22px; border-radius:999px; background:#3f3f46; position:relative; flex:0 0 auto; }
.meg-toggle i:after { content:""; width:18px; height:18px; background:#fff; border-radius:50%; position:absolute; top:2px; left:2px; transition:.18s; }
.meg-toggle.active { border-color:#f59e0b; }
.meg-toggle.active i { background:#f59e0b; }
.meg-toggle.active i:after { left:18px; background:#111; }
.meg-field { display:flex; flex-direction:column; gap:6px; color:#a1a1aa; font-size:12px; font-weight:800; text-transform:uppercase; }
.meg-input, .meg-textarea { width:100%; box-sizing:border-box; background:#101115; color:#f4f4f5; border:1px solid #2a2c32; border-radius:8px; padding:10px 12px; font:inherit; text-transform:none; }
.meg-textarea { min-height:118px; resize:vertical; }
.meg-textarea.tall { min-height:190px; }
.meg-textarea.xl { min-height:360px; margin-top:14px; }
.meg-btn { border:1px solid #2a2c32; border-radius:8px; padding:9px 14px; cursor:pointer; font-weight:800; background:#111215; color:#f4f4f5; }
.meg-btn.primary { background:#10b981; border-color:#10b981; color:#051b13; }
.meg-btn.subtle { background:#111215; }
.meg-btn.danger, .meg-btn.subtle.danger { color:#f87171; border-color:rgba(248,113,113,.45); }
.meg-tags, .meg-row-wrap { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; }
.meg-tag, .meg-chip { border:1px solid #2a2c32; border-radius:999px; padding:7px 10px; background:#111215; color:#f4f4f5; cursor:pointer; }
.meg-list { display:flex; flex-direction:column; gap:12px; }
.meg-panel.npc { display:grid; grid-template-columns:96px minmax(0,1fr); gap:14px; }
.npc-img { width:96px; height:96px; border-radius:8px; object-fit:cover; background:#101115; border:1px solid #2a2c32; display:grid; place-items:center; color:#f59e0b; font-size:32px; font-weight:900; }
details { border-top:1px solid #2a2c32; padding:10px 0; }
pre { white-space:pre-wrap; color:#d4d4d8; }
.meg-inline-image { margin-top:10px; border:1px solid #2a2c32; background:#111215; border-radius:8px; overflow:hidden; max-width:420px; }
.meg-inline-image img { display:block; width:100%; height:auto; }
.meg-inline-image div { padding:10px; display:flex; flex-direction:column; gap:4px; }
.meg-inline-image span { color:#a1a1aa; font-size:12px; }
@media (max-width:760px) {
  .meg-shell { grid-template-columns:1fr; }
  .meg-dock { flex-direction:row; overflow:auto; border-right:0; border-bottom:1px solid #2a2c32; padding:8px; }
  .meg-dock-btn { min-width:56px; }
  .meg-hero { min-height:142px; align-items:start; flex-direction:column; padding:20px; }
  .meg-hero h1 { font-size:32px; }
  .meg-content { padding:16px; }
}`;
}
export {
  setup
};

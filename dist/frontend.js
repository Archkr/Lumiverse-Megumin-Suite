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
var KAZUMA_PLACEHOLDERS = [
  { key: '"%prompt%"', desc: "Positive Prompt (Text)" },
  { key: '"%negative_prompt%"', desc: "Negative Prompt (Text)" },
  { key: '"%seed%"', desc: "Seed (Integer)" },
  { key: '"%steps%"', desc: "Sampling Steps (Integer)" },
  { key: '"%scale%"', desc: "CFG Scale (Float)" },
  { key: '"%denoise%"', desc: "Denoise Strength (Float)" },
  { key: '"%clip_skip%"', desc: "CLIP Skip (Integer)" },
  { key: '"%model%"', desc: "Checkpoint Name" },
  { key: '"%sampler%"', desc: "Sampler Name" },
  { key: '"%width%"', desc: "Image Width (px)" },
  { key: '"%height%"', desc: "Image Height (px)" },
  { key: '"%lora1%"', desc: "LoRA 1 Filename" },
  { key: '"%lorawt1%"', desc: "LoRA 1 Weight (Float)" },
  { key: '"%lora2%"', desc: "LoRA 2 Filename" },
  { key: '"%lorawt2%"', desc: "LoRA 2 Weight (Float)" },
  { key: '"%lora3%"', desc: "LoRA 3 Filename" },
  { key: '"%lorawt3%"', desc: "LoRA 3 Weight (Float)" },
  { key: '"%lora4%"', desc: "LoRA 4 Filename" },
  { key: '"%lorawt4%"', desc: "LoRA 4 Weight (Float)" }
];
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
  devMode: false,
  engineFilter: "all",
  styleFilter: "direct",
  context: null,
  profile: clone(DEFAULT_PROFILE),
  logic: null,
  engines: [],
  customEngines: [],
  imageConnections: [],
  uiAssets: { heroImages: [] },
  status: "Loading..."
};
var tabs = [
  { title: "Core Engine", sub: "Choose the core ruleset that drives NPC behavior and world logic.", short: "Engine", icon: "server", color: "#f59e0b", render: renderEngines },
  { title: "Persona & Toggles", sub: "Set the narrator voice and fine-tune engine behavior.", short: "Persona", icon: "masks", color: "#ec4899", render: renderPersona },
  { title: "Writing Style", sub: "Apply a prebuilt style, generate one with AI, or build your own.", short: "Style", icon: "pen", color: "#a855f7", render: renderStyle },
  { title: "Global Settings", sub: "Set response length, output language, pronouns, and utility behavior.", short: "Global", icon: "globe", color: "#3b82f6", render: renderGlobalSettings },
  { title: "Add-ons & Blocks", sub: "Attach extra gameplay modules and response panels.", short: "Blocks", icon: "puzzle", color: "#10b981", render: renderBlocks },
  { title: "Chain of Thought", sub: "Configure the reasoning framework and thinking depth.", short: "Thinking", icon: "brain", color: "#8b5cf6", render: renderThinking },
  { title: "Story Planner", sub: "Brainstorm and track plot milestones automatically.", short: "Story", icon: "map", color: "#f59e0b", render: renderStory },
  { title: "Dynamic Ban List", sub: "Detect and ban repetitive AI phrasing.", short: "Ban", icon: "ban", color: "#ef4444", render: renderBanList },
  { title: "Image Generation", sub: "Use Lumiverse image connections for scene rendering.", short: "Image", icon: "image", color: "#06b6d4", render: renderImage },
  { title: "NPCs Bank", sub: "Extract, store, recall, and portrait significant NPCs.", short: "NPCs", icon: "address", color: "#22c55e", render: renderNpc },
  { title: "Memory Core", sub: "Advanced 3-tier context and history management.", short: "Memory", icon: "memory", color: "#38bdf8", render: renderMemory }
];
var devTab = { title: "Dev Engine Builder", sub: "Clone, edit, and save custom Megumin engine blocks.", short: "Dev", icon: "code", color: "#a855f7", render: renderDev };
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
  floatWidget.root.innerHTML = `<button class="meg-float-btn" title="Megumin Suite" type="button" aria-label="Megumin Suite">${icon("wand")}</button>`;
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
  state.uiAssets = data.uiAssets || { heroImages: [] };
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
  const current = state.devMode ? devTab : tabs[state.activeTab] || tabs[0];
  const heroImage = state.uiAssets.heroImages[(state.activeTab + (state.context?.chatId || "").length) % Math.max(1, state.uiAssets.heroImages.length)] || "";
  root().innerHTML = `
    <div class="meg-overlay">
      <div class="ps-modern-modal app-container">
        <nav class="dock" id="ps_dynamic_dots" aria-label="Megumin Suite sections">
          ${tabs.map((tab, index) => dockButton(tab, index)).join("")}
        </nav>
        <div class="main-wrapper">
          <section class="hero-banner" ${heroImage ? `style="background-image:url('${escapeHtml(heroImage)}')"` : ""}>
            <div class="hero-overlay"></div>
            <div class="top-app-bar">
              <div class="app-actions">
                <div class="live-token-count" title="Estimated Payload Tokens">${icon("microchip")} ~${estimatePayloadTokens()}</div>
                <button type="button" class="ps-modern-btn secondary gold" data-action="sync-tab">${icon("globe")} Sync Tab Globally</button>
                <button type="button" class="ps-modern-btn secondary danger" data-action="reset">${icon("reset")} Reset</button>
                <button type="button" class="ps-modern-btn secondary purple ${state.devMode ? "active" : ""}" data-action="open-dev">${icon("code")} Dev</button>
                <span class="ps-save-indicator ${state.saving ? "saving" : ""}">${escapeHtml(state.status)}</span>
                <button type="button" class="ps-modern-btn primary" data-action="close">${icon("save")} Save & Close</button>
              </div>
            </div>
            <div class="hero-content">
              <div class="status" id="ps_rule_status_main">${escapeHtml(scopeLabel())}</div>
              <h2 class="name" id="ps_char_rule_label">Megumin Suite</h2>
              <p>${escapeHtml(current.sub)} ${escapeHtml(state.context?.characterName ? `for ${state.context.characterName}.` : "")}</p>
            </div>
          </section>
          <section class="main-content" id="ps_stage_content">
            ${current.render()}
          </section>
        </div>
      </div>
    </div>`;
  wire(root());
}
function dockButton(tab, index) {
  const active = !state.devMode && index === state.activeTab;
  return `<button type="button" class="dock-icon ${active ? "active" : ""}" data-tab="${index}" title="${escapeHtml(tab.title)}">
    ${icon(tab.icon)}<span>${escapeHtml(tab.title)}</span>
  </button>`;
}
function scopeLabel() {
  return state.context?.chatId ? `Chat Profile: ${state.context.chatId}` : "Global Default";
}
function wire(container) {
  container.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.devMode = false;
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
    if (action === "open-dev") {
      state.devMode = !state.devMode;
      render();
      return;
    }
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
      state.devMode = false;
      render();
      return;
    }
    if (action === "sync-tab") {
      const data = await request("profile:syncTab", { keys: activeTabProfileKeys() });
      state.profile = mergeProfile(data.profile);
      state.status = "Synced";
      render();
      return;
    }
    if (action === "engine-filter") {
      state.engineFilter = el.dataset.value || "all";
      render();
      return;
    }
    if (action === "style-filter") {
      state.styleFilter = el.dataset.value || "direct";
      render();
      return;
    }
    if (action === "style-off") {
      state.profile.activeStyleId = null;
      state.profile.aiRule = "";
      saveProfileSoon();
      render();
      return;
    }
    if (action === "style-direct") {
      const style = (state.logic?.directStyles || []).find((item) => item.id === el.dataset.value);
      if (style) {
        state.profile.activeStyleId = style.id;
        state.profile.aiRule = style.rule || "";
        saveProfileSoon();
        render();
      }
      return;
    }
    if (action === "style-template") {
      const template = (state.logic?.styleTemplates || [])[Number(el.dataset.index || 0)];
      if (template) {
        state.profile.aiRule = template.notes || "";
        state.profile.activeStyleId = null;
        saveProfileSoon();
        render();
      }
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
    if (action === "select-engine") {
      const engineId = el.dataset.value || "";
      state.profile.mode = engineId;
      const style = preferredStyleForEngine(engineId);
      if (style) {
        state.profile.activeStyleId = style.id;
        state.profile.aiRule = style.rule || state.profile.aiRule;
      }
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
      return runTask("Generating portrait...", "npc:portrait", { name: el.dataset.name });
    if (action === "ban-remove") {
      state.profile.banList = state.profile.banList.filter((item) => item !== el.dataset.value);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "ban-clear") {
      if (!state.profile.banList.length || !confirm("Clear every banned phrase?"))
        return;
      state.profile.banList = [];
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
  const p3 = root().querySelector("#dev-p3")?.value || "";
  const p4 = root().querySelector("#dev-p4")?.value || "";
  const p5 = root().querySelector("#dev-p5")?.value || "";
  const p6 = root().querySelector("#dev-p6")?.value || "";
  if (!id || !label)
    throw new Error("Engine id and label are required");
  const data = await request("engine:save", { engine: { id, label, color: "#a855f7", p1, p3, p4, p5, p6 } });
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
  const descriptions = {
    balance: "The original Secret Sauce. NPCs react naturally - no simping, no needless hostility.",
    "balance Test": "Newer balance mode with lower token weight and more creativity.",
    cinematic: "Hollywood-inspired storytelling with dramatic beats and heightened tension.",
    dark: "Balance, but harsher. The world is unforgiving and consequences hit harder.",
    "v6-anime-director": "Advanced cinematic framing and pacing for high-budget anime direction.",
    "v6-dream-team": "A six-specialist writer room for narrative consistency and realism.",
    "v6-dream-team-lite": "A streamlined Dream Team variant with lower token overhead.",
    "v7-core": "Grounded, cinematic, patient, and built for relentless world progression.",
    "v7-reality": "Unrelenting simulation with no narrative protection.",
    "v7-gentle": "A softer, quieter engine with more atmospheric pacing."
  };
  const active = state.engines.find((engine) => engine.id === state.profile.mode);
  const visible = state.engines.filter((engine) => engineMatchesFilter(engine, state.engineFilter));
  return `
    ${tabHeader("Core Engines", "Choose the narrative engine that drives your AI's behavior.", "microchip", "#f59e0b", active?.label || state.profile.mode, "#10b981")}
    <div class="wstyle-filters">
      ${["all", "V4", "V5", "V6", "V7", "Custom"].map((filter) => filterPill(filter, state.engineFilter === filter, engineCount(filter))).join("")}
    </div>
    <div class="mtab-card-grid">
      ${visible.map((engine) => engineCard(engine, descriptions[engine.id] || `${engine.label || engine.id} engine flow.`)).join("")}
    </div>
    ${state.engineFilter === "V6" && !visible.length ? lockedState("hammer", "V6 Engines are in the forge.", "Stay tuned for the next update.") : ""}
    ${state.customEngines.length ? `<div class="wstyle-section-head green">${icon("code")} Custom Engines</div><div class="mtab-card-grid">${state.customEngines.map((engine) => engineCard(engine, "Custom user logic flow.")).join("")}</div>` : ""}
    <div class="wstyle-section-head blue">${icon("layers")} V7 Modules</div>
    <div class="mtab-card-list">
      ${toggleGeneric("OOC Protocol", "toggles.v7_ooc", state.profile.toggles.v7_ooc, "Keep the V7 out-of-character directive active.")}
      ${toggleGeneric("PC Solo Physicality", "toggles.v7_pcsolo", state.profile.toggles.v7_pcsolo, "Allow observable body language when the user character is alone.")}
      ${toggleGeneric("Cultural Anchoring", "toggles.v7_culture", state.profile.toggles.v7_culture, "Use era-specific culture and real-world specificity in suitable scenes.")}
      ${toggleGeneric("Scene Choreography", "toggles.v7_scene", state.profile.toggles.v7_scene, "Keep crowd management and camera-focus rules active.")}
      ${toggleGeneric("Introduction Protocol", "toggles.v7_intro", state.profile.toggles.v7_intro, "Preserve V7 opening-scene behavior.")}
    </div>`;
}
function renderPersona() {
  const personalities = state.logic?.personalities || [];
  const locked = state.profile.mode.startsWith("v7") || state.profile.mode.includes("v6-dream-team");
  return `
    ${tabHeader("Persona & Toggles", "Set narrator voice and extra behavioral switches.", "masks", "#ec4899", locked ? "Locked" : state.profile.personality, "#ec4899")}
    ${locked ? lockedState("lock", "Persona Selection Locked", "This engine uses its own narrative framework. Standard persona overlays are disabled to avoid logic conflicts.") : `
      <div class="wstyle-section-head purple">${icon("masks")} Select Persona</div>
      <div class="mtab-card-grid">
        ${personalities.map((item) => infoCard({
    title: item.label,
    sub: personaDesc(item.id, item.content),
    active: state.profile.personality === item.id,
    action: "select",
    path: "personality",
    value: item.id,
    badge: item.recommended ? "Recommended" : ""
  })).join("")}
      </div>`}
    <div class="wstyle-section-head gold">${icon("sliders")} Extra Toggles</div>
    <div class="mtab-card-list">
      ${Object.entries(state.logic?.toggles || {}).map(([key, toggle]) => toggleGeneric(toggle.label, `toggles.${key}`, !!state.profile.toggles[key], toggle.recommendedOff ? "Off by default - most engines handle this natively." : strip(toggle.content).slice(0, 140))).join("")}
    </div>`;
}
function renderStyle() {
  const directStyles = state.logic?.directStyles || [];
  const templates = state.logic?.styleTemplates || [];
  const activeName = state.profile.activeStyleId ? directStyles.find((item) => item.id === state.profile.activeStyleId)?.name || "Custom" : state.profile.aiRule ? "Custom Rule" : "Off";
  return `
    ${tabHeader("Writing Style", "Apply direct styles, generate from templates, or write your own rule.", "pen", "#a855f7", activeName, "#a855f7")}
    <div class="wstyle-filters">
      ${stylePill("direct", "Direct Styles", directStyles.length)}
      ${stylePill("templates", "Style Templates", templates.length)}
      ${stylePill("editor", "Rule Editor", state.profile.aiRule ? 1 : 0)}
    </div>
    ${state.styleFilter === "direct" ? `
      <div class="mtab-card-grid">
        ${infoCard({ title: "Off", sub: "No additional style overlay.", active: !state.profile.activeStyleId && !state.profile.aiRule, action: "style-off", value: "off", badge: "Clean" })}
        ${directStyles.map((style) => infoCard({ title: style.name, sub: style.desc || strip(style.rule).slice(0, 160), active: state.profile.activeStyleId === style.id, action: "style-direct", value: style.id, badge: state.profile.activeStyleId === style.id ? "Active" : "" })).join("")}
      </div>` : ""}
    ${state.styleFilter === "templates" ? `
      <div class="mtab-card-grid">
        ${templates.map((template, index) => infoCard({ title: template.name, sub: `${(template.tags || []).slice(0, 5).join(", ")} - ${template.notes || ""}`.slice(0, 220), active: false, action: "style-template", index, badge: "Generate Rule" })).join("")}
      </div>` : ""}
    ${state.styleFilter === "editor" ? `
      <div class="mtab-panel">
        <div class="mtab-panel-title purple">${icon("pen")} Custom Writing Rule</div>
        <textarea class="ps-modern-input textarea-xl" data-bind="aiRule" placeholder="Custom style or authoring rule...">${escapeHtml(state.profile.aiRule)}</textarea>
      </div>` : ""}
    <div class="wstyle-dnr-panel">
      <div class="mtab-panel-title gold">${icon("sliders")} Dialogue / Narration Ratio</div>
      ${toggleGeneric("Enable Ratio Control", "dnRatio.enabled", state.profile.dnRatio.enabled, "Guide the balance between spoken dialogue and narration.")}
      ${rangeField("Dialogue Percentage", "dnRatio.dialogue", state.profile.dnRatio.dialogue, 0, 100)}
    </div>`;
}
function renderGlobalSettings() {
  return `
    ${tabHeader("Global Settings", "Language, response length, pronouns, utility behavior, and sound styling.", "globe", "#3b82f6", "Profile", "#3b82f6")}
    <div class="mtab-panel">
      <div class="mtab-panel-title blue">${icon("globe")} Output Preferences</div>
      <div class="mtab-setting-row">${settingText("Target Word Count", "Leave empty for no limit")}${inputField("", "userWordCount", state.profile.userWordCount, "e.g. 600", "number")}</div>
      <div class="mtab-setting-row">${settingText("Language Output", "Leave empty for the chat default")}${inputField("", "userLanguage", state.profile.userLanguage, "English")}</div>
      <div class="mtab-setting-row">${settingText("User Gender", "Pronoun hint for the assistant")}${selectField("", "userPronouns", state.profile.userPronouns, [["off", "Off"], ["male", "Male (He/Him)"], ["female", "Female (She/Her)"]])}</div>
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title gold">${icon("settings")} Utility Controls</div>
      ${toggleGeneric("Prompt Payload Preview", "toggles.promptPreview", !!state.profile.toggles.promptPreview, "Show the constructed prompt before it is sent.")}
      ${toggleGeneric("Disable Utility Prefills", "disableUtilityPrefill", state.profile.disableUtilityPrefill, "Use this if a provider rejects assistant prefills during utility generations.")}
      ${toggleGeneric("Cinematic Sounds", "onomatopoeia.enabled", state.profile.onomatopoeia.enabled, "Use precise sound words where physically appropriate.")}
      ${toggleGeneric("Animate Sounds", "onomatopoeia.useStyling", state.profile.onomatopoeia.useStyling, "Wrap sound words for capable renderers.")}
    </div>`;
}
function renderBlocks() {
  const addons = state.logic?.addons || [];
  const blocks = state.logic?.blocks || [];
  return `
    ${tabHeader("Add-ons & Blocks", "Gameplay modules and response panels injected into Megumin prompts.", "puzzle", "#10b981", `${state.profile.addons.length + state.profile.blocks.length} Active`, "#10b981")}
    <div class="wstyle-section-head blue">${icon("puzzle")} Gameplay Add-ons</div>
    <div class="mtab-card-grid">
      ${addons.map((item) => moduleCard(item, state.profile.addons.includes(item.id), "addons")).join("")}
    </div>
    <div class="wstyle-section-head green">${icon("cubes")} Response Blocks</div>
    <div class="mtab-card-grid">
      ${blocks.map((item) => moduleCard(item, state.profile.blocks.includes(item.id), "blocks")).join("")}
    </div>`;
}
function renderThinking() {
  const models = state.logic?.models || [];
  const grouped = groupModels(models);
  return `
    ${tabHeader("Chain of Thought", "Configure the AI's thinking framework and reasoning depth.", "brain", "#8b5cf6", state.profile.model, "#8b5cf6")}
    <div class="mtab-panel">
      <div class="mtab-panel-title purple">${icon("brain")} Reasoning Control</div>
      <div class="mtab-card-grid compact">
        ${["unspecified", "50", "100", "200", "custom"].map((effort) => infoCard({
    title: effort === "unspecified" ? "Default" : effort === "custom" ? "Custom" : `${effort} Words`,
    sub: effort === "unspecified" ? "Use the selected model preset." : "Add a target thinking budget.",
    active: state.profile.thinkEffort === effort,
    action: "select",
    path: "thinkEffort",
    value: effort
  })).join("")}
      </div>
      ${state.profile.thinkEffort === "custom" ? inputField("Custom Think Effort", "customThinkEffort", state.profile.customThinkEffort, "100") : ""}
      ${toggleGeneric("Gemini Thinking", "thinkingV2", state.profile.thinkingV2, "Inject the triple think opener used by the original Suite.")}
    </div>
    ${Object.entries(grouped).map(([group, items]) => `
      <div class="wstyle-section-head purple">${icon("spark")} ${escapeHtml(group)}</div>
      <div class="mtab-card-grid compact">
        ${items.map((item) => infoCard({ title: item.label || readableModel(item.id), sub: item.id, active: state.profile.model === item.id, action: "select", path: "model", value: item.id })).join("")}
      </div>`).join("")}`;
}
function renderStory() {
  const sp = state.profile.storyPlan;
  return `
    ${tabHeader("Story Planner", "Brainstorm and track plot milestones automatically.", "map", "#f59e0b", sp.enabled ? "Enabled" : "Disabled", sp.enabled ? "#10b981" : "#a1a1aa")}
    ${toggleGeneric("Enable Story Planner", "storyPlan.enabled", sp.enabled, "Inject the current plan and tracker into Megumin prompts.")}
    <div class="mtab-panel">
      <div class="mtab-panel-title gold">${icon("settings")} Engine Settings</div>
      <div class="mtab-setting-row">${settingText("Generation Backend", "Utility generations run through Lumiverse quiet generation.")}${selectField("", "storyPlan.backend", sp.backend, [["direct", "Direct API Call"]])}</div>
      <div class="mtab-setting-row">${settingText("Auto-Trigger Mode", "Generate new plans automatically.")}${selectField("", "storyPlan.triggerMode", sp.triggerMode, [["manual", "Manual Only"], ["frequency", "Every X Replies"]])}</div>
      ${sp.triggerMode === "frequency" ? `<div class="mtab-setting-row">${settingText("Every X Replies", "Reply cadence for background planning.")}${inputField("", "storyPlan.autoFreq", String(sp.autoFreq), "10", "number")}</div>` : ""}
    </div>
    <div class="mtab-panel">
      <div class="panel-heading-row">
        <div class="mtab-panel-title gold">${icon("book")} Current Story Plan</div>
        <button class="wstyle-gen-btn" type="button" data-action="story-generate">${icon("bolt")} Generate Plan Now</button>
      </div>
      <textarea class="ps-modern-input textarea-xl" data-bind="storyPlan.currentPlan" placeholder="Generated plot milestones will appear here.">${escapeHtml(sp.currentPlan)}</textarea>
      <div class="mtab-callout gold">${icon("info")} <span>A tracker is injected at the end of each response when the planner is enabled.</span></div>
    </div>`;
}
function renderBanList() {
  return `
    ${tabHeader("Dynamic Ban List", "Detect and ban overused phrases from AI responses.", "ban", "#ef4444", `${state.profile.banList.length} Banned`, "#ef4444")}
    <div class="mtab-panel">
      <div class="panel-heading-row">
        <div class="mtab-panel-title purple">${icon("radar")} AI Slop Detector</div>
        <button class="wstyle-gen-btn purple-bg" type="button" data-action="ban-analyze">${icon("radar")} Analyze Chat</button>
      </div>
      <div class="mtab-setting-row">${settingText("Generator Backend", "Choose how to generate the analysis.")}${selectField("", "banListBackend", state.profile.banListBackend, [["direct", "Direct API Call"]])}</div>
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title red">${icon("plus")} Add Phrase</div>
      <div class="inline-form">
        <textarea class="ps-modern-input" placeholder="Add one phrase per line..." id="ban-manual"></textarea>
        <button class="ps-modern-btn secondary" type="button" data-action="ban-add">${icon("plus")} Add</button>
      </div>
    </div>
    <div class="panel-heading-row">
      <div class="wstyle-section-head red">${icon("list")} Active Banned Phrases</div>
      <button class="ps-modern-btn secondary danger mini" type="button" data-action="ban-clear">${icon("trash")} Clear All</button>
    </div>
    <div class="mtab-card-list dashed">
      ${state.profile.banList.length ? state.profile.banList.map((item) => `<button type="button" class="mtab-ban-item" data-action="ban-remove" data-value="${escapeHtml(item)}"><span>${escapeHtml(item)}</span>${icon("x")}</button>`).join("") : `<span class="empty-text">No phrases banned yet.</span>`}
    </div>
    <div class="mtab-callout purple">${icon("info")} <span>Ban entries become strict negative style rules during prompt assembly.</span></div>`;
}
function renderImage() {
  const ig = state.profile.imageGen;
  const previewImage = state.uiAssets.mascotImage || state.uiAssets.heroImages[0] || "";
  return `
    ${tabHeader("Image Generation", "Use Lumiverse image connections for automatic scene rendering.", "image", "#06b6d4", ig.enabled ? "Enabled" : "Disabled", ig.enabled ? "#10b981" : "#a1a1aa")}
    ${toggleGeneric("Enable Image Generation", "imageGen.enabled", ig.enabled, "Allow Megumin to generate scene images.")}
    <div class="image-lab">
      <div class="mtab-panel">
        <div class="mtab-panel-title blue">${icon("link")} Connection & Backend</div>
        <div class="mtab-setting-row">${settingText("Connection", "Uses the selected Lumiverse image-gen connection.")}${selectField("", "imageGen.connectionId", ig.connectionId, [["", "Default"], ...state.imageConnections.map((c) => [String(c.id), `${c.name} (${c.provider})`])])}</div>
        <div class="mtab-setting-row">${settingText("Prompt Generator", "Direct quiet generation is used for prompt creation.")}${selectField("", "imageGen.generatorBackend", ig.generatorBackend, [["direct", "Direct API Call"]])}</div>
        <div class="mtab-setting-row">${settingText("Trigger Mode", "Choose when Megumin asks for an image.")}${selectField("", "imageGen.triggerMode", ig.triggerMode, [["always", "Every Reply"], ["frequency", "After X Replies"], ["conditional", "Only when a character sends a picture"], ["manual", "Manual Button Only"]])}</div>
        ${ig.triggerMode === "frequency" ? `<div class="mtab-setting-row">${settingText("Every X Replies", "Reply cadence for automatic images.")}${inputField("", "imageGen.autoGenFreq", String(ig.autoGenFreq), "1", "number")}</div>` : ""}
        ${toggleGeneric("Preview Prompt Before Sending", "imageGen.previewPrompt", ig.previewPrompt, "Preview or edit prompts before rendering.")}
      </div>
      <div class="visual-preview" ${previewImage ? `style="background-image:url('${escapeHtml(previewImage)}')"` : ""}>
        <div>${icon("spark")} Kazuma Image Lab</div>
      </div>
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title gold">${icon("pen")} Prompt Formatting</div>
      <div class="setting-grid">
        ${selectField("Model Style Format", "imageGen.promptStyle", ig.promptStyle, [["standard", "Standard"], ["illustrious", "Illustrious / Pony Tags"], ["sdxl", "SDXL Natural Prose"]])}
        ${selectField("Camera Perspective", "imageGen.promptPerspective", ig.promptPerspective, [["scene", "Cinematic Scene"], ["pov", "First Person POV"], ["character", "Character Portrait"]])}
      </div>
      ${inputField("Extra Instructions", "imageGen.promptExtra", ig.promptExtra, "moody lighting, dark atmosphere...")}
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title gold">${icon("sliders")} Image Parameters</div>
      <div class="resolution-grid">${RESOLUTIONS.map((res) => `<button type="button" class="res-pill ${ig.imgWidth === res.w && ig.imgHeight === res.h ? "active" : ""}" data-action="select-resolution" data-w="${res.w}" data-h="${res.h}">${escapeHtml(res.label)}</button>`).join("")}</div>
      <div class="setting-grid">
        ${inputField("Width", "imageGen.imgWidth", String(ig.imgWidth), "1024", "number")}
        ${inputField("Height", "imageGen.imgHeight", String(ig.imgHeight), "1024", "number")}
        ${inputField("Steps", "imageGen.steps", String(ig.steps), "20", "number")}
        ${inputField("CFG Scale", "imageGen.cfg", String(ig.cfg), "7", "number")}
        ${inputField("Seed", "imageGen.customSeed", String(ig.customSeed), "-1", "number")}
        ${inputField("Sampler", "imageGen.selectedSampler", ig.selectedSampler, "euler")}
        ${inputField("Scheduler", "imageGen.scheduler", ig.scheduler, "normal")}
        ${inputField("Checkpoint", "imageGen.selectedModel", ig.selectedModel, "model.safetensors")}
      </div>
      <textarea class="ps-modern-input" data-bind="imageGen.customNegative" placeholder="Negative prompt...">${escapeHtml(ig.customNegative)}</textarea>
    </div>
    <div class="mtab-panel">
      <div class="panel-heading-row">
        <div class="mtab-panel-title blue">${icon("bolt")} Manual Render</div>
        <button class="wstyle-gen-btn blue-bg" type="button" data-action="image-manual">${icon("image")} Generate Image</button>
      </div>
      <textarea id="meg-manual-image-prompt" class="ps-modern-input" placeholder="Optional manual image prompt..."></textarea>
    </div>
    <details class="mtab-panel">
      <summary class="mtab-panel-title blue">${icon("code")} ComfyUI Field Placeholders</summary>
      <div class="placeholder-grid">${KAZUMA_PLACEHOLDERS.map((item) => `<div><code>${escapeHtml(item.key)}</code><span>${escapeHtml(item.desc)}</span></div>`).join("")}</div>
    </details>`;
}
function renderNpc() {
  const bank = state.profile.npcBank;
  return `
    ${tabHeader("NPCs Bank", "Automatically extract and track significant NPCs.", "address", "#22c55e", `${bank.npcs.length} NPCs`, "#22c55e")}
    <div class="mtab-panel">
      <div class="mtab-panel-title green">${icon("settings")} Bank Settings</div>
      ${toggleGeneric("Enable NPC Bank", "npcBank.enabled", bank.enabled, "Capture and inject significant NPC dossiers.")}
      ${toggleGeneric("Send Portraits To AI", "npcBank.sendPortraitsToAi", bank.sendPortraitsToAi, "Use generated portraits as multimodal context when relevant.")}
      <button class="wstyle-gen-btn green-bg" type="button" data-action="npc-scan">${icon("search")} Scan Last Message</button>
    </div>
    ${bank.npcs.length ? `<div class="npc-grid">${bank.npcs.map(renderNpcCard).join("")}</div>` : emptyWithMascot("No NPCs saved yet.", "Dossiers appear here after Megumin extracts them from assistant replies.")}`;
}
function renderNpcCard(npc) {
  return `
    <article class="npc-card">
      ${npc.pfpImageUrl ? `<img class="npc-img" src="${escapeHtml(npc.pfpImageUrl)}" alt="">` : `<div class="npc-img placeholder">${escapeHtml(String(npc.name || "?").slice(0, 1))}</div>`}
      <div class="npc-body">
        <div class="npc-title-row"><h3>${escapeHtml(npc.name)}</h3><button class="icon-btn danger" type="button" data-action="npc-remove" data-name="${escapeHtml(npc.name)}">${icon("trash")}</button></div>
        <p class="npc-meta">${escapeHtml([npc.age, npc.sex, npc.occupation].filter(Boolean).join(" | ") || "No metadata")}</p>
        <p>${escapeHtml(npc.appearance || npc.background || "No dossier details yet.")}</p>
        <div class="npc-actions">
          <button class="ps-modern-btn secondary mini" type="button" data-action="npc-portrait" data-name="${escapeHtml(npc.name)}">${icon("image")} Portrait</button>
        </div>
      </div>
    </article>`;
}
function renderMemory() {
  const mem = state.profile.memoryCore;
  const workingPct = clamp(mem.workingLimit / Math.max(1, mem.workingLimit + mem.shortTermLimit) * 100, 8, 80);
  const shortPct = clamp(mem.shortTermChunks.length / Math.max(1, mem.shortTermLimit) * 100, 5, 100);
  const longPct = clamp(mem.longTermVault.length / Math.max(1, mem.longTermVault.length + mem.shortTermChunks.length || 1) * 100, 5, 100);
  return `
    ${tabHeader("Memory Core", "Advanced 3-tier context and history management.", "memory", "#38bdf8", mem.enabled ? "Enabled" : "Disabled", mem.enabled ? "#10b981" : "#a1a1aa")}
    <div class="memory-dashboard">
      ${statTile("Working", String(mem.workingLimit), "live messages", "#10b981")}
      ${statTile("Short-Term", String(mem.shortTermChunks.length), "summaries", "#f59e0b")}
      ${statTile("Long-Term", String(mem.longTermVault.length), "vault entries", "#3b82f6")}
      ${statTile("Saved", `~${estimateTokensSaved()}`, "tokens", "#a855f7")}
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title blue">${icon("memory")} Memory Architecture</div>
      ${toggleGeneric("Enable Memory Core", "memoryCore.enabled", mem.enabled, "Archive older messages and inject relevant memory.")}
      <div class="setting-grid">
        ${selectField("Architecture", "memoryCore.architecture", mem.architecture, [["raw_short_long", "Raw + Short + Long"], ["raw_long", "Raw + Long"]])}
        ${selectField("Scanner", "memoryCore.scannerEngine", mem.scannerEngine, [["tfidf", "TF-IDF Retrieval"], ["semantic", "Semantic Memory"]])}
        ${selectField("Trigger", "memoryCore.triggerMode", mem.triggerMode, [["manual", "Manual"], ["frequency", "Every X Replies"]])}
        ${inputField("Auto Frequency", "memoryCore.autoFreq", String(mem.autoFreq), "10", "number")}
        ${inputField("Working Limit", "memoryCore.workingLimit", String(mem.workingLimit), "30", "number")}
        ${inputField("Short-Term Limit", "memoryCore.shortTermLimit", String(mem.shortTermLimit), "70", "number")}
      </div>
      <div class="mem-progress"><span class="mem-prog-working" style="width:${workingPct}%"></span><span class="mem-prog-short" style="width:${shortPct}%"></span><span class="mem-prog-long" style="width:${longPct}%"></span></div>
      <button class="wstyle-gen-btn blue-bg" type="button" data-action="memory-process">${icon("bolt")} Apply & Extract Pending</button>
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title blue">${icon("book")} Long-Term Vault</div>
      ${(mem.longTermVault || []).slice(-20).reverse().map((chunk) => `<details class="mem-accordion"><summary>${escapeHtml(chunk.id)} <span>${new Date(chunk.timestamp).toLocaleString()}</span></summary><pre>${escapeHtml(chunk.text || chunk.summary || "")}</pre></details>`).join("") || `<span class="empty-text">No vault entries yet.</span>`}
    </div>`;
}
function renderDev() {
  return `
    ${tabHeader("Dev Engine Builder", "Clone, edit, and save custom Megumin engine blocks.", "code", "#a855f7", `${state.customEngines.length} Custom`, "#a855f7")}
    <div class="dev-layout">
      <div class="mtab-panel">
        <div class="mtab-panel-title purple">${icon("wand")} Create Engine</div>
        <div class="setting-grid">
          <label class="ps-field"><span>Engine ID</span><input id="dev-id" class="ps-modern-input" placeholder="engine_id"></label>
          <label class="ps-field"><span>Display Name</span><input id="dev-label" class="ps-modern-input" placeholder="Display name"></label>
        </div>
        <textarea id="dev-p1" class="ps-modern-input dev-area" placeholder="[[prompt1]] Root / setup block"></textarea>
        <textarea id="dev-p3" class="ps-modern-input dev-area" placeholder="[[prompt3]] Middle engine block"></textarea>
        <textarea id="dev-p4" class="ps-modern-input dev-area" placeholder="[[prompt4]] Physicality / rules block"></textarea>
        <textarea id="dev-p5" class="ps-modern-input dev-area" placeholder="[[prompt5]] Continuation block"></textarea>
        <textarea id="dev-p6" class="ps-modern-input dev-area" placeholder="[[prompt6]] Final reminder block"></textarea>
        <button class="wstyle-gen-btn green-bg" type="button" data-action="dev-save">${icon("save")} Save Engine</button>
      </div>
      <div class="mtab-panel">
        <div class="mtab-panel-title green">${icon("cubes")} Custom Engines</div>
        ${state.customEngines.length ? state.customEngines.map((engine) => `<div class="custom-engine-row"><div><strong>${escapeHtml(engine.label || engine.id)}</strong><span>${escapeHtml(engine.id)}</span></div><button class="icon-btn danger" type="button" data-action="dev-delete" data-id="${escapeHtml(engine.id)}">${icon("trash")}</button></div>`).join("") : emptyWithMascot("No custom engines yet.", "Create one on the left, then select it from Core Engines.")}
      </div>
    </div>`;
}
function tabHeader(title, sub, iconName, color, badge, badgeColor) {
  return `
    <div class="mtab-header">
      <div class="mtab-header-left">
        <div class="mtab-header-icon" style="--header-color:${color};">${icon(iconName)}</div>
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(sub)}</p>
        </div>
      </div>
      <div class="mtab-header-badge" style="--badge-color:${badgeColor};">${icon("check")} ${escapeHtml(badge)}</div>
    </div>`;
}
function filterPill(value, active, count) {
  return `<button class="wstyle-filter-pill ${active ? "active" : ""}" type="button" data-action="engine-filter" data-value="${escapeHtml(value)}">${escapeHtml(value === "all" ? "All" : value)} <span class="pill-count">${count}</span></button>`;
}
function stylePill(value, label, count) {
  return `<button class="wstyle-filter-pill ${state.styleFilter === value ? "active" : ""}" type="button" data-action="style-filter" data-value="${escapeHtml(value)}">${escapeHtml(label)} <span class="pill-count">${count}</span></button>`;
}
function engineCount(filter) {
  return state.engines.filter((engine) => engineMatchesFilter(engine, filter)).length;
}
function engineMatchesFilter(engine, filter) {
  if (filter === "all")
    return true;
  if (filter === "Custom")
    return state.customEngines.some((item) => item.id === engine.id);
  const label = `${engine.label || ""} ${engine.id || ""}`.toUpperCase();
  return label.includes(filter.toUpperCase());
}
function engineCard(engine, desc) {
  const active = state.profile.mode === engine.id;
  const locked = !!engine.locked;
  const badges = [
    active ? `<span class="ecard-badge active-badge">${icon("check")} Active</span>` : "",
    engine.recommended ? `<span class="ecard-badge rec">${icon("star")} Recommended</span>` : "",
    engine.isNew ? `<span class="ecard-badge new">New</span>` : "",
    locked ? `<span class="ecard-badge locked">${icon("lock")} Coming Soon</span>` : ""
  ].filter(Boolean).join("");
  return `<button type="button" class="mtab-eng-card ${active ? "active" : ""} ${locked ? "locked-card" : ""}" ${locked ? "" : `data-action="select-engine" data-value="${escapeHtml(engine.id)}"`}>
    <span class="ecard-accent" style="--accent:${engine.color || "#10b981"}"></span>
    <span class="ecard-body">
      <span class="ecard-title"><span>${escapeHtml(engine.label || engine.id)}</span></span>
      <span class="ecard-desc">${escapeHtml(desc)}</span>
      ${badges ? `<span class="badge-row">${badges}</span>` : ""}
    </span>
  </button>`;
}
function infoCard(input) {
  const attrs = [
    `data-action="${escapeHtml(input.action)}"`,
    input.path ? `data-path="${escapeHtml(input.path)}"` : "",
    input.value !== undefined ? `data-value="${escapeHtml(input.value)}"` : "",
    input.index !== undefined ? `data-index="${input.index}"` : ""
  ].filter(Boolean).join(" ");
  return `<button type="button" class="mtab-eng-card ${input.active ? "active" : ""}" ${attrs}>
    <span class="ecard-accent"></span>
    <span class="ecard-body">
      <span class="ecard-title"><span>${escapeHtml(input.title)}</span>${input.badge ? `<span class="ecard-badge rec">${escapeHtml(input.badge)}</span>` : ""}</span>
      <span class="ecard-desc">${escapeHtml(strip(input.sub || "").slice(0, 240))}</span>
    </span>
  </button>`;
}
function moduleCard(item, active, path) {
  const desc = moduleDesc(item.id) || strip(item.content).slice(0, 180);
  return `<button type="button" class="mtab-eng-card ${active ? "active" : ""}" data-action="toggle-array" data-path="${path}" data-value="${escapeHtml(item.id)}">
    <span class="ecard-accent"></span>
    <span class="ecard-body">
      <span class="ecard-title"><span>${escapeHtml(item.label)}</span>${active ? `<span class="ecard-badge active-badge">${icon("check")} On</span>` : ""}</span>
      <span class="ecard-desc">${escapeHtml(desc)}</span>
      ${item.recommended ? `<span class="badge-row"><span class="ecard-badge rec">${icon("star")} Recommended</span></span>` : ""}
    </span>
  </button>`;
}
function toggleGeneric(label, path, active, desc) {
  return `<button type="button" class="mtab-toggle-row ${active ? "active" : ""}" data-action="toggle" data-path="${escapeHtml(path)}">
    <span class="toggle-info"><span class="toggle-label">${escapeHtml(label)}</span><span class="toggle-desc">${escapeHtml(desc)}</span></span>
    <span class="ps-switch"></span>
  </button>`;
}
function inputField(label, path, value, placeholder = "", type = "text") {
  return `<label class="ps-field ${label ? "" : "bare"}">${label ? `<span>${escapeHtml(label)}</span>` : ""}<input class="ps-modern-input" type="${type}" data-bind="${escapeHtml(path)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"></label>`;
}
function rangeField(label, path, value, min, max) {
  return `<label class="mtab-param-row"><span class="param-label">${escapeHtml(label)} <b>${value}</b></span><input class="ps-modern-input" type="range" min="${min}" max="${max}" data-bind="${escapeHtml(path)}" value="${value}"></label>`;
}
function selectField(label, path, value, options) {
  return `<label class="ps-field ${label ? "" : "bare"}">${label ? `<span>${escapeHtml(label)}</span>` : ""}<select class="ps-modern-input" data-bind="${escapeHtml(path)}">
    ${options.map(([id, text]) => `<option value="${escapeHtml(id)}" ${id === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}
  </select></label>`;
}
function settingText(label, desc) {
  return `<span class="set-info"><span class="set-label">${escapeHtml(label)}</span><span class="set-desc">${escapeHtml(desc)}</span></span>`;
}
function lockedState(iconName, title, text) {
  return `<div class="mtab-locked-state">${icon(iconName)}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}
function emptyWithMascot(title, text) {
  const image = state.uiAssets.mascotImage || "";
  return `<div class="mtab-locked-state empty-state">${image ? `<img src="${escapeHtml(image)}" alt="">` : icon("spark")}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}
function statTile(title, value, sub, color) {
  return `<div class="mem-stat" style="--stat-color:${color};"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(title)}</span><small>${escapeHtml(sub)}</small></div>`;
}
function preferredStyleForEngine(engineId) {
  const styles = state.logic?.directStyles || [];
  const target = engineId === "v7-core" ? "dir_v7_core" : engineId === "v7-gentle" ? "dir_v7_gentle" : engineId.startsWith("v7") ? "dir_v7" : "";
  return target ? styles.find((style) => style.id === target) || null : null;
}
function groupModels(models) {
  const groups = {};
  for (const model of models) {
    const id = String(model.id || "");
    const group = id.includes("v7") ? "V7 Frameworks" : id.includes("chinese") ? "Chinese" : id.includes("japanese") ? "Japanese" : "Classic";
    if (!groups[group])
      groups[group] = [];
    groups[group].push(model);
  }
  return groups;
}
function activeTabProfileKeys() {
  if (state.devMode)
    return ["mode"];
  const map = {
    0: ["mode", "toggles", "activeStyleId", "aiRule"],
    1: ["personality", "toggles"],
    2: ["activeStyleId", "aiRule", "customStyles", "dnRatio"],
    3: ["userWordCount", "userLanguage", "userPronouns", "disableUtilityPrefill", "onomatopoeia", "toggles"],
    4: ["addons", "blocks"],
    5: ["model", "thinkEffort", "customThinkEffort", "thinkingV2"],
    6: ["storyPlan"],
    7: ["banList", "banListBackend"],
    8: ["imageGen"],
    9: ["npcBank"],
    10: ["memoryCore"]
  };
  return map[state.activeTab] || [];
}
function moduleDesc(id) {
  const descriptions = {
    death: "Permanent consequences. Characters can die when the scene logic says they would.",
    combat: "Grounded tactical combat where positioning, injury, fatigue, and numbers matter.",
    direct: "Forces direct language and reduces polite evasions.",
    color: "Color-coded dialogue formatting for easier parsing.",
    npc_events: "Requires new events to grow from prior context or environmental cues.",
    dn: "Wraps dialogue and narration in XML tags for provider-specific formatting.",
    info: "A compact world-state panel with time, weather, location, and visible conditions.",
    summary: "A running story digest updated by the assistant.",
    cyoa: "A choose-your-own-action panel with suggested next moves.",
    mvu: "MVU compatibility scaffolding for game-style state outputs.",
    npc_inner_chatter: "Hidden NPC private thoughts that feed future behavior.",
    npc_inner_chatter_v2: "A smaller NPC inner chatter block."
  };
  return descriptions[id] || "";
}
function personaDesc(id, content) {
  const descriptions = {
    megumin: "A rebellious, dominant voice with sharper story energy.",
    director: "Professional narrator with clean cinematic direction.",
    Nora: "Nora should I say more.",
    engine: "No personality overlay. The engine speaks in its purest form."
  };
  return descriptions[id] || content;
}
function readableModel(id) {
  return id.replace(/^cot-/, "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function estimateTokensSaved() {
  const chars = [...state.profile.memoryCore.shortTermChunks, ...state.profile.memoryCore.longTermVault].reduce((total, chunk) => total + (chunk.text || chunk.summary || "").length, 0);
  return Math.ceil(chars / 4);
}
function estimatePayloadTokens() {
  const profileText = JSON.stringify({
    mode: state.profile.mode,
    aiRule: state.profile.aiRule,
    addons: state.profile.addons,
    blocks: state.profile.blocks,
    story: state.profile.storyPlan.currentPlan,
    memory: [...state.profile.memoryCore.shortTermChunks, ...state.profile.memoryCore.longTermVault].slice(-8)
  });
  return Math.max(0, Math.ceil(profileText.length / 4));
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
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
function icon(name) {
  const paths = {
    wand: `<path d="m15 4 5 5-11 11-5-5 11-11Z"/><path d="m14 5 5 5"/><path d="M5 4v3M3.5 5.5h3M20 16v3M18.5 17.5h3M8 2l.7 1.7L10.5 4l-1.8.7L8 6.5l-.7-1.8L5.5 4l1.8-.7L8 2Z"/>`,
    spark: `<path d="M12 2l1.7 5.1L19 9l-5.3 1.9L12 16l-1.7-5.1L5 9l5.3-1.9L12 2Z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z"/>`,
    server: `<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/>`,
    microchip: `<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>`,
    masks: `<path d="M7 10h.01M11 10h.01M9 14c1.5 1 3 1 4 0"/><path d="M3 5c4-2 8-2 12 0v5c0 5-3 8-6 8s-6-3-6-8V5Z"/><path d="M15 7c2-.4 4-.1 6 1v4c0 4-2 6-5 7"/>`,
    pen: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>`,
    globe: `<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2c3 3 3 17 0 20M12 2c-3 3-3 17 0 20"/>`,
    puzzle: `<path d="M9 3h6v4a2 2 0 1 0 0 4v4h-4a2 2 0 1 1-4 0H3V9h4a2 2 0 1 0 2-2V3Z"/>`,
    cubes: `<path d="m12 2 7 4v8l-7 4-7-4V6l7-4Z"/><path d="M12 10 5 6M12 10l7-4M12 10v8"/>`,
    brain: `<path d="M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5v1a3 3 0 0 0 5 2V3H9Z"/><path d="M15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5v1a3 3 0 0 1-5 2V3h2Z"/>`,
    map: `<path d="m9 18-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path d="M9 3v15M15 6v15"/>`,
    ban: `<circle cx="12" cy="12" r="9"/><path d="M5.5 5.5 18.5 18.5"/>`,
    image: `<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="10" r="2"/><path d="m21 15-5-5L5 19"/>`,
    address: `<path d="M7 3h10a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M9 7h6M9 11h6M9 15h4"/>`,
    memory: `<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 1v3M16 1v3M8 20v3M16 20v3M1 8h3M1 16h3M20 8h3M20 16h3M8 8h8v8H8Z"/>`,
    code: `<path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 4l-4 16"/>`,
    refresh: `<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>`,
    reset: `<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/>`,
    save: `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>`,
    check: `<path d="M20 6 9 17l-5-5"/>`,
    star: `<path d="m12 2 3 6 7 .9-5 4.8 1.2 6.8L12 17l-6.2 3.5L7 13.7 2 8.9 9 8l3-6Z"/>`,
    lock: `<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>`,
    settings: `<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M3 12h2M19 12h2M12 3v2M12 19v2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>`,
    bolt: `<path d="M13 2 3 14h8l-1 8 11-14h-8l1-6Z"/>`,
    plus: `<path d="M12 5v14M5 12h14"/>`,
    trash: `<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6"/>`,
    link: `<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>`,
    sliders: `<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/>`,
    info: `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>`,
    radar: `<path d="M20 12a8 8 0 1 1-8-8"/><path d="M12 12 20 4M12 8a4 4 0 1 0 4 4"/>`,
    list: `<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>`,
    x: `<path d="M18 6 6 18M6 6l12 12"/>`,
    search: `<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`,
    book: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z"/>`,
    hammer: `<path d="m15 12 6 6-3 3-6-6M14 4l6 6M4 14l7-7 3 3-7 7H4v-3Z"/>`
  };
  return `<svg class="meg-svg meg-${escapeHtml(name)}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}
function styles() {
  return `
.megumin-suite-app { z-index: 1; }
.meg-float { width:52px; height:52px; }
.meg-float-btn { width:52px; height:52px; border-radius:14px; border:1px solid rgba(255,255,255,.12); background:#18181b; color:#f4f4f5; cursor:pointer; display:grid; place-items:center; box-shadow:0 16px 34px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.05); transition:transform .2s ease, background .2s ease, border-color .2s ease; }
.meg-float-btn:hover { transform:translateY(-2px); background:#27272a; border-color:rgba(255,255,255,.22); }
.meg-float-btn .meg-svg { width:30px; height:30px; color:#ffffff; filter:drop-shadow(0 2px 6px rgba(0,0,0,.45)); }
.meg-float-btn .meg-wand path:first-child { fill:#ffffff; stroke:#ffffff; }
.meg-float-btn .meg-wand path:nth-child(2) { stroke:#38bdf8; stroke-width:2.6; }
.meg-float-btn .meg-wand path:last-child { fill:#fbbf24; stroke:#fbbf24; }
.meg-svg { width:16px; height:16px; flex:0 0 auto; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.meg-overlay { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.68); backdrop-filter:blur(4px); font-family:Inter, ui-sans-serif, system-ui, sans-serif; color:#f4f4f5; }
.ps-modern-modal.app-container { width:min(1380px, calc(100vw - 40px)); height:calc(100dvh - 40px); background:#18181b; border:1px solid #27272a; border-radius:16px; box-shadow:0 25px 60px rgba(0,0,0,.7); display:flex; position:relative; overflow:hidden; }
.main-wrapper { flex:1; display:flex; flex-direction:column; min-width:0; overflow:hidden; }
.hero-banner { height:220px; width:100%; background-position:center 26%; background-size:cover; position:relative; display:flex; flex-direction:column; justify-content:space-between; flex-shrink:0; background-color:#111; }
.hero-banner::before { content:""; position:absolute; inset:0; background:radial-gradient(circle at 75% 20%, rgba(245,158,11,.22), transparent 32%); pointer-events:none; }
.hero-overlay { position:absolute; inset:0; background:linear-gradient(to right, rgba(0,0,0,.92) 0%, rgba(24,24,27,.48) 52%, rgba(24,24,27,.86) 100%); }
.hero-overlay::after { content:""; position:absolute; inset:0; background:linear-gradient(to top, #18181b 0%, transparent 72%); }
.top-app-bar { position:relative; z-index:2; padding:20px 28px; display:flex; justify-content:flex-end; }
.app-actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
.live-token-count { color:#a1a1aa; background:rgba(0,0,0,.5); padding:8px 12px; border-radius:8px; border:1px solid #27272a; backdrop-filter:blur(4px); font-size:12px; font-weight:800; display:flex; gap:6px; align-items:center; }
.ps-save-indicator { color:#a1a1aa; font-size:12px; font-weight:800; min-width:54px; }
.ps-save-indicator.saving { color:#f59e0b; }
.hero-content { position:relative; z-index:2; padding:0 30px 28px 104px; }
.hero-content .status { font-size:12px; font-weight:900; color:#f59e0b; text-transform:uppercase; letter-spacing:0; margin-bottom:6px; text-shadow:0 2px 4px rgba(0,0,0,.8); }
.hero-content .name { font-size:42px; font-weight:900; margin:0; line-height:1.05; color:#fff; letter-spacing:0; text-shadow:0 4px 10px rgba(0,0,0,.8); }
.hero-content p { margin:8px 0 0; color:#d4d4d8; font-size:14px; max-width:760px; text-shadow:0 2px 4px rgba(0,0,0,.7); }
.dock { position:absolute; top:20px; bottom:20px; left:20px; width:60px; background:rgba(18,18,20,.72); backdrop-filter:blur(15px); border:1px solid rgba(255,255,255,.1); border-radius:12px; display:flex; flex-direction:column; padding:14px 0; gap:4px; transition:width .3s cubic-bezier(.4,0,.2,1), box-shadow .3s; overflow:hidden; z-index:50; }
.dock:hover { width:250px; box-shadow:10px 10px 40px rgba(0,0,0,.8); }
.dock-icon { display:flex; align-items:center; gap:14px; width:238px; height:48px; margin:0 10px; padding:0 14px; border:0; border-radius:8px; color:#a1a1aa; background:transparent; cursor:pointer; font-weight:800; font-size:13px; text-align:left; transition:.2s ease; }
.dock-icon .meg-svg { width:19px; height:19px; }
.dock-icon span { opacity:0; pointer-events:none; transition:opacity .2s; white-space:nowrap; }
.dock:hover .dock-icon span { opacity:1; transition-delay:.1s; }
.dock-icon:hover { color:#fff; background:rgba(255,255,255,.1); }
.dock-icon.active { color:#f59e0b; background:rgba(245,158,11,.15); }
.main-content { flex:1; padding:22px 34px 42px 104px; overflow:auto; background:#0e0e11; display:flex; flex-direction:column; gap:18px; }
.main-content::-webkit-scrollbar { width:10px; }
.main-content::-webkit-scrollbar-track { background:#0e0e11; }
.main-content::-webkit-scrollbar-thumb { background:#3f3f46; border-radius:999px; border:2px solid #0e0e11; }
.ps-modern-btn, .wstyle-gen-btn, .icon-btn { border:1px solid #27272a; border-radius:8px; background:#111; color:#f4f4f5; cursor:pointer; font-weight:900; display:inline-flex; align-items:center; justify-content:center; gap:7px; transition:.18s ease; white-space:nowrap; }
.ps-modern-btn { padding:9px 13px; font-size:12px; }
.ps-modern-btn:hover, .wstyle-gen-btn:hover, .icon-btn:hover { transform:translateY(-1px); border-color:rgba(255,255,255,.24); }
.ps-modern-btn.primary { background:#10b981; border-color:#10b981; color:#03140e; }
.ps-modern-btn.secondary.gold { color:#f59e0b; border-color:rgba(245,158,11,.35); background:rgba(0,0,0,.35); }
.ps-modern-btn.secondary.danger, .danger { color:#f87171; border-color:rgba(239,68,68,.35); }
.ps-modern-btn.secondary.purple { color:#c084fc; border-color:rgba(168,85,247,.35); }
.ps-modern-btn.secondary.purple.active { background:rgba(168,85,247,.16); }
.ps-modern-btn.mini, .icon-btn.mini { padding:6px 9px; font-size:11px; }
.icon-btn { width:34px; height:34px; padding:0; }
.wstyle-gen-btn { padding:10px 16px; background:linear-gradient(135deg,#f59e0b,#d97706); border-color:transparent; color:#111; font-size:12px; }
.wstyle-gen-btn.purple-bg { background:linear-gradient(135deg,#a855f7,#7c3aed); color:#fff; }
.wstyle-gen-btn.blue-bg { background:linear-gradient(135deg,#06b6d4,#0891b2); color:#fff; }
.wstyle-gen-btn.green-bg { background:linear-gradient(135deg,#10b981,#059669); color:#03140e; }
.mtab-header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:2px; }
.mtab-header-left { display:flex; align-items:center; gap:14px; min-width:0; }
.mtab-header-icon { width:48px; height:48px; border-radius:8px; display:grid; place-items:center; background:linear-gradient(135deg,var(--header-color),color-mix(in srgb,var(--header-color) 72%,#000)); color:#fff; box-shadow:0 12px 28px rgba(0,0,0,.25); }
.mtab-header-icon .meg-svg { width:24px; height:24px; }
.mtab-header h2 { margin:0; font-size:26px; line-height:1.1; letter-spacing:0; }
.mtab-header p { margin:5px 0 0; color:#a1a1aa; font-size:13px; }
.mtab-header-badge { border:1px solid color-mix(in srgb,var(--badge-color) 38%,transparent); color:var(--badge-color); background:color-mix(in srgb,var(--badge-color) 14%,transparent); padding:8px 12px; border-radius:999px; font-size:12px; font-weight:900; display:flex; gap:6px; align-items:center; }
.wstyle-filters { display:flex; flex-wrap:wrap; gap:8px; margin:4px 0; }
.wstyle-filter-pill { border:1px solid #27272a; background:#111; color:#a1a1aa; border-radius:999px; padding:7px 12px; cursor:pointer; font-size:12px; font-weight:900; display:flex; align-items:center; gap:7px; }
.wstyle-filter-pill.active { color:#111; background:#f59e0b; border-color:#f59e0b; }
.pill-count { border-radius:999px; padding:1px 7px; background:rgba(255,255,255,.14); }
.wstyle-section-head { color:#d4d4d8; font-size:13px; font-weight:900; display:flex; align-items:center; gap:8px; margin:12px 0 0; }
.wstyle-section-head.gold { color:#f59e0b; }
.wstyle-section-head.green { color:#10b981; }
.wstyle-section-head.purple { color:#a855f7; }
.wstyle-section-head.blue { color:#38bdf8; }
.wstyle-section-head.red { color:#ef4444; }
.mtab-card-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(245px,1fr)); gap:12px; }
.mtab-card-grid.compact { grid-template-columns:repeat(auto-fill,minmax(188px,1fr)); }
.mtab-eng-card { min-height:132px; position:relative; text-align:left; border:1px solid #27272a; border-radius:8px; background:#101114; color:#f4f4f5; cursor:pointer; overflow:hidden; padding:0; display:flex; transition:transform .18s ease, border-color .18s ease, background .18s ease; }
.mtab-eng-card:hover { transform:translateY(-2px); border-color:rgba(245,158,11,.55); background:#15161a; }
.mtab-eng-card.active { border-color:#10b981; background:rgba(16,185,129,.05); }
.mtab-eng-card.locked-card { opacity:.55; cursor:not-allowed; }
.ecard-accent { position:absolute; top:0; left:0; right:0; height:3px; background:linear-gradient(90deg,var(--accent,#27272a),transparent); }
.mtab-eng-card.active .ecard-accent { background:linear-gradient(90deg,#10b981,#059669,transparent); }
.ecard-body { padding:16px; display:flex; flex-direction:column; gap:8px; width:100%; }
.ecard-title { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; color:#fff; font-size:15px; font-weight:900; line-height:1.25; }
.ecard-desc { color:#a1a1aa; font-size:12px; line-height:1.45; display:block; }
.badge-row { display:flex; flex-wrap:wrap; gap:6px; margin-top:auto; }
.ecard-badge { display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:900; border-radius:999px; padding:4px 7px; color:#a1a1aa; background:rgba(255,255,255,.06); }
.ecard-badge.rec { color:#f59e0b; background:rgba(245,158,11,.12); }
.ecard-badge.new { color:#3b82f6; background:rgba(59,130,246,.15); }
.ecard-badge.locked { color:#a1a1aa; background:rgba(82,82,91,.25); }
.ecard-badge.active-badge { color:#10b981; background:rgba(16,185,129,.15); }
.mtab-card-list { display:flex; flex-direction:column; gap:8px; }
.mtab-card-list.dashed { min-height:64px; padding:12px; border:1px dashed #27272a; border-radius:8px; background:rgba(0,0,0,.12); }
.mtab-toggle-row { width:100%; display:flex; justify-content:space-between; align-items:center; gap:18px; border:1px solid #27272a; border-radius:8px; background:#101114; color:#f4f4f5; padding:14px 16px; cursor:pointer; text-align:left; transition:.18s ease; }
.mtab-toggle-row:hover { border-color:rgba(245,158,11,.45); background:#15161a; }
.mtab-toggle-row.active { border-color:#f59e0b; background:rgba(245,158,11,.035); }
.toggle-info { display:flex; flex-direction:column; gap:4px; min-width:0; }
.toggle-label { color:#fff; font-size:13px; font-weight:900; }
.toggle-desc { color:#a1a1aa; font-size:12px; line-height:1.4; }
.ps-switch { width:38px; height:22px; border-radius:999px; background:#3f3f46; position:relative; flex:0 0 auto; transition:.18s; }
.ps-switch::after { content:""; width:18px; height:18px; border-radius:50%; background:#fff; position:absolute; top:2px; left:2px; transition:.18s; }
.mtab-toggle-row.active .ps-switch { background:#f59e0b; }
.mtab-toggle-row.active .ps-switch::after { left:18px; background:#111; }
.mtab-panel, .wstyle-dnr-panel { background:#18191f; border:1px solid #27272a; border-radius:8px; padding:16px; }
.mtab-panel-title { margin:0 0 14px; color:#f4f4f5; font-weight:900; font-size:15px; display:flex; align-items:center; gap:8px; }
.mtab-panel-title.gold { color:#f59e0b; }
.mtab-panel-title.green { color:#10b981; }
.mtab-panel-title.purple { color:#a855f7; }
.mtab-panel-title.blue { color:#38bdf8; }
.mtab-panel-title.red { color:#ef4444; }
.panel-heading-row { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
.mtab-setting-row { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:13px 0; border-top:1px solid rgba(255,255,255,.06); }
.mtab-setting-row:first-child { border-top:0; padding-top:0; }
.set-info { display:flex; flex-direction:column; gap:4px; min-width:0; }
.set-label { color:#fff; font-size:13px; font-weight:900; }
.set-desc { color:#a1a1aa; font-size:12px; }
.ps-field { display:flex; flex-direction:column; gap:6px; color:#a1a1aa; font-size:11px; font-weight:900; text-transform:uppercase; }
.ps-field.bare { min-width:min(240px, 45vw); }
.ps-modern-input { width:100%; box-sizing:border-box; background:#0e0e11; border:1px solid #27272a; color:#f4f4f5; border-radius:8px; padding:10px 12px; font:inherit; font-size:13px; text-transform:none; outline:none; }
.ps-modern-input:focus { border-color:#f59e0b; box-shadow:0 0 0 3px rgba(245,158,11,.12); }
textarea.ps-modern-input { min-height:108px; resize:vertical; line-height:1.45; }
.textarea-xl { min-height:280px !important; }
.dev-area { min-height:90px !important; font-family:ui-monospace, SFMono-Regular, Consolas, monospace; font-size:12px; }
.setting-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin:8px 0 12px; }
.mtab-param-row { display:flex; flex-direction:column; gap:8px; margin-top:12px; }
.param-label { color:#a1a1aa; font-size:12px; font-weight:900; display:flex; justify-content:space-between; }
.mtab-locked-state { border:1px dashed #27272a; border-radius:8px; padding:28px; background:#101114; text-align:center; color:#a1a1aa; display:grid; place-items:center; gap:10px; }
.mtab-locked-state .meg-svg { width:34px; height:34px; color:#a855f7; }
.mtab-locked-state h3 { margin:0; color:#fff; font-size:18px; }
.mtab-locked-state p { margin:0; max-width:640px; line-height:1.45; }
.empty-state img { width:110px; height:110px; object-fit:cover; border-radius:12px; border:1px solid #27272a; }
.mtab-callout { display:flex; align-items:flex-start; gap:10px; margin-top:12px; padding:12px; border-radius:8px; background:rgba(99,102,241,.07); color:#c7d2fe; border:1px solid rgba(99,102,241,.16); font-size:12px; line-height:1.45; }
.mtab-callout.gold { background:rgba(245,158,11,.07); color:#fbbf24; border-color:rgba(245,158,11,.18); }
.mtab-callout.purple { background:rgba(168,85,247,.07); color:#d8b4fe; border-color:rgba(168,85,247,.18); }
.inline-form { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:stretch; }
.mtab-ban-item { display:flex; align-items:center; justify-content:space-between; gap:12px; border:1px solid rgba(239,68,68,.2); border-radius:8px; padding:10px 12px; background:rgba(239,68,68,.06); color:#fca5a5; cursor:pointer; text-align:left; }
.mtab-ban-item:hover { background:rgba(239,68,68,.12); }
.empty-text { color:#a1a1aa; font-size:13px; padding:8px; }
.image-lab { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr); gap:14px; }
.visual-preview { min-height:260px; border-radius:8px; border:1px solid #27272a; background:#0e0e11 center/cover; overflow:hidden; position:relative; display:flex; align-items:flex-end; }
.visual-preview::before { content:""; position:absolute; inset:0; background:linear-gradient(to top, rgba(0,0,0,.9), transparent 75%); }
.visual-preview div { position:relative; z-index:1; padding:16px; font-weight:900; color:#fff; display:flex; gap:8px; align-items:center; }
.resolution-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:8px; margin-bottom:14px; }
.res-pill { border:1px solid #27272a; background:#101114; color:#a1a1aa; border-radius:8px; padding:9px; cursor:pointer; font-weight:800; font-size:12px; text-align:left; }
.res-pill.active { color:#111; background:#f59e0b; border-color:#f59e0b; }
.placeholder-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:8px; margin-top:12px; }
.placeholder-grid div { display:flex; flex-direction:column; gap:4px; border:1px solid #27272a; border-radius:8px; padding:10px; background:#0e0e11; }
.placeholder-grid code { color:#f59e0b; font-size:12px; }
.placeholder-grid span { color:#a1a1aa; font-size:12px; }
.npc-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:12px; }
.npc-card { display:grid; grid-template-columns:104px minmax(0,1fr); gap:14px; border:1px solid #27272a; border-radius:8px; padding:12px; background:#18191f; }
.npc-img { width:104px; height:104px; border-radius:8px; object-fit:cover; border:1px solid #27272a; background:#0e0e11; display:grid; place-items:center; color:#f59e0b; font-size:38px; font-weight:900; }
.npc-title-row { display:flex; justify-content:space-between; gap:8px; align-items:start; }
.npc-title-row h3 { margin:0; font-size:17px; }
.npc-meta, .npc-body p { color:#a1a1aa; font-size:12px; line-height:1.45; margin:6px 0; }
.npc-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
.memory-dashboard { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.mem-stat { border:1px solid #27272a; border-radius:8px; padding:16px; background:#18191f; }
.mem-stat strong { display:block; color:var(--stat-color); font-size:28px; line-height:1; }
.mem-stat span { display:block; color:#fff; font-weight:900; margin-top:8px; }
.mem-stat small { color:#a1a1aa; }
.mem-progress { display:flex; height:12px; border-radius:999px; overflow:hidden; background:#0e0e11; border:1px solid #27272a; margin:14px 0; }
.mem-progress span { display:block; transition:width .35s ease; }
.mem-prog-working { background:#10b981; }
.mem-prog-short { background:#f59e0b; }
.mem-prog-long { background:#3b82f6; }
.mem-accordion { border:1px solid #27272a; border-radius:8px; background:#101114; margin:8px 0; padding:0; }
.mem-accordion summary { cursor:pointer; padding:12px; font-weight:900; display:flex; justify-content:space-between; gap:12px; }
.mem-accordion summary span { color:#a1a1aa; font-size:11px; }
pre { white-space:pre-wrap; color:#d4d4d8; margin:0; padding:12px; border-top:1px solid #27272a; font-size:12px; line-height:1.45; }
.dev-layout { display:grid; grid-template-columns:minmax(0,1.35fr) minmax(280px,.65fr); gap:14px; }
.custom-engine-row { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px; border:1px solid #27272a; border-radius:8px; background:#101114; margin-bottom:8px; }
.custom-engine-row div { display:flex; flex-direction:column; gap:3px; }
.custom-engine-row span { color:#a1a1aa; font-size:12px; }
.meg-inline-image { margin-top:10px; border:1px solid #27272a; background:#111; border-radius:8px; overflow:hidden; max-width:420px; }
.meg-inline-image img { display:block; width:100%; height:auto; }
.meg-inline-image div { padding:10px; display:flex; flex-direction:column; gap:4px; }
.meg-inline-image span { color:#a1a1aa; font-size:12px; }
@media (max-width:900px) {
  .ps-modern-modal.app-container { width:100vw; height:100dvh; border-radius:0; border:0; }
  .dock { left:0; right:0; top:auto; bottom:0; width:100%; height:66px; flex-direction:row; padding:8px; border-radius:12px 12px 0 0; overflow:auto; }
  .dock:hover { width:100%; }
  .dock-icon { width:52px; min-width:52px; height:48px; margin:0; justify-content:center; padding:0; }
  .dock-icon span { display:none; }
  .hero-banner { height:190px; }
  .hero-content { padding:0 18px 22px 18px; }
  .hero-content .name { font-size:34px; }
  .top-app-bar { padding:12px; }
  .app-actions .ps-modern-btn span, .app-actions .ps-modern-btn:not(.primary) { font-size:0; gap:0; padding:9px; }
  .app-actions .ps-modern-btn .meg-svg { margin:0; }
  .main-content { padding:16px 14px 86px; }
  .mtab-header { align-items:flex-start; flex-direction:column; }
  .image-lab, .dev-layout { grid-template-columns:1fr; }
  .memory-dashboard { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .mtab-setting-row { align-items:stretch; flex-direction:column; }
  .inline-form { grid-template-columns:1fr; }
}
@media (max-width:560px) {
  .mtab-card-grid, .mtab-card-grid.compact, .npc-grid, .setting-grid, .resolution-grid, .memory-dashboard { grid-template-columns:1fr; }
}`;
}
export {
  setup
};

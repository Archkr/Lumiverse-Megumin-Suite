import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import type { EngineMode, MeguminProfile, RpcResponse } from "./types";
import { DEFAULT_PROFILE, clone, mergeProfile } from "./defaults";
import { KAZUMA_PLACEHOLDERS, RESOLUTIONS } from "./image-data";

type Ctx = SpindleFrontendContext & Record<string, any>;

type AppState = {
  ready: boolean;
  visible: boolean;
  saving: boolean;
  activeTab: number;
  devMode: boolean;
  engineFilter: string;
  styleFilter: string;
  context: any;
  profile: MeguminProfile;
  logic: any;
  engines: EngineMode[];
  customEngines: EngineMode[];
  imageConnections: any[];
  uiAssets: { heroImages: string[]; groupImage?: string; mascotImage?: string };
  status: string;
};

let ctxRef: Ctx | null = null;
let appMount: any = null;
let floatWidget: any = null;
let removeStyle: (() => void) | null = null;
let cleanupTagInterceptor: (() => void) | null = null;
let pending = new Map<string, { resolve: (value: any) => void; reject: (err: Error) => void }>();
let seq = 0;

const state: AppState = {
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

export const MEGUMIN_PARITY_LABELS = {
  tabs: [
    ["Core Engine", "Choose the core ruleset that drives all NPC behavior and world logic."],
    ["Persona & Toggles", "Define the personality and extra toggles."],
    ["Writing Style", "Apply a prebuilt style, generate one with AI, or build your own."],
    ["Global Settings", "Set response length, output language, and how the AI addresses you."],
    ["Add-ons & Blocks", "Attach extra modules that appear at the end of every response."],
    ["Chain of Thought", "Control the AI's internal reasoning process before it writes."],
    ["Story Planner", "Generate and track future plot developments."],
    ["Dynamic Ban List", "Scan and ban repetitive AI phrases."],
    ["Image Generation", "Wire up ComfyUI to auto-generate scene images during roleplay."],
    ["NPCs Bank", "Automatically extract and track significant NPCs in the story."],
    ["Memory Core", "Advanced 3-Tier Context & History Management."]
  ]
};

const tabs = [
  { title: "Core Engine", sub: "Choose the core ruleset that drives all NPC behavior and world logic.", short: "Engine", icon: "fa-server", color: "#f59e0b", render: renderEngines },
  { title: "Persona & Toggles", sub: "Define the personality and extra toggles.", short: "Persona", icon: "fa-user-astronaut", color: "#ec4899", render: renderPersona },
  { title: "Writing Style", sub: "Apply a prebuilt style, generate one with AI, or build your own.", short: "Style", icon: "fa-pen-nib", color: "#a855f7", render: renderStyle },
  { title: "Global Settings", sub: "Set response length, output language, and how the AI addresses you.", short: "Global", icon: "fa-earth-americas", color: "#3b82f6", render: renderGlobalSettings },
  { title: "Add-ons & Blocks", sub: "Attach extra modules that appear at the end of every response.", short: "Blocks", icon: "fa-puzzle-piece", color: "#10b981", render: renderBlocks },
  { title: "Chain of Thought", sub: "Control the AI's internal reasoning process before it writes.", short: "Thinking", icon: "fa-brain", color: "#8b5cf6", render: renderThinking },
  { title: "Story Planner", sub: "Generate and track future plot developments.", short: "Story", icon: "fa-map", color: "#f59e0b", render: renderStory },
  { title: "Dynamic Ban List", sub: "Scan and ban repetitive AI phrases.", short: "Ban", icon: "fa-ban", color: "#ef4444", render: renderBanList },
  { title: "Image Generation", sub: "Wire up ComfyUI to auto-generate scene images during roleplay.", short: "Image", icon: "fa-image", color: "#06b6d4", render: renderImage },
  { title: "NPCs Bank", sub: "Automatically extract and track significant NPCs in the story.", short: "NPCs", icon: "fa-address-book", color: "#f43f5e", render: renderNpc },
  { title: "Memory Core", sub: "Advanced 3-Tier Context & History Management.", short: "Memory", icon: "fa-memory", color: "#10b981", render: renderMemory }
];

const devTab = { title: "Dev Engine Builder", sub: "Clone, edit, and save custom Megumin engine blocks.", short: "Dev", icon: "fa-code", color: "#a855f7", render: renderDev };

export function setup(ctx: SpindleFrontendContext) {
  ctxRef = ctx as Ctx;
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

  const unsubscribeBackend = ctxRef.onBackendMessage((payload: unknown) => {
    const response = payload as RpcResponse;
    if (!response?.requestId) return;
    const waiter = pending.get(response.requestId);
    if (!waiter) return;
    pending.delete(response.requestId);
    if (response.type === "rpc:error") waiter.reject(new Error(response.error || "Megumin request failed"));
    else waiter.resolve(response.payload);
  });

  cleanupTagInterceptor = ctxRef.messages?.registerTagInterceptor?.(
    { tagName: "megumin-image", removeFromMessage: true },
    (payload: any) => renderMeguminImageTag(payload)
  );

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

async function request<T = any>(type: string, payload?: unknown): Promise<T> {
  if (!ctxRef) throw new Error("Megumin frontend is not ready");
  const requestId = `meg-${Date.now()}-${++seq}`;
  const promise = new Promise<T>((resolve, reject) => pending.set(requestId, { resolve, reject }));
  ctxRef.sendToBackend({ type, requestId, payload });
  return promise;
}

async function bootstrap() {
  const data = await request<any>("bootstrap");
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

function root(): HTMLElement {
  return appMount.root as HTMLElement;
}

function render() {
  if (!appMount || !state.visible) return;
  const current = state.devMode ? devTab : tabs[state.activeTab] || tabs[0];
  const heroImage = heroImageUrl();
  const status = heroStatus();
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
                <div class="live-token-count" title="Estimated Payload Tokens">${icon("fa-microchip")} ~${estimatePayloadTokens()}</div>
                <button type="button" class="ps-modern-btn secondary gold" data-action="sync-tab">${icon("fa-earth-americas")} Sync Tab Globally</button>
                <button type="button" class="ps-modern-btn secondary danger" data-action="reset">${icon("fa-rotate-left")} Reset</button>
                <button type="button" class="ps-modern-btn secondary purple ${state.devMode ? "active" : ""}" data-action="open-dev">${icon("fa-code")} Dev</button>
                <span class="ps-save-indicator ${state.saving ? "saving" : ""}">${escapeHtml(state.status)}</span>
                <button type="button" class="ps-modern-btn primary" data-action="close">${icon("fa-save")} Save & Close</button>
              </div>
            </div>
            <div class="hero-content">
              <div class="status" id="ps_rule_status_main" style="color:${status.color};text-shadow:${status.shadow};">${escapeHtml(status.text)}</div>
              <h2 class="name" id="ps_char_rule_label">${escapeHtml(heroName())}</h2>
              <p>${escapeHtml(current.sub)}</p>
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

function dockButton(tab: typeof tabs[number], index: number): string {
  const active = !state.devMode && index === state.activeTab;
  return `<button type="button" class="dock-icon ${active ? "active" : ""}" data-tab="${index}" title="${escapeHtml(tab.title)}">
    ${icon(tab.icon)}<span>${escapeHtml(tab.title)}</span>
  </button>`;
}

function scopeLabel(): string {
  return state.context?.chatId ? `Chat Profile: ${state.context.chatId}` : "Global Default";
}

function heroImageUrl(): string {
  if (state.context?.isGroup && state.uiAssets.groupImage) return state.uiAssets.groupImage;
  if (state.context?.characterAvatarUrl) return state.context.characterAvatarUrl;
  const heroes = state.uiAssets.heroImages || [];
  return heroes[(state.activeTab + (state.context?.chatId || "").length) % Math.max(1, heroes.length)] || "";
}

function heroStatus(): { text: string; color: string; shadow: string } {
  if (state.context?.isGroup) return { text: "Custom Group Profile", color: "#3b82f6", shadow: "0 0 10px rgba(59,130,246,0.5)" };
  if (state.context?.characterId) return { text: "Custom Character Profile", color: "#10b981", shadow: "0 0 10px rgba(16,185,129,0.5)" };
  if (state.context?.chatId) return { text: "Using System Default", color: "#f59e0b", shadow: "0 0 10px rgba(245,158,11,0.5)" };
  return { text: "Modifying Global Default", color: "#a855f7", shadow: "0 0 10px rgba(168,85,247,0.5)" };
}

function heroName(): string {
  if (state.context?.isGroup) return state.context.groupName || state.context.chatName || "Group Chat";
  if (state.context?.characterId && state.context.characterName !== "the character") return state.context.characterName;
  return state.context?.chatName || "Global Default";
}

function wire(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.devMode = false;
      state.activeTab = Number(button.dataset.tab || 0);
      render();
    });
  });
  container.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
    el.addEventListener("click", () => handleAction(el));
  });
  container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-bind]").forEach((input) => {
    input.addEventListener("change", () => {
      const path = input.dataset.bind!;
      const value = readInputValue(input);
      setPath(state.profile as any, path, value);
      saveProfileSoon();
      render();
    });
    if (input.tagName === "TEXTAREA" || input.type === "text" || input.type === "number" || input.type === "range") {
      input.addEventListener("input", () => {
        const path = input.dataset.bind!;
        setPath(state.profile as any, path, readInputValue(input));
        saveProfileSoon();
      });
    }
  });
}

function readInputValue(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): unknown {
  if (input instanceof HTMLInputElement && input.type === "checkbox") return input.checked;
  if (input instanceof HTMLInputElement && (input.type === "number" || input.type === "range")) return Number(input.value);
  return input.value;
}

let saveTimer: number | null = null;
function saveProfileSoon() {
  if (saveTimer) window.clearTimeout(saveTimer);
  state.saving = true;
  state.status = "Saving...";
  saveTimer = window.setTimeout(async () => {
    try {
      const data = await request<any>("profile:save", { profile: state.profile });
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

async function handleAction(el: HTMLElement) {
  const action = el.dataset.action;
  try {
    if (action === "close") return closeApp();
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
      if (!confirm("Reset this Megumin profile to defaults?")) return;
      const data = await request<any>("profile:reset");
      state.profile = mergeProfile(data.profile);
      state.status = "Reset";
      state.devMode = false;
      render();
      return;
    }
    if (action === "sync-tab") {
      const data = await request<any>("profile:syncTab", { keys: activeTabProfileKeys() });
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
      const style = [...(state.logic?.directStyles || []), ...(state.profile.customStyles || [])].find((item: any) => item.id === el.dataset.value);
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
    if (action === "style-save-custom") {
      const name = ((root().querySelector("#style-name") as HTMLInputElement)?.value || "Custom AI Style").trim();
      const rule = state.profile.aiRule.trim();
      if (!rule) throw new Error("Write or generate a rule before saving");
      const id = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || Date.now()}`;
      const existing = (state.profile.customStyles || []).filter((style) => style.id !== id);
      state.profile.customStyles = [...existing, { id, name, rule, notes: "" }];
      state.profile.activeStyleId = id;
      saveProfileSoon();
      render();
      return;
    }
    if (action === "toggle") {
      const path = el.dataset.path!;
      setPath(state.profile as any, path, !getPath(state.profile as any, path));
      saveProfileSoon();
      render();
      return;
    }
    if (action === "select") {
      setPath(state.profile as any, el.dataset.path!, el.dataset.value);
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
      const path = el.dataset.path!;
      const value = el.dataset.value!;
      const current = [...(getPath(state.profile as any, path) || [])];
      setPath(state.profile as any, path, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
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
    if (action === "story-generate") return runTask("Generating story plan...", "story:generate");
    if (action === "ban-analyze") return runTask("Analyzing style...", "banlist:analyze");
    if (action === "memory-process") return runTask("Processing memory...", "memory:process");
    if (action === "npc-scan") return runTask("Scanning NPCs...", "npc:scan");
    if (action === "image-manual") {
      const prompt = (root().querySelector("#meg-manual-image-prompt") as HTMLTextAreaElement)?.value || "";
      return runTask("Generating image...", "image:manual", { prompt });
    }
    if (action === "image-test") return runTask("Testing ComfyUI connection...", "image:connections");
    if (action === "image-workflow-noop") {
      state.status = "Workflow settings are saved";
      render();
      return;
    }
    if (action === "npc-portrait") return runTask("Generating portrait...", "npc:portrait", { name: el.dataset.name });
    if (action === "npc-clear") {
      if (!state.profile.npcBank.npcs.length || !confirm("Clear all saved NPCs?")) return;
      state.profile.npcBank.npcs = [];
      saveProfileSoon();
      render();
      return;
    }
    if (action === "ban-remove") {
      state.profile.banList = state.profile.banList.filter((item) => item !== el.dataset.value);
      saveProfileSoon();
      render();
      return;
    }
    if (action === "ban-clear") {
      if (!state.profile.banList.length || !confirm("Clear every banned phrase?")) return;
      state.profile.banList = [];
      saveProfileSoon();
      render();
      return;
    }
    if (action === "ban-add") {
      const raw = (root().querySelector("#ban-manual") as HTMLTextAreaElement)?.value || "";
      const additions = raw.split(/\n+/).map((item) => item.trim()).filter(Boolean);
      for (const item of additions) if (!state.profile.banList.includes(item)) state.profile.banList.push(item);
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
    if (action === "memory-clear-short") {
      state.profile.memoryCore.shortTermChunks = [];
      saveProfileSoon();
      render();
      return;
    }
    if (action === "memory-clear-vault") {
      if (!state.profile.memoryCore.longTermVault.length || !confirm("Clear the Long-Term Vault?")) return;
      state.profile.memoryCore.longTermVault = [];
      saveProfileSoon();
      render();
      return;
    }
    if (action === "memory-test-vector") {
      state.status = "Scanner ready";
      render();
      return;
    }
    if (action === "ban-export") {
      const blob = new Blob([JSON.stringify(state.profile.banList, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "megumin-ban-list.json";
      anchor.click();
      URL.revokeObjectURL(url);
      return;
    }
    if (action === "dev-save") return saveDevEngine();
    if (action === "dev-delete") return deleteDevEngine(el.dataset.id || "");
  } catch (err) {
    state.status = err instanceof Error ? err.message : String(err);
    render();
  }
}

async function runTask(status: string, type: string, payload?: unknown) {
  state.status = status;
  render();
  const data = await request<any>(type, payload);
  if (data.profile) state.profile = mergeProfile(data.profile);
  if (data.imageConnections) state.imageConnections = data.imageConnections;
  state.status = "Done";
  render();
}

async function saveDevEngine() {
  const id = (root().querySelector("#dev-id") as HTMLInputElement)?.value.trim();
  const label = (root().querySelector("#dev-label") as HTMLInputElement)?.value.trim();
  const p1 = (root().querySelector("#dev-p1") as HTMLTextAreaElement)?.value || "";
  const p3 = (root().querySelector("#dev-p3") as HTMLTextAreaElement)?.value || "";
  const p4 = (root().querySelector("#dev-p4") as HTMLTextAreaElement)?.value || "";
  const p5 = (root().querySelector("#dev-p5") as HTMLTextAreaElement)?.value || "";
  const p6 = (root().querySelector("#dev-p6") as HTMLTextAreaElement)?.value || "";
  if (!id || !label) throw new Error("Engine id and label are required");
  const data = await request<any>("engine:save", { engine: { id, label, color: "#a855f7", p1, p3, p4, p5, p6 } });
  state.engines = data.engines;
  state.customEngines = data.customEngines;
  state.status = "Engine saved";
  render();
}

async function deleteDevEngine(id: string) {
  if (!id || !confirm(`Delete ${id}?`)) return;
  const data = await request<any>("engine:delete", { id });
  state.engines = data.engines;
  state.customEngines = data.customEngines;
  state.status = "Engine deleted";
  render();
}

function renderEngines(): string {
  const descriptions: Record<string, string> = {
    balance: "The original Secret Sauce. NPCs react naturally &mdash; no simping, no needless hostility.",
    "balance Test": "New and improved balance mode that aims to use less tokens and more creativity.",
    cinematic: "Hollywood-inspired storytelling. Dramatic beats and heightened tension.",
    dark: "Balance but harsher. The world is unforgiving and consequences hit harder.",
    "v6-anime-director": "Advanced cinematic framing and pacing. Designed to emulate high-budget anime direction.",
    "v6-dream-team": "The ultimate 6-specialist writer room. Unprecedented narrative consistency and realism.",
    "v6-dream-team-lite": "A streamlined version of the Dream Team. Faster generation with lower token overhead.",
    "v7-core": "The V7 Core engine. The perfect middle ground: cinematic pacing, realistic friction, and relentless world progression.",
    "v7-reality": "The V7 Reality engine. Grounded, unrelenting simulation with zero narrative protection.",
    "v7-gentle": "The V7 Gentle engine. A softer, For pussies."
  };
  const active = state.engines.find((engine) => engine.id === state.profile.mode);
  const visible = state.engines.filter((engine) => engineMatchesFilter(engine, state.engineFilter));
  const isV7 = state.profile.mode.startsWith("v7");

  return `
    ${tabHeader("Core Engines", "Choose the narrative engine that drives your AI's behavior.", "fa-microchip", "#f59e0b", active?.label || state.profile.mode, "#10b981", "fa-circle-check")}
    <div class="wstyle-filters">
      ${["all", "V4", "V5", "V6", "V7"].map((filter) => filterPill(filter, state.engineFilter === filter, engineCount(filter))).join("")}
    </div>
    <div class="mtab-card-grid">
      ${visible.map((engine) => engineCard(engine, descriptions[engine.id] || `${engine.label || engine.id} engine flow.`)).join("")}
    </div>
    ${state.engineFilter === "V6" && !visible.length ? lockedState("fa-hammer", "V6 Engines are in the forge.", "Stay tuned for the next update! Later this week.") : ""}
    ${isV7 ? `<div class="wstyle-section-head blue">${icon("fa-layer-group")} V7 Modules (Turn off to disable)</div>
    <div class="mtab-card-list">
      ${toggleGeneric("OOC Protocol", "toggles.v7_ooc", state.profile.toggles.v7_ooc, "Allows out-of-character directives.")}
      ${toggleGeneric("PC Solo Physicality", "toggles.v7_pcsolo", state.profile.toggles.v7_pcsolo, "Narration of PC when unobserved.")}
      ${toggleGeneric("Introduction Protocol", "toggles.v7_intro", state.profile.toggles.v7_intro, "How new NPCs enter the story.")}
      ${toggleGeneric("Cultural Anchoring", "toggles.v7_culture", state.profile.toggles.v7_culture, "Real-world integration and references.")}
      ${toggleGeneric("Scene Choreography", "toggles.v7_scene", state.profile.toggles.v7_scene, "Focus shifting and crowd management.")}
    </div>` : ""}
    ${state.customEngines.length ? `<div class="wstyle-section-head green">${icon("fa-puzzle-piece")} Custom User Engines</div><div class="mtab-card-grid">${state.customEngines.map((engine) => engineCard(engine, "Custom Engine Flow")).join("")}</div>` : ""}`;
}

function renderPersona(): string {
  const personalities = state.logic?.personalities || [];
  const locked = state.profile.mode.startsWith("v7") || state.profile.mode.includes("v6-dream-team");
  const lockedText = state.profile.mode.startsWith("v7")
    ? "The V7 engine utilizes a pure narrative framework. Standard persona injections are disabled to prevent logic conflicts."
    : "The V6 Dream Team engine utilizes an intrinsic 6-specialist framework. Standard persona injections are disabled to prevent logic conflicts.";
  return `
    ${tabHeader("Persona & Toggles", "Set the narrator's voice and fine-tune engine behavior.", "fa-masks-theater", "#ec4899", locked ? "Locked" : state.profile.personality, "#ec4899", "fa-user")}
    ${locked ? lockedState("fa-user-lock", "Persona Selection Locked", lockedText) : `
      <div class="wstyle-section-head purple">${icon("fa-masks-theater")} Select Persona</div>
      <div class="mtab-card-grid">
        ${personalities.map((item: any) => infoCard({
          title: item.label,
          sub: personaDesc(item.id, item.content),
          active: state.profile.personality === item.id,
          action: "select",
          path: "personality",
          value: item.id,
          badge: item.recommended ? "Recommended" : ""
        })).join("")}
      </div>`}
    <div class="wstyle-section-head gold">${icon("fa-sliders")} Extra Toggles</div>
    <div class="mtab-card-list">
      ${(Object.entries(state.logic?.toggles || {}) as Array<[string, any]>).map(([key, toggle]) => toggleGeneric(toggle.label, `toggles.${key}`, !!state.profile.toggles[key], toggle.recommendedOff ? "Off by default - most engines handle this natively" : "")).join("")}
    </div>`;
}

function renderStyle(): string {
  const directStyles = state.logic?.directStyles || [];
  const templates = state.logic?.styleTemplates || [];
  const filter = ["all", "precooked", "custom", "generators"].includes(state.styleFilter) ? state.styleFilter : "all";
  const isV7 = state.profile.mode.startsWith("v7");
  const isOff = !state.profile.activeStyleId && !state.profile.aiRule;
  const customStyles = state.profile.customStyles || [];
  const existingNames = customStyles.map((style) => style.name);
  const genTemplates = templates.filter((template: any) => !existingNames.includes(template.name));
  const activeName = state.profile.activeStyleId
    ? directStyles.find((item: any) => item.id === state.profile.activeStyleId)?.name || "Custom"
    : state.profile.aiRule ? "Custom Rule" : "No Style Active";
  return `
    <div class="wstyle-header">
      <div class="wstyle-header-left">
        <div class="wstyle-header-icon">${icon("fa-pen-nib")}</div>
        <div><h2>Writing Style</h2><p>Apply a prebuilt style, generate one with AI, or craft your own.</p></div>
      </div>
      <div class="wstyle-active-badge ${isOff ? "off" : ""}">${icon(isOff ? "fa-power-off" : "fa-circle-check")} ${escapeHtml(activeName)}</div>
    </div>
    ${!isV7 ? `<button type="button" class="wstyle-off-card ${isOff ? "active" : ""}" data-action="style-off">
      <span class="off-left"><span class="off-icon">${icon("fa-power-off")}</span><span><strong>No Style (Off)</strong><small>Let the engine decide &mdash; no extra style directives injected.</small></span></span>
      ${isOff ? `<span class="card-status active-status">${icon("fa-check")} Active</span>` : ""}
    </button>` : `<div class="wstyle-off-card locked-card"><span class="off-left"><span class="off-icon blue">${icon("fa-lock")}</span><span><strong>No Style (Off) - Locked</strong><small>V7 Engines require a narrative style directive. Defaulting to V7 Recommended.</small></span></span></div>`}
    <div class="wstyle-dnr-panel">
      <div class="wstyle-dnr-header">
        <div class="dnr-info"><div class="dnr-icon">${icon("fa-scale-balanced")}</div><div><strong>Dialogue / Narration Ratio</strong><small>Fine-tune the balance between spoken dialogue and descriptive prose.</small></div></div>
        <button type="button" class="ps-toggle-card ${state.profile.dnRatio.enabled ? "active" : ""}" data-action="toggle" data-path="dnRatio.enabled"><span class="ps-switch"></span></button>
      </div>
      <div class="wstyle-dnr-body ${state.profile.dnRatio.enabled ? "open" : ""}">
        <div class="wstyle-dnr-slider-track"><span class="wstyle-dnr-label narr">${100 - state.profile.dnRatio.dialogue}% Narration</span><input type="range" min="0" max="100" step="10" data-bind="dnRatio.dialogue" value="${state.profile.dnRatio.dialogue}"><span class="wstyle-dnr-label dial">${state.profile.dnRatio.dialogue}% Dialogue</span></div>
        <div class="dnr-preview">Preview - "Maintain a balance of ${state.profile.dnRatio.dialogue}% Dialogue and ${100 - state.profile.dnRatio.dialogue}% Narration."</div>
      </div>
    </div>
    <div class="wstyle-filters">
      ${stylePill("all", "All", directStyles.length + customStyles.length + genTemplates.length)}
      ${stylePill("precooked", "Precooked", directStyles.length, "fa-fire-burner")}
      ${stylePill("custom", "My Library", customStyles.length, "fa-book")}
      ${stylePill("generators", "AI Generators", genTemplates.length, "fa-wand-magic-sparkles")}
    </div>
    ${filter === "all" || filter === "precooked" ? `<div class="style-section"><div class="wstyle-section-head gold">${icon("fa-fire-burner")} Precooked Styles</div><div class="wstyle-list">${directStyles.map((style: any) => styleCard(style.name, style.desc, style.rule, state.profile.activeStyleId === style.id, "style-direct", style.id)).join("")}</div></div>` : ""}
    ${filter === "all" || filter === "custom" ? `<div class="style-section"><div class="wstyle-section-head green">${icon("fa-book")} My Library</div><div class="wstyle-list">${customStyles.map((style) => styleCard(style.name, style.notes || "Custom AI style.", style.rule, state.profile.activeStyleId === style.id, "style-direct", style.id)).join("")}<button type="button" class="wstyle-create-card" data-action="style-filter" data-value="custom">${icon("fa-plus")} Create Custom AI Style</button></div></div>` : ""}
    ${filter === "all" || filter === "generators" ? `<div class="style-section"><div class="wstyle-section-head purple">${icon("fa-wand-magic-sparkles")} AI Style Generators</div><div class="mtab-card-grid">${genTemplates.map((template: any, index: number) => `<button type="button" class="wstyle-gen-card" data-action="style-template" data-index="${index}"><span class="gen-info"><span class="gen-title">${escapeHtml(template.name)}</span><span class="gen-desc">${escapeHtml((template.notes || (template.tags || []).join(", ")).slice(0, 180))}</span></span><span class="wstyle-gen-btn">${icon("fa-bolt")} Generate</span></button>`).join("")}</div></div>` : ""}
    <div class="wstyle-section-head purple">${icon("fa-pen-nib")} Create Custom AI Style</div>
    <div class="mtab-panel">
      <div class="wstyle-editor-bar"><input id="style-name" class="ps-modern-input" placeholder="Name your style..."><button class="ps-modern-btn secondary" type="button" data-action="style-save-custom">${icon("fa-save")} Save</button><button class="ps-modern-btn secondary" type="button">${icon("fa-arrow-left")} Back</button></div>
      <div class="panel-heading-row"><div class="mtab-panel-title purple">${icon("fa-scroll")} Generated Rule</div><button class="wstyle-gen-btn" type="button">${icon("fa-bolt")} Generate Writing Rule</button></div>
      <textarea class="ps-modern-input textarea-xl" data-bind="aiRule" placeholder="Select tags above and click Generate...">${escapeHtml(state.profile.aiRule)}</textarea>
      <div class="wstyle-info-callout">${icon("fa-circle-info")}<span>After generating or editing your rule, hit <strong>Save</strong> in the toolbar above to apply it to your library.</span></div>
    </div>`;
}

function renderGlobalSettings(): string {
  const addons = state.logic?.addons || [];
  return `
    ${tabHeader("Global Settings", "Toggle add-ons, set output preferences, and configure extras.", "fa-puzzle-piece", "#3b82f6", `${state.profile.addons.length} Active`, "#3b82f6", "fa-toggle-on")}
    <div class="wstyle-section-head blue">${icon("fa-puzzle-piece")} Gameplay Add-ons</div>
    <div class="mtab-card-grid">${addons.map((item: any) => moduleCard(item, state.profile.addons.includes(item.id), "addons")).join("")}</div>
    <div class="mtab-panel">
      <div class="mtab-panel-title blue">${icon("fa-earth-americas")} Extra</div>
      ${toggleGeneric(`${icon("fa-magnifying-glass")} Prompt Payload Preview`, "toggles.promptPreview", !!state.profile.toggles.promptPreview, "Show a popup of the final constructed prompt right before it is sent to the AI. only enable if you know what you doing it maybe buggy.", true)}
      ${toggleGeneric("Disable Utility Prefills", "disableUtilityPrefill", state.profile.disableUtilityPrefill, "Turn this ON if your API (like Claude) errors out during Image Gen, Banlist, or Story Planner generation.")}
      <div class="mtab-setting-row">${settingText("Target Word Count", "Leave empty for no limit")}${inputField("", "userWordCount", state.profile.userWordCount, "e.g. 400", "number")}</div>
      <div class="mtab-setting-row">${settingText("Language Output", "Leave empty for default (English)")}${inputField("", "userLanguage", state.profile.userLanguage, "e.g. Arabic, French...")}</div>
      <div class="mtab-setting-row">${settingText("User Gender", "Ensure the AI addresses you correctly")}${selectField("", "userPronouns", state.profile.userPronouns, [["off", "Off"], ["male", "Male (Him/He)"], ["female", "Female (Her/She)"]])}</div>
      ${toggleGeneric("Cinematic Sounds", "onomatopoeia.enabled", state.profile.onomatopoeia.enabled, "Force the AI to use precise phonetic sound words (e.g., click, thud) instead of abstract descriptions.")}
      ${state.profile.onomatopoeia.enabled ? toggleGeneric("Animate Sounds", "onomatopoeia.useStyling", state.profile.onomatopoeia.useStyling, "Wrap in HTML tags. For capable AI only.") : ""}
    </div>`;
}

function renderBlocks(): string {
  const blocks = state.logic?.blocks || [];
  return `
    ${tabHeader("Response Blocks", "Attach extra UI panels to every AI response.", "fa-cubes", "#10b981", `${state.profile.blocks.length} Active`, "#10b981", "fa-cubes")}
    <div class="mtab-card-grid">
      ${blocks.map((item: any) => moduleCard(item, state.profile.blocks.includes(item.id), "blocks")).join("")}
    </div>`;
}

function renderThinking(): string {
  const currentType = currentCotType();
  const currentLang = currentCotLang();
  return `
    ${tabHeader("Chain of Thought", "Configure the AI's thinking framework and reasoning depth.", "fa-brain", "#a855f7", "", "#a855f7")}
    <div class="wstyle-section-head purple">${icon("fa-gauge-high")} Thinking Effort</div>
    <div class="mtab-callout purple">${icon("fa-circle-info")} <span><strong>Hint:</strong> When using V7 CoT, it is highly recommended to <strong>not</strong> use low Thinking Effort.</span></div>
    <div class="mtab-card-grid compact">
      ${[
        ["100", "100 Words"],
        ["250", "250 Words"],
        ["450", "450 Words"],
        ["custom", "Custom"],
        ["unspecified", "Unspecified"]
      ].map(([id, label]) => infoCard({ title: label, sub: "", active: state.profile.thinkEffort === normalizeEffort(id), action: "select", path: "thinkEffort", value: normalizeEffort(id) })).join("")}
    </div>
    ${state.profile.thinkEffort === "custom" ? `<div class="mtab-panel">${inputField("Custom Word Count", "customThinkEffort", state.profile.customThinkEffort, "100", "number")}</div>` : ""}
    ${toggleGeneric(`${icon("fa-brain")} Gemini Thinking`, "thinkingV2", state.profile.thinkingV2, "Enable only for Gemini. When enabled, you MUST add <think> and </think> to the Reasoning Formatting prefix/suffix. Note: Enable Prefill ONLY if using Gemini models.", true)}
    <div class="wstyle-section-head purple">${icon("fa-diagram-project")} Thinking Framework</div>
    <div class="mtab-card-grid">
      ${cotFrameworks(currentType, currentLang).map((item) => infoCard({ title: item.label, sub: item.desc, active: currentType === item.id, action: "select", path: "model", value: item.value, badge: item.isNew ? "New" : "" })).join("")}
    </div>
    ${currentType !== "off" ? `<div class="wstyle-section-head gold">${icon("fa-language")} Language</div><div class="mtab-card-grid compact">${cotLanguages(currentType).map((item) => infoCard({ title: item.label, sub: "", active: currentLang === item.id, action: "select", path: "model", value: `cot-${currentType}-${item.id}`, badge: item.rec ? "Pro Tip" : "" })).join("")}</div>` : ""}`;
}

function renderStory(): string {
  const sp = state.profile.storyPlan;
  return `
    ${tabHeader("Story Planner", "Brainstorm and track plot milestones automatically.", "fa-map-location-dot", "#f59e0b", sp.enabled ? "Enabled" : "Disabled", sp.enabled ? "#10b981" : "#a1a1aa", sp.enabled ? "fa-circle-check" : "fa-circle-xmark")}
    ${toggleGeneric(`${icon("fa-map-location-dot")} Enable Story Planner`, "storyPlan.enabled", sp.enabled, "Just enable and hit generate plan now and let the ai do the rest.", true)}
    <div class="mtab-panel" style="display:${sp.enabled ? "block" : "none"};">
      <div class="mtab-panel-title gold">${icon("fa-gears")} Engine Settings</div>
      <div class="mtab-setting-row">${settingText("Generation Backend", "")}${selectField("", "storyPlan.backend", sp.backend, [["direct", "Direct API Call (Fast)"]])}</div>
      <div class="mtab-setting-row">${settingText("Auto-Trigger Mode", "Generate new plans automatically.")}${selectField("", "storyPlan.triggerMode", sp.triggerMode, [["manual", "Manual Only"], ["frequency", "Every X Replies"]])}</div>
      ${sp.triggerMode === "frequency" ? `<div class="mtab-setting-row">${settingText("Every X Replies", "")}${inputField("", "storyPlan.autoFreq", String(sp.autoFreq), "10", "number")}</div>` : ""}
    </div>
    <div class="mtab-panel" style="display:${sp.enabled ? "block" : "none"};">
      <div class="panel-heading-row">
        <div class="mtab-panel-title gold">${icon("fa-book-open")} Current Story Plan</div>
        <button class="wstyle-gen-btn" type="button" data-action="story-generate">${icon("fa-bolt")} Generate Plan Now</button>
      </div>
      <textarea class="ps-modern-input textarea-xl" data-bind="storyPlan.currentPlan" placeholder="Generated plot milestones will appear here.">${escapeHtml(sp.currentPlan)}</textarea>
    </div>`;
}

function renderBanList(): string {
  return `
    ${tabHeader("Dynamic Ban List", "Detect and ban overused phrases from AI responses.", "fa-ban", "#ef4444", `${state.profile.banList.length} Banned`, "#ef4444", "fa-ban")}
    <div class="mtab-panel" style="margin-bottom:16px;">
      <div class="panel-heading-row">
        <div class="mtab-panel-title purple">${icon("fa-radar")} AI Slop Detector</div>
        <button class="wstyle-gen-btn purple-bg" type="button" data-action="ban-analyze">${icon("fa-radar")} Analyze Chat</button>
      </div>
      <div class="mtab-setting-row">${settingText("Generator Backend", "Choose how to generate the analysis.")}${selectField("", "banListBackend", state.profile.banListBackend, [["direct", "Direct API Call (Fast)"]])}</div>
    </div>
    <div class="mtab-panel" style="margin-bottom:16px;">
      <div class="mtab-panel-title red">${icon("fa-plus-circle")} Add Phrase</div>
      <div class="inline-form">
        <input class="ps-modern-input" placeholder="Manually add a phrase to ban..." id="ban-manual">
        <button class="ps-modern-btn secondary" type="button" data-action="ban-add">Add</button>
      </div>
    </div>
    <div class="panel-heading-row">
      <div class="wstyle-section-head red">${icon("fa-list")} Active Banned Phrases</div>
      <div class="mtab-btn-row">
        <button class="ps-modern-btn secondary mini blue-text" type="button">${icon("fa-file-import")} Import</button>
        <button class="ps-modern-btn secondary mini green-text" type="button" data-action="ban-export">${icon("fa-file-export")} Export</button>
        <button class="ps-modern-btn secondary danger mini" type="button" data-action="ban-clear">${icon("fa-trash-can")} Clear All</button>
      </div>
    </div>
    <div class="mtab-card-list dashed">
      ${state.profile.banList.length ? state.profile.banList.map((item) => `<button type="button" class="mtab-ban-item" data-action="ban-remove" data-value="${escapeHtml(item)}"><span>${escapeHtml(item)}</span>${icon("fa-xmark")}</button>`).join("") : `<span class="empty-text">No phrases banned yet.</span>`}
    </div>
    <div class="mtab-callout purple">${icon("fa-circle-info")} <span>This is a beta feature. Don't complain if you have to generate more than once.</span></div>`;
}

function renderImage(): string {
  const ig = state.profile.imageGen;
  return `
    ${tabHeader("Image Generation", "ComfyUI integration for automatic scene rendering.", "fa-image", "#06b6d4", ig.enabled ? "Enabled" : "Disabled", ig.enabled ? "#10b981" : "#a1a1aa", ig.enabled ? "fa-circle-check" : "fa-circle-xmark")}
    ${toggleGeneric("Enable Image Generation", "imageGen.enabled", ig.enabled, "Activate ComfyUI integration for this specific character/group.")}
    <div class="mtab-panel">
      <div class="mtab-panel-title blue">${icon("fa-wand-magic-sparkles")} Prompt Generator Backend</div>
      <div class="mtab-setting-row">${settingText("Generation Method", "\"Direct\" is faster. \"Megumin Image\" is more creative.")}${selectField("", "imageGen.generatorBackend", ig.generatorBackend, [["direct", "Direct API Call (Fast)"]])}</div>
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title blue">${icon("fa-plug")} ComfyUI Server & Workflow</div>
      <div class="mtab-setting-row">${settingText("Connection", "Select the ComfyUI-capable image connection.")}${selectField("", "imageGen.connectionId", ig.connectionId, [["", "Default"], ...state.imageConnections.map((c): [string, string] => [String(c.id), `${c.name} (${c.provider})`])])}</div>
      <div class="inline-form"><input class="ps-modern-input" placeholder="http://127.0.0.1:8188"><button class="ps-modern-btn secondary blue-text" type="button" data-action="image-test">${icon("fa-vial")} Test</button></div>
      <div class="mtab-btn-row workflow-row"><button class="ps-modern-btn secondary" type="button" data-action="image-workflow-noop">${icon("fa-plus")} New</button><button class="ps-modern-btn secondary" type="button" data-action="image-workflow-noop">${icon("fa-pen")} Edit</button><button class="ps-modern-btn secondary danger" type="button" data-action="image-workflow-noop">${icon("fa-trash-can")} Delete</button></div>
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title gold">${icon("fa-sliders")} Triggers & Formatting</div>
      <div class="mtab-setting-row">${settingText("Trigger Mode", "")}${selectField("", "imageGen.triggerMode", ig.triggerMode, [["always", "Always (Every Reply)"], ["frequency", "After X Replies"], ["conditional", "Only when character sends a pic"], ["manual", "Manual Button Only"]])}</div>
      ${ig.triggerMode === "frequency" ? `<div class="mtab-setting-row">${settingText("Every X Replies", "")}${inputField("", "imageGen.autoGenFreq", String(ig.autoGenFreq), "1", "number")}</div>` : ""}
      ${toggleGeneric("Preview Prompt Before Sending", "imageGen.previewPrompt", ig.previewPrompt, "Preview the prompt before sending it to ComfyUI.")}
      <div class="setting-grid">${selectField("Model Style Format", "imageGen.promptStyle", ig.promptStyle, [["standard", "Standard"], ["illustrious", "Illustrious / Pony Tags"], ["sdxl", "SDXL Natural Prose"]])}${selectField("Camera Perspective", "imageGen.promptPerspective", ig.promptPerspective, [["scene", "Cinematic Scene"], ["pov", "First Person POV"], ["character", "Character Portrait"]])}</div>
      ${inputField("Extra Instructions...", "imageGen.promptExtra", ig.promptExtra, "moody lighting, dark atmosphere...")}
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title gold">${icon("fa-sliders")} Image Parameters</div>
      <div class="setting-grid">
        ${inputField("Model", "imageGen.selectedModel", ig.selectedModel, "model.safetensors")}
        ${inputField("Sampler", "imageGen.selectedSampler", ig.selectedSampler, "euler")}
        ${inputField("Width", "imageGen.imgWidth", String(ig.imgWidth), "1024", "number")}
        ${inputField("Height", "imageGen.imgHeight", String(ig.imgHeight), "1024", "number")}
        ${inputField("Steps", "imageGen.steps", String(ig.steps), "20", "number")}
        ${inputField("CFG Scale", "imageGen.cfg", String(ig.cfg), "7", "number")}
        ${inputField("Denoise", "imageGen.denoise", String(ig.denoise), "0.5", "number")}
        ${inputField("CLIP Skip", "imageGen.clipSkip", String(ig.clipSkip), "1", "number")}
      </div>
      <div class="wstyle-section-head blue">${icon("fa-up-right-and-down-left-from-center")} Resolution Preset</div>
      <div class="resolution-grid">${RESOLUTIONS.map((res) => `<button type="button" class="res-pill ${ig.imgWidth === res.w && ig.imgHeight === res.h ? "active" : ""}" data-action="select-resolution" data-w="${res.w}" data-h="${res.h}">${escapeHtml(res.label)}</button>`).join("")}</div>
      <div class="mtab-setting-row">${settingText("Seed (-1 for random)", "")}${inputField("", "imageGen.customSeed", String(ig.customSeed), "-1", "number")}</div>
      <textarea class="ps-modern-input" data-bind="imageGen.customNegative" placeholder="Negative Prompt Override">${escapeHtml(ig.customNegative)}</textarea>
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title purple">${icon("fa-flask")} LoRA Lab</div>
      <div class="setting-grid">${[1, 2, 3, 4].map((slot) => loraSlot(slot)).join("")}</div>
    </div>
    <div class="mtab-panel">
      <div class="panel-heading-row">
        <div class="mtab-panel-title blue">${icon("fa-bolt")} Manual Render</div>
        <button class="wstyle-gen-btn blue-bg" type="button" data-action="image-manual">${icon("fa-image")} Generate Image</button>
      </div>
      <textarea id="meg-manual-image-prompt" class="ps-modern-input" placeholder="Optional manual image prompt..."></textarea>
    </div>
    <details class="mtab-panel">
      <summary class="mtab-panel-title blue">${icon("fa-code")} ComfyUI Field Placeholders</summary>
      <div class="placeholder-grid">${KAZUMA_PLACEHOLDERS.map((item) => `<div><code>${escapeHtml(item.key)}</code><span>${escapeHtml(item.desc)}</span></div>`).join("")}</div>
    </details>`;
}

function renderNpc(): string {
  const bank = state.profile.npcBank;
  return `
    ${tabHeader("NPCs Bank", "Automatically extract and track significant NPCs in the story.", "fa-address-book", "#f43f5e", `${bank.npcs.length} NPCs`, "#f43f5e", "fa-users")}
    <div class="mtab-panel">
      ${toggleGeneric("Enable NPC Bank", "npcBank.enabled", bank.enabled, "When enabled, the AI generates detailed dossiers for new NPCs, which are saved here and injected when relevant.")}
      ${toggleGeneric("Send Portraits to AI", "npcBank.sendPortraitsToAi", bank.sendPortraitsToAi, "If an injected NPC has a portrait, send the image to the AI to help it visualize the character.")}
    </div>
    <div class="panel-heading-row"><div class="wstyle-section-head red">${icon("fa-address-book")} Saved NPCs <span class="pill-count">${bank.npcs.length}</span></div><button class="ps-modern-btn secondary danger mini" type="button" data-action="npc-clear">${icon("fa-trash-can")} Clear All</button></div>
    ${bank.npcs.length ? `<div class="npc-list">${bank.npcs.map(renderNpcCard).join("")}</div>` : emptyWithMascot("No NPCs saved yet.", "Dossiers appear here after Megumin extracts them from assistant replies.")}`;
}

function renderNpcCard(npc: any): string {
  const initials = escapeHtml(String(npc.name || "?").slice(0, 1));
  return `
    <details class="npc-card">
      <summary class="npc-card-header">
        <span class="npc-chevron">${icon("fa-chevron-right")}</span>
        ${npc.pfpImageUrl ? `<img class="npc-mini-pfp" src="${escapeHtml(npc.pfpImageUrl)}" alt="">` : `<span class="npc-mini-pfp placeholder">${initials}</span>`}
        <span class="npc-card-title"><strong>${escapeHtml(npc.name)}</strong><small>${escapeHtml([npc.age, npc.sex].filter(Boolean).join(" / ") || "Unknown")}</small></span>
        <button class="icon-btn danger" type="button" data-action="npc-remove" data-name="${escapeHtml(npc.name)}">${icon("fa-trash-can")}</button>
      </summary>
      <div class="npc-card-body">
        <div class="npc-pfp-container">${npc.pfpImageUrl ? `<img src="${escapeHtml(npc.pfpImageUrl)}" alt="">` : `<span>${initials}</span>`}<button class="ps-modern-btn secondary mini" type="button">${icon("fa-upload")} Upload</button><button class="ps-modern-btn secondary mini" type="button" data-action="npc-portrait" data-name="${escapeHtml(npc.name)}">${icon("fa-image")} Generate</button></div>
        <div class="npc-fields">
          ${npcField("Appearance", npc.appearance)}
          ${npcField("Occupation", npc.occupation)}
          ${npcField("Background", npc.background)}
          ${npcField("Inner Circle", npc.innerCircle)}
          ${npcField("Personality", npc.personality)}
          ${npcField("Current Agenda", npc.agenda)}
          ${npcField("Hidden Layer", npc.hiddenLayer)}
        </div>
      </div>
    </details>`;
}

function renderMemory(): string {
  const mem = state.profile.memoryCore;
  const totalUnits = Math.max(1, mem.workingLimit + mem.shortTermLimit + mem.longTermVault.length + mem.shortTermChunks.length);
  const workingPct = clamp((mem.workingLimit / totalUnits) * 100, 8, 70);
  const shortPct = clamp((mem.shortTermLimit / totalUnits) * 100, 8, 70);
  const vaultPct = clamp((mem.longTermVault.length / totalUnits) * 100, 5, 70);
  return `
    ${tabHeader("Memory Core", "3-Tier Context Management: Working, Short-Term, and Long-Term Vector DB.", "fa-memory", "#10b981", mem.enabled ? "Enabled" : "Disabled", mem.enabled ? "#10b981" : "#a1a1aa", mem.enabled ? "fa-circle-check" : "fa-circle-xmark")}
    ${toggleGeneric("Enable Memory Core", "memoryCore.enabled", mem.enabled, "Archiving happens silently in the background. Old messages fade in the UI and are replaced in the prompt with injected summaries.")}
    <div class="mtab-panel">
      <div class="panel-heading-row"><div class="mtab-panel-title green">${icon("fa-chart-pie")} Context Allocation Dashboard</div><span class="mtab-header-badge" style="--badge-color:#a855f7;">~${estimateTokensSaved()} Tokens Saved</span></div>
      <div class="mem-progress-container"><span class="mem-prog-working" style="width:${workingPct}%"></span><span class="mem-prog-short" style="width:${shortPct}%"></span><span class="mem-prog-long" style="width:${vaultPct}%"></span></div>
      <div class="mem-legend"><span>Working</span><span>Pend Short</span><span>Short</span><span>Pend Vault</span><span>Vault</span></div>
      <div class="mtab-callout green">${icon("fa-spinner")} <span>Monitoring Chat History...</span></div>
    </div>
    <div class="mtab-panel">
      <div class="mtab-panel-title blue">${icon("fa-gears")} Extraction Engine Settings</div>
      <div class="mtab-callout gold">${icon("fa-circle-info")} <span><strong>How to Use:</strong> Set limits, then use Apply & Extract Pending to archive older turns into Short-Term summaries and the Long-Term Vault.</span></div>
      <div class="setting-grid">
        ${selectField("Memory Architecture", "memoryCore.architecture", mem.architecture, [["raw_short_long", "Raw Text + Short-Term Summaries + Vault"], ["raw_long", "Raw Text + Vault Directly (Skip Summaries)"]])}
        ${selectField("Scanner", "memoryCore.scannerEngine", mem.scannerEngine, [["tfidf", "TF-IDF Retrieval"], ["semantic", "Semantic Memory"]])}
        ${inputField("Working Limit", "memoryCore.workingLimit", String(mem.workingLimit), "30", "number")}
        ${inputField("Short-Term Limit", "memoryCore.shortTermLimit", String(mem.shortTermLimit), "70", "number")}
        ${selectField("Auto-Trigger Mode", "memoryCore.triggerMode", mem.triggerMode, [["manual", "Manual"], ["frequency", "Every X Replies"]])}
        ${inputField("Auto Frequency", "memoryCore.autoFreq", String(mem.autoFreq), "10", "number")}
      </div>
      <button class="wstyle-gen-btn blue-bg" type="button" data-action="memory-process">${icon("fa-bolt")} Apply & Extract Pending</button>
    </div>
    <div class="mtab-panel">
      <div class="panel-heading-row"><div class="mtab-panel-title gold">${icon("fa-layer-group")} Short-Term Memory</div><button class="ps-modern-btn secondary danger mini" type="button" data-action="memory-clear-short">${icon("fa-trash-can")} Clear All</button></div>
      ${(mem.shortTermChunks || []).slice(-20).reverse().map((chunk) => memoryAccordion(chunk)).join("") || `<span class="empty-text">No short-term summaries yet.</span>`}
    </div>
    <div class="mtab-panel">
      <div class="panel-heading-row"><div class="mtab-panel-title blue">${icon("fa-database")} Long-Term Vault</div><div class="mtab-btn-row"><button class="ps-modern-btn secondary mini blue-text" type="button" data-action="memory-test-vector">${icon("fa-vial")} Test Scanner</button><button class="ps-modern-btn secondary danger mini" type="button" data-action="memory-clear-vault">${icon("fa-trash-can")} Clear All</button></div></div>
      <input class="ps-modern-input" placeholder="Search vault...">
      ${(mem.longTermVault || []).slice(-20).reverse().map((chunk) => memoryAccordion(chunk)).join("") || `<span class="empty-text">No vault entries yet.</span>`}
    </div>`;
}

function renderDev(): string {
  const coreEngines = state.engines.filter((engine) => !state.customEngines.some((custom) => custom.id === engine.id));
  return `
    ${tabHeader("Dev Engine Builder", "Clone, edit, and save custom Megumin engine blocks.", "fa-code", "#a855f7", `${state.customEngines.length} Custom`, "#a855f7", "fa-code")}
    <div class="dev-layout">
      <div class="mtab-panel">
        <div class="mtab-panel-title purple">${icon("fa-wand-magic-sparkles")} Create Engine</div>
        <div class="setting-grid">
          <label class="ps-field"><span>Engine ID</span><input id="dev-id" class="ps-modern-input" placeholder="engine_id"></label>
          <label class="ps-field"><span>Display Name</span><input id="dev-label" class="ps-modern-input" placeholder="Display name"></label>
        </div>
        <textarea id="dev-p1" class="ps-modern-input dev-area" placeholder="[[prompt1]] Root / setup block"></textarea>
        <textarea id="dev-p3" class="ps-modern-input dev-area" placeholder="[[prompt3]] Middle engine block"></textarea>
        <textarea id="dev-p4" class="ps-modern-input dev-area" placeholder="[[prompt4]] Physicality / rules block"></textarea>
        <textarea id="dev-p5" class="ps-modern-input dev-area" placeholder="[[prompt5]] Continuation block"></textarea>
        <textarea id="dev-p6" class="ps-modern-input dev-area" placeholder="[[prompt6]] Final reminder block"></textarea>
        <div class="mtab-btn-row"><button class="wstyle-gen-btn green-bg" type="button" data-action="dev-save">${icon("fa-save")} Save Engine</button><button class="ps-modern-btn secondary" type="button">${icon("fa-file-import")} Import Engine JSON</button></div>
      </div>
      <div class="mtab-panel">
        <div class="mtab-panel-title gold">${icon("fa-copy")} Clone Core Engine</div>
        ${coreEngines.slice(0, 6).map((engine) => `<div class="custom-engine-row"><div><strong>${escapeHtml(engine.label || engine.id)}</strong><span>${escapeHtml(engine.id)}</span></div><button class="ps-modern-btn secondary mini" type="button">${icon("fa-copy")} Clone</button></div>`).join("")}
      </div>
      <div class="mtab-panel dev-full">
        <div class="mtab-panel-title green">${icon("fa-cubes")} Custom Engines</div>
        ${state.customEngines.length ? state.customEngines.map((engine) => `<div class="custom-engine-row"><div><strong>${escapeHtml(engine.label || engine.id)}</strong><span>${escapeHtml(engine.id)}</span></div><button class="icon-btn danger" type="button" data-action="dev-delete" data-id="${escapeHtml(engine.id)}">${icon("fa-trash-can")}</button></div>`).join("") : emptyWithMascot("No custom engines yet.", "Create one on the left, then select it from Core Engines.")}
      </div>
    </div>`;
}

function tabHeader(title: string, sub: string, iconName: string, color: string, badge: string, badgeColor: string, badgeIcon = "fa-circle-check"): string {
  return `
    <div class="mtab-header">
      <div class="mtab-header-left">
        <div class="mtab-header-icon" style="--header-color:${color};">${icon(iconName)}</div>
        <div>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(sub)}</p>
        </div>
      </div>
      ${badge ? `<div class="mtab-header-badge" style="--badge-color:${badgeColor};">${icon(badgeIcon)} ${escapeHtml(badge)}</div>` : ""}
    </div>`;
}

function filterPill(value: string, active: boolean, count: number): string {
  const label = value === "all" ? "All" : value;
  return `<button class="wstyle-filter-pill ${active ? "active" : ""}" type="button" data-action="engine-filter" data-value="${escapeHtml(value)}">${value === "V6" ? icon("fa-lock") : ""}${escapeHtml(label)} <span class="pill-count">${count}</span></button>`;
}

function stylePill(value: string, label: string, count: number, iconName?: string): string {
  const active = (["all", "precooked", "custom", "generators"].includes(state.styleFilter) ? state.styleFilter : "all") === value;
  return `<button class="wstyle-filter-pill ${active ? "active" : ""}" type="button" data-action="style-filter" data-value="${escapeHtml(value)}">${iconName ? icon(iconName) : ""}${escapeHtml(label)} <span class="pill-count">${count}</span></button>`;
}

function engineCount(filter: string): number {
  return state.engines.filter((engine) => engineMatchesFilter(engine, filter)).length;
}

function engineMatchesFilter(engine: EngineMode, filter: string): boolean {
  if (filter === "all") return true;
  const label = `${engine.label || ""} ${engine.id || ""}`.toUpperCase();
  return label.includes(filter.toUpperCase());
}

function engineCard(engine: EngineMode, desc: string): string {
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
      <span class="ecard-desc">${escapeHtml(desc).replace(/&amp;mdash;/g, "&mdash;")}</span>
      ${badges ? `<span class="badge-row">${badges}</span>` : ""}
    </span>
  </button>`;
}

function infoCard(input: { title: string; sub?: string; active?: boolean; action: string; path?: string; value?: string; badge?: string; index?: number }): string {
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

function moduleCard(item: any, active: boolean, path: "addons" | "blocks"): string {
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

function toggleGeneric(label: string, path: string, active: boolean, desc: string, rawLabel = false): string {
  return `<button type="button" class="mtab-toggle-row ${active ? "active" : ""}" data-action="toggle" data-path="${escapeHtml(path)}">
    <span class="toggle-info"><span class="toggle-label">${rawLabel ? label : escapeHtml(label)}</span>${desc ? `<span class="toggle-desc">${escapeHtml(desc).replace(/&amp;mdash;/g, "&mdash;")}</span>` : ""}</span>
    <span class="ps-switch"></span>
  </button>`;
}

function inputField(label: string, path: string, value: string, placeholder = "", type = "text"): string {
  return `<label class="ps-field ${label ? "" : "bare"}">${label ? `<span>${escapeHtml(label)}</span>` : ""}<input class="ps-modern-input" type="${type}" data-bind="${escapeHtml(path)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"></label>`;
}

function rangeField(label: string, path: string, value: number, min: number, max: number): string {
  return `<label class="mtab-param-row"><span class="param-label">${escapeHtml(label)} <b>${value}</b></span><input class="ps-modern-input" type="range" min="${min}" max="${max}" data-bind="${escapeHtml(path)}" value="${value}"></label>`;
}

function selectField(label: string, path: string, value: string, options: Array<[string, string]>): string {
  return `<label class="ps-field ${label ? "" : "bare"}">${label ? `<span>${escapeHtml(label)}</span>` : ""}<select class="ps-modern-input" data-bind="${escapeHtml(path)}">
    ${options.map(([id, text]) => `<option value="${escapeHtml(id)}" ${id === value ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}
  </select></label>`;
}

function settingText(label: string, desc: string): string {
  return `<span class="set-info"><span class="set-label">${escapeHtml(label)}</span><span class="set-desc">${escapeHtml(desc)}</span></span>`;
}

function lockedState(iconName: string, title: string, text: string): string {
  return `<div class="mtab-locked-state">${icon(iconName)}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}

function emptyWithMascot(title: string, text: string): string {
  const image = state.uiAssets.mascotImage || "";
  return `<div class="mtab-locked-state empty-state">${image ? `<img src="${escapeHtml(image)}" alt="">` : icon("spark")}<h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}

function styleCard(title: string, desc: string, rule: string, active: boolean, action: string, value: string): string {
  return `<button type="button" class="wstyle-card ${active ? "active" : ""}" data-action="${escapeHtml(action)}" data-value="${escapeHtml(value)}">
    <span class="card-accent"></span>
    <span class="card-body">
      <span class="card-top"><span><span class="card-title">${icon("fa-bolt")} ${escapeHtml(title)}</span><span class="card-desc">${escapeHtml(desc || "")}</span></span>${active ? `<span class="card-status active-status">${icon("fa-check")} Active</span>` : ""}</span>
      <span class="card-rule">${escapeHtml(strip(rule || "").slice(0, 360))}</span>
    </span>
  </button>`;
}

function loraSlot(slot: number): string {
  const suffix = slot === 1 ? "" : String(slot);
  const loraPath = `imageGen.selectedLora${suffix}`;
  const weightPath = `imageGen.selectedLoraWt${suffix}`;
  const loraValue = String(getPath(state.profile as any, loraPath) || "");
  const weightValue = Number(getPath(state.profile as any, weightPath) || 1);
  return `<div class="lora-slot"><label class="ps-field"><span>LoRA ${slot}</span><input class="ps-modern-input" data-bind="${loraPath}" value="${escapeHtml(loraValue)}" placeholder="None"></label>${rangeField("Weight", weightPath, weightValue, -2, 2)}</div>`;
}

function npcField(label: string, value?: string): string {
  return `<div class="npc-field-section"><strong>${escapeHtml(label)}</strong><p>${escapeHtml(value || "Not recorded.")}</p></div>`;
}

function memoryAccordion(chunk: any): string {
  return `<details class="mem-accordion"><summary class="mem-accordion-header">${escapeHtml(chunk.id || "Memory Chunk")} <span>${new Date(chunk.timestamp || Date.now()).toLocaleString()}</span></summary><div class="mem-accordion-body"><textarea readonly>${escapeHtml(chunk.text || chunk.summary || "")}</textarea></div></details>`;
}

function statTile(title: string, value: string, sub: string, color: string): string {
  return `<div class="mem-stat" style="--stat-color:${color};"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(title)}</span><small>${escapeHtml(sub)}</small></div>`;
}

function preferredStyleForEngine(engineId: string): any | null {
  const styles = state.logic?.directStyles || [];
  const target = engineId === "v7-core" ? "dir_v7_core" : engineId === "v7-gentle" ? "dir_v7_gentle" : engineId.startsWith("v7") ? "dir_v7" : "";
  return target ? styles.find((style: any) => style.id === target) || null : null;
}

function groupModels(models: any[]): Record<string, any[]> {
  const groups: Record<string, any[]> = {};
  for (const model of models) {
    const id = String(model.id || "");
    const group = id.includes("v7") ? "V7 Frameworks" : id.includes("chinese") ? "Chinese" : id.includes("japanese") ? "Japanese" : "Classic";
    if (!groups[group]) groups[group] = [];
    groups[group].push(model);
  }
  return groups;
}

function currentCotType(): string {
  const model = state.profile.model || "cot-off";
  if (model === "cot-off") return "off";
  for (const type of ["v7-lite", "v7", "v6-lite", "v6", "v2", "v1"]) {
    if (model.startsWith(`cot-${type}-`)) return type;
  }
  return "v1";
}

function currentCotLang(): string {
  const type = currentCotType();
  if (type === "off") return "english";
  return (state.profile.model || "").replace(`cot-${type}-`, "") || "english";
}

function normalizeEffort(value: string): "unspecified" | "100" | "250" | "450" | "custom" {
  if (value === "250" || value === "450" || value === "custom" || value === "unspecified") return value;
  return "100";
}

function cotFrameworks(currentType: string, currentLang: string): Array<{ id: string; value: string; label: string; desc: string; isNew?: boolean }> {
  const lang = currentLang || "english";
  return [
    { id: "off", value: "cot-off", label: "CoT Off", desc: "No Chain of Thought or prefill. The AI will respond normally." },
    { id: "v1", value: `cot-v1-${lang}`, label: "CoT V1 (Classic)", desc: "The original 8-step framework. Focuses heavily on the NPC's internal emotional landscape vs their observable actions." },
    { id: "v2", value: `cot-v2-${lang}`, label: "CoT V2 (New)", desc: "The new experimental framework. Stricter reality checks, info audits, better NPCs, and hook generation." },
    { id: "v6", value: `cot-v6-${lang}`, label: "CoT V6 (Dream Team)", desc: "The full 4-phase sequence designed specifically for V6 engines. Specialized validation and modeling.", isNew: true },
    { id: "v6-lite", value: `cot-v6-lite-${lang}`, label: "CoT V6 (Lite)", desc: "A streamlined 3-phase sequence. Less token overhead while maintaining narrative rules.", isNew: true },
    { id: "v7", value: "cot-v7-english", label: "CoT V7", desc: "The new V7 sequence with 5-phase strict ground truth rebuilding.", isNew: true },
    { id: "v7-lite", value: "cot-v7-lite-english", label: "CoT V7 (Lite)", desc: "A streamlined 5-phase sequence for V7.", isNew: true }
  ].map((item) => ({ ...item, value: item.id === "off" ? item.value : item.value.replace("cot-off-", "cot-") }));
}

function cotLanguages(currentType: string): Array<{ id: string; label: string; rec?: boolean }> {
  if (currentType === "v7" || currentType === "v7-lite") return [{ id: "english", label: "English" }];
  return [
    { id: "english", label: "English" },
    { id: "arabic", label: "Arabic", rec: true },
    { id: "spanish", label: "Spanish" },
    { id: "french", label: "French" },
    { id: "zh", label: "Mandarin" },
    { id: "ru", label: "Russian" },
    { id: "jp", label: "Japanese" },
    { id: "pt", label: "Portuguese" }
  ];
}

function activeTabProfileKeys(): string[] {
  if (state.devMode) return ["mode"];
  const map: Record<number, string[]> = {
    0: ["mode", "toggles", "activeStyleId", "aiRule"],
    1: ["personality", "toggles"],
    2: ["activeStyleId", "aiRule", "customStyles", "dnRatio"],
    3: ["addons", "userWordCount", "userLanguage", "userPronouns", "disableUtilityPrefill", "onomatopoeia", "toggles"],
    4: ["blocks"],
    5: ["model", "thinkEffort", "customThinkEffort", "thinkingV2"],
    6: ["storyPlan"],
    7: ["banList", "banListBackend"],
    8: ["imageGen"],
    9: ["npcBank"],
    10: ["memoryCore"]
  };
  return map[state.activeTab] || [];
}

function moduleDesc(id: string): string {
  const descriptions: Record<string, string> = {
    death: "Enables permanent consequences. Characters - including yours - can die for real. No safety net, no plot armor.",
    combat: "Activates a grounded, tactical combat layer. Actions have real weight, positioning matters, and you can lose badly.",
    direct: "Forces AI to say words like D and P. No dancing around the subject, no polite deflection. you know what i mean.",
    color: "Each character's dialogue is color-coded for easy visual parsing.",
    npc_events: "Requires all new story events to grow naturally from prior context or environmental cues - no random drama out of nowhere. V6 only.",
    dn: "Forces dialogue and narration to be wrapped in their respective XML tags. Useful for specific Models for better narration style adherence.",
    info: "Appends a tidy status panel after each response showing time, weather, location, and what characters are wearing.",
    summary: "Keeps a running story digest that the AI updates each turn - helps it remember names, events, and details over long sessions.",
    cyoa: "Choose-Your-Own-Adventure panel with 4 suggested actions for you to pick from each turn.",
    mvu: "Add MVU Compatibility still in test read more here: https://github.com/KritBlade/MVU_Game_Maker",
    npc_inner_chatter: "Reveal NPC private thoughts the PC never hears - crushes, resentment, scheming, anxiety. This feeds future NPC behavior.",
    npc_inner_chatter_v2: "A simpler version of NPC Inner Chatter. use less input token."
  };
  return descriptions[id] || "";
}

function personaDesc(id: string, content: string): string {
  const descriptions: Record<string, string> = {
    megumin: "A rebellious, dominant voice. Adds an edge of arrogance and chaos to the narration. Best for energetic or confrontational stories.",
    director: "Professional narrator. Clean, authoritative story direction with cinematic awareness.",
    Nora: "Nora should i say more.",
    engine: "No personality overlay at all. The engine speaks in its purest form - precise, neutral, and fully under your control. Recommended for most setups."
  };
  return descriptions[id] || content;
}

function readableModel(id: string): string {
  return id.replace(/^cot-/, "").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function estimateTokensSaved(): number {
  const chars = [...state.profile.memoryCore.shortTermChunks, ...state.profile.memoryCore.longTermVault]
    .reduce((total, chunk) => total + (chunk.text || chunk.summary || "").length, 0);
  return Math.ceil(chars / 4);
}

function estimatePayloadTokens(): number {
  const activeEngine = state.engines.find((engine) => engine.id === state.profile.mode) as any;
  const selectedAddons = (state.logic?.addons || []).filter((item: any) => state.profile.addons.includes(item.id));
  const selectedBlocks = (state.logic?.blocks || []).filter((item: any) => state.profile.blocks.includes(item.id));
  const selectedModel = (state.logic?.models || []).find((item: any) => item.id === state.profile.model);
  const profileText = JSON.stringify({
    mode: state.profile.mode,
    engine: activeEngine ? [activeEngine.p1, activeEngine.p2, activeEngine.p3, activeEngine.p4, activeEngine.p5, activeEngine.p6].join("\n") : "",
    aiRule: state.profile.aiRule,
    addons: selectedAddons.map((item: any) => item.content).join("\n"),
    blocks: selectedBlocks.map((item: any) => item.content).join("\n"),
    model: selectedModel?.content || "",
    story: state.profile.storyPlan.currentPlan,
    memory: [...state.profile.memoryCore.shortTermChunks, ...state.profile.memoryCore.longTermVault].slice(-8)
  });
  return Math.max(0, Math.ceil(profileText.length / 4));
}

function getPath(target: any, path: string): any {
  return path.split(".").reduce((value, key) => value?.[key], target);
}

function setPath(target: any, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts[parts.length - 1]] = value;
}

function strip(html: string): string {
  return String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function renderMeguminImageTag(payload: any) {
  if (!ctxRef || !payload?.messageId) return;
  const bubble = ctxRef.dom.findMessageElement(payload.messageId);
  if (!bubble) return;
  const id = payload.attrs?.["image-id"] || "";
  const src = payload.attrs?.src || (id ? `/api/v1/images/${id}` : "");
  const prompt = payload.attrs?.prompt || "";
  if (!src || bubble.querySelector(`[data-megumin-image="${CSS.escape(id || src)}"]`)) return;
  const html = `
    <div class="meg-inline-image" data-megumin-image="${escapeHtml(id || src)}">
      <img src="${escapeHtml(src)}" alt="Megumin generated image">
      <div><strong>Megumin Image</strong><span>${escapeHtml(prompt)}</span></div>
    </div>`;
  ctxRef.dom.inject(bubble, html, "beforeend");
}

function icon(name: string): string {
  const aliases: Record<string, string> = {
    "fa-server": "server",
    "fa-user-astronaut": "masks",
    "fa-pen-nib": "pen",
    "fa-earth-americas": "globe",
    "fa-puzzle-piece": "puzzle",
    "fa-brain": "brain",
    "fa-map": "map",
    "fa-ban": "ban",
    "fa-image": "image",
    "fa-address-book": "address",
    "fa-memory": "memory",
    "fa-code": "code",
    "fa-microchip": "microchip",
    "fa-circle-check": "check",
    "fa-check": "check",
    "fa-toggle-on": "settings",
    "fa-masks-theater": "masks",
    "fa-user": "address",
    "fa-user-lock": "lock",
    "fa-sliders": "sliders",
    "fa-fire-burner": "bolt",
    "fa-book": "book",
    "fa-wand-magic-sparkles": "wand",
    "fa-power-off": "power",
    "fa-lock": "lock",
    "fa-scale-balanced": "sliders",
    "fa-save": "save",
    "fa-arrow-left": "arrow-left",
    "fa-magnifying-glass": "search",
    "fa-cubes": "cubes",
    "fa-gauge-high": "settings",
    "fa-diagram-project": "cubes",
    "fa-language": "globe",
    "fa-map-location-dot": "map",
    "fa-circle-xmark": "x",
    "fa-gears": "settings",
    "fa-book-open": "book",
    "fa-radar": "radar",
    "fa-plus-circle": "plus",
    "fa-list": "list",
    "fa-file-import": "file-import",
    "fa-file-export": "file-export",
    "fa-rotate-left": "reset",
    "fa-trash-can": "trash",
    "fa-xmark": "x",
    "fa-plug": "link",
    "fa-vial": "flask",
    "fa-plus": "plus",
    "fa-pen": "pen",
    "fa-up-right-and-down-left-from-center": "image",
    "fa-flask": "flask",
    "fa-bolt": "bolt",
    "fa-upload": "upload",
    "fa-chevron-right": "chevron-right",
    "fa-users": "masks",
    "fa-chart-pie": "pie",
    "fa-spinner": "refresh",
    "fa-layer-group": "layers",
    "fa-database": "server",
    "fa-copy": "copy",
    "fa-circle-info": "info",
    "fa-scroll": "book",
    "fa-triangle-exclamation": "info",
    "fa-hammer": "hammer"
  };
  const key = aliases[name] || name;
  const paths: Record<string, string> = {
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
    power: `<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>`,
    "arrow-left": `<path d="M19 12H5M12 19l-7-7 7-7"/>`,
    "file-import": `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 11v6M9 14l3 3 3-3"/>`,
    "file-export": `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 17v-6M9 14l3-3 3 3"/>`,
    flask: `<path d="M9 2h6M10 2v6l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V2"/><path d="M7 16h10"/>`,
    upload: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8 12 3 7 8M12 3v12"/>`,
    "chevron-right": `<path d="m9 18 6-6-6-6"/>`,
    pie: `<path d="M21 12a9 9 0 1 1-9-9v9Z"/><path d="M12 3a9 9 0 0 1 9 9h-9Z"/>`,
    layers: `<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>`,
    copy: `<rect x="9" y="9" width="11" height="11" rx="2"/><rect x="4" y="4" width="11" height="11" rx="2"/>`,
    sliders: `<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/>`,
    info: `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>`,
    radar: `<path d="M20 12a8 8 0 1 1-8-8"/><path d="M12 12 20 4M12 8a4 4 0 1 0 4 4"/>`,
    list: `<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>`,
    x: `<path d="M18 6 6 18M6 6l12 12"/>`,
    search: `<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`,
    book: `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15Z"/>`,
    hammer: `<path d="m15 12 6 6-3 3-6-6M14 4l6 6M4 14l7-7 3 3-7 7H4v-3Z"/>`
  };
  return `<svg class="meg-svg meg-${escapeHtml(name)}" viewBox="0 0 24 24" aria-hidden="true">${paths[key] || paths.spark}</svg>`;
}

function styles(): string {
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
.meg-overlay { --bg-panel:#18181b; --bg-main:#0e0e11; --border-color:#27272a; --text-main:#f4f4f5; --text-muted:#a1a1aa; --gold:#f59e0b; position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.72); backdrop-filter:blur(5px); font-family:Inter, ui-sans-serif, system-ui, sans-serif; color:#f4f4f5; }
.ps-modern-modal.app-container { width:1050px; max-width:95vw; height:85vh; max-height:850px; background:var(--bg-panel); border:1px solid var(--border-color); border-radius:16px; box-shadow:0 25px 50px -12px rgba(0,0,0,.7); display:flex; flex-direction:column; position:relative; overflow:hidden; }
.main-wrapper { flex:1; display:flex; flex-direction:column; min-width:0; overflow:hidden; }
.hero-banner { height:200px; width:100%; background-position:center 25%; background-size:cover; position:relative; display:flex; flex-direction:column; justify-content:space-between; flex-shrink:0; background-color:#111; }
.hero-banner::before { display:none; }
.hero-overlay { position:absolute; inset:0; background:linear-gradient(to right, rgba(0,0,0,.9) 0%, rgba(24,24,27,.4) 50%, rgba(24,24,27,.8) 100%); }
.hero-overlay::after { content:""; position:absolute; inset:0; background:linear-gradient(to top, var(--bg-panel) 0%, transparent 100%); }
.top-app-bar { position:relative; z-index:2; padding:20px 30px; display:flex; justify-content:flex-end; }
.app-actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
.live-token-count { color:#c9c9d2; background:rgba(26,26,31,.78); padding:10px 14px; border-radius:8px; border:1px solid rgba(255,255,255,.1); backdrop-filter:blur(6px); font-size:12px; font-weight:900; display:flex; gap:6px; align-items:center; box-shadow:0 10px 24px rgba(0,0,0,.28); }
.ps-save-indicator { color:#a1a1aa; font-size:12px; font-weight:800; min-width:54px; }
.ps-save-indicator.saving { color:#f59e0b; }
.hero-content { position:relative; z-index:2; padding:0 30px 25px 100px; }
.hero-content .status { font-size:.7rem; font-weight:800; text-transform:uppercase; letter-spacing:1px; margin-bottom:5px; text-shadow:0 2px 4px rgba(0,0,0,.8); }
.hero-content .name { font-size:2.2rem; font-weight:800; margin:0; line-height:1.1; color:#fff; letter-spacing:0; text-shadow:0 4px 10px rgba(0,0,0,.8); }
.hero-content p { margin:8px 0 0; color:#d4d4d8; font-size:.84rem; max-width:760px; text-shadow:0 2px 4px rgba(0,0,0,.7); }
.dock { position:absolute; top:20px; bottom:20px; left:20px; width:60px; background:rgba(18,18,20,.7); backdrop-filter:blur(15px); border:1px solid rgba(255,255,255,.1); border-radius:12px; display:flex; flex-direction:column; padding-top:15px; transition:width .3s cubic-bezier(.4,0,.2,1); overflow:hidden; white-space:nowrap; z-index:50; }
.dock:hover { width:240px; box-shadow:10px 10px 40px rgba(0,0,0,.8); }
.dock-icon { display:flex; align-items:center; width:240px; height:50px; padding:0 20px; color:#a1a1aa; cursor:pointer; transition:.2s; font-weight:600; font-size:.9rem; margin-bottom:5px; border:0; background:transparent; }
.dock-icon .meg-svg { width:20px; height:20px; margin-right:15px; flex:0 0 20px; }
.dock-icon span { opacity:0; transition:opacity .2s; pointer-events:none; display:inline; }
.dock:hover .dock-icon span { opacity:1; transition-delay:.1s; }
.dock-icon:hover { color:#fff; background:rgba(255,255,255,.1); border-radius:8px; margin-left:10px; width:220px; }
.dock-icon.active { color:#f59e0b; background:rgba(245,158,11,.15); border-radius:8px; margin-left:10px; width:220px; box-shadow:none; }
.main-content { flex:1; padding:10px 40px 40px 100px; overflow:auto; background:var(--bg-main); display:flex; flex-direction:column; gap:20px; }
.main-content::-webkit-scrollbar { width:10px; }
.main-content::-webkit-scrollbar-track { background:#0e0e11; }
.main-content::-webkit-scrollbar-thumb { background:#3f3f46; border-radius:999px; border:2px solid #0e0e11; }
.ps-modern-btn, .wstyle-gen-btn, .icon-btn { border:1px solid #27272a; border-radius:8px; background:#111; color:#f4f4f5; cursor:pointer; font-weight:900; display:inline-flex; align-items:center; justify-content:center; gap:7px; transition:.18s ease; white-space:nowrap; }
.ps-modern-btn { padding:10px 14px; font-size:12px; min-height:42px; }
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
.mtab-header, .wstyle-header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:24px; padding-bottom:20px; border-bottom:1px solid var(--border-color); }
.mtab-header-left { display:flex; align-items:center; gap:14px; min-width:0; }
.wstyle-header-left { display:flex; align-items:center; gap:14px; min-width:0; }
.mtab-header-icon, .wstyle-header-icon { width:44px; height:44px; border-radius:12px; display:grid; place-items:center; background:linear-gradient(135deg,var(--header-color,#a855f7),color-mix(in srgb,var(--header-color,#a855f7) 72%,#000)); color:#fff; box-shadow:0 4px 15px rgba(0,0,0,.2); }
.wstyle-header-icon { background:linear-gradient(135deg,#a855f7,#6366f1); box-shadow:0 4px 15px rgba(168,85,247,.3); }
.mtab-header-icon .meg-svg, .wstyle-header-icon .meg-svg { width:21px; height:21px; }
.mtab-header h2, .wstyle-header h2 { margin:0; font-size:1.25rem; font-weight:800; line-height:1.1; letter-spacing:0; }
.mtab-header p, .wstyle-header p { margin:2px 0 0; color:#a1a1aa; font-size:.78rem; }
.mtab-header-badge, .wstyle-active-badge { border:1px solid color-mix(in srgb,var(--badge-color,#10b981) 38%,transparent); color:var(--badge-color,#10b981); background:color-mix(in srgb,var(--badge-color,#10b981) 14%,transparent); padding:7px 14px; border-radius:20px; font-size:.72rem; font-weight:800; display:flex; gap:6px; align-items:center; text-transform:uppercase; letter-spacing:.5px; white-space:nowrap; }
.wstyle-active-badge.off { --badge-color:#a1a1aa; }
.wstyle-filters { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:20px; padding:4px; border:1px solid var(--border-color); border-radius:12px; background:rgba(0,0,0,.2); }
.wstyle-filter-pill { border:0; background:transparent; color:#a1a1aa; border-radius:10px; padding:8px 18px; cursor:pointer; font-size:.8rem; font-weight:700; display:flex; align-items:center; gap:6px; }
.wstyle-filter-pill.active { color:#fff; background:#33343a; border-color:transparent; }
.pill-count { border-radius:999px; padding:1px 7px; background:rgba(255,255,255,.14); }
.wstyle-section-head { color:#d4d4d8; font-size:.72rem; font-weight:900; text-transform:uppercase; letter-spacing:1.5px; display:flex; align-items:center; gap:10px; margin:20px 0 12px; }
.wstyle-section-head::after { content:""; flex:1; height:1px; background:linear-gradient(to right,var(--border-color),transparent); }
.wstyle-section-head.gold { color:#f59e0b; }
.wstyle-section-head.green { color:#10b981; }
.wstyle-section-head.purple { color:#a855f7; }
.wstyle-section-head.blue { color:#38bdf8; }
.wstyle-section-head.red { color:#ef4444; }
.mtab-card-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:14px; margin-bottom:20px; }
.mtab-card-grid.compact { grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); }
.mtab-eng-card { min-height:0; position:relative; text-align:left; border:1px solid var(--border-color); border-radius:14px; background:var(--bg-main); color:#f4f4f5; cursor:pointer; overflow:hidden; padding:0; display:flex; flex-direction:column; transition:all .25s cubic-bezier(.4,0,.2,1); }
.mtab-eng-card:hover { transform:translateY(-2px); border-color:#52525b; box-shadow:0 8px 25px rgba(0,0,0,.35); }
.mtab-eng-card.active { border-color:#10b981; background:rgba(16,185,129,.04); box-shadow:none; }
.mtab-eng-card.active .ecard-title { color:#10b981; }
.mtab-eng-card.locked-card { opacity:.55; cursor:not-allowed; }
.ecard-accent { position:absolute; top:0; left:0; right:0; height:3px; background:linear-gradient(90deg,var(--accent,#27272a),transparent); }
.mtab-eng-card.active .ecard-accent { background:linear-gradient(90deg,#10b981,#059669,transparent); }
.ecard-body { padding:16px 18px; display:flex; flex-direction:column; gap:6px; width:100%; }
.ecard-title { display:flex; justify-content:space-between; align-items:flex-start; gap:8px; color:#fff; font-size:.95rem; font-weight:800; line-height:1.25; }
.ecard-desc { color:#a1a1aa; font-size:.78rem; line-height:1.5; display:block; }
.badge-row { display:flex; flex-wrap:wrap; gap:6px; margin-top:auto; }
.ecard-badge { display:inline-flex; align-items:center; gap:4px; font-size:10px; font-weight:900; border-radius:999px; padding:4px 7px; color:#a1a1aa; background:rgba(255,255,255,.06); }
.ecard-badge.rec { color:#f59e0b; background:rgba(245,158,11,.12); }
.ecard-badge.new { color:#3b82f6; background:rgba(59,130,246,.15); }
.ecard-badge.locked { color:#a1a1aa; background:rgba(82,82,91,.25); }
.ecard-badge.active-badge { color:#10b981; background:rgba(16,185,129,.15); }
.mtab-card-list { display:flex; flex-direction:column; gap:8px; }
.mtab-card-list.dashed { min-height:64px; padding:12px; border:1px dashed #27272a; border-radius:8px; background:rgba(0,0,0,.12); }
.mtab-toggle-row { width:100%; display:flex; justify-content:space-between; align-items:center; gap:16px; border:1px solid var(--border-color); border-radius:14px; background:var(--bg-main); color:#f4f4f5; padding:16px 20px; cursor:pointer; text-align:left; transition:all .25s ease; }
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
.dev-full { grid-column:1 / -1; }
.wstyle-list { display:flex; flex-direction:column; gap:10px; }
.wstyle-card { position:relative; display:flex; flex-direction:column; background:var(--bg-main); border:1px solid var(--border-color); border-radius:14px; overflow:hidden; cursor:pointer; transition:all .25s cubic-bezier(.4,0,.2,1); color:var(--text-main); text-align:left; }
.wstyle-card:hover { border-color:#52525b; transform:translateY(-2px); box-shadow:0 8px 25px rgba(0,0,0,.4); }
.wstyle-card.active { border-color:#10b981; background:rgba(16,185,129,.04); }
.wstyle-card .card-accent { height:3px; width:100%; background:linear-gradient(90deg,var(--border-color),transparent); }
.wstyle-card.active .card-accent { background:linear-gradient(90deg,#10b981,#059669); }
.wstyle-card .card-body { padding:16px 18px; display:flex; flex-direction:column; gap:8px; }
.wstyle-card .card-top { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.wstyle-card .card-title { font-weight:800; font-size:.9rem; color:var(--text-main); display:flex; gap:6px; align-items:center; }
.wstyle-card .card-desc { display:block; font-size:.76rem; color:var(--text-muted); line-height:1.45; margin-top:3px; }
.wstyle-card .card-rule { font-size:.72rem; color:#d4d4d8; line-height:1.45; padding:10px; background:rgba(0,0,0,.22); border:1px solid rgba(255,255,255,.06); border-radius:8px; max-height:96px; overflow:hidden; }
.card-status { font-size:.62rem; font-weight:900; padding:3px 10px; border-radius:8px; text-transform:uppercase; letter-spacing:.5px; display:inline-flex; align-items:center; gap:4px; white-space:nowrap; }
.active-status { color:#10b981; background:rgba(16,185,129,.15); }
.wstyle-off-card { width:100%; display:flex; align-items:center; justify-content:space-between; border:1px solid var(--border-color); border-radius:14px; background:var(--bg-main); padding:16px 18px; color:var(--text-main); cursor:pointer; text-align:left; margin-bottom:14px; }
.wstyle-off-card.active { border-color:#10b981; background:rgba(16,185,129,.04); }
.wstyle-off-card.locked-card { opacity:.72; cursor:not-allowed; border-color:rgba(59,130,246,.3); }
.off-left { display:flex; align-items:center; gap:12px; }
.off-left strong { display:block; font-size:.9rem; }
.off-left small { display:block; color:var(--text-muted); font-size:.75rem; margin-top:2px; }
.off-icon { width:36px; height:36px; border-radius:10px; display:grid; place-items:center; background:rgba(161,161,170,.12); color:#a1a1aa; }
.off-icon.blue { background:rgba(59,130,246,.18); color:#3b82f6; }
.wstyle-dnr-header { display:flex; justify-content:space-between; align-items:center; gap:12px; cursor:pointer; }
.dnr-info { display:flex; align-items:center; gap:12px; }
.dnr-info strong { display:block; font-size:.9rem; }
.dnr-info small { display:block; color:var(--text-muted); font-size:.73rem; margin-top:2px; }
.dnr-icon { width:34px; height:34px; border-radius:10px; display:grid; place-items:center; background:rgba(245,158,11,.13); color:var(--gold); }
.ps-toggle-card { border:1px solid var(--border-color); border-radius:10px; background:transparent; padding:8px; min-width:56px; display:flex; justify-content:center; cursor:pointer; }
.wstyle-dnr-body { display:none; padding-top:15px; margin-top:12px; border-top:1px dashed var(--border-color); }
.wstyle-dnr-body.open { display:block; }
.wstyle-dnr-slider-track { display:flex; align-items:center; gap:12px; }
.wstyle-dnr-slider-track input { flex:1; }
.wstyle-dnr-label { color:var(--text-muted); font-size:.72rem; white-space:nowrap; }
.wstyle-dnr-label.dial { color:#3b82f6; }
.wstyle-dnr-label.narr { color:var(--gold); }
.dnr-preview { font-size:.7rem; color:var(--text-muted); text-align:center; margin-top:10px; font-family:ui-monospace,Consolas,monospace; opacity:.78; }
.wstyle-gen-card, .wstyle-create-card { display:flex; align-items:center; justify-content:space-between; gap:12px; border:1px solid var(--border-color); border-radius:14px; background:var(--bg-main); padding:16px 18px; color:var(--text-main); cursor:pointer; text-align:left; }
.wstyle-create-card { justify-content:center; border-style:dashed; color:#10b981; font-weight:800; }
.gen-info { display:flex; flex-direction:column; gap:3px; }
.gen-title { font-weight:800; }
.gen-desc { color:var(--text-muted); font-size:.76rem; line-height:1.35; }
.wstyle-editor-bar { display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:10px; margin-bottom:12px; }
.wstyle-info-callout { display:flex; gap:10px; margin-top:12px; color:#c4b5fd; background:rgba(168,85,247,.08); border:1px solid rgba(168,85,247,.18); border-radius:8px; padding:12px; font-size:.78rem; }
.workflow-row { margin-top:12px; }
.lora-slot { border:1px solid var(--border-color); border-radius:8px; padding:12px; background:rgba(0,0,0,.16); }
.npc-list { display:flex; flex-direction:column; gap:10px; }
.npc-card { border:1px solid var(--border-color); border-radius:12px; background:var(--bg-main); overflow:hidden; }
.npc-card[open] .npc-chevron { transform:rotate(90deg); }
.npc-card-header { list-style:none; display:flex; align-items:center; gap:12px; padding:12px 14px; cursor:pointer; }
.npc-card-header::-webkit-details-marker { display:none; }
.npc-chevron { color:var(--text-muted); transition:.2s; display:grid; place-items:center; }
.npc-mini-pfp { width:34px; height:34px; border-radius:8px; object-fit:cover; border:1px solid var(--border-color); background:#0e0e11; display:grid; place-items:center; color:var(--gold); font-weight:900; }
.npc-card-title { display:flex; flex-direction:column; gap:2px; flex:1; }
.npc-card-title small { color:var(--text-muted); font-size:.72rem; }
.npc-card-body { display:grid; grid-template-columns:180px minmax(0,1fr); gap:16px; padding:14px; border-top:1px solid var(--border-color); }
.npc-pfp-container { display:flex; flex-direction:column; gap:8px; align-items:stretch; }
.npc-pfp-container img, .npc-pfp-container > span { width:160px; height:240px; border-radius:10px; border:1px solid var(--border-color); object-fit:cover; background:#0e0e11; display:grid; place-items:center; color:var(--gold); font-size:48px; font-weight:900; }
.npc-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
.npc-field-section { border:1px solid rgba(255,255,255,.06); border-radius:8px; padding:10px; background:rgba(0,0,0,.16); }
.npc-field-section strong { color:#fff; font-size:.78rem; }
.npc-field-section p { color:var(--text-muted); font-size:.76rem; line-height:1.4; margin:6px 0 0; }
.mem-progress-container { width:100%; height:12px; background:rgba(0,0,0,.4); border-radius:6px; overflow:hidden; display:flex; margin-top:10px; border:1px solid var(--border-color); }
.mem-legend { display:flex; justify-content:space-between; color:var(--text-muted); font-size:.68rem; margin-top:6px; text-transform:uppercase; letter-spacing:.5px; }
.green-text { color:#10b981 !important; border-color:rgba(16,185,129,.3) !important; }
.blue-text { color:#3b82f6 !important; border-color:rgba(59,130,246,.3) !important; }
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

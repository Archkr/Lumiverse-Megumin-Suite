import type { MeguminProfile } from "./types";

export const EXTENSION_ID = "megumin_suite";
export const EXTENSION_NAME = "Megumin Suite";

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const DEFAULT_PROFILE: MeguminProfile = {
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
    comfyUrl: "http://127.0.0.1:8188",
    currentWorkflowName: "",
    savedWorkflowStates: {},
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

export function mergeProfile(raw: unknown): MeguminProfile {
  const base = clone(DEFAULT_PROFILE);
  if (!raw || typeof raw !== "object") return base;
  const input = raw as Partial<MeguminProfile>;
  const merged = { ...base, ...input } as MeguminProfile;
  merged.toggles = { ...base.toggles, ...(input.toggles || {}) };
  merged.dnRatio = { ...base.dnRatio, ...(input.dnRatio || {}) };
  merged.onomatopoeia = { ...base.onomatopoeia, ...(input.onomatopoeia || {}) };
  merged.storyPlan = { ...base.storyPlan, ...(input.storyPlan || {}) };
  merged.imageGen = { ...base.imageGen, ...(input.imageGen || {}) };
  merged.userWordCount = String((input as any).userWordCount ?? base.userWordCount);
  merged.userLanguage = String((input as any).userLanguage ?? base.userLanguage);
  merged.customThinkEffort = String((input as any).customThinkEffort ?? base.customThinkEffort);
  merged.memoryCore = {
    ...base.memoryCore,
    ...(input.memoryCore || {}),
    shortTermChunks: input.memoryCore?.shortTermChunks || [],
    longTermVault: input.memoryCore?.longTermVault || []
  };
  merged.npcBank = {
    ...base.npcBank,
    ...(input.npcBank || {}),
    npcs: input.npcBank?.npcs || []
  };
  return merged;
}

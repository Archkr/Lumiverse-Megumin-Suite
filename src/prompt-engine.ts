import { DEFAULT_PROFILE, clone, mergeProfile } from "./defaults";
import type {
  ChatContext,
  ChatMessage,
  EngineMode,
  LlmMessage,
  MeguminProfile,
  NpcRecord,
  PromptBuildResult
} from "./types";
import { chunkContainsIndex, cleanChatText, npcBuildText, relevantChunks } from "./text";
// The prompt database is the original Megumin prompt content, relocated into src.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { hardcodedLogic } from "./megumin-data.js";

type HardcodedLogic = {
  modes: EngineMode[];
  personalities: Array<{ id: string; label: string; content: string; recommended?: boolean }>;
  toggles: Record<string, { content: string; trigger: string; label: string }>;
  addons: Array<{ id: string; label: string; content: string; trigger: string }>;
  blocks: Array<{ id: string; label: string; content: string; trigger: string }>;
  models: Array<{ id: string; label?: string; content: string; prefill?: string }>;
};

const logic = hardcodedLogic as unknown as HardcodedLogic;

export function getLogic() {
  return logic;
}

export function allEngines(customEngines: EngineMode[] = []): EngineMode[] {
  return [...logic.modes, ...customEngines];
}

export function hydrateProfile(raw: unknown): MeguminProfile {
  return mergeProfile(raw);
}

function normalizeMacroTargets(text: string, context: ChatContext): string {
  return text
    .replace(/<BOT>/g, context.characterName || "the character")
    .replace(/<USER>/g, "the user");
}

function cleanEmptyLines(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/(?:\r?\n[ \t]*){3,}/g, "\n\n")
    .trim();
}

const UNUSED_PLACEHOLDERS = [
  "[[long-Memory]]",
  "[[Short-memory]]",
  "[[prompt1]]",
  "[[prompt2]]",
  "[[prompt3]]",
  "[[prompt4]]",
  "[[prompt5]]",
  "[[prompt6]]",
  "[prompt1]",
  "[prompt2]",
  "[prompt3]",
  "[prompt4]",
  "[prompt5]",
  "[prompt6]",
  "[[AI1]]",
  "[[AI2]]",
  "[[main]]",
  "[[OOC]]",
  "[[control]]",
  "[[aiprompt]]",
  "[[death]]",
  "[[combat]]",
  "[[Direct]]",
  "[[DN]]",
  "[[COLOR]]",
  "[[infoblock]]",
  "[[summary]]",
  "[[cyoa]]",
  "[[COT]]",
  "[[prefill]]",
  "[[order]]",
  "[[Language]]",
  "[[pronouns]]",
  "[[banlist]]",
  "[[count]]",
  "[[MVU]]",
  "[[img1]]",
  "[[img2]]",
  "[[storyplan]]",
  "[[storytracker]]",
  "[[DNRATIO]]",
  "[[THINK]]",
  "[[onomato]]",
  "[[npc_events]]",
  "[[cyoa2]]",
  "[[infoblock2]]",
  "[[summary2]]",
  "[[storytracker2]]",
  "[[npc_inner_chatter]]",
  "[[npc_inner_chatter2]]",
  "[[npc_dossier]]",
  "[[npc_dossier2]]",
  "[[npc list]]"
];

export type PlaceholderHookGroup = {
  label: string;
  aliases: string[];
};

export type PlaceholderFeatureSpec = {
  id: string;
  label: string;
  hooks: PlaceholderHookGroup[];
  placeholders: string[];
};

function featureSpec(id: string, label: string, hooks: PlaceholderHookGroup[]): PlaceholderFeatureSpec {
  return {
    id,
    label,
    hooks,
    placeholders: [...new Set(hooks.flatMap((hook) => hook.aliases))]
  };
}

export const REQUIRED_PLACEHOLDER_FEATURES = [
  featureSpec("core-engines", "Core Engines", [
    { label: "prompt1 hook", aliases: ["[[prompt1]]", "[prompt1]"] },
    { label: "prompt2 hook", aliases: ["[[prompt2]]", "[prompt2]"] },
    { label: "prompt3 hook", aliases: ["[[prompt3]]", "[prompt3]"] },
    { label: "prompt4 hook", aliases: ["[[prompt4]]", "[prompt4]"] },
    { label: "prompt5 hook", aliases: ["[[prompt5]]", "[prompt5]"] },
    { label: "prompt6 hook", aliases: ["[[prompt6]]", "[prompt6]"] },
    { label: "main personality hook", aliases: ["[[main]]"] },
    { label: "AI1 prefill hook", aliases: ["[[AI1]]"] },
    { label: "AI2 prefill hook", aliases: ["[[AI2]]"] },
    { label: "OOC hook", aliases: ["[[OOC]]"] },
    { label: "control hook", aliases: ["[[control]]"] }
  ]),
  featureSpec("writing-style", "Writing Style", [{ label: "style hook", aliases: ["[[aiprompt]]"] }]),
  featureSpec("global-settings", "Global Settings", [
    { label: "language hook", aliases: ["[[Language]]"] },
    { label: "pronouns hook", aliases: ["[[pronouns]]"] },
    { label: "word count hook", aliases: ["[[count]]"] }
  ]),
  featureSpec("gameplay-addons", "Gameplay Add-ons", [
    { label: "death hook", aliases: ["[[death]]"] },
    { label: "combat hook", aliases: ["[[combat]]"] },
    { label: "directness hook", aliases: ["[[Direct]]"] },
    { label: "deep narration hook", aliases: ["[[DN]]"] },
    { label: "dialogue color hook", aliases: ["[[COLOR]]"] },
    { label: "NPC events hook", aliases: ["[[npc_events]]"] },
    { label: "onomatopoeia hook", aliases: ["[[onomato]]"] }
  ]),
  featureSpec("response-blocks", "Response Blocks", [
    { label: "info block hook", aliases: ["[[infoblock]]"] },
    { label: "summary hook", aliases: ["[[summary]]"] },
    { label: "CYOA hook", aliases: ["[[cyoa]]"] },
    { label: "CYOA display hook", aliases: ["[[cyoa2]]"] },
    { label: "MVU hook", aliases: ["[[MVU]]"] },
    { label: "NPC inner chatter hook", aliases: ["[[npc_inner_chatter]]"] },
    { label: "NPC inner chatter display hook", aliases: ["[[npc_inner_chatter2]]"] }
  ]),
  featureSpec("chain-of-thought", "Chain of Thought", [
    { label: "CoT framework hook", aliases: ["[[COT]]"] },
    { label: "prefill hook", aliases: ["[[prefill]]"] },
    { label: "thinking hook", aliases: ["[[THINK]]"] }
  ]),
  featureSpec("story-planner", "Story Planner", [
    { label: "story plan hook", aliases: ["[[storyplan]]"] },
    { label: "story tracker hook", aliases: ["[[storytracker]]"] },
    { label: "story tracker display hook", aliases: ["[[storytracker2]]"] }
  ]),
  featureSpec("image-generation", "Image Generation", [
    { label: "image instruction hook", aliases: ["[[img1]]"] },
    { label: "image tag hook", aliases: ["[[img2]]"] }
  ]),
  featureSpec("npc-bank", "NPC Bank", [
    { label: "NPC list hook", aliases: ["[[npc list]]"] },
    { label: "NPC dossier hook", aliases: ["[[npc_dossier]]"] },
    { label: "NPC dossier display hook", aliases: ["[[npc_dossier2]]"] }
  ]),
  featureSpec("memory-core", "Memory Core", [
    { label: "long memory hook", aliases: ["[[long-Memory]]"] },
    { label: "short memory hook", aliases: ["[[Short-memory]]"] }
  ]),
  featureSpec("dynamic-ban-list", "Dynamic Ban List", [{ label: "ban list hook", aliases: ["[[banlist]]"] }]),
  featureSpec("dialogue-narration", "Dialogue / Narration Ratio", [{ label: "D/N ratio hook", aliases: ["[[DNRATIO]]"] }])
] as const;

export type PlaceholderFeatureAudit = {
  id: string;
  label: string;
  placeholders: string[];
  present: string[];
  missing: string[];
  connected: boolean;
};

export function auditPresetPlaceholders(presentPlaceholders: Iterable<string>, hasScannedPreset: boolean): PlaceholderFeatureAudit[] {
  const presentSet = new Set(presentPlaceholders);
  return REQUIRED_PLACEHOLDER_FEATURES.map((feature) => {
    const placeholders = [...feature.placeholders];
    const present = placeholders.filter((placeholder) => presentSet.has(placeholder));
    const missing = hasScannedPreset
      ? feature.hooks
        .filter((hook) => !hook.aliases.some((placeholder) => presentSet.has(placeholder)))
        .map((hook) => hook.label)
      : [];
    return {
      id: feature.id,
      label: feature.label,
      placeholders,
      present,
      missing,
      connected: missing.length === 0
    };
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectedEngine(profile: MeguminProfile, customEngines: EngineMode[]): EngineMode {
  return allEngines(customEngines).find((mode) => mode.id === profile.mode) || logic.modes[0] || { id: "fallback", label: "Fallback" };
}

function getContent<T extends { id: string; content?: string }>(items: T[], id: string): string {
  return items.find((item) => item.id === id)?.content || "";
}

function buildBaseDict(profile: MeguminProfile, customEngines: EngineMode[], chatMessages: ChatMessage[], context: ChatContext): Record<string, string> {
  const dict: Record<string, string> = {};
  const activeEngine = selectedEngine(profile, customEngines);
  const allModes = allEngines(customEngines);
  const isCustom = !logic.modes.some((mode) => mode.id === activeEngine.id);

  const targetLang = profile.userLanguage.trim() ? profile.userLanguage.trim().toUpperCase() : "ENGLISH";
  dict.Language = `[LANGUAGE RULE]\nALL OUTPUT EXCEPT THINKING MUST BE IN ${targetLang} ONLY.`;
  dict.pronouns = profile.userPronouns === "male"
    ? "{{user}} is male. Always portray and address him as such."
    : profile.userPronouns === "female"
      ? "{{user}} is female. Always portray and address her as such."
      : "";
  const wordCountStr = profile.userWordCount.trim() || "";
  dict.count = wordCountStr ? `— maximum ${wordCountStr} words` : "";

  const personality = logic.personalities.find((item) => item.id === profile.personality);
  dict.main = personality?.content || "";
  dict.AI1 = profile.personality === "megumin" ? "Fine i read the rules." : "Understood.";
  dict.AI2 = profile.personality === "megumin" ? "OK i Understnd it." : "Understood.";
  dict.OOC = profile.toggles.ooc ? logic.toggles.ooc?.content || "" : "";
  dict.control = profile.toggles.control ? logic.toggles.control?.content || "" : "";

  for (let i = 1; i <= 6; i++) {
    dict[`prompt${i}`] = String(activeEngine[`p${i}`] || "");
  }

  if (isCustom && activeEngine.isCoreClone !== true) dict.main = "";
  if (typeof activeEngine.A1 === "string") dict.AI1 = activeEngine.A1;
  if (typeof activeEngine.A2 === "string") dict.AI2 = activeEngine.A2;

  if (profile.mode.includes("v6-dream-team") || profile.mode.startsWith("v7")) {
    dict.main = "";
  }

  if (profile.aiRule.trim()) {
    dict.aiprompt = profile.mode.startsWith("v7") && profile.activeStyleId !== "dir_v7"
      ? `<narrative_style>\nvoice: ${profile.aiRule.trim()}\npacing: Unhurried where needed; compact when the moment demands it.\n</narrative_style>`
      : profile.aiRule.trim();
  } else {
    dict.aiprompt = "";
  }

  for (const addonId of profile.addons) {
    const item = logic.addons.find((addon) => addon.id === addonId);
    if (item?.trigger) dict[item.trigger.replace(/\[|\]/g, "")] = item.content;
  }

  for (const blockId of profile.blocks) {
    const item = logic.blocks.find((block) => block.id === blockId);
    if (item?.trigger) dict[item.trigger.replace(/\[|\]/g, "")] = item.content;
  }

  const model = logic.models.find((item) => item.id === profile.model);
  dict.COT = model?.content || "";
  dict.prefill = model?.prefill || "";
  dict.THINK = profile.thinkingV2 && profile.model !== "cot-off"
    ? "<think>\n<think>\n<think>\n{Thinking}\n</think>"
    : "";

  if (profile.thinkEffort !== "unspecified" && dict.COT) {
    const effort = profile.thinkEffort === "custom" ? profile.customThinkEffort || "100" : profile.thinkEffort;
    dict.COT = `Your thinking must not be more than ${effort} words.\n\n${dict.COT}`;
  }

  dict.DNRATIO = profile.dnRatio.enabled
    ? `- Ratio: Maintain a balance of ${profile.dnRatio.dialogue}% Dialogue and ${100 - profile.dnRatio.dialogue}% Narration.`
    : "";
  dict.onomato = profile.onomatopoeia.enabled
    ? `- Narration must utilize onomatopoeia. Use precise, context-specific phonetic representations for physical interactions (e.g., the click of a latch, the thud of a heavy object, the soughing of wind) rather than abstract descriptions of sound.${profile.onomatopoeia.useStyling ? "\nAll onomatopoeic words must animated and colored using HTML and CSS. The selected style tag and color must objectively correspond to the physical nature or movement of the sound produced; for example, a repetitive friction sound such as \"shush-shush\" must utilize a sliding animation tag to represent the physical action." : ""}`
    : "";
  dict.MVU = profile.blocks.includes("mvu")
    ? (getContent(logic.blocks, "mvu") || "{main response}").replace("[[count]]", wordCountStr ? `maximum ${wordCountStr} words` : "...")
    : (wordCountStr ? `{main response — maximum ${wordCountStr} words}` : "{main response}");

  const overrides = [
    ["cot", "COT", true],
    ["prefill", "prefill", true],
    ["think", "THINK", profile.thinkingV2],
    ["info", "infoblock", profile.blocks.includes("info")],
    ["summary", "summary", profile.blocks.includes("summary")],
    ["cyoa", "cyoa", profile.blocks.includes("cyoa")],
    ["mvu", "MVU", profile.blocks.includes("mvu")],
    ["death", "death", profile.addons.includes("death")],
    ["combat", "combat", profile.addons.includes("combat")],
    ["direct", "Direct", profile.addons.includes("direct")],
    ["dn", "DN", profile.addons.includes("dn")],
    ["dialogueColor", "COLOR", profile.addons.includes("color")],
    ["npc_inner_chatter", "npc_inner_chatter", profile.blocks.includes("npc_inner_chatter") || profile.blocks.includes("npc_inner_chatter_v2")],
    ["storytracker", "storytracker", profile.storyPlan.enabled],
    ["language", "Language", true],
    ["pronouns", "pronouns", true],
    ["count", "count", true],
    ["dnratio", "DNRATIO", profile.dnRatio.enabled],
    ["onomato", "onomato", profile.onomatopoeia.enabled],
    ["banlist", "banlist", true]
  ] as const;

  for (const [source, target, condition] of overrides) {
    const value = activeEngine[source];
    if (condition && typeof value === "string" && value.trim()) dict[target] = value;
  }

  if (Array.isArray(activeEngine.customToggles)) {
    for (const customToggle of activeEngine.customToggles as Array<{ id?: string; attachPoint?: string; content?: string }>) {
      if (!customToggle?.id || !profile.toggles[customToggle.id]) continue;
      const targetKey = `prompt${String(customToggle.attachPoint || "").replace("p", "")}`;
      if (dict[targetKey] !== undefined && customToggle.content) {
        dict[targetKey] = `${dict[targetKey]}\n\n${customToggle.content}`.trim();
      }
    }
  }

  if (activeEngine.id.startsWith("v7")) {
    if (!profile.toggles.v7_ooc) dict.prompt1 = dict.prompt1.replace(/<ooc_protocol>[\s\S]*?<\/ooc_protocol>/g, "");
    if (!profile.toggles.v7_pcsolo) dict.prompt4 = dict.prompt4.replace(/<pc_solo_physicality[\s\S]*?<\/pc_solo_physicality>/g, "");
    if (!profile.toggles.v7_culture) dict.prompt4 = dict.prompt4.replace(/<cultural_anchoring>[\s\S]*?<\/cultural_anchoring>/g, "");
    if (!profile.toggles.v7_scene) dict.prompt4 = dict.prompt4.replace(/<scene_choreography>[\s\S]*?<\/scene_choreography>/g, "");
    if (!profile.toggles.v7_intro) dict.prompt4 = dict.prompt4.replace(/\s*introduction_protocol:\s*"[^"]*"/g, "");
  }

  if (profile.storyPlan.enabled && profile.storyPlan.currentPlan.trim()) {
    dict.storyplan = `<Story_Plan>\nThis is a possible event for the story, take from it:\n${profile.storyPlan.currentPlan.trim()}\n</Story_Plan>`;
    dict.storytracker = "<Story_Tracker>\narc: The Arc that is now active.\nchapter: The chapter that is now active.\nEpisode: The episode that is now active.\nSecrets: Any secret that the user/{{user}} doesn't know.\n</Story_Tracker>";
  } else {
    dict.storyplan = "";
    dict.storytracker = "";
  }

  dict.banlist = profile.banList.length > 0
    ? `[BAN LIST]\nNever rely on these clichés, tropes, or repetitive patterns. They are dead language:\n${profile.banList.map((item) => `- ${item}`).join("\n")}`
    : "";

  for (const [source, target, condition] of overrides) {
    const value = activeEngine[source];
    if (condition && typeof value === "string" && value.trim()) dict[target] = value;
  }

  const aiMessageCount = chatMessages.filter((msg) => msg.role === "assistant").length;
  const imageMode = profile.imageGen.triggerMode || "manual";
  const shouldInjectImage =
    profile.imageGen.enabled &&
    (imageMode === "always" ||
      (imageMode === "frequency" && (aiMessageCount + 1) % Math.max(1, profile.imageGen.autoGenFreq || 1) === 0) ||
      imageMode === "conditional");
  if (shouldInjectImage) {
    const style = profile.imageGen.promptStyle === "illustrious"
      ? "Use Danbooru-style tags focused on anime art."
      : profile.imageGen.promptStyle === "sdxl"
        ? "Use natural descriptive prose focused on photorealism."
        : "Use concise visual keywords.";
    const perspective = profile.imageGen.promptPerspective === "pov"
      ? "First-person POV."
      : profile.imageGen.promptPerspective === "character"
        ? "Focus on character appearance."
        : "Describe the scene and environment.";
    const conditional = imageMode === "conditional"
      ? "Only output the image tag if the character explicitly takes, sends, or shares an image in this moment.\n"
      : "";
    dict.img1 = `[IMAGE GENERATION]\n${conditional}Style: ${style}\nPerspective: ${perspective}${profile.imageGen.promptExtra ? `\nExtra: ${profile.imageGen.promptExtra}` : ""}`;
    dict.img2 = `<img prompt="prompt">`;
  } else {
    dict.img1 = "";
    dict.img2 = "";
  }

  const recentText = chatMessages.slice(-4).map((msg) => cleanChatText(msg.content)).join(" ").toLowerCase();
  const npcBlock = buildNpcInjection(profile.npcBank.npcs, recentText);
  dict.npcList = npcBlock;
  dict.npcDossier = profile.npcBank.enabled ? npcDossierDirective() : "";
  dict.npcDossierSlot = profile.npcBank.enabled ? "[NPC Dossier block here]" : "";

  const memory = buildMemoryInjection(profile, chatMessages);
  dict.longMemory = memory.longMemory;
  dict.shortMemory = memory.shortMemory;

  if (profile.thinkingV2 && dict.prefill) {
    dict.prefill = dict.prefill.replace(/\n<think>[\s\S]*/, "\n<think>\n<think>");
  }
  if (profile.disableUtilityPrefill) dict.prefill = "";

  dict.cyoa2 = dict.cyoa ? "[CYOA block here]" : "";
  dict.infoblock2 = dict.infoblock ? "[Info block here]" : "";
  dict.summary2 = dict.summary ? "[Summary block here]" : "";
  dict.storytracker2 = dict.storytracker ? "[Story tracker here]" : "";
  dict.npc_inner_chatter2 = dict.npc_inner_chatter ? "[Npc inner chatter here]" : "";

  const earlyTokens = ["count", "Language", "pronouns", "DNRATIO"];
  for (const token of earlyTokens) {
    const value = dict[token] || "";
    const marker = `[[${token}]]`;
    for (const key of Object.keys(dict)) {
      if (key !== token && dict[key]?.includes(marker)) dict[key] = dict[key].split(marker).join(value);
    }
  }

  for (const key of Object.keys(dict)) dict[key] = normalizeMacroTargets(dict[key], context);
  return dict;
}

function placeholderMapFromDict(dict: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  const set = (placeholder: string, value: string | undefined) => {
    map[placeholder] = value || "";
  };

  for (const [key, value] of Object.entries(dict)) {
    set(`[[${key}]]`, value);
  }

  for (let index = 1; index <= 6; index += 1) {
    set(`[prompt${index}]`, dict[`prompt${index}`]);
  }

  set("[[long-Memory]]", dict.longMemory);
  set("[[Short-memory]]", dict.shortMemory);
  set("[[npc list]]", dict.npcList);
  set("[[npc_dossier]]", dict.npcDossier);
  set("[[npc_dossier2]]", dict.npcDossierSlot);
  return map;
}

export function buildMeguminReplacementMap(
  rawProfile: unknown,
  customEngines: EngineMode[],
  chatMessages: ChatMessage[],
  context: ChatContext
): Record<string, string> {
  const profile = hydrateProfile(rawProfile || DEFAULT_PROFILE);
  return placeholderMapFromDict(buildBaseDict(profile, customEngines, chatMessages, context));
}

export function estimateMeguminPayloadTokens(
  rawProfile: unknown,
  customEngines: EngineMode[],
  chatMessages: ChatMessage[],
  context: ChatContext,
  presentPlaceholders?: Set<string>
): number {
  const replacements = buildMeguminReplacementMap(rawProfile, customEngines, chatMessages, context);
  const counted = new Set<string>();
  let chars = 0;
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (presentPlaceholders && !presentPlaceholders.has(placeholder)) continue;
    const text = String(value || "").trim();
    if (!text || counted.has(text)) continue;
    counted.add(text);
    chars += text.replace(/\s+/g, " ").length;
  }
  return Math.max(0, Math.ceil(chars / 4));
}

function replacePlaceholderText(content: string, replacements: Record<string, string>): { content: string; replacementsMade: number; changed: boolean } {
  let next = content;
  let replacementsMade = 0;
  let changed = false;

  for (const [placeholder, replacement] of Object.entries(replacements)) {
    if (!next.includes(placeholder)) continue;
    const processed = replacement || "";
    if (processed.trim() === "") {
      next = next.replace(new RegExp(`^[ \\t]*${escapeRegex(placeholder)}[ \\t]*\\r?\\n?`, "gm"), "");
    }
    next = next.replace(new RegExp(escapeRegex(placeholder), "g"), processed);
    replacementsMade += 1;
    changed = true;
  }

  for (const placeholder of UNUSED_PLACEHOLDERS) {
    if (!next.includes(placeholder)) continue;
    next = next.replace(new RegExp(`^[ \\t]*${escapeRegex(placeholder)}[ \\t]*\\r?\\n?`, "gm"), "");
    next = next.replace(new RegExp(escapeRegex(placeholder), "g"), "");
    replacementsMade += 1;
    changed = true;
  }

  const cleaned = cleanEmptyLines(next);
  return { content: cleaned, replacementsMade, changed: changed || cleaned !== content };
}

export function replaceMeguminPlaceholders(
  incoming: LlmMessage[],
  rawProfile: unknown,
  customEngines: EngineMode[],
  chatMessages: ChatMessage[],
  context: ChatContext
): { messages: LlmMessage[]; replacementsMade: number; changedMessages: Array<{ messageIndex: number; replacementsMade: number }> } {
  const profile = hydrateProfile(rawProfile || DEFAULT_PROFILE);
  const replacements = placeholderMapFromDict(buildBaseDict(profile, customEngines, chatMessages, context));
  let replacementsMade = 0;
  const changedMessages: Array<{ messageIndex: number; replacementsMade: number }> = [];
  const messages = incoming.map((message, messageIndex) => {
    let messageReplacements = 0;
    let messageChanged = false;
    if (typeof message.content === "string") {
      const replaced = replacePlaceholderText(message.content, replacements);
      replacementsMade += replaced.replacementsMade;
      messageReplacements += replaced.replacementsMade;
      messageChanged = replaced.changed;
      if (messageChanged) changedMessages.push({ messageIndex, replacementsMade: messageReplacements });
      return { ...message, content: replaced.content };
    }
    const content = message.content.map((part) => {
      if (part.type !== "text") return part;
      const replaced = replacePlaceholderText(part.text, replacements);
      replacementsMade += replaced.replacementsMade;
      messageReplacements += replaced.replacementsMade;
      if (replaced.changed) messageChanged = true;
      return { ...part, text: replaced.content };
    });
    if (messageChanged) changedMessages.push({ messageIndex, replacementsMade: messageReplacements });
    return { ...message, content };
  });
  return { messages, replacementsMade, changedMessages };
}

function buildMemoryInjection(profile: MeguminProfile, chatMessages: ChatMessage[]): { longMemory: string; shortMemory: string } {
  const mem = profile.memoryCore;
  if (!mem.enabled) return { longMemory: "", shortMemory: "" };
  const recentText = chatMessages.slice(-4).map((msg) => cleanChatText(msg.content)).join(" ");
  const relevant = relevantChunks(mem.longTermVault || [], recentText, 3);
  const longMemory = relevant.length > 0
    ? `[LONG-TERM MEMORY VAULT]\nThe following are relevant archived events. Do not treat them as currently happening.\n<retrieved_archives>\n${relevant.map((chunk) => `<archive_memory time="${new Date(chunk.timestamp).toLocaleString()}">\n[Msg ${chunk.id}]\n${chunk.text || chunk.summary || ""}\n</archive_memory>`).join("\n")}\n</retrieved_archives>`
    : "";
  const shortMemory = mem.shortTermChunks.length > 0
    ? `[SHORT-TERM MEMORY]\n<recent_state_extracts>\n${mem.shortTermChunks.map((chunk) => `<archive_memory time="${new Date(chunk.timestamp).toLocaleString()}">[Msg ${chunk.id}]: ${chunk.summary || chunk.text || ""}</archive_memory>`).join("\n")}\n</recent_state_extracts>`
    : "";
  return { longMemory, shortMemory };
}

function buildNpcInjection(npcs: NpcRecord[], recentText: string): string {
  if (npcs.length === 0 || !recentText.trim()) return "";
  const words = new Set(recentText.match(/\p{L}[\p{L}\p{N}_-]*/gu)?.map((word) => word.toLowerCase()) || []);
  const scored = npcs
    .map((npc) => {
      const text = npcBuildText(npc).toLowerCase();
      let score = npc.name && recentText.includes(npc.name.toLowerCase()) ? 10 : 0;
      for (const word of words) if (word.length >= 3 && text.includes(word)) score += 1;
      return { npc, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (scored.length === 0) return "";
  return `[RELEVANT NPCs]\nThe following known NPCs are relevant to the current context:\n<retrieved_npcs>\n${scored.map(({ npc }) => `<npc name="${npc.name}">\n${npcBuildText(npc)}\n</npc>`).join("\n\n")}\n</retrieved_npcs>`;
}

function npcDossierDirective(): string {
  return `<npc_dossier>
trigger: Generate only when a new significant NPC is introduced.
format: Collapsible HTML details block. Dense, dashboard-style, no prose.
template:
<details>
<summary>New NPC: [Full Name]</summary>
**Name:** [Full name] | **Age:** [Age] | **Sex:** [M/F/Other]
**Appearance:** [Visual description]
**Occupation:** [Current role]
**Background:** [3-5 sentence life sketch]
**Inner Circle:**
* [Name] - [Relationship and dynamic]
**Personality Snapshot:** [Contradictions and defining behavior]
**Current Agenda:** [What they want right now]
**Hidden Layer:** [A secret or motive]
</details>
</npc_dossier>`;
}

function archivedMessageIndexes(profile: MeguminProfile): Set<number> {
  const mem = profile.memoryCore;
  const indexes = new Set<number>();
  if (!mem.enabled) return indexes;
  for (const chunk of [...mem.shortTermChunks, ...mem.longTermVault]) {
    for (let index = chunk.startIndex; index <= chunk.endIndex; index += 1) indexes.add(index);
  }
  return indexes;
}

function pruneArchivedPromptMessages(messages: LlmMessage[], chatMessages: ChatMessage[], profile: MeguminProfile): { messages: LlmMessage[]; prunedCount: number } {
  const archived = archivedMessageIndexes(profile);
  if (archived.size === 0) return { messages, prunedCount: 0 };
  const archivedTexts = new Set<string>();
  chatMessages.forEach((msg, index) => {
    if (archived.has(index)) {
      const normalized = cleanChatText(msg.content);
      if (normalized.length > 20) archivedTexts.add(normalized);
    }
  });
  if (archivedTexts.size === 0) return { messages, prunedCount: 0 };

  let prunedCount = 0;
  const kept = messages.filter((msg) => {
    if (typeof msg.content !== "string" || msg.role === "system") return true;
    const normalized = cleanChatText(msg.content);
    if (!archivedTexts.has(normalized)) return true;
    prunedCount += 1;
    return false;
  });
  return { messages: kept, prunedCount };
}

export function buildPromptMessages(
  incoming: LlmMessage[],
  chatMessages: ChatMessage[],
  rawProfile: unknown,
  customEngines: EngineMode[],
  context: ChatContext
): PromptBuildResult {
  const profile = hydrateProfile(rawProfile || DEFAULT_PROFILE);
  const { messages: prunedMessages, prunedCount } = pruneArchivedPromptMessages(
    incoming.map((msg) => ({ ...msg, content: Array.isArray(msg.content) ? clone(msg.content) : msg.content })),
    chatMessages,
    profile
  );
  const replaced = replaceMeguminPlaceholders(prunedMessages, profile, customEngines, chatMessages, context);
  const indexedMessages = replaced.messages.map((message, originalIndex) => ({ message, originalIndex })).filter((entry) => {
    if (typeof entry.message.content === "string") return entry.message.content.trim().length > 0;
    return entry.message.content.length > 0;
  });
  const resultMessages = indexedMessages.map((entry) => entry.message);
  const indexMap = new Map<number, number>();
  indexedMessages.forEach((entry, resultIndex) => indexMap.set(entry.originalIndex, resultIndex));

  const breakdown = replaced.changedMessages
    .map((entry) => {
      const messageIndex = indexMap.get(entry.messageIndex);
      return messageIndex === undefined ? null : {
        messageIndex,
        name: `Megumin Suite Placeholder Injection (${entry.replacementsMade})`
      };
    })
    .filter((entry): entry is { messageIndex: number; name: string } => !!entry);

  return {
    messages: resultMessages,
    breakdown,
    prunedCount,
    replacementsMade: replaced.replacementsMade,
    changedMessages: breakdown.map((entry) => ({ messageIndex: entry.messageIndex, replacementsMade: Number(entry.name.match(/\((\d+)\)/)?.[1] || 0) })),
    estimatedInjectionTokens: estimateMeguminPayloadTokens(profile, customEngines, chatMessages, context)
  };
}

export function isMessageArchived(index: number, profile: MeguminProfile): boolean {
  const mem = profile.memoryCore;
  if (!mem.enabled) return false;
  return [...mem.shortTermChunks, ...mem.longTermVault].some((chunk) => chunkContainsIndex(chunk, index));
}

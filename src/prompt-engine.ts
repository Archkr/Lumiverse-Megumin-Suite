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
    .replace(/\{\{char\}\}/gi, context.characterName || "the character")
    .replace(/<BOT>/g, context.characterName || "the character")
    .replace(/\{\{user\}\}/gi, "the user")
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
  dict.Language = `[LANGUAGE RULE]\nAll output except private thinking must be in ${targetLang} only.`;
  dict.pronouns = profile.userPronouns === "male"
    ? "The user character is male. Portray and address him as such."
    : profile.userPronouns === "female"
      ? "The user character is female. Portray and address her as such."
      : "";
  dict.count = profile.userWordCount.trim() ? `maximum ${profile.userWordCount.trim()} words` : "";

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
    ? `Ratio: maintain a balance of ${profile.dnRatio.dialogue}% dialogue and ${100 - profile.dnRatio.dialogue}% narration.`
    : "";
  dict.onomato = profile.onomatopoeia.enabled
    ? `Narration must use precise, context-specific onomatopoeia.${profile.onomatopoeia.useStyling ? " Style sound words with tasteful HTML/CSS when appropriate." : ""}`
    : "";
  dict.MVU = profile.blocks.includes("mvu")
    ? (getContent(logic.blocks, "mvu") || "{main response}").replace("[[count]]", dict.count || "...")
    : (dict.count ? `{main response - ${dict.count}}` : "{main response}");

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
    ["npc_inner_chatter", "npc_inner_chatter", profile.blocks.includes("npc_inner_chatter") || profile.blocks.includes("npc_inner_chatter_v2")]
  ] as const;

  for (const [source, target, condition] of overrides) {
    const value = activeEngine[source];
    if (condition && typeof value === "string" && value.trim()) dict[target] = value;
  }

  if (activeEngine.id.startsWith("v7")) {
    if (!profile.toggles.v7_ooc) dict.prompt1 = dict.prompt1.replace(/<ooc_protocol>[\s\S]*?<\/ooc_protocol>/g, "");
    if (!profile.toggles.v7_pcsolo) dict.prompt4 = dict.prompt4.replace(/<pc_solo_physicality[\s\S]*?<\/pc_solo_physicality>/g, "");
    if (!profile.toggles.v7_culture) dict.prompt4 = dict.prompt4.replace(/<cultural_anchoring>[\s\S]*?<\/cultural_anchoring>/g, "");
    if (!profile.toggles.v7_scene) dict.prompt4 = dict.prompt4.replace(/<scene_choreography>[\s\S]*?<\/scene_choreography>/g, "");
    if (!profile.toggles.v7_intro) dict.prompt4 = dict.prompt4.replace(/\s*introduction_protocol:\s*"[^"]*"/g, "");
  }

  if (profile.storyPlan.enabled && profile.storyPlan.currentPlan.trim()) {
    dict.storyplan = `<Story_Plan>\n${profile.storyPlan.currentPlan.trim()}\n</Story_Plan>`;
    dict.storytracker = "<Story_Tracker>\narc: active arc.\nchapter: active chapter.\nEpisode: active episode.\nSecrets: secrets the user character does not know.\n</Story_Tracker>";
  } else {
    dict.storyplan = "";
    dict.storytracker = "";
  }

  dict.banlist = profile.banList.length > 0
    ? `[BAN LIST]\nNever rely on these cliches, tropes, or repetitive patterns:\n${profile.banList.map((item) => `- ${item}`).join("\n")}`
    : "";

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

function replacePlaceholderText(content: string, replacements: Record<string, string>): { content: string; replacementsMade: number } {
  let next = content;
  let replacementsMade = 0;

  for (const [placeholder, replacement] of Object.entries(replacements)) {
    if (!next.includes(placeholder)) continue;
    const processed = replacement || "";
    if (processed.trim() === "") {
      next = next.replace(new RegExp(`^[ \\t]*${escapeRegex(placeholder)}[ \\t]*\\r?\\n?`, "gm"), "");
    }
    next = next.replace(new RegExp(escapeRegex(placeholder), "g"), processed);
    replacementsMade += 1;
  }

  for (const placeholder of UNUSED_PLACEHOLDERS) {
    if (!next.includes(placeholder)) continue;
    next = next.replace(new RegExp(`^[ \\t]*${escapeRegex(placeholder)}[ \\t]*\\r?\\n?`, "gm"), "");
    next = next.replace(new RegExp(escapeRegex(placeholder), "g"), "");
  }

  return { content: cleanEmptyLines(next), replacementsMade };
}

export function replaceMeguminPlaceholders(
  incoming: LlmMessage[],
  rawProfile: unknown,
  customEngines: EngineMode[],
  chatMessages: ChatMessage[],
  context: ChatContext
): { messages: LlmMessage[]; replacementsMade: number } {
  const profile = hydrateProfile(rawProfile || DEFAULT_PROFILE);
  const replacements = placeholderMapFromDict(buildBaseDict(profile, customEngines, chatMessages, context));
  let replacementsMade = 0;
  const messages = incoming.map((message) => {
    if (typeof message.content === "string") {
      const replaced = replacePlaceholderText(message.content, replacements);
      replacementsMade += replaced.replacementsMade;
      return { ...message, content: replaced.content };
    }
    const content = message.content.map((part) => {
      if (part.type !== "text") return part;
      const replaced = replacePlaceholderText(part.text, replacements);
      replacementsMade += replaced.replacementsMade;
      return { ...part, text: replaced.content };
    });
    return { ...message, content };
  });
  return { messages, replacementsMade };
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
  const resultMessages = replaced.messages.filter((msg) => {
    if (typeof msg.content === "string") return msg.content.trim().length > 0;
    return msg.content.length > 0;
  });

  const breakdown = replaced.replacementsMade > 0
    ? [{ messageIndex: 0, name: `Megumin Suite Placeholder Injection (${replaced.replacementsMade})` }]
    : [];

  return { messages: resultMessages, breakdown, prunedCount };
}

export function isMessageArchived(index: number, profile: MeguminProfile): boolean {
  const mem = profile.memoryCore;
  if (!mem.enabled) return false;
  return [...mem.shortTermChunks, ...mem.longTermVault].some((chunk) => chunkContainsIndex(chunk, index));
}

import { DEFAULT_PROFILE, EXTENSION_NAME, clone, mergeProfile } from "./defaults";
import { buildPromptMessages, getLogic, allEngines } from "./prompt-engine";
import type { ChatContext, ChatMessage, EngineMode, MeguminProfile, NpcRecord, RpcEnvelope, RpcResponse } from "./types";
import { cleanAIOutput, cleanChatText, escapeXmlAttr, extractNpcBlocks, npcBuildText } from "./text";
import { patchComfyWorkflow } from "./image-workflow";
import { MEGUMIN_PRESET_SEEDS, type PresetSeed, type PresetSeedKind } from "./preset-seeds";

declare const spindle: any;

const CUSTOM_ENGINES_PATH = "custom-engines.json";
const PRESET_BRIDGE_PATH = "preset-bridge.json";
const DEFAULT_HERO_ASSETS = ["img/default.png", "img/default1.png", "img/default2.png", "img/default3.png"];
const SYNCABLE_PROFILE_KEYS = new Set([
  "mode",
  "personality",
  "toggles",
  "activeStyleId",
  "aiRule",
  "customStyles",
  "dnRatio",
  "userWordCount",
  "userLanguage",
  "userPronouns",
  "disableUtilityPrefill",
  "onomatopoeia",
  "addons",
  "blocks",
  "model",
  "thinkEffort",
  "customThinkEffort",
  "thinkingV2",
  "storyPlan",
  "banList",
  "banListBackend",
  "imageGen",
  "npcBank",
  "memoryCore"
]);
let utilityBypassDepth = 0;

type PresetKind = "engine" | "image";

type PresetBridgeState = {
  enginePresetId?: string;
  imagePresetId?: string;
  suiteDs4PresetId?: string;
  suiteGeminiPresetId?: string;
  updatedAt?: number;
};

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await spindle.storage.read(path);
    return JSON.parse(raw) as T;
  } catch {
    return clone(fallback);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await spindle.storage.write(path, JSON.stringify(value, null, 2));
}

function profilePath(scope: string): string {
  return `profiles/${scope}.json`;
}

async function getCustomEngines(): Promise<EngineMode[]> {
  return readJson<EngineMode[]>(CUSTOM_ENGINES_PATH, []);
}

async function saveCustomEngines(engines: EngineMode[]): Promise<void> {
  await writeJson(CUSTOM_ENGINES_PATH, engines);
}

async function hasPresetAccess(): Promise<boolean> {
  try {
    return !spindle.permissions?.has || await spindle.permissions.has("presets");
  } catch {
    return false;
  }
}

function presetStateKey(kind: PresetSeedKind): keyof PresetBridgeState {
  if (kind === "image") return "imagePresetId";
  if (kind === "suite-ds4") return "suiteDs4PresetId";
  if (kind === "suite-gemini") return "suiteGeminiPresetId";
  return "enginePresetId";
}

function presetSeed(kind: PresetSeedKind): PresetSeed {
  const seed = MEGUMIN_PRESET_SEEDS.find((item) => item.kind === kind);
  if (!seed) throw new Error(`Missing Megumin preset seed: ${kind}`);
  return seed;
}

function presetName(kind: PresetSeedKind): string {
  const name = presetSeed(kind).name;
  return kind === "engine" || kind === "image" ? `${name} Preset` : name;
}

function presetParameters(seed: PresetSeed): Record<string, unknown> {
  const data = seed.data || {};
  const ignored = new Set(["prompts", "prompt_order", "extensions"]);
  const parameters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!ignored.has(key)) parameters[key] = value;
  }
  return parameters;
}

function promptOrderForSeed(seed: PresetSeed): Map<string, boolean> {
  const order = Array.isArray(seed.data?.prompt_order) ? seed.data.prompt_order : [];
  const preferred = order.find((entry: any) => entry?.character_id === 100001) || order[0] || {};
  const map = new Map<string, boolean>();
  for (const entry of preferred.order || []) {
    if (entry?.identifier) map.set(String(entry.identifier), entry.enabled !== false);
  }
  return map;
}

function stPositionToLumiverse(value: unknown): "pre_history" | "post_history" | "in_history" {
  if (value === 1 || value === "1" || value === "post_history") return "post_history";
  if (value === 2 || value === "2" || value === "in_history") return "in_history";
  return "pre_history";
}

function stRoleToLumiverse(value: unknown): "system" | "user" | "assistant" | "user_append" | "assistant_append" {
  return value === "user" || value === "assistant" || value === "user_append" || value === "assistant_append" ? value : "system";
}

function convertStPromptToBlock(seed: PresetSeed, prompt: any, index: number): Record<string, unknown> {
  const order = promptOrderForSeed(seed);
  const identifier = String(prompt?.identifier || `prompt_${index}`);
  const marker = prompt?.marker ? identifier : null;
  const enabledFromOrder = order.has(identifier) ? order.get(identifier) : undefined;
  return {
    name: String(prompt?.name || identifier),
    content: String(prompt?.content || ""),
    role: stRoleToLumiverse(prompt?.role),
    enabled: enabledFromOrder ?? prompt?.enabled ?? prompt?.system_prompt ?? true,
    position: stPositionToLumiverse(prompt?.injection_position),
    depth: Number(prompt?.injection_depth ?? 4),
    marker,
    isLocked: !!prompt?.forbid_overrides,
    color: seed.kind === "image" ? "#06b6d4" : "#f59e0b",
    injectionTrigger: Array.isArray(prompt?.injection_trigger) ? prompt.injection_trigger.map(String) : [],
    group: seed.name,
    variables: []
  };
}

async function findMeguminPreset(kind: PresetSeedKind, userId?: string): Promise<any | null> {
  if (!await hasPresetAccess()) return null;
  const state = await readJson<PresetBridgeState>(PRESET_BRIDGE_PATH, {});
  const knownId = state[presetStateKey(kind)];
  if (knownId) {
    try {
      const preset = await spindle.presets.get(knownId, userId);
      if (preset) return preset;
    } catch {
      // Fall through to list lookup.
    }
  }
  const listed = await spindle.presets.list({ limit: 200, userId });
  const targetName = presetName(kind);
  return (listed?.data || []).find((preset: any) =>
    preset?.metadata?.megumin_suite?.kind === kind ||
    preset?.metadata?.megumin_suite?.sourceFile === presetSeed(kind).sourceFile ||
    String(preset?.name || "").trim().toLowerCase() === targetName.toLowerCase()
  ) || null;
}

async function ensurePresetFromSeed(seed: PresetSeed, userId?: string): Promise<any> {
  if (!await hasPresetAccess()) throw new Error("Megumin preset mode requires the presets permission.");
  const state = await readJson<PresetBridgeState>(PRESET_BRIDGE_PATH, {});
  let preset = await findMeguminPreset(seed.kind, userId);
  const name = presetName(seed.kind);
  const metadata = {
    ...(preset?.metadata || {}),
    description: `${name} managed by Megumin Suite.`,
    megumin_suite: { kind: seed.kind, sourceFile: seed.sourceFile, version: 2 }
  };
  if (!preset) {
    preset = await spindle.presets.create({
      name,
      provider: "loom",
      engine: "classic",
      parameters: presetParameters(seed),
      prompt_order: [],
      prompts: {},
      metadata
    }, userId);
  } else {
    preset = await spindle.presets.update(preset.id, {
      name,
      provider: preset.provider || "loom",
      engine: preset.engine || "classic",
      parameters: { ...(preset.parameters || {}), ...presetParameters(seed) },
      metadata
    }, userId);
  }

  const blocks = await spindle.presets.blocks.list(preset.id, userId);
  for (const block of blocks || []) {
    await spindle.presets.blocks.delete(preset.id, block.id, userId).catch(() => false);
  }
  const prompts = Array.isArray(seed.data?.prompts) ? seed.data.prompts : [];
  for (let index = 0; index < prompts.length; index += 1) {
    await spindle.presets.blocks.create(preset.id, convertStPromptToBlock(seed, prompts[index], index), { index, userId });
  }

  state[presetStateKey(seed.kind)] = preset.id;
  state.updatedAt = Date.now();
  await writeJson(PRESET_BRIDGE_PATH, state);
  return preset;
}

async function ensureSuitePresets(userId?: string): Promise<void> {
  await Promise.all([
    ensurePresetFromSeed(presetSeed("suite-ds4"), userId),
    ensurePresetFromSeed(presetSeed("suite-gemini"), userId)
  ]);
}

async function ensureMeguminPreset(kind: PresetKind, userId?: string): Promise<any> {
  const preset = await ensurePresetFromSeed(presetSeed(kind), userId);
  await ensureSuitePresets(userId).catch((err) => spindle.log.warn(`Megumin suite preset bridge repair failed: ${String(err)}`));
  return preset;
}

async function ensureFullPresetBridge(userId?: string): Promise<any[]> {
  return Promise.all(MEGUMIN_PRESET_SEEDS.map((seed) => ensurePresetFromSeed(seed, userId)));
}

async function presetBridgeStatus(userId?: string): Promise<{ available: boolean; enginePresetId?: string; imagePresetId?: string; suiteDs4PresetId?: string; suiteGeminiPresetId?: string }> {
  const available = await hasPresetAccess();
  if (!available) return { available: false };
  const [engine, image, suiteDs4, suiteGemini] = await Promise.all([
    findMeguminPreset("engine", userId).catch(() => null),
    findMeguminPreset("image", userId).catch(() => null),
    findMeguminPreset("suite-ds4", userId).catch(() => null),
    findMeguminPreset("suite-gemini", userId).catch(() => null)
  ]);
  return {
    available: true,
    enginePresetId: engine?.id,
    imagePresetId: image?.id,
    suiteDs4PresetId: suiteDs4?.id,
    suiteGeminiPresetId: suiteGemini?.id
  };
}

async function loadProfile(scope: string): Promise<MeguminProfile> {
  const globalProfile = await readJson(profilePath("global"), DEFAULT_PROFILE);
  const raw = scope === "global" ? globalProfile : await readJson(profilePath(scope), globalProfile);
  return mergeProfile(raw);
}

async function saveProfile(scope: string, profile: MeguminProfile): Promise<MeguminProfile> {
  const merged = mergeProfile(profile);
  await writeJson(profilePath(scope), merged);
  return merged;
}

function mimeForPath(path: string): string {
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

function stableIndex(input: string, length: number): number {
  if (length <= 1) return 0;
  let hash = 0;
  for (const char of input) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % length;
}

async function readAssetDataUrl(path: string): Promise<string | null> {
  try {
    const bytes = await spindle.storage.readBinary(path);
    const base64 = Buffer.from(bytes).toString("base64");
    return `data:${mimeForPath(path)};base64,${base64}`;
  } catch {
    return null;
  }
}

async function loadUiAssets(context: ChatContext): Promise<{ heroImages: string[]; groupImage?: string; mascotImage?: string }> {
  const start = stableIndex(context.chatId || context.scope, DEFAULT_HERO_ASSETS.length);
  const ordered = [...DEFAULT_HERO_ASSETS.slice(start), ...DEFAULT_HERO_ASSETS.slice(0, start)];
  const heroImages: string[] = [];
  for (const path of ordered) {
    const data = await readAssetDataUrl(path);
    if (data) heroImages.push(data);
  }
  const groupImage = await readAssetDataUrl("img/group.png");
  const mascotImage = await readAssetDataUrl("img/Cat.png");
  return { heroImages, groupImage: groupImage || undefined, mascotImage: mascotImage || undefined };
}

async function syncProfileKeysFrom(scope: string, keys: string[]): Promise<number> {
  const safeKeys = keys.filter((key) => SYNCABLE_PROFILE_KEYS.has(key));
  if (safeKeys.length === 0) return 0;
  const source = await loadProfile(scope);
  let profileFiles: string[] = [];
  try {
    profileFiles = await spindle.storage.list("profiles/");
  } catch {
    profileFiles = [];
  }
  const targets = new Set<string>(["profiles/global.json", profilePath(scope)]);
  for (const file of profileFiles) {
    const path = String(file);
    if (!path.endsWith(".json")) continue;
    targets.add(path.startsWith("profiles/") ? path : `profiles/${path}`);
  }
  for (const path of targets) {
    const current = mergeProfile(await readJson(path, DEFAULT_PROFILE));
    for (const key of safeKeys) {
      (current as unknown as Record<string, unknown>)[key] = clone((source as unknown as Record<string, unknown>)[key]);
    }
    await writeJson(path, current);
  }
  return targets.size;
}

function chatToScope(chatId: string | null): string {
  return chatId ? `chat_${chatId}` : "global";
}

async function getActiveContext(userId?: string): Promise<ChatContext> {
  try {
    const active = await spindle.chats.getActive(userId);
    const chatId = active?.id || null;
    const characterId = active?.character_id || active?.characterId || null;
    const isGroup = !!(active?.is_group || active?.isGroup || active?.group_id || active?.groupId || Array.isArray(active?.character_ids) || Array.isArray(active?.characterIds));
    let characterName = "the character";
    let characterAvatarUrl: string | null = null;
    if (characterId) {
      try {
        const character = await spindle.characters.get(characterId, userId);
        characterName = character?.name || characterName;
        characterAvatarUrl = character ? `/api/v1/characters/${encodeURIComponent(characterId)}/avatar?size=lg` : null;
      } catch {
        // Character permission may be missing; prompts still work with a generic name.
      }
    }
    return {
      chatId,
      chatName: active?.name || null,
      characterId,
      characterName,
      characterAvatarUrl,
      isGroup,
      groupName: isGroup ? active?.name || "Group Chat" : null,
      scope: chatToScope(chatId)
    };
  } catch {
    return { chatId: null, chatName: null, characterId: null, characterName: "the character", characterAvatarUrl: null, isGroup: false, groupName: null, scope: "global" };
  }
}

async function getChatContext(chatId: string | null, userId?: string): Promise<ChatContext> {
  if (!chatId) return getActiveContext(userId);
  try {
    const chat = await spindle.chats.get(chatId, userId);
    const characterId = chat?.character_id || chat?.characterId || null;
    const isGroup = !!(chat?.is_group || chat?.isGroup || chat?.group_id || chat?.groupId || Array.isArray(chat?.character_ids) || Array.isArray(chat?.characterIds));
    let characterName = "the character";
    let characterAvatarUrl: string | null = null;
    if (characterId) {
      try {
        const character = await spindle.characters.get(characterId, userId);
        characterName = character?.name || characterName;
        characterAvatarUrl = character ? `/api/v1/characters/${encodeURIComponent(characterId)}/avatar?size=lg` : null;
      } catch {
        // best effort
      }
    }
    return {
      chatId,
      chatName: chat?.name || null,
      characterId,
      characterName,
      characterAvatarUrl,
      isGroup,
      groupName: isGroup ? chat?.name || "Group Chat" : null,
      scope: chatToScope(chatId)
    };
  } catch {
    return { chatId, chatName: null, characterId: null, characterName: "the character", characterAvatarUrl: null, isGroup: false, groupName: null, scope: chatToScope(chatId) };
  }
}

async function getMessages(chatId: string | null): Promise<ChatMessage[]> {
  if (!chatId) return [];
  try {
    return (await spindle.chat.getMessages(chatId)) as ChatMessage[];
  } catch {
    return [];
  }
}

async function generateQuiet(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  options: { backend?: "direct" | "preset"; presetKind?: PresetKind; userId?: string } = {}
): Promise<string> {
  utilityBypassDepth += 1;
  try {
    const input: Record<string, unknown> = { messages };
    if (options.backend === "preset" && options.presetKind) {
      const preset = await ensureMeguminPreset(options.presetKind, options.userId);
      input.presetId = preset.id;
      input.preset_id = preset.id;
      input.force_preset_id = true;
    }
    const result = await spindle.generate.quiet(input);
    return cleanAIOutput(String(result?.content || result || ""));
  } finally {
    utilityBypassDepth = Math.max(0, utilityBypassDepth - 1);
  }
}

function cleanedTranscript(messages: ChatMessage[], limit = 50): string {
  return messages
    .filter((message) => message.role !== "system")
    .slice(-limit)
    .map((message) => `${message.role}: ${cleanChatText(message.content)}`)
    .filter((line) => line.trim().length > 8)
    .join("\n\n");
}

function lastAssistant(messages: ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return messages[index];
  }
  return null;
}

async function processMemory(scope: string, chatId: string): Promise<MeguminProfile> {
  const profile = await loadProfile(scope);
  const mem = profile.memoryCore;
  const messages = await getMessages(chatId);
  const real = messages
    .map((msg, index) => ({ msg, index }))
    .filter((item) => item.msg.role !== "system" && cleanChatText(item.msg.content).length > 0);

  if (!mem.enabled || real.length <= mem.workingLimit) return profile;
  const archivedIds = new Set([...mem.shortTermChunks, ...mem.longTermVault].map((chunk) => chunk.id));
  const effectiveLimit = mem.architecture === "raw_long" ? mem.workingLimit : mem.workingLimit + mem.shortTermLimit;
  const vaultCutoff = Math.max(0, real.length - effectiveLimit);
  const archivable = real.slice(0, real.length - mem.workingLimit);

  for (let offset = 0; offset < archivable.length; offset += 10) {
    const chunk = archivable.slice(offset, offset + 10);
    if (chunk.length === 0) continue;
    const startIndex = chunk[0].index;
    const endIndex = chunk[chunk.length - 1].index;
    const id = `${startIndex}-${endIndex}`;
    if (archivedIds.has(id)) continue;
    const text = chunk.map((item) => `${item.msg.role}: ${cleanChatText(item.msg.content)}`).join("\n\n");
    if (offset < vaultCutoff || mem.architecture === "raw_long") {
      mem.longTermVault.push({ id, startIndex, endIndex, text, timestamp: Date.now() });
      archivedIds.add(id);
      continue;
    }

    const summary = await generateQuiet([
      {
        role: "system",
        content: "You are an expert narrative condenser. Summarize important story events and meaningful dialogue. Remove flowery prose and trivial motion. Do not quote dialogue unless necessary."
      },
      { role: "user", content: `Summarize this chat chunk clearly:\n\n<chat>\n${text}\n</chat>` }
    ], { backend: mem.backend, presetKind: "engine" });
    mem.shortTermChunks.push({ id, startIndex, endIndex, summary, timestamp: Date.now() });
    archivedIds.add(id);
  }

  const shortCutoffIndex = real.length <= effectiveLimit ? 0 : real[real.length - effectiveLimit]?.index ?? 0;
  for (let index = mem.shortTermChunks.length - 1; index >= 0; index -= 1) {
    const chunk = mem.shortTermChunks[index];
    if (chunk.endIndex < shortCutoffIndex) {
      mem.shortTermChunks.splice(index, 1);
      const rawText = messages
        .slice(chunk.startIndex, chunk.endIndex + 1)
        .filter((message) => message.role !== "system")
        .map((message) => `${message.role}: ${cleanChatText(message.content)}`)
        .join("\n\n");
      mem.longTermVault.push({ ...chunk, text: rawText, summary: undefined, timestamp: Date.now() });
    }
  }

  return saveProfile(scope, profile);
}

async function scanNpcBlocks(scope: string, chatId: string): Promise<MeguminProfile> {
  const profile = await loadProfile(scope);
  if (!profile.npcBank.enabled) return profile;
  const messages = await getMessages(chatId);
  const assistant = lastAssistant(messages);
  if (!assistant) return profile;
  const found = extractNpcBlocks(assistant.content);
  if (found.length === 0) return profile;
  const existing = new Set(profile.npcBank.npcs.map((npc) => npc.name.trim().toLowerCase()));
  let changed = false;
  for (const npc of found) {
    if (existing.has(npc.name.trim().toLowerCase())) continue;
    profile.npcBank.npcs.push(npc);
    existing.add(npc.name.trim().toLowerCase());
    changed = true;
  }
  return changed ? saveProfile(scope, profile) : profile;
}

function parseImageTag(content: string): { prompt: string; cleaned: string } | null {
  const match = content.match(/<img\s+prompt=["']([\s\S]*?)["']\s*\/?>/i);
  if (!match) return null;
  return { prompt: match[1].trim(), cleaned: content.replace(match[0], "").trim() };
}

async function resolveImageConnection(profile: MeguminProfile): Promise<any | null> {
  try {
    if (profile.imageGen.connectionId) {
      return await spindle.imageGen.getConnection(profile.imageGen.connectionId);
    }
    const connections = await spindle.imageGen.listConnections();
    return connections.find((connection: any) => connection.is_default) || connections[0] || null;
  } catch {
    return null;
  }
}

async function generateImageForChat(scope: string, chatId: string, prompt: string, attachToMessageId?: string): Promise<{ imageId?: string; imageUrl?: string; prompt: string }> {
  const profile = await loadProfile(scope);
  const connection = await resolveImageConnection(profile);
  const parameters: Record<string, unknown> = {
    width: profile.imageGen.imgWidth,
    height: profile.imageGen.imgHeight,
    steps: profile.imageGen.steps,
    cfg: profile.imageGen.cfg,
    seed: profile.imageGen.customSeed >= 0 ? profile.imageGen.customSeed : undefined,
    sampler_name: profile.imageGen.selectedSampler || undefined,
    scheduler: profile.imageGen.scheduler || undefined,
    checkpoint: profile.imageGen.selectedModel || undefined,
    denoise: profile.imageGen.denoise,
    clip_skip: profile.imageGen.clipSkip
  };
  if (connection?.provider === "comfyui" || connection?.provider === "swarmui") {
    const workflow = patchComfyWorkflow(connection, profile, prompt);
    if (workflow) parameters.workflow = workflow;
  }
  const result = await spindle.imageGen.generate({
    prompt,
    connection_id: connection?.id || profile.imageGen.connectionId || undefined,
    model: profile.imageGen.selectedModel || undefined,
    negativePrompt: profile.imageGen.customNegative,
    parameters,
    owner_chat_id: chatId
  });

  if (attachToMessageId && result?.imageId) {
    const messages = await getMessages(chatId);
    const target = messages.find((message) => message.id === attachToMessageId);
    if (target) {
      const tag = `<megumin-image image-id="${escapeXmlAttr(result.imageId)}" src="${escapeXmlAttr(result.imageUrl || "")}" prompt="${escapeXmlAttr(prompt)}"></megumin-image>`;
      await spindle.chat.updateMessage(chatId, attachToMessageId, {
        content: `${target.content.trim()}\n\n${tag}`.trim(),
        skipChunkRebuild: true
      });
    }
  }

  return { imageId: result?.imageId, imageUrl: result?.imageUrl, prompt };
}

async function generateImagePromptFromChat(profile: MeguminProfile, messages: ChatMessage[], userId?: string): Promise<string> {
  const chatText = cleanedTranscript(messages, 10);
  const style = profile.imageGen.promptStyle === "illustrious"
    ? "Use Danbooru-style tags separated by commas. Focus on anime art style."
    : profile.imageGen.promptStyle === "sdxl"
      ? "Use natural, descriptive prose. Focus on photorealism."
      : "Use a comma-separated list of detailed keywords and visual descriptors.";
  const perspective = profile.imageGen.promptPerspective === "pov"
    ? "First-person POV."
    : profile.imageGen.promptPerspective === "character"
      ? "Focus on character appearance and expression."
      : "Focus on the whole scene and environment.";
  return generateQuiet([
    {
      role: "system",
      content: "You are an expert image prompt engineer. Convert the latest scene into a concise, high-quality image prompt. Return only the prompt."
    },
    {
      role: "user",
      content: `Chat:\n${chatText}\n\nStyle: ${style}\nPerspective: ${perspective}\nExtra: ${profile.imageGen.promptExtra || "None"}`
    }
  ], { backend: profile.imageGen.generatorBackend, presetKind: "image", userId });
}

async function handlePostGeneration(chatId: string): Promise<void> {
  const context = await getChatContext(chatId);
  const profile = await loadProfile(context.scope);
  const messages = await getMessages(chatId);
  await scanNpcBlocks(context.scope, chatId);

  if (profile.memoryCore.enabled && profile.memoryCore.triggerMode === "frequency") {
    const aiCount = messages.filter((message) => message.role === "assistant").length;
    if (aiCount > 0 && aiCount % Math.max(1, profile.memoryCore.autoFreq || 10) === 0) {
      processMemory(context.scope, chatId).catch((err: unknown) => spindle.log.warn(`Memory scan failed: ${String(err)}`));
    }
  }

  const assistant = lastAssistant(messages);
  if (!assistant || !profile.imageGen.enabled) return;
  const imageTag = parseImageTag(assistant.content);
  if (!imageTag) return;
  await spindle.chat.updateMessage(chatId, assistant.id, { content: imageTag.cleaned, skipChunkRebuild: true });
  await generateImageForChat(context.scope, chatId, imageTag.prompt, assistant.id);
}

async function rpc(payload: RpcEnvelope, userId?: string): Promise<unknown> {
  const context = await getActiveContext(userId);
  switch (payload.type) {
    case "bootstrap": {
      const profile = await loadProfile(context.scope);
      let imageConnections: any[] = [];
      try {
        imageConnections = await spindle.imageGen.listConnections(userId);
      } catch {
        imageConnections = [];
      }
      return {
        context,
        profile,
        logic: getLogic(),
        engines: allEngines(await getCustomEngines()),
        customEngines: await getCustomEngines(),
        imageConnections,
        uiAssets: await loadUiAssets(context),
        presetBridge: await presetBridgeStatus(userId)
      };
    }
    case "profile:save": {
      const profile = mergeProfile((payload.payload as any)?.profile);
      return { profile: await saveProfile(context.scope, profile), context };
    }
    case "profile:syncTab": {
      const keys = Array.isArray((payload.payload as any)?.keys) ? (payload.payload as any).keys.map(String) : [];
      const syncedTargets = await syncProfileKeysFrom(context.scope, keys);
      return { profile: await loadProfile(context.scope), context, syncedTargets };
    }
    case "profile:reset":
      await saveProfile(context.scope, DEFAULT_PROFILE);
      return { profile: await loadProfile(context.scope), context };
    case "engine:save": {
      const engine = (payload.payload as any)?.engine as EngineMode;
      if (!engine?.id) throw new Error("Engine id is required");
      const engines = await getCustomEngines();
      const index = engines.findIndex((item) => item.id === engine.id);
      if (index >= 0) engines[index] = engine;
      else engines.push(engine);
      await saveCustomEngines(engines);
      return { customEngines: engines, engines: allEngines(engines) };
    }
    case "engine:delete": {
      const id = String((payload.payload as any)?.id || "");
      const engines = (await getCustomEngines()).filter((engine) => engine.id !== id);
      await saveCustomEngines(engines);
      return { customEngines: engines, engines: allEngines(engines) };
    }
    case "story:generate": {
      if (!context.chatId) throw new Error("Open a chat before generating a story plan");
      const profile = await loadProfile(context.scope);
      const messages = await getMessages(context.chatId);
      const plan = await generateQuiet([
        { role: "system", content: "You are an expert story architect. Brainstorm medium-to-long-term plot developments. Do not write actions, thoughts, or dialogue for the user character." },
        { role: "user", content: `Create at least 10 future arc/chapter/episode possibilities from this story:\n\n${cleanedTranscript(messages, 60)}` }
      ], { backend: profile.storyPlan.backend, presetKind: "engine", userId });
      profile.storyPlan.currentPlan = plan;
      profile.storyPlan.enabled = true;
      return { profile: await saveProfile(context.scope, profile), plan };
    }
    case "banlist:analyze": {
      if (!context.chatId) throw new Error("Open a chat before analyzing style");
      const profile = await loadProfile(context.scope);
      const messages = await getMessages(context.chatId);
      const analysis = await generateQuiet([
        { role: "system", content: "Identify the 5 most repetitive cliche or overused stylistic patterns. Return only short generalized rules separated by commas." },
        { role: "user", content: cleanedTranscript(messages.filter((message) => message.role === "assistant"), 50) }
      ], { backend: profile.banListBackend, presetKind: "engine", userId });
      const phrases = analysis.split(/[,\n-]+/).map((item) => item.trim().replace(/^["']|["']$/g, "")).filter((item) => item.length > 3);
      for (const phrase of phrases) if (!profile.banList.includes(phrase)) profile.banList.push(phrase);
      return { profile: await saveProfile(context.scope, profile), added: phrases };
    }
    case "memory:process": {
      if (!context.chatId) throw new Error("Open a chat before processing memory");
      return { profile: await processMemory(context.scope, context.chatId) };
    }
    case "npc:scan": {
      if (!context.chatId) throw new Error("Open a chat before scanning NPCs");
      return { profile: await scanNpcBlocks(context.scope, context.chatId) };
    }
    case "npc:portrait": {
      if (!context.chatId) throw new Error("Open a chat before generating portraits");
      const name = String((payload.payload as any)?.name || "");
      const profile = await loadProfile(context.scope);
      const npc = profile.npcBank.npcs.find((item) => item.name === name);
      if (!npc) throw new Error("NPC not found");
      const prompt = await generateQuiet([
        { role: "system", content: "You are an expert image prompt engineer specializing in character portraits. Return only the image prompt." },
        { role: "user", content: `Create a portrait prompt from this NPC dossier:\n\n${npcBuildText(npc)}` }
      ], { backend: profile.imageGen.generatorBackend, presetKind: "image", userId });
      const image = await generateImageForChat(context.scope, context.chatId, prompt);
      npc.pfpImageId = image.imageId;
      npc.pfpImageUrl = image.imageUrl;
      npc.pfp = image.imageUrl || "";
      return { profile: await saveProfile(context.scope, profile), image };
    }
    case "image:connections": {
      return { imageConnections: await spindle.imageGen.listConnections(userId) };
    }
    case "image:manual": {
      if (!context.chatId) throw new Error("Open a chat before generating an image");
      const profile = await loadProfile(context.scope);
      const messages = await getMessages(context.chatId);
      const prompt = String((payload.payload as any)?.prompt || "").trim() || await generateImagePromptFromChat(profile, messages, userId);
      const target = lastAssistant(messages);
      const image = await generateImageForChat(context.scope, context.chatId, prompt, target?.id);
      return { image };
    }
    case "preset:ensureBridge": {
      const kind = ((payload.payload as any)?.kind === "image" ? "image" : "engine") as PresetKind;
      const preset = await ensureMeguminPreset(kind, userId);
      return { presetBridge: await presetBridgeStatus(userId), preset };
    }
    case "preset:repairAll": {
      const presets = await ensureFullPresetBridge(userId);
      return { presetBridge: await presetBridgeStatus(userId), presets };
    }
    case "preset:status":
      return { presetBridge: await presetBridgeStatus(userId) };
    default:
      throw new Error(`Unknown Megumin RPC: ${payload.type}`);
  }
}

function sendRpc(userId: string | undefined, response: RpcResponse): void {
  spindle.sendToFrontend(response, userId);
}

spindle.onFrontendMessage(async (payload: RpcEnvelope, userId?: string) => {
  try {
    const result = await rpc(payload, userId);
    sendRpc(userId, { type: "rpc:result", requestId: payload.requestId, payload: result });
  } catch (err) {
    sendRpc(userId, { type: "rpc:error", requestId: payload.requestId, error: err instanceof Error ? err.message : String(err) });
  }
});

spindle.registerInterceptor(async (messages: any[], generationContext: any) => {
  if (utilityBypassDepth > 0 && generationContext?.generationType === "quiet") return messages;
  const chatId = generationContext?.chatId || null;
  const context = await getChatContext(chatId);
  const profile = await loadProfile(context.scope);
  const customEngines = await getCustomEngines();
  const chatMessages = await getMessages(context.chatId);
  const result = buildPromptMessages(messages, chatMessages, profile, customEngines, context);
  return {
    messages: result.messages,
    breakdown: result.breakdown
  };
}, 40);

try {
  spindle.on("GENERATION_ENDED", (payload: any) => {
    const chatId = payload?.chatId;
    if (chatId) handlePostGeneration(chatId).catch((err) => spindle.log.warn(`Megumin post-generation failed: ${String(err)}`));
  });
} catch {
  // Generation event permission may not be granted yet; the rest of the extension still works.
}

spindle.log.info(`${EXTENSION_NAME} Lumiverse backend loaded`);

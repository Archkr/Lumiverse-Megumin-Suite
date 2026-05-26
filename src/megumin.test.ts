import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { clone, mergeProfile } from "./defaults";
import { buildPromptMessages } from "./prompt-engine";
import { extractNpcBlocks, relevantChunks } from "./text";
import { patchComfyWorkflow } from "./image-workflow";
import { DEFAULT_PROFILE } from "./defaults";
import type { ChatContext, ChatMessage, LlmMessage, MemoryChunk } from "./types";

const frontendSource = readFileSync(new URL("./frontend.ts", import.meta.url), "utf8");
const backendSource = readFileSync(new URL("./backend.ts", import.meta.url), "utf8");
const spindleManifest = JSON.parse(readFileSync(new URL("../spindle.json", import.meta.url), "utf8")) as { permissions: string[] };

const context: ChatContext = {
  chatId: "chat_test",
  chatName: "Test Chat",
  characterId: "char_test",
  characterName: "Yunyun",
  characterAvatarUrl: "/api/v1/characters/char_test/avatar?size=lg",
  isGroup: false,
  scope: "chat_chat_test"
};

describe("Megumin UI parity audit", () => {
  test("keeps ST tab copy, gated panels, and preset bridge wording", () => {
    const requiredLabels = [
      "Choose the core ruleset that drives all NPC behavior and world logic.",
      "Define the personality and extra toggles.",
      "Set response length, output language, and how the AI addresses you.",
      "Attach extra modules that appear at the end of every response.",
      "Control the AI's internal reasoning process before it writes.",
      "Wire up ComfyUI to auto-generate scene images during roleplay.",
      "Advanced 3-Tier Context & History Management.",
      "V7 Modules (Turn off to disable)",
      "Dialogue / Narration Ratio",
      "ComfyUI Server & Workflow",
      "Send Portraits to AI",
      "Context Allocation Dashboard",
      "Requires V6",
      "Cinematic Sounds",
      "Important:",
      "Megumin Engine Preset",
      "Megumin Image Preset",
      "id=\"ig_main_content\"",
      "id=\"npc_main_content\"",
      "id=\"mem_main_content\"",
      "id=\"dev_btn_new\"",
      "id=\"dev_btn_import\"",
      "id=\"dev_save_mode\"",
      "id=\"mem_bar_work\"",
      "id=\"mem_vault_search\"",
      "id=\"ps_btn_scan_slop\"",
      "id=\"ig_enable_card\"",
      "id=\"npc_enable_card\"",
      "id=\"mem_enable_card\""
    ];
    for (const label of requiredLabels) expect(frontendSource).toContain(label);

    const forbiddenLabels = [
      "Use Lumiverse image connections",
      "tracker is injected",
      "Scan Last Message",
      "Lumiverse quiet generation",
      "Preset-specific Main 3"
    ];
    for (const label of forbiddenLabels) expect(frontendSource).not.toContain(label);

    expect(frontendSource).not.toContain("<p>${escapeHtml(current.sub)}</p>");
    expect(frontendSource).not.toContain("--accent:${engine.color");
    expect(frontendSource).not.toContain("data-action=\"image-manual\"><span");
    expect(spindleManifest.permissions).toContain("presets");
    expect(backendSource).toContain("preset:resolve");
    expect(backendSource).toContain("preset:status");
    expect(backendSource).toContain("force_preset_id");
  });
});

describe("Megumin preset bridge", () => {
  test("discovers uploaded Lumiverse presets without seeding or mutating them", () => {
    for (const name of ["Megumin Engine", "Megumin Image", "Megumin Suite V7 DS4", "Megumin Suite V7 Gemini"]) {
      expect(backendSource).toContain(name);
    }

    expect(backendSource).not.toContain("MEGUMIN_PRESET_SEEDS");
    expect(backendSource).not.toContain("convertStPromptToBlock");
    expect(backendSource).not.toContain("presets.create");
    expect(backendSource).not.toContain("presets.update");
    expect(backendSource).not.toContain("presets.delete");
    expect(backendSource).not.toContain("blocks.create");
    expect(backendSource).not.toContain("blocks.delete");
    expect(backendSource).toContain("suiteDs4PresetId");
    expect(backendSource).toContain("suiteGeminiPresetId");
    expect(spindleManifest.permissions).toContain("presets");
    expect(backendSource).toContain("___PS_STORY_PLAN___");
    expect(backendSource).toContain("___PS_IMAGE_GEN___");
    expect(backendSource).toContain("___PS_MEMORY_SUMMARIZE___");
  });
});

describe("Megumin ST function coverage audit", () => {
  test("keeps Lumiverse equivalents for the major original render and backend flows", () => {
    const frontendMappings = [
      "function renderEngines",
      "function renderPersona",
      "function renderStyle",
      "function renderGlobalSettings",
      "function renderBlocks",
      "function renderThinking",
      "function renderStory",
      "function renderBanList",
      "function renderImage",
      "function renderNpc",
      "function renderMemory",
      "function renderDev"
    ];
    for (const marker of frontendMappings) expect(frontendSource).toContain(marker);

    const backendMappings = [
      "buildPromptMessages",
      "story:generate",
      "banlist:analyze",
      "memory:process",
      "npc:scan",
      "image:manual",
      "engine:save",
      "preset:status"
    ];
    for (const marker of backendMappings) expect(backendSource).toContain(marker);
  });
});

describe("Megumin prompt assembly", () => {
  test("coerces numeric UI values before prompt assembly", () => {
    const profile = mergeProfile({ userWordCount: 400, userLanguage: "French", customThinkEffort: 250 });
    const result = buildPromptMessages([{ role: "system", content: "[[count]]\n[[Language]]" }], [], profile, [], context);
    const joined = result.messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n");

    expect(profile.userWordCount).toBe("400");
    expect(profile.customThinkEffort).toBe("250");
    expect(joined).toContain("maximum 400 words");
    expect(joined).toContain("FRENCH");
    expect(joined).not.toContain("[[count]]");
  });

  test("replaces uploaded preset placeholders and prunes archived prompt turns", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.memoryCore.enabled = true;
    profile.memoryCore.shortTermChunks = [
      {
        id: "m0",
        startIndex: 0,
        endIndex: 0,
        summary: "The northern bridge collapsed during the ashfall.",
        timestamp: 1700000000000
      }
    ];
    profile.memoryCore.longTermVault = [
      {
        id: "m1",
        startIndex: 1,
        endIndex: 1,
        text: "The ruby key unlocks the archive shrine beneath the guild hall.",
        timestamp: 1700000000001
      }
    ];

    const chatMessages: ChatMessage[] = [
      { id: "0", role: "user", content: "The party crossed the northern bridge while ash fell for hours." },
      { id: "1", role: "assistant", content: "The keeper revealed that the ruby key unlocks the archive shrine beneath the guild hall." },
      { id: "2", role: "user", content: "We should use the ruby key now." }
    ];
    const incoming: LlmMessage[] = [
      { role: "system", content: "[[prompt1]]\n[[long-Memory]]\n[[Short-memory]]\n[[npc_dossier2]]" },
      ...chatMessages.map((message) => ({ role: message.role, content: message.content }))
    ];

    const result = buildPromptMessages(incoming, chatMessages, profile, [], context);
    const joined = result.messages.map((message) => typeof message.content === "string" ? message.content : "").join("\n");

    expect(result.prunedCount).toBe(2);
    expect(joined).toContain("<system_config>");
    expect(joined).toContain("LONG-TERM MEMORY VAULT");
    expect(joined).toContain("ruby key unlocks the archive shrine");
    expect(joined).not.toContain("[[long-Memory]]");
    expect(result.messages.some((message) => message.content === chatMessages[0].content)).toBe(false);
    expect(result.breakdown.some((entry) => entry.name?.includes("Placeholder Injection"))).toBe(true);
  });
});

describe("Megumin memory retrieval", () => {
  test("ranks TF-IDF chunks by current scene keywords", () => {
    const vault: MemoryChunk[] = [
      { id: "guild", startIndex: 0, endIndex: 1, text: "Ruby key archive shrine guild hall secret lock.", timestamp: 1 },
      { id: "weather", startIndex: 2, endIndex: 3, text: "Rainstorm market stalls lanterns and muddy boots.", timestamp: 2 },
      { id: "camp", startIndex: 4, endIndex: 5, text: "Campfire stew blankets and quiet road songs.", timestamp: 3 }
    ];

    const [best] = relevantChunks(vault, "The party studies the ruby key beside the archive shrine.", 1);

    expect(best.id).toBe("guild");
  });
});

describe("Megumin NPC parsing", () => {
  test("extracts assistant NPC dossier blocks into structured records", () => {
    const [npc] = extractNpcBlocks(`
<details>
<summary>New NPC: Arue</summary>
**Name:** Arue | **Age:** 16 | **Sex:** Female
**Appearance:** Crimson eyes, black mantle, dramatic pose.
**Occupation:** Student novelist
**Background:** She writes disaster romances in secret.
**Inner Circle:**
* Megumin - rival and friend
**Personality Snapshot:** Grandiose but sincere.
**Current Agenda:** Finish her manuscript.
**Hidden Layer:** She fears nobody reads her drafts.
</details>`);

    expect(npc.name).toBe("Arue");
    expect(npc.age).toBe("16");
    expect(npc.appearance).toContain("Crimson eyes");
    expect(npc.agenda).toContain("manuscript");
  });
});

describe("Megumin image workflow patching", () => {
  test("patches ComfyUI mapped fields without mutating the stored template", () => {
    const profile = clone(DEFAULT_PROFILE);
    profile.imageGen.customNegative = "low quality";
    profile.imageGen.imgWidth = 832;
    profile.imageGen.imgHeight = 1216;
    profile.imageGen.steps = 24;
    profile.imageGen.cfg = 6.5;
    profile.imageGen.selectedSampler = "euler";
    profile.imageGen.customSeed = 1234;

    const connection = {
      metadata: {
        comfyui: {
          workflow_api_json: {
            "6": { inputs: { text: "old positive" } },
            "7": { inputs: { text: "old negative" } },
            "8": { inputs: { width: 512, height: 512, seed: 0 } }
          },
          field_mappings: [
            { nodeId: "6", fieldName: "text", mappedAs: "positive_prompt" },
            { nodeId: "7", fieldName: "text", mappedAs: "negative_prompt" },
            { nodeId: "8", fieldName: "width", mappedAs: "width" },
            { nodeId: "8", fieldName: "height", mappedAs: "height" },
            { nodeId: "8", fieldName: "seed", mappedAs: "seed" }
          ]
        }
      }
    };

    const patched = patchComfyWorkflow(connection, profile, "Megumin casting explosion") as any;

    expect(patched["6"].inputs.text).toBe("Megumin casting explosion");
    expect(patched["7"].inputs.text).toBe("low quality");
    expect(patched["8"].inputs.width).toBe(832);
    expect(patched["8"].inputs.height).toBe(1216);
    expect(patched["8"].inputs.seed).toBe(1234);
    expect(connection.metadata.comfyui.workflow_api_json["6"].inputs.text).toBe("old positive");
  });
});

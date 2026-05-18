/* eslint-disable no-undef */
import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, generateQuietPrompt, event_types, eventSource, substituteParams, saveChat, reloadCurrentChat, addOneMessage, getRequestHeaders, appendMediaToMessage } from "../../../../script.js";
import { saveBase64AsFile } from "../../../utils.js";
import { humanizedDateTime } from "../../../RossAscends-mods.js";
import { Popup, POPUP_TYPE } from "../../../popup.js";
import { hardcodedLogic } from "./data/database.js";
import { KAZUMA_PLACEHOLDERS, RESOLUTIONS } from "./data/image_data.js";

const extensionName = "Megumin-Suite";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const TARGET_PRESET_NAME = "Megumin Engine";

// -------------------------------------------------------------
// STATE MANAGEMENT
// -------------------------------------------------------------
let currentTab = 0;
let localProfile = {};
let activeGenerationOrder = null;
let currentQueryVector = null;
let lastPromptPreviewTime = 0;
let activeMemorySummarizationRequest = null;
let activeBanListChat = null;
let activeImageGenRequest = null;
let activeStoryPlanRequest = null;
let activeNpcImages = [];
let isDevEngineDirty = false;

function getCharacterKey() {
    const context = getContext();
    if (context.groupId !== undefined && context.groupId !== null) { return `group_${context.groupId}`; }
    if (context.characterId !== undefined && context.characterId !== null && context.characters[context.characterId]) { return context.characters[context.characterId].avatar; }
    return null;
}

function cleanGhostProfiles() {
    if (!extension_settings[extensionName] || !extension_settings[extensionName].profiles) return;

    const context = getContext();
    if (!context.characters || context.characters.length === 0) {
        return;
    }
    // Get all valid avatars and group IDs currently in SillyTavern
    const activeAvatars = Object.values(context.characters || {}).map(c => c.avatar);
    const activeGroups = (context.groups || []).map(g => `group_${g.id}`);
    const validKeys = ["default", ...activeAvatars, ...activeGroups];

    let deletedCount = 0;
    Object.keys(extension_settings[extensionName].profiles).forEach(key => {
        if (!validKeys.includes(key)) {
            delete extension_settings[extensionName].profiles[key];
            deletedCount++;
        }
    });

    if (deletedCount > 0) {
        saveSettingsDebounced();
        console.log(`[Megumin Suite] Garbage Collection: Cleaned up ${deletedCount} ghost profiles.`);
    }
}


function initProfile() {
    const key = getCharacterKey();
    const context = getContext();
    const isGroup = context.groupId !== undefined && context.groupId !== null;

    if (!extension_settings[extensionName]) extension_settings[extensionName] = { profiles: {} };
    if (!extension_settings[extensionName].profiles) extension_settings[extensionName].profiles = {};
    if (!extension_settings[extensionName].customModes) {
        extension_settings[extensionName].customModes = [];
    }

    const defaults = {
        mode: "balance",
        personality: "engine",
        toggles: { ooc: false, control: false },
        disableUtilityPrefill: false,
        aiTags: [],
        aiGeneratedOptions: [],
        aiRule: "",
        customStyles: [],
        activeStyleId: null,
        dnRatio: {
            enabled: false,
            dialogue: 50
        },
        onomatopoeia: {
            enabled: false,
            useStyling: false
        },
        addons: [],
        blocks: [],
        model: "cot-v1-english",
        userNotes: "",
        userWordCount: "",
        userLanguage: "",
        userPronouns: "off",
        devOverrides: {},
        banList: [],
        banListBackend: "direct",
        customModes: [],
        thinkEffort: "unspecified",
        customThinkEffort: "100",
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
            selectedModel: "",
            selectedLora: "", selectedLora2: "", selectedLora3: "", selectedLora4: "",
            selectedLoraWt: 1.0, selectedLoraWt2: 1.0, selectedLoraWt3: 1.0, selectedLoraWt4: 1.0,
            imgWidth: 1024, imgHeight: 1024,
            customNegative: "bad quality, blurry, worst quality, low quality",
            customSeed: -1,
            selectedSampler: "euler",
            compressImages: true,
            steps: 20, cfg: 7.0, denoise: 0.5, clipSkip: 1,
            promptStyle: "standard",
            promptPerspective: "scene",
            promptExtra: "",
            triggerMode: "always",
            autoGenFreq: 1,
            previewPrompt: false,
            savedWorkflowStates: {}
        },
        memoryCore: {
            enabled: false,
            architecture: "raw_short_long", // "raw_short_long" or "raw_long"
            workingLimit: 30,
            shortTermLimit: 70,
            backend: "direct",
            scannerEngine: "tfidf",
            triggerMode: "frequency",
            autoFreq: 10,
            shortTermChunks: [],
            longTermVault: []
        },
        npcBank: {
            enabled: false,
            npcs: []
        }
    };


    if (!extension_settings[extensionName].profiles["default"]) {
        extension_settings[extensionName].profiles["default"] = JSON.parse(JSON.stringify(defaults));
    }

    if (key && extension_settings[extensionName].profiles[key]) {
        localProfile = extension_settings[extensionName].profiles[key];
        if (isGroup) {
            $("#ps_rule_status_main").css({ "color": "#3b82f6", "text-shadow": "0 0 10px rgba(59,130,246,0.5)" }).text(`CUSTOM GROUP PROFILE`);
        } else {
            $("#ps_rule_status_main").css({ "color": "#10b981", "text-shadow": "0 0 10px rgba(16,185,129,0.5)" }).text(`CUSTOM CHARACTER PROFILE`);
        }
    } else {
        localProfile = JSON.parse(JSON.stringify(extension_settings[extensionName].profiles["default"]));
        if (key) {
            $("#ps_rule_status_main").css({ "color": "#f59e0b", "text-shadow": "0 0 10px rgba(245,158,11,0.5)" }).text(`USING SYSTEM DEFAULT`);
        } else {
            $("#ps_rule_status_main").css({ "color": "#a855f7", "text-shadow": "0 0 10px rgba(168,85,247,0.5)" }).text(`MODIFYING GLOBAL DEFAULT`);
        }
    }

    // PATCH missing keys
    Object.keys(defaults).forEach(k => {
        if (localProfile[k] === undefined) localProfile[k] = defaults[k];
    });
    if (!localProfile.toggles) localProfile.toggles = defaults.toggles;
    if (!localProfile.imageGen) localProfile.imageGen = defaults.imageGen;
    if (!localProfile.storyPlan) localProfile.storyPlan = defaults.storyPlan;
    if (!localProfile.memoryCore) localProfile.memoryCore = defaults.memoryCore;
    if (!localProfile.dnRatio) localProfile.dnRatio = defaults.dnRatio;
    if (!localProfile.onomatopoeia) localProfile.onomatopoeia = defaults.onomatopoeia;
    if (localProfile.disableUtilityPrefill === undefined) localProfile.disableUtilityPrefill = false;

    if (localProfile.devOverrides && Object.keys(localProfile.devOverrides).length > 0) {
        localProfile.devOverrides = {};
        saveSettingsDebounced();
    }

    let displayName = "Global Default";
    if (isGroup) {
        if (context.groups && Array.isArray(context.groups)) {
            const group = context.groups.find(g => String(g.id) === String(context.groupId));
            if (group && group.name) displayName = group.name;
            else displayName = `Group Chat (${context.groupId})`;
        } else { displayName = "Group Chat"; }
    } else if (key && context.characterId !== undefined && context.characters[context.characterId]) {
        displayName = context.characters[context.characterId].name;
    }

    $("#ps_char_rule_label").text(displayName);
    toggleQuickGenButton();
    updateLiveTokenCount();
}

function saveProfileToMemory() {
    const key = getCharacterKey() || "default";
    const ruleBox = $("#ps_main_current_rule");
    if (ruleBox.length > 0) { localProfile.aiRule = ruleBox.val(); }
    extension_settings[extensionName].profiles[key] = localProfile;
    saveSettingsDebounced();

    updateLiveTokenCount(); // NEW: Update the UI whenever settings are saved!

    const saveInd = $("#ps_save_indicator");
    if (saveInd.length) {
        saveInd.html(`<i class="fa-solid fa-check"></i> Saved`).fadeIn(150);
        clearTimeout(window.psSaveTimer);
        window.psSaveTimer = setTimeout(() => saveInd.fadeOut(400), 2000);
    }
}

// NEW: Function to calculate and update the token UI with a Hover Breakdown
function updateLiveTokenCount() {
    const counterBadge = $("#ps_live_token_count");
    if (!counterBadge.length) return;

    const dict = buildBaseDict();

    let engineStr = "";
    let cotStr = "";
    let styleStr = "";
    let addonsStr = "";

    Object.entries(dict).forEach(([key, value]) => {
        if (!value) return;
        // Skip the single-bracket aliases to prevent double counting
        if (key.match(/^\[prompt[1-6]\]$/)) return;

        // SKIP MEMORY CORE BLOCKS from the Token Counter
        if (key === "[[long-Memory]]" || key === "[[Short-memory]]") return;

        // Categorize the text
        if (key.includes("prompt") || key.includes("main") || key.includes("AI")) {
            engineStr += value + " ";
        } else if (key.includes("COT") || key.includes("prefill") || key.includes("THINK")) {
            cotStr += value + " ";
        } else if (key.includes("aiprompt") || key.includes("Language") || key.includes("pronouns") || key.includes("count") || key.includes("DNRATIO")) {
            styleStr += value + " ";
        } else {
            addonsStr += value + " ";
        }
    });

    // Estimate tokens (4.0 chars per token is the standard English NLP ratio)
    const estEngine = Math.ceil(engineStr.replace(/\s+/g, ' ').length / 4.0);
    const estCot = Math.ceil(cotStr.replace(/\s+/g, ' ').length / 4.0);
    const estStyle = Math.ceil(styleStr.replace(/\s+/g, ' ').length / 4.0);
    const estAddons = Math.ceil(addonsStr.replace(/\s+/g, ' ').length / 4.0);

    const total = estEngine + estCot + estStyle + estAddons;

    // Update the UI text
    counterBadge.html(`<i class="fa-solid fa-microchip"></i> ~${total}`);

    // Build the Hover Breakdown HTML
    const breakdownHTML = `
        <div style="text-align:left; min-width: 160px; font-family: 'Inter', sans-serif;">
            <div style="border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 6px; margin-bottom: 6px; color: var(--gold); font-size: 0.8rem;"><b>Payload Breakdown</b></div>
            <div style="display:flex; justify-content:space-between; font-size: 0.75rem; margin-bottom: 4px;"><span>Engine Core:</span> <span style="color:#10b981; font-weight:bold;">~${estEngine}</span></div>
            <div style="display:flex; justify-content:space-between; font-size: 0.75rem; margin-bottom: 4px;"><span>CoT / Logic:</span> <span style="color:#3b82f6; font-weight:bold;">~${estCot}</span></div>
            <div style="display:flex; justify-content:space-between; font-size: 0.75rem; margin-bottom: 4px;"><span>Writing Style:</span> <span style="color:#a855f7; font-weight:bold;">~${estStyle}</span></div>
            <div style="display:flex; justify-content:space-between; font-size: 0.75rem;"><span>Add-ons/Blocks:</span> <span style="color:#ef4444; font-weight:bold;">~${estAddons}</span></div>
        </div>
    `;

    // Attach it to the badge
    counterBadge.attr("data-breakdown", breakdownHTML);
    counterBadge.css("cursor", "help");

    // Flash green to show it updated
    counterBadge.css("color", "#10b981");
    setTimeout(() => {
        counterBadge.css("color", "var(--text-muted)");
    }, 400);
}

let defaultImageCount = 0;

async function discoverDefaultImages() {
    if (defaultImageCount > 0) return;
    let count = 0;
    for (let i = 1; i <= 20; i++) {
        try {
            const res = await fetch(`${extensionFolderPath}/img/default${i}.png`, { method: 'HEAD' });
            if (res.ok) count = i;
            else break;
        } catch { break; }
    }
    defaultImageCount = count;
}

function getRandomDefaultImage() {
    if (defaultImageCount <= 0) return `${extensionFolderPath}/img/default.png`;
    const pick = Math.floor(Math.random() * defaultImageCount) + 1;
    return `${extensionFolderPath}/img/default${pick}.png`;
}

function updateCharacterDisplay() {
    const context = getContext();
    const bannerElement = $("#ps_hero_banner");
    let imgUrl = getRandomDefaultImage();

    if (context.groupId !== undefined && context.groupId !== null) {
        imgUrl = `${extensionFolderPath}/img/group.png`;
    } else if (context.characterId !== undefined && context.characterId !== null && context.characters[context.characterId]) {
        imgUrl = `/characters/${context.characters[context.characterId].avatar}`;
    }

    // Set the full-width background image smoothly
    bannerElement.css("background-image", `url('${imgUrl}')`);
}

function cleanAIOutput(text) {
    if (!text) return "";
    const re = new RegExp("(<disclaimer>.*?</disclaimer>)|(<guifan>.*?</guifan>)|(<danmu>.*?</danmu>)|(<options>.*?</options>)|```start|```end|<done>|`<done>`|(.*?</think(ing)?>(\\n)?)|(<think(ing)?>[\\s\\S]*?</think(ing)?>(\\n)?)", "gs");
    return text.replace(re, "").trim();
}

// MASTER CHAT CLEANER: Removes Megumin UI blocks, thoughts, and raw HTML from chat text.
function meguminCleanChatHistoryText(text) {
    if (!text) return "";
    let cleaned = text;

    // 1. Remove Specific Megumin Suite Blocks (Inner Chatter, World State, CYOA, NPC Dossiers)
    cleaned = cleaned.replace(/<details>\s*<summary>.*?💭.*?<b>NPC Inner Chatter<\/b><\/summary>\s*([\s\S]*?)\s*<\/details>/gi, "");
    cleaned = cleaned.replace(/<details>\s*<summary>.*?📌.*?<b>World State<\/b><\/summary>\s*([\s\S]*?)\s*<\/details>/gi, "");
    cleaned = cleaned.replace(/<details>\s*<summary>.*?🆕.*?<b>New NPC:.*?<\/b><\/summary>\s*([\s\S]*?)\s*<\/details>/gi, ""); // <-- NEW
    cleaned = cleaned.replace(/<div style="border: 1px solid #444;[\s\S]*?<\/div>/gi, "");

    // 2. Remove AI reasoning and artifacts (think, disclaimer, options, start/end)
    const badStuffRegex = /(<disclaimer>.*?<\/disclaimer>)|(<guifan>.*?<\/guifan>)|(<danmu>.*?<\/danmu>)|(<options>.*?<\/options>)|```start|```end|<done>|`<done>`|(.*?<\/(?:ksc??|think(?:ing)?)>(\n)?)|(<(?:ksc??|think(?:ing)?)>[\s\S]*?<\/(?:ksc??|think(?:ing)?)>(\n)?)/gs;
    cleaned = cleaned.replace(badStuffRegex, "");

    // 3. Remove leftover standard details/summary tags & HTML
    cleaned = cleaned.replace(/<details>[\s\S]*?<\/details>/gi, "");
    cleaned = cleaned.replace(/<summary>[\s\S]*?<\/summary>/gi, "");
    cleaned = cleaned.replace(/<[^>]*>?/gm, "");

    return cleaned.trim();
}

// -------------------------------------------------------------
// UI TAB RENDERER (Toolbox System)
// -------------------------------------------------------------
const tabsUI = [
    { title: "Core Engine", sub: "Choose the core ruleset that drives all NPC behavior and world logic.", icon: "fa-server", render: renderMode },
    { title: "Persona & Toggles", sub: "Define the personality and extra toggles.", icon: "fa-user-astronaut", render: renderPersonality },
    { title: "Writing Style", sub: "Apply a prebuilt style, generate one with AI, or build your own.", icon: "fa-pen-nib", render: renderStyleLibrary },
    { title: "Global Settings", sub: "Set response length, output language, and how the AI addresses you.", icon: "fa-earth-americas", render: renderAddons },
    { title: "Add-ons & Blocks", sub: "Attach extra modules that appear at the end of every response.", icon: "fa-puzzle-piece", render: renderBlocks },
    { title: "Chain of Thought", sub: "Control the AI's internal reasoning process before it writes.", icon: "fa-brain", render: renderModels },
    { title: "Story Planner", sub: "Generate and track future plot developments.", icon: "fa-map", render: renderStoryPlanner },
    { title: "Dynamic Ban List", sub: "Scan and ban repetitive AI phrases.", icon: "fa-ban", render: renderBanList },
    { title: "Image Generation", sub: "Wire up ComfyUI to auto-generate scene images during roleplay.", icon: "fa-image", render: renderImageGen },
    { title: "NPCs Bank", sub: "Automatically extract and track significant NPCs in the story.", icon: "fa-address-book", render: renderNpcBank },
    { title: "Memory Core", sub: "Advanced 3-Tier Context & History Management.", icon: "fa-memory", render: renderMemoryCore }
];

function switchTab(index) {
    $(".dock").show();
    $("#ps_btn_save_close").show();

    // Hide Apply All on Tab 3 (Writing Style)
    if (index === 2) { $("#btn_apply_tab_all").hide(); }
    else { $("#btn_apply_tab_all").show(); }

    $("#ps_btn_dev_mode").html(`<i class="fa-solid fa-code"></i> Dev`).css("color", "#a855f7");

    let isSameTab = (currentTab === index);
    const container = $("#ps_stage_content");
    let savedScroll = 0;
    if (isSameTab && container.length) {
        savedScroll = container.scrollTop() || 0;
    }

    currentTab = index;
    const tab = tabsUI[index];

    // Generate Icons
    const dotsContainer = $("#ps_dynamic_dots");
    if (dotsContainer.children(".dock-icon").length < tabsUI.length) {
        dotsContainer.empty();
        tabsUI.forEach((t, i) => {
            dotsContainer.append(`<div class="dock-icon sidebar-step" id="dot_${i}" title="${t.title}">
                <i class="fa-solid ${t.icon}"></i> <span>${t.title}</span>
            </div>`);
        });
    }

    $(".dock-icon").removeClass("active");
    $(`#dot_${index}`).addClass("active");

    container.empty();
    container.off(".devDirty");

    tab.render(container);

    if (isSameTab) {
        container.scrollTop(savedScroll);
    } else {
        container.scrollTop(0);
    }

    updateLiveTokenCount();
}

function applyTabToAll() {
    const tabKeys = {
        0: ["mode"],
        1: ["personality", "toggles"],
        2: ["activeStyleId", "aiRule", "customStyles", "dnRatio"],
        3: ["userWordCount", "userLanguage", "userPronouns", "disableUtilityPrefill", "onomatopoeia"],
        4: ["addons", "blocks"],
        5: ["model"],
        6: ["storyPlan"],
        7: ["banList"],
        8: ["imageGen"],
        9: ["memoryCore"]
    };

    const keysToSync = tabKeys[currentTab];
    if (confirm(`Apply ${tabsUI[currentTab].title} settings to ALL characters, groups, and defaults?`)) {
        const currentData = localProfile;
        Object.keys(extension_settings[extensionName].profiles).forEach(profKey => {
            const prof = extension_settings[extensionName].profiles[profKey];
            keysToSync.forEach(k => {
                prof[k] = JSON.parse(JSON.stringify(currentData[k]));
            });
        });
        saveSettingsDebounced();
        toastr.success(`Synced ${tabsUI[currentTab].title} across all profiles!`);
    }
}

function renderMode(c) {
    const descriptions = {
        "balance": "The original Secret Sauce. NPCs react naturally — no simping, no needless hostility.",
        "balance Test": "New and improved balance mode that aims to use less tokens and more creativity.",
        "cinematic": "Hollywood-inspired storytelling. Dramatic beats and heightened tension.",
        "dark": "Balance but harsher. The world is unforgiving and consequences hit harder.",
        "v6-anime-director": "Advanced cinematic framing and pacing. Designed to emulate high-budget anime direction.",
        "v6-dream-team": "The ultimate 6-specialist writer room. Unprecedented narrative consistency and realism.",
        "v6-dream-team-lite": "A streamlined version of the Dream Team. Faster generation with lower token overhead.",
        "v7-core": "The V7 Core engine. The perfect middle ground: cinematic pacing, realistic friction, and relentless world progression.",
        "v7-reality": "The V7 Reality engine. Grounded, unrelenting simulation with zero narrative protection.",
        "v7-gentle": "The V7 Gentle engine. A softer, For pussies."
    };

    // Active engine name
    const activeEng = hardcodedLogic.modes.find(m => m.id === localProfile.mode);
    const activeLabel = activeEng ? activeEng.label : localProfile.mode;

    // Count by version
    let v4Count = 0, v5Count = 0, v6Count = 0, v7Count = 0;
    hardcodedLogic.modes.forEach(m => {
        if (m.label.includes("V4")) v4Count++;
        else if (m.label.includes("V5")) v5Count++;
        else if (m.id.includes("v6")) v6Count++;
        else if (m.id.includes("v7")) v7Count++;
    });
    const totalCount = hardcodedLogic.modes.length;

    // ── HEADER ──
    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #f59e0b, #d97706);">
                    <i class="fa-solid fa-microchip"></i>
                </div>
                <div>
                    <h2>Core Engines</h2>
                    <p>Choose the narrative engine that drives your AI's behavior.</p>
                </div>
            </div>
            <div class="mtab-header-badge" style="background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.25);">
                <i class="fa-solid fa-circle-check" style="font-size:0.6rem;"></i> ${activeLabel}
            </div>
        </div>
    `);

    // ── FILTER PILLS ──
    const filterBar = $(`
        <div class="wstyle-filters" style="margin-bottom: 20px;">
            <button class="wstyle-filter-pill active" data-filter="all">All <span class="pill-count">${totalCount}</span></button>
            <button class="wstyle-filter-pill" data-filter="V4">V4 <span class="pill-count">${v4Count}</span></button>
            <button class="wstyle-filter-pill" data-filter="V5">V5 <span class="pill-count">${v5Count}</span></button>
            <button class="wstyle-filter-pill" data-filter="V6"><i class="fa-solid fa-lock" style="font-size:0.6rem;"></i> V6 <span class="pill-count">${v6Count}</span></button>
            <button class="wstyle-filter-pill" data-filter="V7">V7 <span class="pill-count">${v7Count}</span></button>
        </div>
    `);
    c.append(filterBar);

    // ── ENGINE CARDS ──
    const coreGrid = $(`<div class="mtab-card-grid" style="margin-bottom: 20px;"></div>`);
    const v6Empty = $(`<div id="v6-empty-msg" style="display:none;"><div class="mtab-locked-state"><i class="fa-solid fa-hammer" style="color: var(--border-color);"></i><h3>V6 Engines are in the forge.</h3><p>Stay tuned for the next update! Later this week.</p></div></div>`);

    hardcodedLogic.modes.forEach(m => {
        let version = "all";
        if (m.label.includes("V4")) version = "V4";
        else if (m.label.includes("V5")) version = "V5";
        else if (m.id.includes("v6")) version = "V6";
        else if (m.id.includes("v7")) version = "V7";

        const isLocked = m.locked === true;
        const isSel = localProfile.mode === m.id;

        let badges = '';
        if (m.recommended) badges += `<span class="ecard-badge rec"><i class="fa-solid fa-star"></i> Recommended</span>`;
        if (m.isNew && !isLocked) badges += `<span class="ecard-badge new">New</span>`;
        if (isLocked) badges += `<span class="ecard-badge locked"><i class="fa-solid fa-lock"></i> Coming Soon</span>`;

        const card = $(`
            <div class="mtab-eng-card ${isSel ? 'active' : ''} ${isLocked ? 'locked-card' : ''}" data-version="${version}">
                <div class="ecard-accent"></div>
                <div class="ecard-body">
                    <div class="ecard-title">
                        <span>${m.label}</span>
                        ${isSel ? `<span class="ecard-badge" style="background:rgba(16,185,129,0.15);color:#10b981;"><i class="fa-solid fa-check"></i> Active</span>` : ''}
                    </div>
                    <p class="ecard-desc">${descriptions[m.id] || ""}</p>
                    ${badges ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">${badges}</div>` : ''}
                </div>
            </div>
        `);

        if (!isLocked) {
            card.on("click", () => {
                localProfile.mode = m.id;

                // Specific style mapping for V7 Core, V7 Gentle vs other V7s
                if (m.id === "v7-core") {
                    localProfile.activeStyleId = "dir_v7_core";
                    const ds = hardcodedLogic.directStyles.find(x => x.id === "dir_v7_core");
                    if (ds) localProfile.aiRule = ds.rule;
                } else if (m.id === "v7-gentle") {
                    localProfile.activeStyleId = "dir_v7_gentle";
                    const ds = hardcodedLogic.directStyles.find(x => x.id === "dir_v7_gentle");
                    if (ds) localProfile.aiRule = ds.rule;
                } else if (m.id.startsWith("v7")) { // Catch-all for Reality and others
                    localProfile.activeStyleId = "dir_v7";
                    const ds = hardcodedLogic.directStyles.find(x => x.id === "dir_v7");
                    if (ds) localProfile.aiRule = ds.rule;
                }

                saveProfileToMemory();
                switchTab(currentTab);
            });
        }
        coreGrid.append(card);
    });

    c.append(coreGrid);
    c.append(v6Empty);

    // ── FILTER LOGIC ──
    filterBar.find('.wstyle-filter-pill').on('click', function () {
        filterBar.find('.wstyle-filter-pill').removeClass('active');
        $(this).addClass('active');
        const filter = $(this).attr('data-filter');
        if (filter === "all") {
            coreGrid.show(); coreGrid.find('.mtab-eng-card').show(); v6Empty.hide();
        } else {
            coreGrid.find('.mtab-eng-card').each(function () {
                if ($(this).attr('data-version') === filter) $(this).show(); else $(this).hide();
            });
            coreGrid.show();
            if (filter === "V6") v6Empty.show(); else v6Empty.hide();
        }
    });

    // V7 Modules Toggles
    if (localProfile.mode.startsWith("v7")) {
        c.append(`<div class="wstyle-section-head blue" style="margin-top: 15px;"><i class="fa-solid fa-layer-group"></i> V7 Modules (Turn off to disable)</div>`);
        const v7ToggleList = $(`<div class="mtab-card-list"></div>`);
        const v7Toggles = [
            { id: "v7_ooc", label: "OOC Protocol", desc: "Allows out-of-character directives." },
            { id: "v7_pcsolo", label: "PC Solo Physicality", desc: "Narration of PC when unobserved." },
            { id: "v7_intro", label: "Introduction Protocol", desc: "How new NPCs enter the story." },
            { id: "v7_culture", label: "Cultural Anchoring", desc: "Real-world integration and references." },
            { id: "v7_scene", label: "Scene Choreography", desc: "Focus shifting and crowd management." }
        ];

        v7Toggles.forEach(tog => {
            if (localProfile.toggles[tog.id] === undefined) localProfile.toggles[tog.id] = true;
            const isOn = localProfile.toggles[tog.id];

            const tCard = $(`
                <div class="mtab-toggle-row ${isOn ? 'active' : ''}">
                    <div class="toggle-info">
                        <div class="toggle-label">${tog.label}</div>
                        <div class="toggle-desc">${tog.desc}</div>
                    </div>
                    <div class="ps-switch"></div>
                </div>
            `);
            tCard.on("click", () => { localProfile.toggles[tog.id] = !localProfile.toggles[tog.id]; saveProfileToMemory(); switchTab(currentTab); });
            v7ToggleList.append(tCard);
        });
        c.append(v7ToggleList);
    }

    // ── CUSTOM ENGINES ──
    const customModes = extension_settings[extensionName].customModes || [];
    if (customModes.length > 0) {
        c.append(`<div class="wstyle-section-head green" style="margin-top:12px;"><i class="fa-solid fa-puzzle-piece"></i> Custom User Engines</div>`);
        const customGrid = $(`<div class="mtab-card-grid"></div>`);
        customModes.forEach(m => {
            const isSel = localProfile.mode === m.id;
            const card = $(`
                <div class="mtab-eng-card ${isSel ? 'active' : ''}">
                    <div class="ecard-accent"></div>
                    <div class="ecard-body">
                        <div class="ecard-title">
                            <span>${m.label}</span>
                            <button class="ps-modern-btn secondary btn-quick-edit" style="padding:4px 10px;font-size:0.7rem;color:var(--gold);border-color:rgba(245,158,11,0.3);background:transparent;">
                                <i class="fa-solid fa-pen"></i> Edit
                            </button>
                        </div>
                        <p class="ecard-desc">Custom Engine Flow</p>
                    </div>
                </div>
            `);
            card.on("click", (e) => {
                if ($(e.target).closest('.btn-quick-edit').length) return;
                localProfile.mode = m.id; saveProfileToMemory(); switchTab(currentTab);
            });
            card.find(".btn-quick-edit").on("click", () => renderDevMode("editor", m.id, null, "tab"));
            customGrid.append(card);
        });
        c.append(customGrid);
    }
}

function renderPersonality(c) {
    const isV6DreamTeam = localProfile.mode.includes("v6-dream-team");
    const isV7 = localProfile.mode.startsWith("v7");
    const isLockedPersona = isV6DreamTeam || isV7;

    // ── HEADER ──
    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #ec4899, #be185d);">
                    <i class="fa-solid fa-masks-theater"></i>
                </div>
                <div>
                    <h2>Persona & Toggles</h2>
                    <p>Set the narrator's voice and fine‑tune engine behavior.</p>
                </div>
            </div>
            <div class="mtab-header-badge" style="background: rgba(236,72,153,0.12); color: #ec4899; border: 1px solid rgba(236,72,153,0.25);">
                <i class="fa-solid fa-user" style="font-size:0.6rem;"></i> ${isLockedPersona ? 'Locked' : localProfile.personality}
            </div>
        </div>
    `);

    if (isV6DreamTeam) {
        c.append(`
            <div class="mtab-locked-state">
                <i class="fa-solid fa-user-lock" style="color: #a855f7;"></i>
                <h3>Persona Selection Locked</h3>
                <p>The V6 Dream Team engine utilizes an intrinsic 6-specialist framework. Standard persona injections are disabled to prevent logic conflicts.</p>
            </div>
        `);
    } else if (isV7) {
        c.append(`
            <div class="mtab-locked-state">
                <i class="fa-solid fa-user-lock" style="color: #3b82f6;"></i>
                <h3>Persona Selection Locked</h3>
                <p>The V7 engine utilizes a pure narrative framework. Standard persona injections are disabled to prevent logic conflicts.</p>
            </div>
        `);
    } else {
        const descriptions = {
            "megumin": "A rebellious, dominant voice. Adds an edge of arrogance and chaos to the narration. Best for energetic or confrontational stories.",
            "director": "Professional narrator. Clean, authoritative story direction with cinematic awareness.",
            "Nora": "Nora should i say more.",
            "engine": "No personality overlay at all. The engine speaks in its purest form — precise, neutral, and fully under your control. Recommended for most setups."
        };

        c.append(`<div class="wstyle-section-head purple"><i class="fa-solid fa-masks-theater"></i> Select Persona</div>`);
        const grid = $(`<div class="mtab-card-grid" style="margin-bottom: 24px;"></div>`);
        hardcodedLogic.personalities.forEach(p => {
            const isSel = localProfile.personality === p.id;
            let badges = '';
            if (p.recommended) badges = `<span class="ecard-badge rec"><i class="fa-solid fa-star"></i> Recommended</span>`;

            const card = $(`
                <div class="mtab-eng-card ${isSel ? 'active' : ''}">
                    <div class="ecard-accent"></div>
                    <div class="ecard-body">
                        <div class="ecard-title">
                            <span>${p.label}</span>
                            ${isSel ? `<span class="ecard-badge" style="background:rgba(16,185,129,0.15);color:#10b981;"><i class="fa-solid fa-check"></i> Active</span>` : ''}
                        </div>
                        <p class="ecard-desc">${descriptions[p.id] || ""}</p>
                        ${badges ? `<div style="margin-top:4px;">${badges}</div>` : ''}
                    </div>
                </div>
            `);
            card.on("click", () => { localProfile.personality = p.id; saveProfileToMemory(); switchTab(currentTab); });
            grid.append(card);
        });
        c.append(grid);
    }

    // EXTRA TOGGLES (Always available)
    c.append(`<div class="wstyle-section-head gold"><i class="fa-solid fa-sliders"></i> Extra Toggles</div>`);
    const toggleList = $(`<div class="mtab-card-list"></div>`);
    Object.entries(hardcodedLogic.toggles).forEach(([key, tog]) => {
        const isOn = localProfile.toggles[key];
        const tCard = $(`
            <div class="mtab-toggle-row ${isOn ? 'active' : ''}">
                <div class="toggle-info">
                    <div class="toggle-label">${tog.label}</div>
                    ${tog.recommendedOff ? `<div class="toggle-desc"><i class="fa-solid fa-star" style="color:var(--gold);font-size:0.6rem;margin-right:4px;"></i> Off by default — most engines handle this natively</div>` : ''}
                </div>
                <div class="ps-switch"></div>
            </div>
        `);
        tCard.on("click", () => { localProfile.toggles[key] = !localProfile.toggles[key]; saveProfileToMemory(); switchTab(currentTab); });
        toggleList.append(tCard);
    });
    c.append(toggleList);
}

function renderStyleLibrary(c) {
    c.empty();
    const root = $(`<div style="display: flex; flex-direction: column;"></div>`);

    const isV7 = localProfile.mode.startsWith("v7");
    if (isV7 && !localProfile.activeStyleId) {
        let targetStyle = "dir_v7";
        if (localProfile.mode === "v7-core") targetStyle = "dir_v7_core";
        else if (localProfile.mode === "v7-gentle") targetStyle = "dir_v7_gentle";

        localProfile.activeStyleId = targetStyle;
        const ds = hardcodedLogic.directStyles.find(x => x.id === targetStyle);
        if (ds) localProfile.aiRule = ds.rule;
        saveProfileToMemory();
    }

    const isOff = !localProfile.activeStyleId;
    const customCount = (localProfile.customStyles || []).length;
    const existingNames = localProfile.customStyles ? localProfile.customStyles.map(s => s.name) : [];
    const genCount = hardcodedLogic.styleTemplates.filter(t => !existingNames.includes(t.name)).length;
    const precookedCount = hardcodedLogic.directStyles.length;

    // Find active style name
    let activeStyleName = "Off";
    if (!isOff) {
        const ds = hardcodedLogic.directStyles.find(d => d.id === localProfile.activeStyleId);
        if (ds) activeStyleName = ds.name;
        else {
            const cs = (localProfile.customStyles || []).find(s => s.id === localProfile.activeStyleId);
            if (cs) activeStyleName = cs.name;
        }
    }

    // ── HEADER ──
    root.append(`
        <div class="wstyle-header">
            <div class="wstyle-header-left">
                <div class="wstyle-header-icon"><i class="fa-solid fa-pen-nib"></i></div>
                <div>
                    <h2>Writing Style</h2>
                    <p>Apply a prebuilt style, generate one with AI, or craft your own.</p>
                </div>
            </div>
            <div class="wstyle-active-badge ${isOff ? 'off' : ''}">
                <i class="fa-solid ${isOff ? 'fa-power-off' : 'fa-circle-check'}"></i>
                ${isOff ? 'No Style Active' : activeStyleName}
            </div>
        </div>
    `);

    // ── OFF CARD ──
    const offCard = $(`
        <div class="wstyle-off-card ${isOff ? 'active' : ''}">
            <div class="off-left">
                <div class="off-icon"><i class="fa-solid fa-power-off"></i></div>
                <div>
                    <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main);">No Style (Off)</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">Let the engine decide — no extra style directives injected.</div>
                </div>
            </div>
            ${isOff ? `<span class="card-status active-status"><i class="fa-solid fa-check"></i> Active</span>` : ''}
        </div>
    `);
    offCard.on("click", () => { localProfile.activeStyleId = null; localProfile.aiRule = ""; saveProfileToMemory(); renderStyleLibrary(c); });

    if (!isV7) {
        root.append(offCard);
    } else {
        const v7LockCard = $(`
            <div class="wstyle-off-card locked-card" style="opacity: 0.7; cursor: not-allowed; border: 1px solid rgba(59,130,246,0.3);">
                <div class="off-left">
                    <div class="off-icon" style="background: rgba(59,130,246,0.2); color: #3b82f6;"><i class="fa-solid fa-lock"></i></div>
                    <div>
                        <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main);">No Style (Off) - Locked</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">V7 Engines require a narrative style directive. Defaulting to V7 Recommended.</div>
                    </div>
                </div>
            </div>
        `);
        root.append(v7LockCard);
    }

    // ── DIALOGUE / NARRATION RATIO ──
    if (!localProfile.dnRatio) localProfile.dnRatio = { enabled: false, dialogue: 50 };
    const isDNR = localProfile.dnRatio.enabled;
    const dVal = localProfile.dnRatio.dialogue;

    const dnrPanel = $(`
        <div class="wstyle-dnr-panel">
            <div class="wstyle-dnr-header" id="dnr_header_toggle">
                <div class="dnr-info">
                    <div class="dnr-icon"><i class="fa-solid fa-scale-balanced"></i></div>
                    <div>
                        <div style="font-weight: 700; font-size: 0.9rem; color: var(--text-main);">Dialogue / Narration Ratio</div>
                        <div style="font-size: 0.73rem; color: var(--text-muted);">Fine‑tune the balance between spoken dialogue and descriptive prose.</div>
                    </div>
                </div>
                <div class="ps-toggle-card ${isDNR ? 'active' : ''}" id="dnr_toggle" style="padding: 8px; min-width: 56px; justify-content: center; cursor: pointer;">
                    <div class="ps-switch"></div>
                </div>
            </div>
            <div class="wstyle-dnr-body ${isDNR ? 'open' : ''}" id="dnr_body">
                <div class="wstyle-dnr-slider-track">
                    <span class="wstyle-dnr-label narr"><span id="lbl_narr">${100 - dVal}</span>% Narration</span>
                    <input type="range" id="dnr_slider" min="0" max="100" step="10" value="${dVal}">
                    <span class="wstyle-dnr-label dial"><span id="lbl_dial">${dVal}</span>% Dialogue</span>
                </div>
                <div style="font-size: 0.7rem; color: var(--text-muted); text-align: center; margin-top: 10px; font-family: monospace; opacity: 0.7;">
                    Preview → "Maintain a balance of <span id="lbl_prev_d">${dVal}</span>% Dialogue and <span id="lbl_prev_n">${100 - dVal}</span>% Narration."
                </div>
            </div>
        </div>
    `);
    dnrPanel.find("#dnr_toggle").on("click", function (e) {
        e.stopPropagation();
        localProfile.dnRatio.enabled = !localProfile.dnRatio.enabled; saveProfileToMemory(); renderStyleLibrary(c);
    });
    dnrPanel.find("#dnr_slider").on("input", function () {
        let d = parseInt($(this).val()); let n = 100 - d;
        $("#lbl_dial, #lbl_prev_d").text(d); $("#lbl_narr, #lbl_prev_n").text(n);
    });
    dnrPanel.find("#dnr_slider").on("change", function () {
        localProfile.dnRatio.dialogue = parseInt($(this).val()); saveProfileToMemory();
    });
    root.append(dnrPanel);

    // ── FILTER PILLS ──
    const filterBar = $(`
        <div class="wstyle-filters">
            <button class="wstyle-filter-pill active" data-filter="all">All <span class="pill-count">${precookedCount + customCount + genCount}</span></button>
            <button class="wstyle-filter-pill" data-filter="precooked"><i class="fa-solid fa-fire-burner" style="font-size:0.7rem;"></i> Precooked <span class="pill-count">${precookedCount}</span></button>
            <button class="wstyle-filter-pill" data-filter="custom"><i class="fa-solid fa-book" style="font-size:0.7rem;"></i> My Library <span class="pill-count">${customCount}</span></button>
            <button class="wstyle-filter-pill" data-filter="generators"><i class="fa-solid fa-wand-magic-sparkles" style="font-size:0.7rem;"></i> AI Generators <span class="pill-count">${genCount}</span></button>
        </div>
    `);
    root.append(filterBar);

    // ── SECTIONS ──
    const secPrecooked = $(`<div class="style-section" data-section="precooked"></div>`);
    const secCustom = $(`<div class="style-section" data-section="custom"></div>`);
    const secGenerators = $(`<div class="style-section" data-section="generators"></div>`);

    // —— A. PRECOOKED STYLES ——
    secPrecooked.append(`<div class="wstyle-section-head gold"><i class="fa-solid fa-fire-burner"></i> Precooked Styles</div>`);
    const precookedGrid = $(`<div style="display: flex; flex-direction: column; gap: 10px;"></div>`);
    hardcodedLogic.directStyles.forEach(ds => {
        const isSel = localProfile.activeStyleId === ds.id;
        const card = $(`
            <div class="wstyle-card ${isSel ? 'active' : ''}">
                <div class="card-accent"></div>
                <div class="card-body">
                    <div class="card-top">
                        <div style="flex:1;">
                            <div class="card-title"><i class="fa-solid fa-bolt" style="font-size:0.7rem; color: var(--gold);"></i> ${ds.name}</div>
                            <p class="card-desc">${ds.desc}</p>
                        </div>
                        ${isSel ? `<span class="card-status active-status"><i class="fa-solid fa-check"></i> Active</span>` : ''}
                    </div>
                    <div class="card-rule">${ds.rule}</div>
                </div>
            </div>
        `);
        card.on("click", () => {
            localProfile.activeStyleId = ds.id; localProfile.aiRule = ds.rule; saveProfileToMemory(); renderStyleLibrary(c);
        });
        precookedGrid.append(card);
    });
    secPrecooked.append(precookedGrid);

    // —— B. CUSTOM STYLES (My Library) ——
    secCustom.append(`<div class="wstyle-section-head green"><i class="fa-solid fa-book"></i> My Library</div>`);
    const customGrid = $(`<div style="display: flex; flex-direction: column; gap: 10px;"></div>`);
    if (localProfile.customStyles && localProfile.customStyles.length > 0) {
        localProfile.customStyles.forEach(style => {
            const isSel = localProfile.activeStyleId === style.id;
            const card = $(`
                <div class="wstyle-card ${isSel ? 'active' : ''}">
                    <div class="card-accent"></div>
                    <div class="card-body">
                        <div class="card-top">
                            <div class="card-title">${style.name}</div>
                            ${isSel ? `<span class="card-status active-status"><i class="fa-solid fa-check"></i> Active</span>` : ''}
                        </div>
                        <div class="card-rule">${style.rule || "No rule generated yet."}</div>
                        <div class="card-actions">
                            <button class="ps-btn-edit"><i class="fa-solid fa-pen"></i> Edit</button>
                            <button class="act-regen ps-btn-regen"><i class="fa-solid fa-rotate-right"></i> Redo</button>
                            <button class="act-delete ps-btn-delete"><i class="fa-solid fa-trash-can"></i> Delete</button>
                        </div>
                    </div>
                </div>
            `);
            card.on("click", (e) => {
                if ($(e.target).closest("button").length) return;
                localProfile.activeStyleId = style.id; localProfile.aiRule = style.rule; saveProfileToMemory(); renderStyleLibrary(c);
            });
            card.find(".ps-btn-edit").on("click", () => renderStyleEditor(c, style.id));
            card.find(".ps-btn-delete").on("click", () => {
                if (confirm(`Delete "${style.name}"?`)) {
                    localProfile.customStyles = localProfile.customStyles.filter(s => s.id !== style.id);
                    if (localProfile.activeStyleId === style.id) { localProfile.activeStyleId = null; localProfile.aiRule = ""; }
                    saveProfileToMemory(); renderStyleLibrary(c);
                }
            });
            card.find(".ps-btn-regen").on("click", async function () {
                $(this).html(`<i class="fa-solid fa-spinner fa-spin"></i>`);
                await useMeguminEngine(async () => {
                    const orderText = `Inspired by ${style.notes}. Write a writing style rule based on: ${style.tags.join(", ")}. Direct instructions only. 2-3 paragraphs. No fluff.`;
                    let rule = await runMeguminTask(orderText);
                    style.rule = cleanAIOutput(rule).trim();
                    if (localProfile.activeStyleId === style.id) localProfile.aiRule = style.rule;
                    saveProfileToMemory(); renderStyleLibrary(c); toastr.success("Rule Regenerated!");
                });
            });
            customGrid.append(card);
        });
    }
    // Create new style card
    const createCard = $(`
        <div class="wstyle-create-card">
            <i class="fa-solid fa-plus"></i> Create Custom AI Style
        </div>
    `);
    createCard.on("click", () => renderStyleEditor(c, null));
    customGrid.append(createCard);
    secCustom.append(customGrid);

    // —— C. AI GENERATORS ——
    secGenerators.append(`<div class="wstyle-section-head purple"><i class="fa-solid fa-wand-magic-sparkles"></i> AI Style Generators</div>`);
    const genGrid = $(`<div style="display: flex; flex-direction: column; gap: 10px;"></div>`);
    hardcodedLogic.styleTemplates.forEach(tpl => {
        if (existingNames.includes(tpl.name)) return;
        const card = $(`
            <div class="wstyle-gen-card">
                <div class="gen-info">
                    <div class="gen-title">${tpl.name}</div>
                    <div class="gen-desc">${tpl.notes}</div>
                </div>
                <button class="wstyle-gen-btn ps-btn-tpl-gen">
                    <i class="fa-solid fa-bolt"></i> Generate
                </button>
            </div>
        `);
        card.find(".ps-btn-tpl-gen").on("click", async function () {
            const btn = $(this); btn.prop("disabled", true).html(`<i class="fa-solid fa-spinner fa-spin"></i>`);
            await useMeguminEngine(async () => {
                const orderText = `Inspired by ${tpl.notes}. Write a writing style rule based on: ${tpl.tags.join(", ")}. Direct instructions only. 2-3 paragraphs. No fluff.`;
                let rule = await runMeguminTask(orderText);
                const newId = "style_" + Date.now();
                const newStyle = { id: newId, name: tpl.name, tags: [...tpl.tags], notes: tpl.notes, rule: cleanAIOutput(rule).trim() };
                localProfile.customStyles.push(newStyle); localProfile.activeStyleId = newId; localProfile.aiRule = newStyle.rule;
                saveProfileToMemory(); renderStyleLibrary(c); toastr.success(`${tpl.name} Added!`);
            });
        });
        genGrid.append(card);
    });
    secGenerators.append(genGrid);

    root.append(secPrecooked);
    root.append(secCustom);
    root.append(secGenerators);
    c.append(root);

    // ── FILTER LOGIC ──
    filterBar.find('.wstyle-filter-pill').on('click', function () {
        filterBar.find('.wstyle-filter-pill').removeClass('active');
        $(this).addClass('active');
        const filter = $(this).attr('data-filter');
        if (filter === "all") {
            secPrecooked.show(); secGenerators.show(); secCustom.show();
        } else {
            secPrecooked.toggle(filter === "precooked");
            secGenerators.toggle(filter === "generators");
            secCustom.toggle(filter === "custom");
        }
    });
}

function renderStyleEditor(c, editId, presetData = null) {

    let currentStyle = presetData ? presetData : (editId ? JSON.parse(JSON.stringify(localProfile.customStyles.find(s => s.id === editId))) : {
        id: "style_" + Date.now(), name: "", tags: [], generatedOptions: [], notes: "", rule: ""
    });

    c.empty();
    let templateOptions = `<option value="" disabled selected>✨ Load a Pre-configured Template...</option>`;
    if (hardcodedLogic.styleTemplates) {
        hardcodedLogic.styleTemplates.forEach((tpl, index) => { templateOptions += `<option value="${index}">${tpl.name}</option>`; });
    }

    // ── TEMPLATE DROPDOWN ──
    c.append(`
        <div style="margin-bottom: 16px;">
            <select id="ps_style_template_dropdown" class="ps-modern-input" style="font-weight: 600; color: var(--gold); border-color: rgba(245,158,11,0.3); cursor: pointer;">${templateOptions}</select>
        </div>
    `);

    // ── EDITOR TOP BAR ──
    c.append(`
        <div class="wstyle-editor-bar">
            <i class="fa-solid fa-pen-nib" style="color: #a855f7; font-size: 1.1rem;"></i>
            <input type="text" id="ps_style_name" value="${currentStyle.name}" placeholder="Name your style…" />
            <button id="ps_btn_save_style" class="ps-modern-btn primary" style="background: #10b981; color: #fff; padding: 8px 18px; white-space: nowrap;">
                <i class="fa-solid fa-floppy-disk"></i> Save
            </button>
            <button id="ps_btn_cancel_style" class="ps-modern-btn secondary" style="color: var(--text-muted); padding: 8px 18px; white-space: nowrap;">
                <i class="fa-solid fa-arrow-left"></i> Back
            </button>
        </div>
    `);

    // ── TEMPLATE CHANGE ──
    $("#ps_style_template_dropdown").on("change", function () {
        const tplIndex = $(this).val(); if (tplIndex === null) return;
        const chosenTpl = hardcodedLogic.styleTemplates[tplIndex];
        currentStyle.name = chosenTpl.name; currentStyle.tags = [...chosenTpl.tags]; currentStyle.notes = chosenTpl.notes; currentStyle.rule = ""; currentStyle.generatedOptions = [];
        renderStyleEditor(c, editId, currentStyle); toastr.info(`${chosenTpl.name} loaded!`);
    });

    // ── TAG CATEGORIES ──
    const tagContainer = $(`<div class="wstyle-tag-section"></div>`);
    hardcodedLogic.styles.forEach(cat => {
        const catWrap = $(`<div style="margin-bottom: 18px;"></div>`);
        catWrap.append(`<div class="wstyle-tag-cat-title">${cat.category}</div>`);
        const grid = $(`<div class="wstyle-tag-grid"></div>`);
        cat.tags.forEach(tagObj => {
            const tagName = tagObj.id; const isSel = currentStyle.tags.includes(tagName);
            const tEl = $(`<span class="wstyle-tag ${isSel ? 'selected' : ''}" data-hint="${tagObj.hint}">${tagName}</span>`);
            tEl.on("click", () => {
                if (currentStyle.tags.includes(tagName)) currentStyle.tags = currentStyle.tags.filter(t => t !== tagName); else currentStyle.tags.push(tagName);
                tEl.toggleClass("selected");
            }); grid.append(tEl);
        }); catWrap.append(grid); tagContainer.append(catWrap);
    }); c.append(tagContainer);

    // ── AI INSIGHTS PANEL ──
    c.append(`
        <div class="wstyle-insights-panel">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-sparkles" style="color: var(--gold); font-size: 0.9rem;"></i>
                    <span style="font-weight: 700; font-size: 0.88rem; color: var(--text-main);">AI Author Matches</span>
                </div>
                <button id="ps_btn_get_authors_style" class="ps-modern-btn secondary" style="padding: 6px 14px; font-size: 0.73rem;">
                    <i class="fa-solid fa-lightbulb"></i> Generate Insights
                </button>
            </div>
            <div id="ps_ai_author_box_style" class="wstyle-tag-grid" style="min-height: 20px; margin-bottom: 14px;"></div>
            <div style="border-top: 1px dashed var(--border-color); padding-top: 14px;">
                <input type="text" id="ps_style_notes" class="ps-modern-input" placeholder="Custom directives or inspiration notes…" value="${currentStyle.notes || ''}" />
            </div>
        </div>
    `);

    // ── FINAL RULE PANEL ──
    c.append(`
        <div class="wstyle-rule-panel">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-scroll" style="color: #a855f7; font-size: 0.85rem;"></i>
                    <span style="font-weight: 700; font-size: 0.88rem; color: var(--text-main);">Generated Rule</span>
                </div>
                <button id="ps_btn_generate_style" class="wstyle-gen-btn" style="padding: 8px 18px; font-size: 0.78rem;">
                    <i class="fa-solid fa-bolt"></i> Generate Writing Rule
                </button>
            </div>
            <textarea id="ps_style_rule_text" placeholder="Select tags above and click Generate…">${currentStyle.rule || ''}</textarea>
            <div class="wstyle-info-callout">
                <i class="fa-solid fa-circle-info"></i>
                <span>After generating or editing your rule, hit <strong>Save</strong> in the toolbar above to apply it to your library.</span>
            </div>
        </div>
    `);

    // ── INSIGHTS RENDERING ──
    const renderInsights = () => {
        const box = $("#ps_ai_author_box_style"); box.empty();
        (currentStyle.generatedOptions || []).forEach(tag => {
            const isSel = currentStyle.tags.includes(tag);
            const tEl = $(`<span class="wstyle-tag ${isSel ? 'selected' : ''}">${tag.replace(" ✨", "")} <i class="fa-solid fa-sparkles" style="font-size:0.55rem; margin-left:3px; color:var(--gold);"></i></span>`);
            tEl.on("click", () => {
                if (isSel) currentStyle.tags = currentStyle.tags.filter(t => t !== tag); else currentStyle.tags.push(tag);
                tEl.toggleClass("selected");
            }); box.append(tEl);
        });
    };
    renderInsights();

    // ── EVENT BINDINGS ──
    $("#ps_style_notes").on("input", function () { currentStyle.notes = $(this).val(); });
    $("#ps_style_rule_text").on("input", function () { currentStyle.rule = $(this).val(); });
    $("#ps_style_name").on("input", function () { currentStyle.name = $(this).val(); });

    $("#ps_btn_cancel_style").on("click", () => renderStyleLibrary(c));
    $("#ps_btn_save_style").on("click", () => {
        if (currentStyle.name.trim() === "") currentStyle.name = "Unnamed Style";
        if (!editId) { localProfile.customStyles.push(currentStyle); }
        else { const idx = localProfile.customStyles.findIndex(s => s.id === editId); if (idx > -1) localProfile.customStyles[idx] = currentStyle; }
        if (localProfile.activeStyleId === currentStyle.id) { localProfile.aiRule = currentStyle.rule; }
        saveProfileToMemory(); renderStyleLibrary(c); toastr.success(`Saved "${currentStyle.name}"`);
    });

    $("#ps_btn_get_authors_style").on("click", async function () {
        if (!getCharacterKey()) return toastr.warning("Open a chat or group first so I can read the context!");
        $(this).prop("disabled", true).html(`<i class="fa-solid fa-spinner fa-spin"></i> Brainstorming...`);
        await useMeguminEngine(async () => {
            const orderText = `Based on the active characters and scenario, give me EXACTLY 2 famous author names or literary writing styles (e.g. Edgar Allan Poe, Jane Austen style, Dark Fantasy Author) and 5 tags that fit the rp (e.g. internet culture, femboy, virtual game) whose writing style perfectly fits the tone and world. Return ONLY the 7 items separated by a comma. Do not explain them.`;
            let aiRawOutput = await runMeguminTask(orderText);
            const aiTagsTemp = cleanAIOutput(aiRawOutput).split(",").map(t => t.trim().replace(/['"[\].]/g, '')).filter(t => t.length > 0);
            if (aiTagsTemp.length > 0) {
                currentStyle.tags = currentStyle.tags.filter(tag => !tag.endsWith("✨"));
                currentStyle.generatedOptions = aiTagsTemp.map(tag => `${tag} ✨`);
                renderInsights(); toastr.success(`Generated ${aiTagsTemp.length} insights!`);
            }
        }); $(this).prop("disabled", false).html(`<i class="fa-solid fa-lightbulb"></i> Generate Insights`);
    });

    $("#ps_btn_generate_style").on("click", async function () {
        if (currentStyle.tags.length === 0) return toastr.warning("Select tags first!");
        $(this).prop("disabled", true).html(`<i class="fa-solid fa-spinner fa-spin"></i> Finalizing...`);
        await useMeguminEngine(async () => {
            const orderText = `Create a writing style prompt based on these traits:\n\nSelected style tags: ${currentStyle.tags.join(", ")}\n\nAdditional user instructions: ${currentStyle.notes}\n\nWrite a concise, well-structured writing style rule (100 words max) that the AI must follow. Combine all tags into a cohesive directive. Write it as a direct instruction. Do not use bullet points or introductory text.`;
            let rule = await runMeguminTask(orderText);
            currentStyle.rule = cleanAIOutput(rule).trim();
            $("#ps_style_rule_text").val(currentStyle.rule); toastr.success("Live AI Rule Generated!");
        }); $(this).prop("disabled", false).html(`<i class="fa-solid fa-bolt"></i> Generate Writing Rule`);
    });
}

function renderAddons(c) {
    const descriptions = {
        "death": "Enables permanent consequences. Characters — including yours — can die for real. No safety net, no plot armor.",
        "combat": "Activates a grounded, tactical combat layer. Actions have real weight, positioning matters, and you can lose badly.",
        "direct": "Forces AI to say words like D and P. No dancing around the subject, no polite deflection. you know what i mean.",
        "color": "Each character's dialogue is color-coded for easy visual parsing.",
        "npc_events": "Requires all new story events to grow naturally from prior context or environmental cues — no random drama out of nowhere. V6 only.",
        "dn": "Forces dialogue and narration to be wrapped in their respective XML tags. Useful for specific Models for better narration style adherence."
    };

    const activeMode = [...hardcodedLogic.modes, ...(extension_settings[extensionName].customModes || [])].find(m => m.id === localProfile.mode);
    const isV6 = activeMode && (activeMode.id.includes("v6") || activeMode.label.includes("V6"));

    // ── HEADER ──
    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #3b82f6, #1d4ed8);">
                    <i class="fa-solid fa-puzzle-piece"></i>
                </div>
                <div>
                    <h2>Global Settings</h2>
                    <p>Toggle add-ons, set output preferences, and configure extras.</p>
                </div>
            </div>
            <div class="mtab-header-badge" style="background: rgba(59,130,246,0.12); color: #3b82f6; border: 1px solid rgba(59,130,246,0.25);">
                <i class="fa-solid fa-toggle-on" style="font-size:0.6rem;"></i> ${localProfile.addons.length} Active
            </div>
        </div>
    `);

    // ── ADDON CARDS ──
    c.append(`<div class="wstyle-section-head blue"><i class="fa-solid fa-puzzle-piece"></i> Gameplay Add-ons</div>`);
    const grid = $(`<div class="mtab-card-grid"></div>`);

    hardcodedLogic.addons.forEach(a => {
        const isSel = localProfile.addons.includes(a.id);
        let badges = '';
        if (a.recommended) badges += `<span class="ecard-badge rec"><i class="fa-solid fa-star"></i> Recommended</span>`;

        let extraClass = '';
        let v6BadgeHtml = '';
        if (a.id === "npc_events") {
            if (!isV6) {
                extraClass = 'locked-card';
                v6BadgeHtml = `<span class="ecard-badge" style="background:rgba(239,68,68,0.12);color:#ef4444;"><i class="fa-solid fa-lock"></i> Requires V6</span>`;
            } else {
                v6BadgeHtml = `<span class="ecard-badge v6-active"><i class="fa-solid fa-unlock"></i> V6 Active</span>`;
            }
        }

        const card = $(`
            <div class="mtab-eng-card ${isSel ? 'active' : ''} ${extraClass}">
                <div class="ecard-accent"></div>
                <div class="ecard-body">
                    <div class="ecard-title">
                        <span>${a.label}</span>
                        ${isSel ? `<span class="ecard-badge" style="background:rgba(16,185,129,0.15);color:#10b981;"><i class="fa-solid fa-check"></i> On</span>` : ''}
                    </div>
                    <p class="ecard-desc">${descriptions[a.id] || ""}</p>
                    ${badges || v6BadgeHtml ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px;">${badges}${v6BadgeHtml}</div>` : ''}
                </div>
            </div>
        `);

        card.on("click", () => {
            if (isSel) localProfile.addons = localProfile.addons.filter(i => i !== a.id); else localProfile.addons.push(a.id);
            saveProfileToMemory(); switchTab(currentTab);
        }); grid.append(card);
    });

    // Onomatopoeia card
    if (!localProfile.onomatopoeia) localProfile.onomatopoeia = { enabled: false, useStyling: false };
    const isOno = localProfile.onomatopoeia.enabled;
    const isOnoStyle = localProfile.onomatopoeia.useStyling;

    const onoCard = $(`
        <div class="mtab-eng-card ${isOno ? 'active' : ''}">
            <div class="ecard-accent"></div>
            <div class="ecard-body">
                <div class="ecard-title">
                    <span>Cinematic Sounds</span>
                    ${isOno ? `<span class="ecard-badge" style="background:rgba(16,185,129,0.15);color:#10b981;"><i class="fa-solid fa-check"></i> On</span>` : ''}
                </div>
                <p class="ecard-desc">Force the AI to use precise phonetic sound words (e.g., click, thud) instead of abstract descriptions.</p>
                <div style="display: ${isOno ? 'flex' : 'none'}; margin-top: 8px; padding-top: 10px; border-top: 1px dashed var(--border-color); justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight:700; font-size: 0.75rem; color: var(--text-main);">Animate Sounds</div>
                        <div style="font-size: 0.65rem; color: var(--text-muted);">Wrap in HTML tags. For capable AI only.</div>
                    </div>
                    <div class="ps-toggle-card ${isOnoStyle ? 'active' : ''}" id="ono_inner_toggle" style="padding: 4px; min-width: 44px; justify-content: center; background: transparent; border-color: ${isOnoStyle ? '#10b981' : 'var(--border-color)'};">
                        <div class="ps-switch" style="transform: scale(0.75); ${isOnoStyle ? 'background: #10b981;' : ''}"></div>
                    </div>
                </div>
            </div>
        </div>
    `);
    onoCard.on("click", (e) => {
        if ($(e.target).closest("#ono_inner_toggle").length) {
            localProfile.onomatopoeia.useStyling = !localProfile.onomatopoeia.useStyling;
            saveProfileToMemory(); switchTab(currentTab); return;
        }
        localProfile.onomatopoeia.enabled = !localProfile.onomatopoeia.enabled;
        saveProfileToMemory(); switchTab(currentTab);
    });
    grid.append(onoCard);
    c.append(grid);

    // ── CUSTOM ENGINE SETTINGS ──
    if (activeMode && activeMode.customToggles) {
        const customSettings = activeMode.customToggles.filter(t => t.location === "settings");
        if (customSettings.length > 0) {
            c.append(`<div class="wstyle-section-head green" style="margin-top:16px;"><i class="fa-solid fa-gear"></i> Custom Engine Settings</div>`);
            const toggleList = $(`<div class="mtab-card-list"></div>`);
            customSettings.forEach(cs => {
                const isSel = !!localProfile.toggles[cs.id];
                const tCard = $(`
                    <div class="mtab-toggle-row ${isSel ? 'active' : ''}" style="${isSel ? 'border-color:#10b981;' : ''}">
                        <div class="toggle-info">
                            <div class="toggle-label" style="${isSel ? 'color:#10b981;' : ''}">${cs.name}</div>
                            <div class="toggle-desc">Custom Module → [[${cs.attachPoint}]]</div>
                        </div>
                        <div class="ps-switch" style="${isSel ? 'background:#10b981;' : ''}"></div>
                    </div>
                `);
                tCard.on("click", () => { localProfile.toggles[cs.id] = !localProfile.toggles[cs.id]; saveProfileToMemory(); switchTab(currentTab); });
                toggleList.append(tCard);
            });
            c.append(toggleList);
        }
    }

    // ── EXTRA SETTINGS PANEL ──
    c.append(`<div class="wstyle-section-head blue" style="margin-top:16px;"><i class="fa-solid fa-earth-americas"></i> Extra</div>`);
    const extraPanel = $(`
        <div class="mtab-panel">
            <div class="mtab-toggle-row ${localProfile.toggles.promptPreview ? 'active' : ''}" id="ps_toggle_prompt_preview" style="margin-bottom: 16px;">
                <div class="toggle-info">
                    <div class="toggle-label"><i class="fa-solid fa-magnifying-glass"></i> Prompt Payload Preview</div>
                    <div class="toggle-desc">Show a popup of the final constructed prompt right before it is sent to the AI. only enable if you know what you doing it maybe buggy.</div>
                </div>
                <div class="ps-switch"></div>
            </div>
            <div class="mtab-toggle-row ${localProfile.disableUtilityPrefill ? 'active' : ''}" id="ps_toggle_utility_prefill" style="margin-bottom: 16px;">
                <div class="toggle-info">
                    <div class="toggle-label">Disable Utility Prefills</div>
                    <div class="toggle-desc">Turn this ON if your API (like Claude) errors out during Image Gen, Banlist, or Story Planner generation.</div>
                </div>
                <div class="ps-switch"></div>
            </div>
            <div class="mtab-setting-row">
                <div class="set-info"><div class="set-label">Target Word Count</div><div class="set-desc">Leave empty for no limit</div></div>
                <input type="number" id="ps_input_wordcount" class="ps-modern-input" style="width: 180px;" placeholder="e.g. 400" value="${localProfile.userWordCount || ''}" min="1" />
            </div>
            <div class="mtab-setting-row">
                <div class="set-info"><div class="set-label">Language Output</div><div class="set-desc">Leave empty for default (English)</div></div>
                <input type="text" id="ps_input_language" class="ps-modern-input" style="width: 180px;" placeholder="e.g. Arabic, French…" value="${localProfile.userLanguage || ''}" />
            </div>
            <div class="mtab-setting-row">
                <div class="set-info"><div class="set-label">User Gender</div><div class="set-desc">Ensure the AI addresses you correctly</div></div>
                <select id="ps_select_pronouns" class="ps-modern-input" style="width: 180px; cursor: pointer;">
                    <option value="off" ${localProfile.userPronouns === 'off' ? 'selected' : ''}>Off</option>
                    <option value="male" ${localProfile.userPronouns === 'male' ? 'selected' : ''}>Male (Him/He)</option>
                    <option value="female" ${localProfile.userPronouns === 'female' ? 'selected' : ''}>Female (Her/She)</option>
                </select>
            </div>
        </div>
    `);
    c.append(extraPanel);

    // Bind the new toggle
    $("#ps_toggle_prompt_preview").on("click", function () {
        if (!localProfile.toggles) localProfile.toggles = {};
        localProfile.toggles.promptPreview = !localProfile.toggles.promptPreview;
        saveProfileToMemory();
        if (localProfile.toggles.promptPreview) $(this).addClass("active");
        else $(this).removeClass("active");
    });

    $("#ps_toggle_utility_prefill").on("click", function () {
        localProfile.disableUtilityPrefill = !localProfile.disableUtilityPrefill;
        saveProfileToMemory();
        if (localProfile.disableUtilityPrefill) $(this).addClass("active");
        else $(this).removeClass("active");
    });
    $("#ps_input_wordcount").on("input", function () { localProfile.userWordCount = $(this).val(); saveProfileToMemory(); });
    $("#ps_input_language").on("input", function () { localProfile.userLanguage = $(this).val(); saveProfileToMemory(); });
    $("#ps_select_pronouns").on("change", function () { localProfile.userPronouns = $(this).val(); saveProfileToMemory(); });
}

function renderBlocks(c) {
    const activeEngine = [...hardcodedLogic.modes, ...(extension_settings[extensionName].customModes || [])].find(m => m.id === localProfile.mode);
    const descriptions = {
        "info": "Appends a tidy status panel after each response showing time, weather, location, and what characters are wearing.",
        "summary": "Keeps a running story digest that the AI updates each turn — helps it remember names, events, and details over long sessions.",
        "cyoa": "Choose-Your-Own-Adventure panel with 4 suggested actions for you to pick from each turn.",
        "mvu": "Add MVU Compatibility still in test read more here: <a href='https://github.com/KritBlade/MVU_Game_Maker' target='_blank' style='color: var(--gold); text-decoration: underline;'>https://github.com/KritBlade/MVU_Game_Maker</a>",
        "npc_inner_chatter": "Reveal NPC private thoughts the PC never hears — crushes, resentment, scheming, anxiety. This feeds future NPC behavior.",
        "npc_inner_chatter_v2": "A simpler version of NPC Inner Chatter. use less input token."
    };

    // ── HEADER ──
    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #10b981, #059669);">
                    <i class="fa-solid fa-cubes"></i>
                </div>
                <div>
                    <h2>Response Blocks</h2>
                    <p>Attach extra UI panels to every AI response.</p>
                </div>
            </div>
            <div class="mtab-header-badge" style="background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.25);">
                <i class="fa-solid fa-cubes" style="font-size:0.6rem;"></i> ${localProfile.blocks.length} Active
            </div>
        </div>
    `);

    const grid = $(`<div class="mtab-card-grid"></div>`);
    hardcodedLogic.blocks.forEach(b => {
        const isSel = localProfile.blocks.includes(b.id);
        const isOverridden = activeEngine && activeEngine[b.id] && activeEngine[b.id].trim() !== "";

        let badges = '';
        if (isOverridden) badges += `<span class="ecard-badge override"><i class="fa-solid fa-code-branch"></i> Engine Override</span>`;

        const card = $(`
            <div class="mtab-eng-card ${isSel ? 'active' : ''}" style="${isOverridden && !isSel ? 'border-color: rgba(16,185,129,0.4);' : ''}">
                <div class="ecard-accent"></div>
                <div class="ecard-body">
                    <div class="ecard-title">
                        <span>${b.label}</span>
                        ${isSel ? `<span class="ecard-badge" style="background:rgba(16,185,129,0.15);color:#10b981;"><i class="fa-solid fa-check"></i> On</span>` : ''}
                    </div>
                    <p class="ecard-desc">${descriptions[b.id] || ""}</p>
                    ${badges ? `<div style="margin-top:4px;">${badges}</div>` : ''}
                </div>
            </div>
        `);
        card.on("click", (e) => {
            if ($(e.target).closest("a").length) return;
            if (isSel) {
                localProfile.blocks = localProfile.blocks.filter(i => i !== b.id);
            } else {
                localProfile.blocks.push(b.id);
                // Make the two Inner Chatter versions mutually exclusive
                if (b.id === "npc_inner_chatter") {
                    localProfile.blocks = localProfile.blocks.filter(i => i !== "npc_inner_chatter_v2");
                } else if (b.id === "npc_inner_chatter_v2") {
                    localProfile.blocks = localProfile.blocks.filter(i => i !== "npc_inner_chatter");
                }
            }
            saveProfileToMemory(); switchTab(currentTab);
        }); grid.append(card);
    });

    if (activeEngine && activeEngine.customToggles) {
        const customAddons = activeEngine.customToggles.filter(t => t.location === "addons");
        if (customAddons.length > 0) {
            grid.append(`<div style="grid-column: 1 / -1;"><div class="wstyle-section-head green" style="margin:8px 0;"><i class="fa-solid fa-puzzle-piece"></i> Custom Engine Add-ons</div></div>`);
            customAddons.forEach(ca => {
                const isSel = !!localProfile.toggles[ca.id];
                const card = $(`
                    <div class="mtab-eng-card ${isSel ? 'active' : ''}">
                        <div class="ecard-accent"></div>
                        <div class="ecard-body">
                            <div class="ecard-title"><span>${ca.name}</span></div>
                            <p class="ecard-desc">Custom Module → [[${ca.attachPoint}]]</p>
                        </div>
                    </div>
                `);
                card.on("click", () => { localProfile.toggles[ca.id] = !localProfile.toggles[ca.id]; saveProfileToMemory(); switchTab(currentTab); });
                grid.append(card);
            });
        }
    } c.append(grid);
}


function renderModels(c) {
    c.empty();
    const activeEngine = [...hardcodedLogic.modes, ...(extension_settings[extensionName].customModes || [])].find(m => m.id === localProfile.mode);

    // ── HEADER ──
    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #a855f7, #7c3aed);">
                    <i class="fa-solid fa-brain"></i>
                </div>
                <div>
                    <h2>Chain of Thought</h2>
                    <p>Configure the AI's thinking framework and reasoning depth.</p>
                </div>
            </div>
        </div>
    `);

    // Custom Engine override notice
    if (activeEngine && activeEngine.cot && activeEngine.cot.trim() !== "") {
        c.append(`
            <div class="mtab-callout green" style="margin-bottom:20px;">
                <i class="fa-solid fa-shield-halved"></i>
                <span><strong>Custom Engine Logic Active</strong> — This Engine provides its own [[COT]] and [[prefill]]. Selections below will be overridden by the Engine's code.</span>
            </div>
        `);
    }

    const migrationMap = {
        "cot-english": "cot-v1-english", "cot-arabic": "cot-v1-arabic", "cot-spanish": "cot-v1-spanish", "cot-french": "cot-v1-french",
        "cot-zh": "cot-v1-zh", "cot-ru": "cot-v1-ru", "cot-jp": "cot-v1-jp", "cot-pt": "cot-v1-pt", "cot-english-test": "cot-v2-english"
    };
    if (migrationMap[localProfile.model]) { localProfile.model = migrationMap[localProfile.model]; saveProfileToMemory(); }

    let currentType = "off", currentLang = "english";
    if (localProfile.model && localProfile.model.startsWith("cot-v1-")) { currentType = "v1"; currentLang = localProfile.model.replace("cot-v1-", ""); }
    else if (localProfile.model && localProfile.model.startsWith("cot-v2-")) { currentType = "v2"; currentLang = localProfile.model.replace("cot-v2-", ""); }
    else if (localProfile.model && localProfile.model.startsWith("cot-v6-lite-")) { currentType = "v6-lite"; currentLang = localProfile.model.replace("cot-v6-lite-", ""); }
    else if (localProfile.model && localProfile.model.startsWith("cot-v6-")) { currentType = "v6"; currentLang = localProfile.model.replace("cot-v6-", ""); }
    else if (localProfile.model && localProfile.model.startsWith("cot-v7-lite-")) { currentType = "v7-lite"; currentLang = localProfile.model.replace("cot-v7-lite-", ""); }
    else if (localProfile.model && localProfile.model.startsWith("cot-v7-")) { currentType = "v7"; currentLang = localProfile.model.replace("cot-v7-", ""); }

    if (!localProfile.thinkEffort) localProfile.thinkEffort = "unspecified";
    if (!localProfile.customThinkEffort) localProfile.customThinkEffort = "100";

    // ── THINKING EFFORT ──
    c.append(`<div class="wstyle-section-head purple"><i class="fa-solid fa-gauge-high"></i> Thinking Effort</div>`);
    c.append(`<div class="mtab-callout" style="margin-bottom:12px; background: rgba(168,85,247,0.1); border-left: 3px solid #a855f7; padding: 8px 12px; font-size: 0.8rem; color: var(--text-main);">
        <i class="fa-solid fa-circle-info" style="color: #a855f7; margin-right: 6px;"></i>
        <strong>Hint:</strong> When using V7 CoT, it is highly recommended to <strong>not</strong> use low Thinking Effort.
    </div>`);
    const effortGrid = $(`<div class="mtab-card-grid" style="margin-bottom: 20px; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));"></div>`);
    const efforts = [
        { id: "100", label: "100 Words" },
        { id: "250", label: "250 Words" },
        { id: "450", label: "450 Words" },
        { id: "custom", label: "Custom" },
        { id: "unspecified", label: "Unspecified" }
    ];
    efforts.forEach(e => {
        const isSel = localProfile.thinkEffort === e.id;
        const card = $(`
            <div class="mtab-eng-card ${isSel ? 'active' : ''}" style="text-align:center;">
                <div class="ecard-accent"></div>
                <div class="ecard-body" style="padding:12px 10px; align-items:center;">
                    <span style="font-weight:700; font-size:0.85rem; color:${isSel ? '#10b981' : 'var(--text-main)'};">${e.label}</span>
                </div>
            </div>
        `);
        card.on("click", () => { localProfile.thinkEffort = e.id; saveProfileToMemory(); renderModels(c); });
        effortGrid.append(card);
    });
    c.append(effortGrid);

    if (localProfile.thinkEffort === "custom") {
        const customBlock = $(`
            <div class="mtab-panel" style="margin-top:-10px; margin-bottom:20px;">
                <div class="mtab-setting-row">
                    <div class="set-info"><div class="set-label">Custom Word Count</div></div>
                    <input type="number" id="ps_input_custom_effort" class="ps-modern-input" style="width: 150px;" value="${localProfile.customThinkEffort}" min="1" />
                </div>
            </div>
        `);
        customBlock.find("#ps_input_custom_effort").on("change input", function () {
            localProfile.customThinkEffort = $(this).val(); saveProfileToMemory();
        });
        c.append(customBlock);
    }

    // ── GEMINI THINKING ──
    if (localProfile.thinkingV2 === undefined) localProfile.thinkingV2 = false;
    const v2Card = $(`
        <div class="mtab-toggle-row ${localProfile.thinkingV2 ? 'active' : ''}" style="margin-bottom: 20px;">
            <div class="toggle-info">
                <div class="toggle-label"><i class="fa-solid fa-brain" style="color:#a855f7;"></i> Gemini Thinking</div>
                <div class="toggle-desc">
                    Enable only for Gemini. When enabled, you MUST add <code>&lt;think&gt;</code> and <code>&lt;/think&gt;</code> to the Reasoning Formatting prefix/suffix.<br>
                    <strong>Note:</strong> Enable Prefill ONLY if using Gemini models.
                </div>
            </div>
            <div class="ps-switch"></div>
        </div>
    `);
    v2Card.on("click", function () { localProfile.thinkingV2 = !localProfile.thinkingV2; saveProfileToMemory(); renderModels(c); });
    c.append(v2Card);

    // ── THINKING FRAMEWORK ──
    c.append(`<div class="wstyle-section-head purple"><i class="fa-solid fa-diagram-project"></i> Thinking Framework</div>`);
    c.append(`<div class="mtab-callout" style="margin-bottom:12px; background: rgba(245,158,11,0.1); border-left: 3px solid #f59e0b; padding: 8px 12px; font-size: 0.8rem; color: var(--text-main);">
        <i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b; margin-right: 6px;"></i>
        <strong>Important:</strong> When using GLM or DS4 models, you must disable "Main 3" and enable "Main 3 DS4 + GLM" in the Megumin Suite preset.
    </div>`);
    const typeGrid = $(`<div class="mtab-card-grid" style="margin-bottom: 20px;"></div>`);
    const types = [
        { id: "off", label: "CoT Off", desc: "No Chain of Thought or prefill. The AI will respond normally." },
        { id: "v1", label: "CoT V1 (Classic)", desc: "The original 8-step framework. Focuses heavily on the NPC's internal emotional landscape vs their observable actions." },
        { id: "v2", label: "CoT V2 (New)", desc: "The new experimental framework. Stricter reality checks, info audits, better NPCs, and hook generation." },
        { id: "v6", label: "CoT V6 (Dream Team)", desc: "The full 4-phase sequence designed specifically for V6 engines. Specialized validation and modeling.", isNew: true },
        { id: "v6-lite", label: "CoT V6 (Lite)", desc: "A streamlined 3-phase sequence. Less token overhead while maintaining narrative rules.", isNew: true },
        { id: "v7", label: "CoT V7", desc: "The new V7 sequence with 5-phase strict ground truth rebuilding.", isNew: true },
        { id: "v7-lite", label: "CoT V7 (Lite)", desc: "A streamlined 5-phase sequence for V7.", isNew: true }
    ];
    types.forEach(t => {
        const isSel = currentType === t.id;
        let badges = '';
        if (t.isNew) badges = `<span class="ecard-badge new">New</span>`;

        const card = $(`
            <div class="mtab-eng-card ${isSel ? 'active' : ''}">
                <div class="ecard-accent"></div>
                <div class="ecard-body">
                    <div class="ecard-title">
                        <span>${t.label}</span>
                        ${isSel ? `<span class="ecard-badge" style="background:rgba(16,185,129,0.15);color:#10b981;"><i class="fa-solid fa-check"></i> Active</span>` : ''}
                    </div>
                    <p class="ecard-desc">${t.desc}</p>
                    ${badges ? `<div style="margin-top:4px;">${badges}</div>` : ''}
                </div>
            </div>
        `);
        card.on("click", () => {
            if (t.id === "off") localProfile.model = "cot-off";
            else if (t.id === "v7") localProfile.model = `cot-v7-english`;
            else if (t.id === "v7-lite") localProfile.model = `cot-v7-lite-english`;
            else localProfile.model = `cot-${t.id}-${currentLang}`;
            saveProfileToMemory(); renderModels(c);
        }); typeGrid.append(card);
    }); c.append(typeGrid);

    // ── LANGUAGE ──
    if (currentType !== "off") {
        c.append(`<div class="wstyle-section-head gold"><i class="fa-solid fa-language"></i> Language</div>`);
        const langGrid = $(`<div class="mtab-card-grid" style="grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));"></div>`);
        let langs = [
            { id: "english", label: "English" }, { id: "arabic", label: "Arabic (العربية)", rec: true }, { id: "spanish", label: "Spanish (Español)" },
            { id: "french", label: "French (Français)" }, { id: "zh", label: "Mandarin (中文)" }, { id: "ru", label: "Russian (Русский)" },
            { id: "jp", label: "Japanese (日本語)" }, { id: "pt", label: "Portuguese (Português)" }
        ];
        if (currentType === "v7" || currentType === "v7-lite") langs = [{ id: "english", label: "English" }];
        langs.forEach(l => {
            const isSel = currentLang === l.id;
            let badges = '';
            if (l.rec) badges = `<span class="ecard-badge rec"><i class="fa-solid fa-star"></i> Pro Tip</span>`;

            const card = $(`
                <div class="mtab-eng-card ${isSel ? 'active' : ''}">
                    <div class="ecard-accent"></div>
                    <div class="ecard-body" style="padding:12px 16px;">
                        <div class="ecard-title" style="font-size:0.88rem;">
                            <span>${l.label}</span>
                            ${isSel ? `<span class="ecard-badge" style="background:rgba(16,185,129,0.15);color:#10b981;"><i class="fa-solid fa-check"></i></span>` : ''}
                        </div>
                        ${badges ? `<div style="margin-top:2px;">${badges}</div>` : ''}
                    </div>
                </div>
            `);
            card.on("click", () => { localProfile.model = `cot-${currentType}-${l.id}`; saveProfileToMemory(); renderModels(c); });
            langGrid.append(card);
        }); c.append(langGrid);
    }
}

// -------------------------------------------------------------
// STAGE 7.5: STORY PLANNER
// -------------------------------------------------------------
function renderStoryPlanner(c) {
    c.empty();
    const sp = localProfile.storyPlan;

    c.append(`
        <!-- HEADER -->
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #f59e0b, #d97706);">
                    <i class="fa-solid fa-map-location-dot"></i>
                </div>
                <div>
                    <h2>Story Planner</h2>
                    <p>Brainstorm and track plot milestones automatically.</p>
                </div>
            </div>
            <div id="sp_header_badge" class="mtab-header-badge" style="background: ${sp.enabled ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.06)'}; color: ${sp.enabled ? '#10b981' : 'var(--text-muted)'}; border: 1px solid ${sp.enabled ? 'rgba(16,185,129,0.25)' : 'var(--border-color)'};">
                <i class="fa-solid fa-${sp.enabled ? 'circle-check' : 'circle-xmark'}" style="font-size:0.6rem;"></i> ${sp.enabled ? 'Enabled' : 'Disabled'}
            </div>
        </div>

        <!-- MASTER TOGGLE -->
        <div class="mtab-toggle-row ${sp.enabled ? 'active' : ''}" id="sp_enable_card" style="margin-bottom: 20px;">
            <div class="toggle-info">
                <div class="toggle-label"><i class="fa-solid fa-map-location-dot" style="color:var(--gold);"></i> Enable Story Planner</div>
                <div class="toggle-desc">Just enable and hit generate plan now and let the ai do the rest.</div>
            </div>
            <div class="ps-switch"></div>
        </div>

        <div id="sp_main_content" style="display: ${sp.enabled ? 'block' : 'none'};">
            <div class="mtab-panel">
                <div class="mtab-panel-title gold"><i class="fa-solid fa-gears"></i> Engine Settings</div>
                <div class="mtab-setting-row">
                    <div class="set-info"><div class="set-label">Generation Backend</div></div>
                    <select id="sp_backend" class="ps-modern-input" style="width: 220px; cursor: pointer;">
                        <option value="direct" ${sp.backend === 'direct' ? 'selected' : ''}>Direct API Call (Fast)</option>
                        <option value="preset" ${sp.backend === 'preset' ? 'selected' : ''}>Megumin Engine Preset</option>
                    </select>
                </div>
                <div class="mtab-setting-row">
                    <div class="set-info">
                        <div class="set-label">Auto-Trigger Mode</div>
                        <div class="set-desc">Generate new plans automatically.</div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <select id="sp_trigger" class="ps-modern-input" style="width: 150px; cursor: pointer;">
                            <option value="manual" ${sp.triggerMode === 'manual' ? 'selected' : ''}>Manual Only</option>
                            <option value="frequency" ${sp.triggerMode === 'frequency' ? 'selected' : ''}>Every X Replies</option>
                        </select>
                        <input type="number" id="sp_freq" class="ps-modern-input" value="${sp.autoFreq}" min="1" style="width: 70px; text-align: center; display: ${sp.triggerMode === 'frequency' ? 'block' : 'none'};" />
                    </div>
                </div>
            </div>

            <div class="mtab-panel">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                    <div class="mtab-panel-title gold" style="margin-bottom:0;"><i class="fa-solid fa-book-open"></i> Current Story Plan</div>
                    <button id="sp_btn_generate" class="wstyle-gen-btn" style="padding: 8px 18px; font-size: 0.78rem;"><i class="fa-solid fa-bolt"></i> Generate Plan Now</button>
                </div>
                <textarea id="sp_current_plan" class="ps-modern-input" style="height: 250px; resize: vertical; font-size: 0.85rem; line-height: 1.5; margin-bottom: 12px;" placeholder="Generated plot milestones will appear here.">${sp.currentPlan || ""}</textarea>
                <div class="mtab-callout">
                    <i class="fa-solid fa-circle-info"></i>
                    <span>A tracker will be added automatically at the end of each response.</span>
                </div>
            </div>
        </div>
    `);


    // Listeners
    $("#sp_enable_card").on("click", function () {
        sp.enabled = !sp.enabled; saveProfileToMemory();
        if (sp.enabled) {
            $(this).addClass("active").css("border-color", "var(--gold)").find("span").css("color", "var(--gold)");
            $("#sp_main_content").slideDown(200);
            $("#sp_header_badge").css({ background: 'rgba(16,185,129,0.12)', color: '#10b981', 'border-color': 'rgba(16,185,129,0.25)' }).html(`<i class="fa-solid fa-circle-check" style="font-size:0.6rem;"></i> Enabled`);
        } else {
            $(this).removeClass("active").css("border-color", "var(--border-color)").find("span").css("color", "var(--text-main)");
            $("#sp_main_content").slideUp(200);
            $("#sp_header_badge").css({ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', 'border-color': 'var(--border-color)' }).html(`<i class="fa-solid fa-circle-xmark" style="font-size:0.6rem;"></i> Disabled`);
        }
    });

    $("#sp_backend").on("change", e => { sp.backend = $(e.target).val(); saveProfileToMemory(); });
    $("#sp_trigger").on("change", e => {
        sp.triggerMode = $(e.target).val(); saveProfileToMemory();
        if (sp.triggerMode === 'frequency') $("#sp_freq").show(); else $("#sp_freq").hide();
    });
    $("#sp_freq").on("input", e => { sp.autoFreq = Math.max(1, parseInt($(e.target).val()) || 10); saveProfileToMemory(); });
    $("#sp_current_plan").on("input", e => { sp.currentPlan = $(e.target).val(); saveProfileToMemory(); });

    $("#sp_btn_generate").on("click", async function () {
        const chatText = getCleanedChatHistory();
        if (chatText.length < 100) return toastr.warning("Not enough chat history to generate a plot.");

        const btn = $(this);
        btn.prop("disabled", true).html(`<i class="fa-solid fa-spinner fa-spin"></i> Brainstorming...`);

        try {
            let output;
            if (!sp.backend || sp.backend === "direct") {
                output = await generateStoryPlanLogic(chatText);
            } else {
                await useMeguminEngine(async () => { output = await generateStoryPlanLogic(chatText); });
            }

            if (output) {
                // Extract only what is inside <plot></plot>
                const plotMatch = output.match(/<plot>([\s\S]*?)<\/plot>/i);
                if (plotMatch) {
                    sp.currentPlan = plotMatch[1].trim();
                    $("#sp_current_plan").val(sp.currentPlan);
                    saveProfileToMemory();
                    toastr.success("Story Plan Generated!");
                } else {
                    toastr.warning("AI failed to format the plot correctly. Try again.");
                }
            }
        } catch (e) {
            toastr.error("Failed to generate plot.");
        } finally {
            btn.prop("disabled", false).html(`<i class="fa-solid fa-bolt"></i> Generate Plan Now`);
        }
    });
}

async function generateStoryPlanLogic(chatText) {
    activeStoryPlanRequest = chatText;
    try {
        let rawOutput = await generateQuietPrompt({ prompt: "___PS_STORY_PLAN___" });
        return rawOutput;
    } finally {
        activeStoryPlanRequest = null;
    }
}

function renderBanList(c) {
    c.empty();
    if (!localProfile.banList) localProfile.banList = [];

    // ── HEADER ──
    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #ef4444, #b91c1c);">
                    <i class="fa-solid fa-ban"></i>
                </div>
                <div>
                    <h2>Dynamic Ban List</h2>
                    <p>Detect and ban overused phrases from AI responses.</p>
                </div>
            </div>
            <div id="ban_header_badge" class="mtab-header-badge" style="background: rgba(239,68,68,0.12); color: #ef4444; border: 1px solid rgba(239,68,68,0.25);">
                <i class="fa-solid fa-ban" style="font-size:0.6rem;"></i> ${localProfile.banList.length} Banned
            </div>
        </div>
    `);

    // ── AI SLOP DETECTOR ──
    c.append(`
        <div class="mtab-panel" style="margin-bottom:16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                <div class="mtab-panel-title purple" style="margin-bottom:0;"><i class="fa-solid fa-radar"></i> AI Slop Detector</div>
                <button id="ps_btn_scan_slop" class="wstyle-gen-btn" style="padding: 8px 18px; font-size: 0.78rem; background: linear-gradient(135deg, #a855f7, #7c3aed);"><i class="fa-solid fa-radar"></i> Analyze Chat</button>
            </div>
            <div class="mtab-setting-row">
                <div class="set-info">
                    <div class="set-label">Generator Backend</div>
                    <div class="set-desc">Choose how to generate the analysis.</div>
                </div>
                <select id="ban_list_backend" class="ps-modern-input" style="width: 200px; cursor: pointer;">
                    <option value="direct" ${localProfile.banListBackend === 'direct' ? 'selected' : ''}>Direct API Call (Fast)</option>
                    <option value="preset" ${localProfile.banListBackend === 'preset' ? 'selected' : ''}>Megumin Engine Preset</option>
                </select>
            </div>
        </div>

        <div class="mtab-panel" style="margin-bottom:16px;">
            <div class="mtab-panel-title red"><i class="fa-solid fa-plus-circle"></i> Add Phrase</div>
            <div style="display: flex; gap: 10px;">
                <input type="text" id="ps_manual_ban_input" class="ps-modern-input" placeholder="Manually add a phrase to ban…" style="flex: 1;" />
                <button id="ps_btn_add_ban" class="ps-modern-btn secondary" style="padding: 0 15px;">Add</button>
            </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div class="wstyle-section-head red" style="margin-bottom:0;"><i class="fa-solid fa-list"></i> Active Banned Phrases</div>
            <div class="mtab-btn-row">
                <input type="file" id="ps_import_bans_file" accept=".json" style="display: none;">
                <button id="ps_btn_import_bans" class="ps-modern-btn secondary" style="padding: 4px 10px; font-size: 0.72rem; color: #3b82f6; border-color: rgba(59, 130, 246, 0.3);"><i class="fa-solid fa-file-import"></i> Import</button>
                <button id="ps_btn_export_bans" class="ps-modern-btn secondary" style="padding: 4px 10px; font-size: 0.72rem; color: #10b981; border-color: rgba(16, 185, 129, 0.3);"><i class="fa-solid fa-file-export"></i> Export</button>
                <button id="ps_btn_clear_bans" class="ps-modern-btn secondary" style="padding: 4px 10px; font-size: 0.72rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);"><i class="fa-solid fa-trash-can"></i> Clear All</button>
            </div>
        </div>
        <div id="ps_banlist_container" class="mtab-card-list" style="min-height: 50px; padding: 10px; border: 1px dashed var(--border-color); border-radius: 10px;"></div>
        <div class="mtab-callout purple" style="margin-top: 16px;">
            <i class="fa-solid fa-circle-info"></i>
            <span>This is a beta feature. Don't complain if you have to generate more than once.</span>
        </div>
    `);

    const renderTags = () => {
        const box = $("#ps_banlist_container"); box.empty();
        if (localProfile.banList.length === 0) { box.append(`<span style="color: var(--text-muted); font-size: 0.8rem; font-style: italic;">No phrases banned yet.</span>`); $("#ban_header_badge").html(`<i class="fa-solid fa-ban" style="font-size:0.6rem;"></i> 0 Banned`); return; }
        localProfile.banList.forEach(phrase => {
            const tEl = $(`<div class="mtab-ban-item">
                <span style="padding-right: 15px;">${phrase}</span>
                <i class="fa-solid fa-xmark"></i>
            </div>`);
            tEl.on("click", () => { localProfile.banList = localProfile.banList.filter(p => p !== phrase); saveProfileToMemory(); renderTags(); }); box.append(tEl);
        });
        // Update header badge dynamically
        $("#ban_header_badge").html(`<i class="fa-solid fa-ban" style="font-size:0.6rem;"></i> ${localProfile.banList.length} Banned`);
    }; renderTags();

    $("#ps_btn_add_ban").on("click", () => {
        const val = $("#ps_manual_ban_input").val().trim();
        if (val && !localProfile.banList.includes(val)) { localProfile.banList.push(val); saveProfileToMemory(); $("#ps_manual_ban_input").val(""); renderTags(); }
    });
    $("#ps_btn_clear_bans").on("click", () => {
        if (localProfile.banList.length === 0) return;
        if (confirm("Are you sure you want to delete all banned phrases?")) { localProfile.banList = []; saveProfileToMemory(); renderTags(); toastr.info("Ban list cleared."); }
    });
    $("#ps_btn_export_bans").on("click", () => {
        if (!localProfile.banList || localProfile.banList.length === 0) return toastr.warning("Ban list is empty!");
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(localProfile.banList, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href", dataStr);
        dlAnchorElem.setAttribute("download", `banlist_${localProfile.id || 'export'}.json`);
        document.body.appendChild(dlAnchorElem);
        dlAnchorElem.click();
        document.body.removeChild(dlAnchorElem);
    });
    $("#ps_btn_import_bans").on("click", () => {
        $("#ps_import_bans_file").trigger("click");
    });
    $("#ps_import_bans_file").on("change", function (e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (evt) {
            try {
                const imported = JSON.parse(evt.target.result);
                if (Array.isArray(imported)) {
                    let added = 0;
                    imported.forEach(p => {
                        if (typeof p === 'string' && !localProfile.banList.includes(p.trim()) && p.trim().length > 0) {
                            localProfile.banList.push(p.trim());
                            added++;
                        }
                    });
                    saveProfileToMemory();
                    renderTags();
                    if (added > 0) toastr.success(`Imported ${added} phrases!`);
                    else toastr.info("No new phrases imported.");
                } else {
                    toastr.error("Invalid JSON format. Expected an array of strings.");
                }
            } catch (err) {
                toastr.error("Error parsing JSON file.");
            }
        };
        reader.readAsText(file);
        $(this).val('');
    });
    $("#ban_list_backend").on("change", function () {
        localProfile.banListBackend = $(this).val();
        saveProfileToMemory();
    });
    $("#ps_btn_scan_slop").on("click", async function () {
        const chatText = getCleanedChatHistory();
        if (chatText.length < 50) return toastr.warning("Not enough chat history to analyze!");
        $(this).prop("disabled", true).html(`<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...`);
        let rawResponse;
        if (!localProfile.banListBackend || localProfile.banListBackend === "direct") {
            rawResponse = await analyzeSlopDirectly(chatText);
        } else {
            rawResponse = await analyzeSlopWithPreset(chatText);
        }
        if (rawResponse) {
            const newPhrases = rawResponse.split(/[,*\n-]/).map(t => t.trim().replace(/['"\[\]\.]/g, '')).filter(t => t.length > 3);
            let addedCount = 0;
            newPhrases.forEach(p => { if (!localProfile.banList.includes(p)) { localProfile.banList.push(p); addedCount++; } });
            if (addedCount > 0) { saveProfileToMemory(); renderTags(); toastr.success(`Caught and banned ${addedCount} repetitive phrases!`); } else { toastr.info("No new repetitive phrases found."); }
        }
        $(this).prop("disabled", false).html(`<i class="fa-solid fa-radar"></i> Analyze Chat History`);
    });
}

// -------------------------------------------------------------
// STAGE 8: IMAGE GEN KAZUMA (ComfyUI Integration)
// -------------------------------------------------------------
function renderImageGen(c) {
    c.empty();
    const s = localProfile.imageGen;

    c.append(`
        <!-- HEADER -->
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #06b6d4, #0891b2);">
                    <i class="fa-solid fa-image"></i>
                </div>
                <div>
                    <h2>Image Generation</h2>
                    <p>ComfyUI integration for automatic scene rendering.</p>
                </div>
            </div>
            <div id="ig_header_badge" class="mtab-header-badge" style="background: ${s.enabled ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.06)'}; color: ${s.enabled ? '#10b981' : 'var(--text-muted)'}; border: 1px solid ${s.enabled ? 'rgba(16,185,129,0.25)' : 'var(--border-color)'};">
                <i class="fa-solid fa-${s.enabled ? 'circle-check' : 'circle-xmark'}" style="font-size:0.6rem;"></i> ${s.enabled ? 'Enabled' : 'Disabled'}
            </div>
        </div>

        <!-- MASTER TOGGLE -->
        <div class="mtab-toggle-row ${s.enabled ? 'active' : ''}" id="ig_enable_card" style="margin-bottom: 20px;">
            <div class="toggle-info">
                <div class="toggle-label"><i class="fa-solid fa-image" style="color:#06b6d4;"></i> Enable Image Generation</div>
                <div class="toggle-desc">Activate ComfyUI integration for this specific character/group.</div>
            </div>
            <div class="ps-switch"></div>
        </div>

        <!-- Generator Backend -->
        <div class="mtab-panel" style="margin-bottom:16px;">
            <div class="mtab-panel-title blue"><i class="fa-solid fa-gears"></i> Prompt Generator Backend</div>
            <div class="mtab-setting-row">
                <div class="set-info">
                    <div class="set-label">Generation Method</div>
                    <div class="set-desc">"Direct" is faster. "Megumin Image" is more creative.</div>
                </div>
                <select id="img_gen_backend" class="ps-modern-input" style="width: 220px; cursor: pointer;">
                    <option value="direct" ${s.generatorBackend === 'direct' ? 'selected' : ''}>Direct API Call (Fast)</option>
                    <option value="preset" ${s.generatorBackend === 'preset' ? 'selected' : ''}>Megumin Image Preset</option>
                </select>
            </div>
        </div>

        <div id="ig_main_content" style="display: ${s.enabled ? 'block' : 'none'};">
            
            <!-- Connection & Workflow -->
            <div class="mtab-panel" style="margin-bottom:16px;">
                <div class="mtab-panel-title blue"><i class="fa-solid fa-link"></i> ComfyUI Server & Workflow</div>
                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <input type="text" id="ig_url" class="ps-modern-input" value="${s.comfyUrl}" placeholder="http://127.0.0.1:8188" style="flex: 1;" />
                    <button id="ig_test_btn" class="ps-modern-btn secondary" style="padding: 0 15px;"><i class="fa-solid fa-wifi"></i> Test</button>
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <select id="ig_workflow_list" class="ps-modern-input" style="flex: 1; cursor: pointer;"></select>
                    <button id="ig_new_wf" class="ps-modern-btn secondary" title="New Workflow"><i class="fa-solid fa-plus"></i></button>
                    <button id="ig_edit_wf" class="ps-modern-btn secondary" title="Edit JSON"><i class="fa-solid fa-pen"></i></button>
                    <button id="ig_del_wf" class="ps-modern-btn secondary" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.3);" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>

            <!-- Triggers & Formatting -->
            <div class="mtab-panel" style="margin-bottom:16px;">
                <div class="mtab-panel-title gold"><i class="fa-solid fa-pen-nib"></i> Triggers & Formatting</div>
                <div style="display: flex; gap: 15px; margin-bottom: 15px;">
                    <div style="flex: 2;">
                        <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Trigger Mode</div>
                        <select id="ig_trigger_mode" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem; cursor: pointer;">
                            <option value="always" ${s.triggerMode === 'always' ? 'selected' : ''}>Always (Every Reply)</option>
                            <option value="frequency" ${s.triggerMode === 'frequency' ? 'selected' : ''}>After X Replies</option>
                            <option value="conditional" ${s.triggerMode === 'conditional' ? 'selected' : ''}>Only when character sends a pic</option>
                            <option value="manual" ${s.triggerMode === 'manual' ? 'selected' : ''}>Manual Button Only</option>
                        </select>
                    </div>
                    <div style="flex: 1; display: ${s.triggerMode === 'frequency' ? 'block' : 'none'};" id="ig_freq_container">
                        <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Every X Replies</div>
                        <input type="number" id="ig_auto_freq" class="ps-modern-input" value="${s.autoGenFreq}" min="1" style="padding: 8px; font-size: 0.8rem; text-align: center;" />
                    </div>
                </div>

                <div class="mtab-toggle-row ${s.previewPrompt ? 'active' : ''}" id="ig_preview_card" style="padding: 12px 18px; margin-bottom: 15px;">
                    <div class="toggle-info">
                        <div class="toggle-label" style="font-size:0.85rem;">Preview Prompt Before Sending</div>
                        <div class="toggle-desc">Show a popup to view or edit the AI's prompt before rendering.</div>
                    </div>
                    <div class="ps-switch"></div>
                </div>

                <div id="ig_prompt_builder" style="background: rgba(0,0,0,0.15); padding: 15px; border-radius: 10px; border-left: 3px solid var(--gold);">
                    <div style="display: flex; gap: 15px; margin-bottom: 10px;">
                        <div style="flex: 1;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Model Style Format</div>
                            <select id="ig_style" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;">
                                <option value="standard" ${s.promptStyle === 'standard' ? 'selected' : ''}>Standard (Descriptive)</option>
                                <option value="illustrious" ${s.promptStyle === 'illustrious' ? 'selected' : ''}>Illustrious/Pony (Tags)</option>
                                <option value="sdxl" ${s.promptStyle === 'sdxl' ? 'selected' : ''}>SDXL (Natural Prose)</option>
                            </select>
                        </div>
                        <div style="flex: 1;">
                            <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px;">Camera Perspective</div>
                            <select id="ig_persp" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;">
                                <option value="scene" ${s.promptPerspective === 'scene' ? 'selected' : ''}>Cinematic Scene</option>
                                <option value="pov" ${s.promptPerspective === 'pov' ? 'selected' : ''}>First Person (POV)</option>
                                <option value="character" ${s.promptPerspective === 'character' ? 'selected' : ''}>Character Portrait</option>
                            </select>
                        </div>
                    </div>
                    <input type="text" id="ig_extra" class="ps-modern-input" placeholder="Extra Instructions (e.g. moody lighting, dark atmosphere...)" value="${s.promptExtra}" style="padding: 8px; font-size: 0.8rem;" />
                </div>
            </div>

            <!-- Parameters -->
            <div class="mtab-panel" style="margin-bottom:16px;">
                <div class="mtab-panel-title gold"><i class="fa-solid fa-sliders"></i> Image Parameters</div>
                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <select id="ig_model" class="ps-modern-input" style="flex: 2;"><option value="">Loading Models...</option></select>
                    <select id="ig_sampler" class="ps-modern-input" style="flex: 1;"><option value="">Loading Samplers...</option></select>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 15px; background: rgba(0,0,0,0.1); padding: 15px; border-radius: 10px; border: 1px solid var(--border-color);">
                    <div class="mtab-param-row"><span class="param-label">Steps</span><input type="range" id="ig_steps" min="1" max="100" value="${s.steps}"><input type="number" id="ig_steps_val" value="${s.steps}"></div>
                    <div class="mtab-param-row"><span class="param-label">CFG</span><input type="range" id="ig_cfg" min="1" max="30" step="0.5" value="${s.cfg}"><input type="number" id="ig_cfg_val" value="${s.cfg}"></div>
                    <div class="mtab-param-row"><span class="param-label">Denoise</span><input type="range" id="ig_denoise" min="0" max="1" step="0.05" value="${s.denoise}"><input type="number" id="ig_denoise_val" value="${s.denoise}"></div>
                    <div class="mtab-param-row"><span class="param-label">CLIP</span><input type="range" id="ig_clip" min="1" max="12" step="1" value="${s.clipSkip}"><input type="number" id="ig_clip_val" value="${s.clipSkip}"></div>
                </div>

                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <div style="flex: 2;">
                        <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Resolution Preset</div>
                        <select id="ig_res_preset" class="ps-modern-input" style="padding: 8px; font-size: 0.8rem;"></select>
                    </div>
                    <div style="flex: 1; display: flex; align-items: flex-end; gap: 5px;">
                        <input type="number" id="ig_w" class="ps-modern-input" value="${s.imgWidth}" placeholder="W" style="padding: 8px; text-align: center; font-size: 0.8rem;" />
                        <span style="color: var(--text-muted); padding-bottom: 8px;">x</span>
                        <input type="number" id="ig_h" class="ps-modern-input" value="${s.imgHeight}" placeholder="H" style="padding: 8px; text-align: center; font-size: 0.8rem;" />
                    </div>
                </div>

                <div style="display: flex; gap: 10px;">
                    <div style="flex: 1;">
                        <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Seed (-1 for random)</div>
                        <input type="number" id="ig_seed" class="ps-modern-input" value="${s.customSeed}" style="padding: 8px; font-size: 0.8rem;" />
                    </div>
                    <div style="flex: 2;">
                        <div style="font-size: 0.7rem; font-weight: bold; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">Negative Prompt Override</div>
                        <input type="text" id="ig_neg" class="ps-modern-input" value="${s.customNegative}" style="padding: 8px; font-size: 0.8rem;" />
                    </div>
                </div>
            </div>

            <!-- LoRA Lab -->
            <div class="mtab-panel">
                <div class="mtab-panel-title purple"><i class="fa-solid fa-flask"></i> LoRA Lab</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    ${[1, 2, 3, 4].map(i => `
                        <div style="background: rgba(0,0,0,0.1); border: 1px solid var(--border-color); padding: 12px; border-radius: 10px; border-left: 3px solid #a855f7;">
                            <div style="font-size: 0.75rem; font-weight: 700; color: var(--text-muted); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Slot ${i}</div>
                            <select id="ig_lora_${i}" class="ps-modern-input" style="padding: 6px; font-size: 0.75rem; margin-bottom: 8px;"><option value="">Loading...</option></select>
                            <div class="mtab-param-row" style="padding:0;">
                                <span class="param-label" style="min-width:30px;">Wt</span>
                                <input type="range" id="ig_lorawt_${i}" min="-2" max="2" step="0.1" value="${i === 1 ? s.selectedLoraWt : i === 2 ? s.selectedLoraWt2 : i === 3 ? s.selectedLoraWt3 : s.selectedLoraWt4}">
                                <span id="ig_lorawt_lbl_${i}" style="font-size:0.78rem; font-weight:600; color:var(--text-main); min-width:30px; text-align:center;">${i === 1 ? s.selectedLoraWt : i === 2 ? s.selectedLoraWt2 : i === 3 ? s.selectedLoraWt3 : s.selectedLoraWt4}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `);

    // --- EVENTS & BINDINGS ---
    $("#ig_enable_card").on("click", function () {
        s.enabled = !s.enabled;
        saveProfileToMemory();
        toggleQuickGenButton();
        if (s.enabled) {
            $(this).addClass("active"); $(this).css("border-color", "var(--gold)"); $(this).find("span").css("color", "var(--gold)");
            $("#ig_main_content").slideDown(200); igFetchComfyLists();
            $("#ig_header_badge").css({ background: 'rgba(16,185,129,0.12)', color: '#10b981', 'border-color': 'rgba(16,185,129,0.25)' }).html(`<i class="fa-solid fa-circle-check" style="font-size:0.6rem;"></i> Enabled`);
        } else {
            $(this).removeClass("active"); $(this).css("border-color", "var(--border-color)"); $(this).find("span").css("color", "var(--text-main)");
            $("#ig_main_content").slideUp(200);
            $("#ig_header_badge").css({ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', 'border-color': 'var(--border-color)' }).html(`<i class="fa-solid fa-circle-xmark" style="font-size:0.6rem;"></i> Disabled`);
        }
    });
    $("#img_gen_backend").on("change", function () {
        s.generatorBackend = $(this).val();
        saveProfileToMemory();
    });

    $("#ig_trigger_mode").on("change", (e) => {
        s.triggerMode = $(e.target).val();
        saveProfileToMemory();
        toggleQuickGenButton(); // <-- ADDED
        if (s.triggerMode === 'frequency') $("#ig_freq_container").show(); else $("#ig_freq_container").hide();
    });
    $("#ig_auto_freq").on("input", (e) => { let v = parseInt($(e.target).val()); if (v < 1) v = 1; s.autoGenFreq = v; saveProfileToMemory(); });

    $("#ig_preview_card").on("click", function () {
        s.previewPrompt = !s.previewPrompt;
        saveProfileToMemory();
        if (s.previewPrompt) $(this).addClass("active");
        else $(this).removeClass("active");
    });

    // Inputs
    $("#ig_url").on("input", (e) => { s.comfyUrl = $(e.target).val(); saveProfileToMemory(); });
    $("#ig_style").on("change", (e) => { s.promptStyle = $(e.target).val(); saveProfileToMemory(); });
    $("#ig_persp").on("change", (e) => { s.promptPerspective = $(e.target).val(); saveProfileToMemory(); });
    $("#ig_extra").on("input", (e) => { s.promptExtra = $(e.target).val(); saveProfileToMemory(); });
    $("#ig_w, #ig_h").on("input", (e) => { s[e.target.id === "ig_w" ? "imgWidth" : "imgHeight"] = parseInt($(e.target).val()); saveProfileToMemory(); });
    $("#ig_neg").on("input", (e) => { s.customNegative = $(e.target).val(); saveProfileToMemory(); });
    $("#ig_seed").on("input", (e) => { s.customSeed = parseInt($(e.target).val()); saveProfileToMemory(); });

    // Sliders
    const bindSlider = (id, key, isFloat) => {
        $(`#ig_${id}`).on("input", function () { let v = isFloat ? parseFloat(this.value) : parseInt(this.value); s[key] = v; $(`#ig_${id}_val`).val(v); saveProfileToMemory(); });
        $(`#ig_${id}_val`).on("input", function () { let v = isFloat ? parseFloat(this.value) : parseInt(this.value); s[key] = v; $(`#ig_${id}`).val(v); saveProfileToMemory(); });
    };
    bindSlider("steps", "steps", false); bindSlider("cfg", "cfg", true); bindSlider("denoise", "denoise", true); bindSlider("clip", "clipSkip", false);

    // Resolutions
    const resSel = $("#ig_res_preset");
    resSel.empty().append('<option value="">-- Select Preset --</option>');
    RESOLUTIONS.forEach((r, idx) => resSel.append(`<option value="${idx}">${r.label}</option>`));
    resSel.on("change", (e) => {
        const idx = parseInt($(e.target).val());
        if (!isNaN(idx) && RESOLUTIONS[idx]) { $("#ig_w").val(RESOLUTIONS[idx].w).trigger("input"); $("#ig_h").val(RESOLUTIONS[idx].h).trigger("input"); }
    });

    // LoRAs
    for (let i = 1; i <= 4; i++) {
        const key = i === 1 ? "selectedLora" : `selectedLora${i}`;
        const wtKey = i === 1 ? "selectedLoraWt" : `selectedLoraWt${i}`;
        $(`#ig_lora_${i}`).on("change", (e) => { s[key] = $(e.target).val(); saveProfileToMemory(); });
        $(`#ig_lorawt_${i}`).on("input", function () { let v = parseFloat(this.value); s[wtKey] = v; $(`#ig_lorawt_lbl_${i}`).text(v); saveProfileToMemory(); });
    }

    // Models & Samplers
    $("#ig_model").on("change", (e) => { s.selectedModel = $(e.target).val(); saveProfileToMemory(); });
    $("#ig_sampler").on("change", (e) => { s.selectedSampler = $(e.target).val(); saveProfileToMemory(); });

    // Buttons
    $("#ig_test_btn").on("click", igTestConnection);

    // Workflow Managers
    $("#ig_new_wf").on("click", igNewWorkflowClick);
    $("#ig_edit_wf").on("click", igOpenWorkflowEditorClick);
    $("#ig_del_wf").on("click", igDeleteWorkflowClick);
    $("#ig_workflow_list").on("change", (e) => {
        const newWorkflow = $(e.target).val();
        const oldWorkflow = s.currentWorkflowName;
        if (oldWorkflow) {
            if (!s.savedWorkflowStates) s.savedWorkflowStates = {};
            s.savedWorkflowStates[oldWorkflow] = {
                selectedModel: s.selectedModel, selectedSampler: s.selectedSampler, steps: s.steps, cfg: s.cfg, denoise: s.denoise, clipSkip: s.clipSkip,
                imgWidth: s.imgWidth, imgHeight: s.imgHeight, customSeed: s.customSeed, customNegative: s.customNegative,
                promptStyle: s.promptStyle, promptPerspective: s.promptPerspective, promptExtra: s.promptExtra, previewPrompt: s.previewPrompt,
                selectedLora: s.selectedLora, selectedLoraWt: s.selectedLoraWt, selectedLora2: s.selectedLora2, selectedLoraWt2: s.selectedLoraWt2,
                selectedLora3: s.selectedLora3, selectedLoraWt3: s.selectedLoraWt3, selectedLora4: s.selectedLora4, selectedLoraWt4: s.selectedLoraWt4
            };
        }
        if (s.savedWorkflowStates && s.savedWorkflowStates[newWorkflow]) {
            Object.assign(s, s.savedWorkflowStates[newWorkflow]);
            toastr.success(`Restored settings for ${newWorkflow}`);
            renderImageGen(c); // Re-render to update UI with restored values
        } else { toastr.info(`New workflow context active`); }

        s.currentWorkflowName = newWorkflow;
        saveProfileToMemory();
    });

    if (s.enabled) {
        igPopulateWorkflows();
        igFetchComfyLists();
    }
}

// -------------------------------------------------------------
// STAGE 8 HELPER FUNCTIONS
// -------------------------------------------------------------
async function igFetchComfyLists() {
    const s = localProfile.imageGen;
    const url = s.comfyUrl;
    try {
        const mRes = await fetch('/api/sd/comfy/models', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: url }) });
        if (mRes.ok) {
            const models = await mRes.json();
            const sel = $("#ig_model"); sel.empty().append('<option value="">-- Select Model --</option>');
            models.forEach(m => { let v = m.value || m; let t = m.text || v; sel.append(`<option value="${v}">${t}</option>`); });
            if (s.selectedModel) sel.val(s.selectedModel);
        }
        const sRes = await fetch('/api/sd/comfy/samplers', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: url }) });
        if (sRes.ok) {
            const samplers = await sRes.json();
            const sel = $("#ig_sampler"); sel.empty();
            samplers.forEach(sa => sel.append(`<option value="${sa}">${sa}</option>`));
            if (s.selectedSampler) sel.val(s.selectedSampler);
        }
        const lRes = await fetch(`${url}/object_info/LoraLoader`);
        if (lRes.ok) {
            const json = await lRes.json();
            const files = json['LoraLoader'].input.required.lora_name[0];
            for (let i = 1; i <= 4; i++) {
                const sel = $(`#ig_lora_${i}`); const val = i === 1 ? s.selectedLora : s[`selectedLora${i}`];
                sel.empty().append('<option value="">-- No LoRA --</option>');
                files.forEach(f => sel.append(`<option value="${f}">${f}</option>`));
                if (val) sel.val(val);
            }
        }
    } catch (e) { console.warn(`[Megumin-Suite] ComfyLists failed`, e); }
}

// -------------------------------------------------------------
// STAGE 8.5: NPC BANK
// -------------------------------------------------------------

// Reconstruct a plain-text dossier from structured NPC data for injection into [[npc list]]
function npcBuildTextFromData(n) {
    let lines = [];
    lines.push(`**Name:** ${n.name || "Unknown"} | **Age:** ${n.age || "?"} | **Sex:** ${n.sex || "?"}`);
    if (n.appearance) lines.push(`**Appearance:** ${n.appearance}`);
    if (n.occupation) lines.push(`**Occupation:** ${n.occupation}`);
    if (n.background) lines.push(`**Background:** ${n.background}`);
    if (n.innerCircle) lines.push(`**Inner Circle:**\n${n.innerCircle}`);
    if (n.personality) lines.push(`**Personality Snapshot:** ${n.personality}`);
    if (n.agenda) lines.push(`**Current Agenda:** ${n.agenda}`);
    if (n.hiddenLayer) lines.push(`**Hidden Layer:** ${n.hiddenLayer}`);
    return lines.join("\n");
}

// Parse raw NPC dossier HTML block into structured fields
function npcParseBlock(rawBlock) {
    const strip = (s) => (s || "").replace(/\*\*/g, "").replace(/<\/?[^>]+>/g, "").trim();
    const data = {};

    // Name / Age / Sex line
    const nameLine = rawBlock.match(/\*\*Name:\*\*\s*(.*?)(?:\||$)/im);
    if (nameLine) data.name = strip(nameLine[1]);
    const ageLine = rawBlock.match(/\*\*Age:\*\*\s*(.*?)(?:\||$)/im);
    if (ageLine) data.age = strip(ageLine[1]);
    const sexLine = rawBlock.match(/\*\*Sex:\*\*\s*(.*?)(?:\||$|\n)/im);
    if (sexLine) data.sex = strip(sexLine[1]);

    // Simple single-value fields — NOTE: no 'm' flag so $ means end-of-string, not end-of-line
    const fields = [
        { key: "appearance", regex: /\*\*Appearance:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[A-Z])/i },
        { key: "occupation", regex: /\*\*Occupation:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[A-Z])/i },
        { key: "background", regex: /\*\*Background:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[A-Z])/i },
        { key: "innerCircle", regex: /\*\*Inner Circle:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[A-Z])/i },
        { key: "personality", regex: /\*\*Personality Snapshot:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[A-Z])/i },
        { key: "agenda", regex: /\*\*Current Agenda:\*\*\s*([\s\S]*?)(?=\n\s*\*\*[A-Z])/i },
        { key: "hiddenLayer", regex: /\*\*Hidden Layer:\*\*\s*([\s\S]*?)(?=\n\s*<\/details>|<\/details>)/i }
    ];
    fields.forEach(f => {
        const m = rawBlock.match(f.regex);
        if (m) data[f.key] = m[1].trim();
    });

    return data;
}

// Generate NPC portrait via ComfyUI — uses AI to generate the prompt from full NPC info
let activeNpcPfpRequest = null;

async function npcGeneratePfp(npcName) {
    const s = localProfile.imageGen;
    if (!s || !s.enabled || !s.currentWorkflowName) {
        toastr.warning("Image Generation must be enabled and configured first.");
        return null;
    }

    const npc = localProfile.npcBank.npcs.find(n => n.name === npcName);
    if (!npc) return null;

    // Build full NPC dossier text for the AI
    const npcText = npcBuildTextFromData(npc);

    let styleStr = s.promptStyle === "illustrious" ? "Use Danbooru-style tags separated by commas. Focus on anime art style." : (s.promptStyle === "sdxl" ? "Use natural, descriptive prose and full sentences. Focus on photorealism." : "Use a comma-separated list of detailed keywords and visual descriptors.");
    let perspStr = "This is a CHARACTER PORTRAIT. Frame it as an upper-body/bust shot focused on the character's face and shoulders. Soft, flattering lighting. Clean or simple background. Capture their personality through expression and posture.";

    toastr.info(`Generating portrait prompt for ${npcName}...`, "NPC Bank");
    showKazumaProgress("AI is writing portrait prompt...");

    // Step 1: Ask the AI to generate an image prompt from the NPC dossier
    activeNpcPfpRequest = { npcText, styleStr, perspStr, extraStr: s.promptExtra || "None" };

    let promptText;
    try {
        let rawOutput = await generateQuietPrompt({ prompt: "___PS_NPC_PFP___" });
        promptText = rawOutput.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

        // Try to extract <img prompt="..."> if the AI wrapped it
        const imgRegex = /<img\s+prompt=["'](.*?)["']\s*\/?>/i;
        const match = promptText.match(imgRegex);
        if (match) promptText = match[1];
    } catch (e) {
        console.error("NPC PFP prompt generation failed:", e);
        $("#kazuma_progress_overlay").hide();
        toastr.error("Failed to generate portrait prompt.");
        activeNpcPfpRequest = null;
        return null;
    } finally {
        activeNpcPfpRequest = null;
    }

    if (!promptText || promptText.length < 5) {
        $("#kazuma_progress_overlay").hide();
        toastr.error("AI returned an empty prompt.");
        return null;
    }

    console.log(`[Megumin-Suite] NPC PFP prompt for ${npcName}: ${promptText}`);
    toastr.info("Sending portrait prompt to ComfyUI...", "NPC Bank");
    showKazumaProgress("Rendering NPC Portrait...");

    // Step 2: Send the AI-generated prompt to ComfyUI
    let workflowRaw;
    try {
        const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: s.currentWorkflowName }) });
        if (!res.ok) throw new Error("Load failed"); workflowRaw = await res.json();
    } catch (e) { $("#kazuma_progress_overlay").hide(); toastr.error("Could not load workflow."); return null; }

    let workflow = (typeof workflowRaw === 'string') ? JSON.parse(workflowRaw) : workflowRaw;
    let finalSeed = Math.floor(Math.random() * 1000000000);

    for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (node.inputs) {
            for (const key in node.inputs) {
                const val = node.inputs[key];
                if (val === "%prompt%") node.inputs[key] = promptText;
                if (val === "%negative_prompt%") node.inputs[key] = s.customNegative || "";
                if (val === "%seed%") node.inputs[key] = finalSeed;
                if (val === "%sampler%") node.inputs[key] = s.selectedSampler || "euler";
                if (val === "%model%") node.inputs[key] = s.selectedModel || "v1-5-pruned.ckpt";
                if (val === "%steps%") node.inputs[key] = parseInt(s.steps) || 20;
                if (val === "%scale%") node.inputs[key] = parseFloat(s.cfg) || 7.0;
                if (val === "%denoise%") node.inputs[key] = parseFloat(s.denoise) || 1.0;
                if (val === "%clip_skip%") node.inputs[key] = -Math.abs(parseInt(s.clipSkip)) || -1;
                if (val === "%lora1%") node.inputs[key] = s.selectedLora || "None";
                if (val === "%lora2%") node.inputs[key] = s.selectedLora2 || "None";
                if (val === "%lora3%") node.inputs[key] = s.selectedLora3 || "None";
                if (val === "%lora4%") node.inputs[key] = s.selectedLora4 || "None";
                if (val === "%lorawt1%") node.inputs[key] = parseFloat(s.selectedLoraWt) || 1.0;
                if (val === "%lorawt2%") node.inputs[key] = parseFloat(s.selectedLoraWt2) || 1.0;
                if (val === "%lorawt3%") node.inputs[key] = parseFloat(s.selectedLoraWt3) || 1.0;
                if (val === "%lorawt4%") node.inputs[key] = parseFloat(s.selectedLoraWt4) || 1.0;
                if (val === "%width%") node.inputs[key] = 512;
                if (val === "%height%") node.inputs[key] = 512;
            }
            if (node.class_type === "KSampler" && 'seed' in node.inputs && typeof node.inputs['seed'] === 'number') { node.inputs.seed = finalSeed; }
        }
    }

    try {
        const res = await fetch(`${s.comfyUrl}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow }) });
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();

        showKazumaProgress("Rendering Portrait...");
        return new Promise((resolve) => {
            const checkInterval = setInterval(async () => {
                try {
                    const h = await (await fetch(`${s.comfyUrl}/history/${data.prompt_id}`)).json();
                    if (h[data.prompt_id]) {
                        clearInterval(checkInterval);
                        let finalImage = null;
                        for (const nodeId in h[data.prompt_id].outputs) {
                            const nodeOut = h[data.prompt_id].outputs[nodeId];
                            if (nodeOut.images && nodeOut.images.length > 0) { finalImage = nodeOut.images[0]; break; }
                        }
                        if (finalImage) {
                            const imgUrl = `${s.comfyUrl}/view?filename=${finalImage.filename}&subfolder=${finalImage.subfolder}&type=${finalImage.type}`;
                            const response = await fetch(imgUrl); const blob = await response.blob();
                            const base64 = await new Promise((r) => { const reader = new FileReader(); reader.onloadend = () => r(reader.result); reader.readAsDataURL(blob); });

                            // Compress to JPEG
                            const compressed = await new Promise((r) => {
                                const img = new Image(); img.src = base64;
                                img.onload = () => { const cvs = document.createElement('canvas'); cvs.width = img.width; cvs.height = img.height; cvs.getContext('2d').drawImage(img, 0, 0); r(cvs.toDataURL("image/jpeg", 0.85)); };
                                img.onerror = () => r(base64);
                            });

                            npc.pfp = compressed;
                            saveProfileToMemory();
                            $("#kazuma_progress_overlay").hide();
                            toastr.success(`Portrait generated for ${npcName}!`);
                            renderNpcList();
                            resolve(compressed);
                        } else {
                            $("#kazuma_progress_overlay").hide();
                            resolve(null);
                        }
                    }
                } catch (e) { }
            }, 1000);
        });
    } catch (e) { $("#kazuma_progress_overlay").hide(); toastr.error("ComfyUI Error: " + e.message); return null; }
}

function renderNpcBank(c) {
    c.empty();
    const nb = localProfile.npcBank;

    c.append(`
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #f43f5e, #e11d48);">
                    <i class="fa-solid fa-address-book"></i>
                </div>
                <div>
                    <h2>NPCs Bank</h2>
                    <p>Automatically extract and track significant NPCs in the story.</p>
                </div>
            </div>
            <div id="npc_header_badge" class="mtab-header-badge" style="background: ${nb.enabled ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.06)'}; color: ${nb.enabled ? '#10b981' : 'var(--text-muted)'}; border: 1px solid ${nb.enabled ? 'rgba(16,185,129,0.25)' : 'var(--border-color)'};">
                <i class="fa-solid fa-${nb.enabled ? 'circle-check' : 'circle-xmark'}" style="font-size:0.6rem;"></i> ${nb.enabled ? 'Enabled' : 'Disabled'}
            </div>
        </div>

        <div class="mtab-toggle-row ${nb.enabled ? 'active' : ''}" id="npc_enable_card" style="margin-bottom: 10px;">
            <div class="toggle-info">
                <div class="toggle-label"><i class="fa-solid fa-users" style="color:#f43f5e;"></i> Enable NPC Bank</div>
                <div class="toggle-desc">When enabled, the AI generates detailed dossiers for new NPCs, which are saved here and injected when relevant.</div>
            </div>
            <div class="ps-switch"></div>
        </div>

        <div class="mtab-toggle-row ${nb.sendPortraitsToAi ? 'active' : ''}" id="npc_send_portraits" style="margin-bottom: 20px;">
            <div class="toggle-info">
                <div class="toggle-label"><i class="fa-solid fa-image" style="color:#a855f7;"></i> Send Portraits to AI</div>
                <div class="toggle-desc">If an injected NPC has a portrait, send the image to the AI to help it visualize the character.</div>
            </div>
            <div class="ps-switch"></div>
        </div>

        <div id="npc_main_content" style="display: ${nb.enabled ? 'block' : 'none'};">
            <div style="margin-top: 15px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="color: #f43f5e; font-size: 0.85rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;"><i class="fa-solid fa-address-card"></i> Saved NPCs <span id="npc_count" style="color: var(--text-muted); font-size: 0.75rem; margin-left: 8px;">(${(nb.npcs || []).length})</span></div>
                    <button id="npc_btn_clear_all" class="ps-modern-btn secondary" style="padding: 4px 10px; font-size: 0.72rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);"><i class="fa-solid fa-trash-can"></i> Clear All</button>
                </div>
                <div id="npc_bank_list" style="display: flex; flex-direction: column; gap: 14px; padding: 4px;">
                </div>
            </div>
        </div>
    `);

    $("#npc_enable_card").on("click", function () {
        nb.enabled = !nb.enabled; saveProfileToMemory();
        if (nb.enabled) {
            $(this).addClass("active").css("border-color", "var(--gold)");
            $("#npc_main_content").slideDown(200);
            $("#npc_header_badge").css({ background: 'rgba(16,185,129,0.12)', color: '#10b981', 'border-color': 'rgba(16,185,129,0.25)' }).html(`<i class="fa-solid fa-circle-check" style="font-size:0.6rem;"></i> Enabled`);
            renderNpcList();
        } else {
            $(this).removeClass("active").css("border-color", "var(--border-color)");
            $("#npc_main_content").slideUp(200);
            $("#npc_header_badge").css({ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', 'border-color': 'var(--border-color)' }).html(`<i class="fa-solid fa-circle-xmark" style="font-size:0.6rem;"></i> Disabled`);
        }
    });

    $("#npc_btn_clear_all").on("click", function () {
        if (!localProfile.npcBank.npcs || localProfile.npcBank.npcs.length === 0) return;
        if (confirm("Are you sure you want to delete all saved NPCs? This cannot be undone.")) {
            localProfile.npcBank.npcs = [];
            saveProfileToMemory();
            renderNpcList();
        }
    });

    $("#npc_send_portraits").on("click", function () {
        nb.sendPortraitsToAi = !nb.sendPortraitsToAi; saveProfileToMemory();
        if (nb.sendPortraitsToAi) {
            $(this).addClass("active").css("border-color", "var(--gold)");
        } else {
            $(this).removeClass("active").css("border-color", "var(--border-color)");
        }
    });

    if (nb.enabled) renderNpcList();
}

function renderNpcList() {
    const list = $("#npc_bank_list");
    list.empty();
    if (!localProfile.npcBank.npcs) localProfile.npcBank.npcs = [];
    const npcs = localProfile.npcBank.npcs;
    $("#npc_count").text(`(${npcs.length})`);

    if (npcs.length === 0) {
        list.append('<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 20px;">No NPCs saved yet. The AI will add them automatically when significant NPCs are introduced.</div>');
        return;
    }

    const npcFieldMeta = [
        { key: "appearance", label: "Appearance", icon: "fa-eye", color: "#a78bfa" },
        { key: "occupation", label: "Occupation", icon: "fa-briefcase", color: "#60a5fa" },
        { key: "background", label: "Background", icon: "fa-book", color: "#34d399" },
        { key: "innerCircle", label: "Inner Circle", icon: "fa-people-group", color: "#fbbf24" },
        { key: "personality", label: "Personality", icon: "fa-masks-theater", color: "#f472b6" },
        { key: "agenda", label: "Current Agenda", icon: "fa-bullseye", color: "#fb923c" },
        { key: "hiddenLayer", label: "Hidden Layer", icon: "fa-eye-slash", color: "#ef4444" }
    ];

    [...npcs].reverse().forEach((n, revIdx) => {
        const idx = npcs.length - 1 - revIdx;
        const dateStr = new Date(n.timestamp).toLocaleDateString();
        const pfpSrc = n.pfp || "";

        // Dynamic color based on sex: Blue for male, Red/pink for female/other
        const isMale = (n.sex || "").trim().toLowerCase().startsWith("m");
        const accentColor = isMale ? "#3b82f6" : "#f43f5e";
        const accentRgba = isMale ? "59,130,246" : "244,63,94";
        const gradientFrom = isMale ? "rgba(59,130,246,0.15)" : "rgba(244,63,94,0.15)";
        const gradientTo = isMale ? "rgba(29,78,216,0.08)" : "rgba(225,29,72,0.08)";

        const pfpDisplay = pfpSrc ? `<img src="${pfpSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;" />` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;color:${accentColor};"><i class="fa-solid fa-user-secret"></i></div>`;

        let fieldsHTML = "";
        npcFieldMeta.forEach(fm => {
            const val = n[fm.key] || "";
            fieldsHTML += `
                <div class="npc-field-section" style="margin-bottom: 6px;">
                    <div style="font-size: 0.65rem; color: ${fm.color}; font-weight: 600; margin-bottom: 2px; display: flex; align-items: center; gap: 4px;">
                        <i class="fa-solid ${fm.icon}" style="font-size: 0.6rem;"></i> ${fm.label}
                    </div>
                    <textarea class="ps-modern-input npc_field_edit" data-idx="${idx}" data-field="${fm.key}" 
                        style="height: ${fm.key === 'background' || fm.key === 'innerCircle' ? '60' : '32'}px; resize: vertical; font-size: 0.7rem; padding: 4px 6px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; line-height: 1.3;"
                    >${val}</textarea>
                </div>`;
        });

        const miniPfp = pfpSrc ? `<img src="${pfpSrc}" style="width:28px;height:28px;object-fit:cover;border-radius:6px;border:1px solid rgba(${accentRgba},0.3);" />` : "";

        const card = $(`
            <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(${accentRgba},0.2); border-radius: 12px; overflow: hidden; transition: border-color 0.2s;" class="npc-card" data-accent-rgba="${accentRgba}">
                <!-- Header (clickable to toggle) -->
                <div class="npc-card-header" style="background: linear-gradient(135deg, ${gradientFrom}, ${gradientTo}); padding: 8px 14px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-chevron-right npc-chevron" style="font-size: 0.6rem; color: ${accentColor}; transition: transform 0.2s;"></i>
                        ${miniPfp}
                        <span style="font-size: 0.85rem; font-weight: 700; color: ${accentColor};">${n.name}</span>
                        <span style="font-size: 0.6rem; color: var(--text-muted); background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px;">${n.age || "?"} · ${n.sex || "?"}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="color: var(--text-muted); font-size: 0.6rem;">${dateStr}</span>
                        <button class="npc_del_btn" data-idx="${idx}" style="background: transparent; border: none; color: #ef4444; cursor: pointer; font-size: 0.75rem; padding: 2px 4px;" title="Delete NPC"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
                <!-- Body (collapsed by default) -->
                <div class="npc-card-body" style="display: none; border-top: 1px solid rgba(${accentRgba},0.15);">
                    <div style="display: flex; gap: 12px; padding: 12px;">
                        <!-- PFP Column -->
                        <div style="flex-shrink: 0; width: 160px; display: flex; flex-direction: column; gap: 8px;">
                            <div class="npc-pfp-container" style="width: 160px; height: 240px; border-radius: 10px; overflow: hidden; border: 2px solid rgba(${accentRgba},0.3); background: rgba(0,0,0,0.4);">
                                ${pfpDisplay}
                            </div>
                            <div style="text-align: center; font-size: 0.95rem; font-weight: 800; color: ${accentColor}; margin-top: 2px; margin-bottom: 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">${n.name}</div>
                            <button class="npc_upload_pfp" data-idx="${idx}" style="width: 100%; font-size: 0.65rem; padding: 4px 0; border-radius: 6px; border: 1px solid rgba(${accentRgba},0.3); background: rgba(${accentRgba},0.1); color: ${accentColor}; cursor: pointer; transition: background 0.2s;" title="Upload Image">
                                <i class="fa-solid fa-upload"></i> Upload
                            </button>
                            <button class="npc_gen_pfp" data-idx="${idx}" data-name="${n.name}" style="width: 100%; font-size: 0.65rem; padding: 4px 0; border-radius: 6px; border: 1px solid rgba(168,85,247,0.3); background: rgba(168,85,247,0.1); color: #a855f7; cursor: pointer; transition: background 0.2s;" title="Generate with ComfyUI">
                                <i class="fa-solid fa-wand-magic-sparkles"></i> Generate
                            </button>
                        </div>
                        <!-- Fields Column -->
                        <div style="flex: 1; min-width: 0;">
                            ${fieldsHTML}
                        </div>
                    </div>
                </div>
            </div>
        `);

        // Hover effect — dynamic color
        card.on("mouseenter", function () { $(this).css("border-color", `rgba(${$(this).attr('data-accent-rgba')},0.5)`); });
        card.on("mouseleave", function () { $(this).css("border-color", `rgba(${$(this).attr('data-accent-rgba')},0.2)`); });

        // Collapse / Expand toggle
        card.find(".npc-card-header").on("click", function (e) {
            if ($(e.target).closest(".npc_del_btn").length) return; // Don't toggle when clicking delete
            const body = $(this).siblings(".npc-card-body");
            const chevron = $(this).find(".npc-chevron");
            body.slideToggle(200);
            chevron.css("transform", body.is(":visible") ? "rotate(0deg)" : "rotate(90deg)");
        });

        // Field editing
        card.find(".npc_field_edit").on("change", function () {
            const i = parseInt($(this).attr("data-idx"));
            const field = $(this).attr("data-field");
            if (localProfile.npcBank.npcs[i]) {
                localProfile.npcBank.npcs[i][field] = $(this).val();
                saveProfileToMemory();
            }
        });

        // Delete
        card.find(".npc_del_btn").on("click", function () {
            const i = parseInt($(this).attr("data-idx"));
            if (confirm(`Delete ${localProfile.npcBank.npcs[i]?.name || "this NPC"}?`)) {
                localProfile.npcBank.npcs.splice(i, 1);
                saveProfileToMemory();
                renderNpcList();
            }
        });

        // Upload PFP
        card.find(".npc_upload_pfp").on("click", function () {
            const i = parseInt($(this).attr("data-idx"));
            const input = document.createElement("input");
            input.type = "file"; input.accept = "image/*";
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    // Compress to reasonable size
                    const img = new Image();
                    img.onload = () => {
                        const cvs = document.createElement("canvas");
                        const maxSize = 256;
                        let w = img.width, h = img.height;
                        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                        else { w = Math.round(w * maxSize / h); h = maxSize; }
                        cvs.width = w; cvs.height = h;
                        cvs.getContext("2d").drawImage(img, 0, 0, w, h);
                        const compressed = cvs.toDataURL("image/jpeg", 0.85);
                        localProfile.npcBank.npcs[i].pfp = compressed;
                        saveProfileToMemory();
                        renderNpcList();
                        toastr.success("Portrait uploaded!");
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            };
            input.click();
        });

        // Generate PFP via ComfyUI
        card.find(".npc_gen_pfp").on("click", async function () {
            const name = $(this).attr("data-name");
            await npcGeneratePfp(name);
        });

        list.append(card);
    });
}

// -------------------------------------------------------------
// STAGE 9: MEMORY CORE (3-Tier Context)
// -------------------------------------------------------------
function renderMemoryCore(c) {
    c.empty();
    const mem = localProfile.memoryCore;

    c.append(`
        <!-- HEADER -->
        <div class="mtab-header">
            <div class="mtab-header-left">
                <div class="mtab-header-icon" style="background: linear-gradient(135deg, #10b981, #059669);">
                    <i class="fa-solid fa-memory"></i>
                </div>
                <div>
                    <h2>Memory Core</h2>
                    <p>3-Tier Context Management: Working, Short-Term, and Long-Term Vector DB.</p>
                </div>
            </div>
            <div id="mem_header_badge" class="mtab-header-badge" style="background: ${mem.enabled ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.06)'}; color: ${mem.enabled ? '#10b981' : 'var(--text-muted)'}; border: 1px solid ${mem.enabled ? 'rgba(16,185,129,0.25)' : 'var(--border-color)'};">
                <i class="fa-solid fa-${mem.enabled ? 'circle-check' : 'circle-xmark'}" style="font-size:0.6rem;"></i> ${mem.enabled ? 'Enabled' : 'Disabled'}
            </div>
        </div>

        <!-- MASTER TOGGLE -->
        <div class="mtab-toggle-row ${mem.enabled ? 'active' : ''}" id="mem_enable_card" style="margin-bottom: 20px;">
            <div class="toggle-info">
                <div class="toggle-label"><i class="fa-solid fa-microchip" style="color:#10b981;"></i> Enable Memory Core</div>
                <div class="toggle-desc">Archiving happens silently in the background. Old messages fade in the UI and are replaced in the prompt with injected summaries.</div>
            </div>
            <div class="ps-switch"></div>
        </div>

        <div id="mem_main_content" style="display: ${mem.enabled ? 'block' : 'none'};">
            
            <!-- Dashboard Progress Bar -->
            <div class="mtab-panel" style="margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
                    <div class="mtab-panel-title green" style="margin:0;"><i class="fa-solid fa-chart-gantt"></i> Context Allocation Dashboard</div>
                    <div style="font-size: 0.75rem; font-weight: 800; color: #10b981; background: rgba(16,185,129,0.1); padding: 4px 12px; border-radius: 12px; border: 1px solid rgba(16,185,129,0.3); box-shadow: 0 0 10px rgba(16,185,129,0.2);">
                        <i class="fa-solid fa-floppy-disk"></i> <span id="mem_live_tokens_saved">~0</span> Tokens Saved
                    </div>
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span><i class="fa-solid fa-circle" style="color: #10b981; font-size: 0.5rem;"></i> Working</span>
                    <span id="mem_dash_short_lbl" style="display:${mem.architecture === 'raw_long' ? 'none' : 'inline'};">
                        <i class="fa-solid fa-circle-half-stroke" style="color: rgba(245,158,11,0.5); font-size: 0.5rem;"></i> Pend Short 
                        <i class="fa-solid fa-circle" style="color: #f59e0b; font-size: 0.5rem; margin-left:4px;"></i> Short
                    </span>
                    <span>
                        <i class="fa-solid fa-circle-half-stroke" style="color: rgba(59,130,246,0.5); font-size: 0.5rem;"></i> Pend Vault 
                        <i class="fa-solid fa-circle" style="color: #3b82f6; font-size: 0.5rem; margin-left:4px;"></i> Vault
                    </span>
                </div>
                <div class="mem-progress-container" style="background: rgba(0,0,0,0.6);">
                    <div id="mem_bar_work" style="background: #10b981; transition: width 0.2s ease;"></div>
                    <div id="mem_bar_short_pend" style="background: repeating-linear-gradient(45deg, #9a3412, #9a3412 10px, #d97706 10px, #d97706 20px); transition: width 0.2s ease;"></div>
                    <div id="mem_bar_short" style="background: #f59e0b; transition: width 0.2s ease;"></div>
                    <div id="mem_bar_long_pend" style="background: repeating-linear-gradient(45deg, #1e3a8a, #1e3a8a 10px, #2563eb 10px, #2563eb 20px); transition: width 0.2s ease;"></div>
                    <div id="mem_bar_long" style="background: #3b82f6; transition: width 0.2s ease;"></div>
                </div>
                <div style="margin-top: 10px; font-size: 0.7rem; color: var(--text-muted); text-align: center;" id="mem_status_text">
                    Monitoring Chat History...
                </div>
            </div>

            <!-- Engine Settings -->
            <div class="mtab-panel" style="margin-bottom:16px;">
                <div class="mtab-panel-title gold"><i class="fa-solid fa-gears"></i> Extraction Engine Settings</div>
                
                <!-- Quick Help / Hint -->
                <div style="background: rgba(245,158,11,0.1); border-left: 3px solid #f59e0b; padding: 12px; border-radius: 6px; margin-bottom: 16px; font-size: 0.8rem; color: var(--text-main);">
                    <div style="color: #f59e0b; font-weight: bold; margin-bottom: 6px;"><i class="fa-solid fa-circle-info"></i> How to Use</div>
                    <div style="color: var(--text-muted); line-height: 1.4;">
                        1- Choose your Memory Architecture and how much of each type you want (default is 30 raw, 70 summary).<br>
                        2- Hit <b>Apply & Extract Pending</b> to save and start it.<br>
                        3- You can choose between manual and auto. For manual, you have to hit <b>Apply & Extract Pending</b> to trigger it.
                    </div>
                </div>

                <!-- Architecture Preset Dropdown -->
                <div class="mtab-setting-row" style="padding-top: 0;">
                    <div class="set-info">
                        <div class="set-label">Memory Architecture</div>
                        <div class="set-desc">Choose how the tiers are structured.</div>
                    </div>
                    <select id="mem_architecture" class="ps-modern-input" style="width: 280px; cursor: pointer; color: var(--gold); border-color: rgba(245,158,11,0.3);">
                        <option value="raw_short_long" ${mem.architecture === 'raw_short_long' ? 'selected' : ''}>Raw Text + Short-Term Summaries + Vault</option>
                        <option value="raw_long" ${mem.architecture === 'raw_long' ? 'selected' : ''}>Raw Text + Vault Directly (Skip Summaries)</option>
                    </select>
                </div>

                <!-- Sliders Container -->
                <div style="background: rgba(0,0,0,0.2); padding: 15px; border-radius: 10px; border: 1px solid var(--border-color); margin-bottom: 15px;">
                    <div class="mtab-param-row">
                        <span class="param-label" style="width:120px;">Working Limit</span>
                        <input type="range" id="mem_work_slider" min="30" max="300" step="10" value="${mem.workingLimit}">
                        <span id="mem_work_val" style="font-size:0.8rem; font-weight:bold; min-width:30px; text-align:right;">${mem.workingLimit}</span>
                    </div>
                    <div class="mtab-param-row" id="mem_short_slider_row" style="display:${mem.architecture === 'raw_long' ? 'none' : 'flex'};">
                        <span class="param-label" style="width:120px;">Short-Term Limit</span>
                        <input type="range" id="mem_short_slider" min="10" max="1000" step="10" value="${mem.shortTermLimit}">
                        <span id="mem_short_val" style="font-size:0.8rem; font-weight:bold; min-width:30px; text-align:right;">${mem.shortTermLimit}</span>
                    </div>
                    
                    <!-- NEW APPLY BUTTON -->
                    <div style="margin-top: 15px; display: flex; justify-content: flex-end; border-top: 1px dashed var(--border-color); padding-top: 15px;">
                        <button id="mem_btn_apply_limits" class="ps-modern-btn secondary" style="color: #10b981; border-color: rgba(16,185,129,0.3); font-size: 0.75rem; padding: 6px 14px;">
                            <i class="fa-solid fa-arrows-rotate"></i> Apply & Extract Pending
                        </button>
                    </div>
                </div>

                <div class="mtab-setting-row" style="border-top: 1px solid rgba(255,255,255,0.04); padding-top: 14px;">
                    <div class="set-info">
                        <div class="set-label">Generator Backend</div>
                    </div>
                    <select id="mem_backend" class="ps-modern-input" style="width: 220px; cursor: pointer;">
                        <option value="direct" ${mem.backend === 'direct' ? 'selected' : ''}>Direct API Call (Fast)</option>
                        <option value="preset" ${mem.backend === 'preset' ? 'selected' : ''}>Megumin Engine Preset</option>
                    </select>
                </div>
                <div class="mtab-setting-row" style="border-top: 1px solid rgba(255,255,255,0.04); padding-top: 14px;">
                    <div class="set-info">
                        <div class="set-label">Vault Scanner Engine</div>
                        <div class="set-desc">TF-IDF (Fast/Local) or Semantic Embeddings (Requires ST Vector Storage enabled).</div>
                    </div>
                    <select id="mem_scanner_engine" class="ps-modern-input" style="width: 280px; cursor: pointer;">
                        <option value="tfidf" ${mem.scannerEngine === 'tfidf' ? 'selected' : ''}>TF-IDF Keyword Matcher</option>
                        <option value="semantic" ${mem.scannerEngine === 'semantic' ? 'selected' : ''}>Semantic Embeddings (ST Native API)</option>
                    </select>
                </div>
                <div class="mtab-setting-row">
                    <div class="set-info">
                        <div class="set-label">Auto-Trigger Mode</div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <select id="mem_trigger" class="ps-modern-input" style="width: 150px; cursor: pointer;">
                            <option value="manual" ${mem.triggerMode === 'manual' ? 'selected' : ''}>Manual Only</option>
                            <option value="frequency" ${mem.triggerMode === 'frequency' ? 'selected' : ''}>Every 10 Replies</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Short-Term Editor -->
            <div class="mtab-panel" style="margin-bottom:16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                    <div class="mtab-panel-title gold" style="margin-bottom:0;">
                        <i class="fa-solid fa-box-archive"></i> Short-Term Memory
                        <span id="mem_processing_spinner" style="display:none; margin-left: 10px;" class="mem-spinner"><i class="fa-solid fa-circle-notch"></i></span>
                    </div>
                </div>
                
                <div id="mem_short_term_list">
                    <!-- Accordions Injected Here -->
                </div>
            </div>

            <!-- Long-Term Vault -->
            <div class="mtab-panel">
                <div class="mtab-panel-title blue" style="display:flex; justify-content:space-between;">
                    <span><i class="fa-solid fa-database"></i> Long-Term Vault (Vector Storage)</span>
                    <span id="mem_vault_count" style="font-size:0.7rem; color:var(--text-muted);">0 Entries</span>
                </div>
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <input type="text" id="mem_vault_search" class="ps-modern-input" placeholder="Search archived memories..." style="flex: 1; border-color: rgba(59,130,246,0.3);">
                    <button id="mem_btn_test_vector" class="ps-modern-btn secondary" style="color: #3b82f6; border-color: rgba(59,130,246,0.3);" title="See what memories the AI is retrieving right now"><i class="fa-solid fa-radar"></i> Test Scanner</button>
                </div>
                <div id="mem_vault_list" style="max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
                    <!-- Vault items injected here -->
                </div>
            </div>
        </div>
    `);

    // Toggle Listener
    $("#mem_enable_card").on("click", function () {
        mem.enabled = !mem.enabled; saveProfileToMemory();
        if (mem.enabled) {
            $(this).addClass("active").css("border-color", "var(--gold)");
            $("#mem_main_content").slideDown(200);
            $("#mem_header_badge").css({ background: 'rgba(16,185,129,0.12)', color: '#10b981', 'border-color': 'rgba(16,185,129,0.25)' }).html(`<i class="fa-solid fa-circle-check" style="font-size:0.6rem;"></i> Enabled`);
            memRenderDashboard();
        } else {
            $(this).removeClass("active").css("border-color", "var(--border-color)");
            $("#mem_main_content").slideUp(200);
            $("#mem_header_badge").css({ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', 'border-color': 'var(--border-color)' }).html(`<i class="fa-solid fa-circle-xmark" style="font-size:0.6rem;"></i> Disabled`);
        }
        updateMemoryVisuals();
    });

    // Slider & Architecture Listeners
    $("#mem_architecture").on("change", function () {
        mem.architecture = $(this).val();
        if (mem.architecture === "raw_long") {
            $("#mem_short_slider_row").hide();
            $("#mem_dash_short_lbl").hide();
            $("#mem_bar_short, #mem_bar_short_pend").hide();
        } else {
            $("#mem_short_slider_row").css("display", "flex");
            $("#mem_dash_short_lbl").show();
            $("#mem_bar_short, #mem_bar_short_pend").css("display", "block");
        }
        saveProfileToMemory();
        memRunVaultMigration();
        memRenderDashboard();
    });

    $("#mem_work_slider").on("input", function () {
        let val = parseInt($(this).val());
        mem.workingLimit = val;
        $("#mem_work_val").text(val);

        // Short-term is now independent, no forced minimums based on working limit
        saveProfileToMemory();
        memRenderDashboard();
    });

    $("#mem_scanner_engine").on("change", async function () {
        mem.scannerEngine = $(this).val();
        saveProfileToMemory();
        if (mem.scannerEngine === 'semantic') {
            toastr.info("Semantic Mode active. Syncing vault to Vector Database...");
            await memInsertToVectorDB(mem.longTermVault);
            await memUpdateSemanticQuery();
            toastr.success("Vector Database Synced!");
        }
    });

    // Trigger migration ONLY on 'change' (when they let go of the mouse click) to avoid spamming calculations
    $("#mem_work_slider").on("change", function () { memRunVaultMigration(); });

    $("#mem_short_slider").on("input", function () {
        let val = parseInt($(this).val());
        mem.shortTermLimit = val;
        $("#mem_short_val").text(val);
        saveProfileToMemory();
        memRenderDashboard();
    });
    $("#mem_short_slider").on("change", function () { memRunVaultMigration(); });

    $("#mem_trigger").on("change", function () {
        mem.triggerMode = $(this).val();
        saveProfileToMemory();
    });

    // Apply Limits & Auto-Extract Button
    $("#mem_btn_apply_limits").off("click").on("click", async function () {
        memSyncLimits(); // Scrub overlaps first

        // Check if there is actually anything pending to extract
        const context = typeof getContext === "function" ? getContext() : null;
        if (!context || !context.chat) return;
        let totalRealMessages = 0;
        for (let m of context.chat) { if (!m.is_system) totalRealMessages++; }

        const workingLimit = mem.workingLimit || 30;
        if (totalRealMessages > workingLimit) {
            toastr.info("Starting automatic extraction to fill new limits...");
            await memProcessPendingChunks(); // Start extraction!
        }
    });

    // Test Vector Scanner Button (Dual Engine UI)
    $("body").off("click", "#mem_btn_test_vector").on("click", "#mem_btn_test_vector", async function () {
        const context = typeof getContext === "function" ? getContext() : null;
        const mem = localProfile?.memoryCore;
        const engine = mem?.scannerEngine || 'tfidf';

        let html = `<div style="font-family: 'Inter', sans-serif; font-size: 0.85rem; color: var(--text-main); text-align: left; display: flex; flex-direction: column; gap: 10px;">`;

        if (engine === 'semantic') {
            toastr.info("Querying SillyTavern Vector Database...");
            $("#mem_btn_test_vector").prop("disabled", true);
            await memUpdateSemanticQuery(); // Force a fresh query right now
            $("#mem_btn_test_vector").prop("disabled", false);

            if (currentSemanticMatches.length === 0) {
                toastr.error("Semantic API Failed. Is ST Vector Storage enabled?");
            } else {
                html += `<div style="background: rgba(168,85,247,0.1); border-left: 3px solid #a855f7; padding: 10px; border-radius: 4px; margin-bottom: 5px;">
                <div style="color: #a855f7; font-weight: bold; margin-bottom: 4px;">Semantic Embeddings Engine Active</div>
                <div style="color: var(--text-muted); font-size: 0.75rem;">Using SillyTavern's Vector Storage API (LanceDB) to find the deep contextual meaning of the last 2 messages.</div>
            </div>`;
            }
        }

        // Only show TF-IDF block if Semantic failed OR TF-IDF is manually selected
        if (engine === 'tfidf' || currentSemanticMatches.length === 0) {
            const recentCleanedText = context.chat.filter(m => !m.is_system).slice(-4).map(m => meguminCleanChatHistoryText(m.mes)).join(" ").toLowerCase();
            const uniqueKeywords = memExtractKeywords(recentCleanedText);
            html += `<div style="background: rgba(16,185,129,0.1); border-left: 3px solid #10b981; padding: 10px; border-radius: 4px; margin-bottom: 5px;">
            <div style="color: #10b981; font-weight: bold; margin-bottom: 4px;">TF-IDF Smart Keywords (Last 2 Messages):</div>
            <div style="color: var(--text-muted); font-size: 0.75rem;">${uniqueKeywords.join(", ") || "None"}</div>
        </div>`;
        }

        const matches = memGetRelevantVaultEntries();

        if (matches.length === 0) {
            html += `<div style="padding: 10px;">No highly relevant memories found for the current context.</div>`;
        } else {
            html += `<div style="color: var(--text-muted); margin-bottom: 5px;">The following archives will be injected into the prompt:</div>`;
            matches.forEach(m => {
                const content = m.text || m.summary;
                const scoreColor = engine === 'semantic' ? '#a855f7' : '#3b82f6';
                html += `<div style="background: rgba(0,0,0,0.3); border-left: 3px solid ${scoreColor}; padding: 10px; border-radius: 4px;">
                <div style="color: ${scoreColor}; font-weight: bold; font-size: 0.75rem; margin-bottom: 2px;">[Match Score: ${m.score}] | Msg ${m.id}</div>
                <div style="color: #f59e0b; font-weight: bold; font-size: 0.7rem; margin-bottom: 6px;">Matched Triggers: ${m.matchedWords.join(", ")}</div>
                <div style="max-height: 150px; overflow-y: auto; white-space: pre-wrap; font-size: 0.8rem; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">${content}</div>
            </div>`;
            });
        }
        html += `</div>`;

        const { Popup, POPUP_TYPE } = typeof getContext === "function" ? getContext() : window;
        if (Popup) {
            const popup = new Popup(html, POPUP_TYPE.TEXT, "Vault Scanner Results", { wide: true });
            await popup.show();
        }
    });

    if (mem.enabled) {
        memRenderDashboard();
        memRenderAccordion();
        memRenderVault();
    }
}

function memRenderDashboard() {
    const context = typeof getContext === "function" ? getContext() : null;
    const chat = context?.chat || [];
    const mem = localProfile.memoryCore;

    let totalRealMessages = 0;
    for (let m of chat) { if (!m.is_system) totalRealMessages++; }

    $("#mem_live_tokens_saved").text(`~${memCalculateTokensSaved()}`);

    const isRawLong = (mem.architecture === "raw_long");

    // 1. Determine the projected TARGET sizes based purely on sliders
    const targetWork = Math.min(totalRealMessages, mem.workingLimit || 30);
    const targetShort = isRawLong ? 0 : Math.min(Math.max(0, totalRealMessages - targetWork), mem.shortTermLimit || 70);
    const targetLong = isRawLong ? Math.max(0, totalRealMessages - targetWork) : Math.max(0, totalRealMessages - (targetWork + (mem.shortTermLimit || 70)));

    // 2. Determine ACTUAL summarized chunks currently in memory
    let actualShort = 0;
    if (mem.shortTermChunks && !isRawLong) {
        mem.shortTermChunks.forEach(c => {
            const parts = c.id.split("-");
            actualShort += (parseInt(parts[1]) - parseInt(parts[0]) + 1);
        });
    }

    let actualLong = 0;
    if (mem.longTermVault) {
        mem.longTermVault.forEach(c => {
            const parts = c.id.split("-");
            actualLong += (parseInt(parts[1]) - parseInt(parts[0]) + 1);
        });
    }

    // 3. Calculate Pending (Stripes) vs Displayed Actuals (Solid)
    const pendShort = Math.max(0, targetShort - actualShort);
    const displayShort = Math.min(targetShort, actualShort);

    const pendLong = Math.max(0, targetLong - actualLong);
    const displayLong = Math.min(targetLong, actualLong);

    if (isRawLong) {
        $("#mem_bar_short_pend, #mem_bar_short").hide();
    } else {
        $("#mem_bar_short_pend, #mem_bar_short").css("display", "block"); // Force it to show!
    }

    // 4. Convert to Percentages for the CSS Bar
    const maxBarScale = Math.max(totalRealMessages, 1);
    const pWork = (targetWork / maxBarScale) * 100;
    const pPendShort = (pendShort / maxBarScale) * 100;
    const pDispShort = (displayShort / maxBarScale) * 100;
    const pPendLong = (pendLong / maxBarScale) * 100;
    const pDispLong = (displayLong / maxBarScale) * 100;

    $("#mem_bar_work").css("width", `${pWork}%`);
    $("#mem_bar_short_pend").css("width", `${pPendShort}%`);
    $("#mem_bar_short").css("width", `${pDispShort}%`);
    $("#mem_bar_long_pend").css("width", `${pPendLong}%`);
    $("#mem_bar_long").css("width", `${pDispLong}%`);

    const shortText = isRawLong ? "" : `Pend Short: ${pendShort} | Short: ${displayShort} | `;
    $("#mem_status_text").text(`Total: ${totalRealMessages} | Working: ${targetWork} | ${shortText}Pend Vault: ${pendLong} | Vault: ${displayLong}`);
}

// Renders the editable text areas for chunks already processed
function memRenderAccordion() {
    const mem = localProfile.memoryCore;
    const list = $("#mem_short_term_list");
    list.empty();

    if (!mem.shortTermChunks || mem.shortTermChunks.length === 0) {
        list.append(`<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 10px;">No chunks generated yet. Generate chat messages to trigger background summarization.</div>`);
        return;
    }

    // Reverse array to show newest chunks at the top
    const chunks = [...mem.shortTermChunks].reverse();

    chunks.forEach(chunk => {
        const dateStr = new Date(chunk.timestamp).toLocaleString();
        const acc = $(`
            <div class="mem-accordion">
                <div class="mem-accordion-header">
                    <span><i class="fa-solid fa-layer-group" style="color:var(--gold); margin-right:6px;"></i> Messages: ${chunk.id}</span>
                    <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 400;"><i class="fa-regular fa-clock"></i> ${dateStr}</span>
                </div>
                <div class="mem-accordion-body">
                    <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:6px;">You can manually edit this state extraction before it gets pushed to the Vector DB.</div>
                    <textarea class="mem_chunk_edit" data-id="${chunk.id}">${chunk.summary}</textarea>
                </div>
            </div>
        `);

        // Accordion Toggle
        acc.find(".mem-accordion-header").on("click", function () {
            $(this).next(".mem-accordion-body").slideToggle(150);
        });

        // Auto-save edits
        acc.find("textarea").on("input", function () {
            const id = $(this).attr("data-id");
            const newText = $(this).val();
            const target = localProfile.memoryCore.shortTermChunks.find(c => c.id === id);
            if (target) {
                target.summary = newText;
                saveProfileToMemory();
            }
        });

        list.append(acc);
    });
}

// Renders the Long-Term Vault UI with Search Filtering
function memRenderVault(searchFilter = "") {
    const mem = localProfile.memoryCore;
    const list = $("#mem_vault_list");
    list.empty();

    if (!mem.longTermVault) mem.longTermVault = [];
    $("#mem_vault_count").text(`${mem.longTermVault.length} Entries`);

    if (mem.longTermVault.length === 0) {
        const passMsg = (mem.workingLimit || 30) + (mem.shortTermLimit || 70);
        list.append(`<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 10px;">Vault is empty. Chunks automatically migrate here once they pass message ${passMsg}.</div>`);
        return;
    }

    // Filter using .text (fallback to .summary just in case you have old saves)
    const filtered = mem.longTermVault.filter(c => {
        const content = c.text || c.summary || "";
        return content.toLowerCase().includes(searchFilter.toLowerCase());
    }).reverse();

    filtered.forEach(chunk => {
        const dateStr = new Date(chunk.timestamp).toLocaleDateString();
        const content = chunk.text || chunk.summary || "";

        const row = $(`
            <div style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; position: relative;">
                <div style="font-size: 0.65rem; color: #3b82f6; font-weight: 700; margin-bottom: 4px; display: flex; justify-content: space-between;">
                    <span>ARCHIVE #${chunk.id}</span>
                    <span>${dateStr}</span>
                </div>
                <textarea class="ps-modern-input mem_vault_edit" data-id="${chunk.id}" style="height: 120px; resize: vertical; font-size: 0.75rem; border: none; background: transparent; padding: 0;">${content}</textarea>
                <button class="mem_vault_del" data-id="${chunk.id}" style="position: absolute; bottom: 8px; right: 10px; background: transparent; border: none; color: #ef4444; cursor: pointer; font-size: 0.8rem;" title="Delete Archive"><i class="fa-solid fa-trash"></i></button>
            </div>
        `);

        // Auto-save edits to .text
        row.find(".mem_vault_edit").on("change", function () {
            const id = $(this).attr("data-id");
            const target = localProfile.memoryCore.longTermVault.find(c => c.id === id);
            if (target) {
                target.text = $(this).val();
                saveProfileToMemory();
                if (localProfile.memoryCore.scannerEngine === 'semantic') memInsertToVectorDB([target]);
            }
        });

        // Delete button
        row.find(".mem_vault_del").on("click", function () {
            if (confirm("Permanently delete this archived memory?")) {
                const id = $(this).attr("data-id");
                localProfile.memoryCore.longTermVault = localProfile.memoryCore.longTermVault.filter(c => c.id !== id);
                if (localProfile.memoryCore.scannerEngine === 'semantic') memDeleteFromVectorDB([id]);
                saveProfileToMemory();
                memRenderVault($("#mem_vault_search").val());
                memRenderDashboard();
            }
        });

        list.append(row);
    });
}

// Live Search Listener
$("body").off("input", "#mem_vault_search").on("input", "#mem_vault_search", function () {
    memRenderVault($(this).val());
});

// --- MEMORY GENERATION LOGIC ---

async function memProcessPendingChunks() {
    const context = typeof getContext === "function" ? getContext() : null;
    if (!context || !context.chat || !localProfile.memoryCore.enabled) return;

    const chat = context.chat;
    const mem = localProfile.memoryCore;
    const workingLimit = mem.workingLimit || 30;
    const shortTermLimit = mem.shortTermLimit || 70;

    // 1. Get a clean array of [Index, Message Object]
    const realMessages = [];
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i].is_system) realMessages.push({ originalIndex: i, msg: chat[i] });
    }

    if (realMessages.length <= workingLimit) {
        toastr.info("Not enough messages past the working limit to archive.");
        return;
    }

    // 2. Grab EVERYTHING outside of the Working Memory
    const archivableMessages = realMessages.slice(0, realMessages.length - workingLimit);

    // Identify the cutoff point where messages go straight to the Vault
    const effectiveShortTermLimit = mem.architecture === "raw_long" ? workingLimit : (workingLimit + shortTermLimit);
    const vaultCutoffLimit = Math.max(0, realMessages.length - effectiveShortTermLimit);
    let vaultCutoffMessageIndex = -1;
    if (vaultCutoffLimit > 0 && realMessages[vaultCutoffLimit]) {
        vaultCutoffMessageIndex = realMessages[vaultCutoffLimit].originalIndex;
    }

    // 3. Group into chunks of 10 and find what is missing
    const chunksToProcess = [];
    for (let i = 0; i < archivableMessages.length; i += 10) {
        const chunk = archivableMessages.slice(i, i + 10);
        if (chunk.length === 0) continue;

        const startId = chunk[0].originalIndex;
        const endId = chunk[chunk.length - 1].originalIndex;
        const chunkId = `${startId}-${endId}`;

        if (!isMessageArchived(startId, mem)) {
            let rawText = "";
            chunk.forEach(item => {
                rawText += `${item.msg.name}: ${meguminCleanChatHistoryText(item.msg.mes)}\n\n`;
            });
            chunksToProcess.push({ id: chunkId, text: rawText.trim(), endId: endId });
        }
    }

    if (chunksToProcess.length === 0) {
        memRunVaultMigration();
        toastr.info("All archives are up to date.");
        return;
    }

    // 4. Process the missing chunks
    $("#mem_processing_spinner").show();
    $("#mem_btn_generate").prop("disabled", true).css("opacity", "0.5");

    try {
        for (let chunkData of chunksToProcess) {

            // --- DIRECT-TO-VAULT BYPASS ---
            // If this chunk is older than the Short-Term limit, skip the AI entirely!
            if (vaultCutoffMessageIndex !== -1 && chunkData.endId < vaultCutoffMessageIndex) {
                toastr.info(`Bypassing AI: Archiving Messages ${chunkData.id} directly to Vault...`);

                if (!mem.longTermVault) mem.longTermVault = [];
                mem.longTermVault.push({
                    id: chunkData.id,
                    text: chunkData.text, // Store the raw text directly!
                    timestamp: Date.now()
                });

                saveProfileToMemory();
                memRenderVault($("#mem_vault_search").val() || "");
                memRenderDashboard();
                updateMemoryVisuals();
                continue; // Skip the rest of the loop
            }

            // --- NORMAL SHORT-TERM AI SUMMARIZATION ---
            toastr.info(`Extracting State: Messages ${chunkData.id}...`);

            let summaryResult = "";
            activeMemorySummarizationRequest = chunkData.text;

            if (!mem.backend || mem.backend === "direct") {
                summaryResult = await generateQuietPrompt({ prompt: "___PS_MEMORY_SUMMARIZE___" });
            } else {
                await useMeguminEngine(async () => {
                    summaryResult = await generateQuietPrompt({ prompt: "___PS_MEMORY_SUMMARIZE___" });
                }, "Megumin Engine");
            }

            summaryResult = summaryResult.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

            if (summaryResult) {
                if (!mem.shortTermChunks) mem.shortTermChunks = [];
                mem.shortTermChunks.push({
                    id: chunkData.id,
                    summary: summaryResult,
                    timestamp: Date.now()
                });

                saveProfileToMemory();
                memRunVaultMigration(); // Check if anything aged out
                memRenderAccordion();
                memRenderDashboard();
                updateMemoryVisuals();
            }
        }

        memRunVaultMigration();
        toastr.success("Archive Extraction Complete!");

    } catch (err) {
        console.error("Memory Extraction Error:", err);
        toastr.error("Failed to generate memory summaries.");
    } finally {
        activeMemorySummarizationRequest = null;
        $("#mem_processing_spinner").hide();
        $("#mem_btn_generate").prop("disabled", false).css("opacity", "1");
    }
}

// Standalone helper to push old chunks into the Vault (AS RAW TEXT)
function memRunVaultMigration() {
    const context = typeof getContext === "function" ? getContext() : null;
    if (!context || !context.chat || !localProfile.memoryCore.enabled) return;

    const chat = context.chat;
    const mem = localProfile.memoryCore;
    const effectiveShortTermLimit = mem.architecture === "raw_long" ? (mem.workingLimit || 30) : ((mem.workingLimit || 30) + (mem.shortTermLimit || 70));

    const realMessages = [];
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i].is_system) realMessages.push({ originalIndex: i, msg: chat[i] });
    }

    const cutoffLimit = Math.max(0, realMessages.length - effectiveShortTermLimit);
    let cutoffMessageIndex = -1;

    if (cutoffLimit > 0 && realMessages[cutoffLimit]) {
        cutoffMessageIndex = realMessages[cutoffLimit].originalIndex;
    }

    if (cutoffMessageIndex !== -1 && mem.shortTermChunks && mem.shortTermChunks.length > 0) {
        let migrated = false;
        for (let i = mem.shortTermChunks.length - 1; i >= 0; i--) {
            const chunk = mem.shortTermChunks[i];
            const endMsgId = parseInt(chunk.id.split("-")[1]);

            // If the chunk is older than the Short-Term cutoff, migrate it as RAW TEXT!
            if (endMsgId < cutoffMessageIndex) {
                if (!mem.longTermVault) mem.longTermVault = [];

                // --- RECONSTRUCT RAW TEXT ---
                const parts = chunk.id.split("-");
                const startId = parseInt(parts[0]);
                const stopId = parseInt(parts[1]);
                let rawText = "";

                for (let j = startId; j <= stopId; j++) {
                    if (chat[j] && !chat[j].is_system) {
                        rawText += `${chat[j].name}: ${meguminCleanChatHistoryText(chat[j].mes)}\n\n`;
                    }
                }

                // Push raw text instead of summary
                mem.longTermVault.push({
                    id: chunk.id,
                    text: rawText.trim(), // Use 'text' key for raw data
                    timestamp: Date.now()
                });

                const newVaultChunk = mem.longTermVault[mem.longTermVault.length - 1];
                if (mem.scannerEngine === 'semantic') memInsertToVectorDB([newVaultChunk]);

                mem.shortTermChunks.splice(i, 1);
                migrated = true;
            }
        }
        if (migrated) {
            saveProfileToMemory();
            memRenderAccordion();
            memRenderVault($("#mem_vault_search").val() || "");
            memRenderDashboard();
        }
    }
}

// -------------------------------------------------------------
// STAGE 9 HELPER FUNCTIONS: MEMORY INTERCEPT & VISUALS
// -------------------------------------------------------------

// Checks if a message index is safely stored in either Short-Term or Long-Term memory
function isMessageArchived(mesId, mem) {
    if (!mem) return false;

    const checkChunk = (c) => {
        const parts = c.id.split("-");
        return mesId >= parseInt(parts[0]) && mesId <= parseInt(parts[1]);
    };

    const inShort = mem.shortTermChunks && mem.shortTermChunks.some(checkChunk);
    const inLong = mem.longTermVault && mem.longTermVault.some(checkChunk);

    return inShort || inLong;
}

// Scrubs the memory arrays and pulls overlapping chunks back into active chat
function memSyncLimits() {
    const context = typeof getContext === "function" ? getContext() : null;
    if (!context || !context.chat || !localProfile.memoryCore) return;

    const chat = context.chat;
    const mem = localProfile.memoryCore;

    let realMessages = [];
    for (let i = 0; i < chat.length; i++) {
        if (!chat[i].is_system) realMessages.push(i);
    }

    // Find the cutoff index for Working Memory
    const workingCutoffIndex = realMessages.length <= mem.workingLimit
        ? 0
        : realMessages[realMessages.length - mem.workingLimit];

    // Find the cutoff index for Short-Term Memory
    const effectiveShortLimit = (mem.workingLimit || 30) + (mem.shortTermLimit || 70);
    const shortCutoffIndex = realMessages.length <= effectiveShortLimit
        ? 0
        : realMessages[realMessages.length - effectiveShortLimit];

    let changesMade = false;

    // 1. Scrub Short-Term Chunks
    if (mem.shortTermChunks) {
        for (let i = mem.shortTermChunks.length - 1; i >= 0; i--) {
            const chunk = mem.shortTermChunks[i];
            const endId = parseInt(chunk.id.split("-")[1]);
            // If the chunk overlaps the Working Limit, delete the archive!
            if (endId >= workingCutoffIndex) {
                mem.shortTermChunks.splice(i, 1);
                changesMade = true;
            }
        }
    }

    // 2. Scrub Long-Term Vault
    if (mem.longTermVault) {
        for (let i = mem.longTermVault.length - 1; i >= 0; i--) {
            const chunk = mem.longTermVault[i];
            const endId = parseInt(chunk.id.split("-")[1]);

            // If it overlaps Working Memory, delete it!
            if (endId >= workingCutoffIndex) {
                mem.longTermVault.splice(i, 1);
                changesMade = true;
            }
            // If it overlaps Short-Term Memory (and we are using summaries), delete it to force a re-summary!
            else if (mem.architecture === "raw_short_long" && endId >= shortCutoffIndex) {
                mem.longTermVault.splice(i, 1);
                changesMade = true;
            }
        }
    }

    if (changesMade) {
        saveProfileToMemory();
        toastr.success("Limits Applied! Overlapping archives returned to chat.");
    } else {
        toastr.info("Limits Applied. No overlaps found.");
    }

    memRunVaultMigration(); // Push any remaining items down
    memRenderAccordion();
    memRenderVault($("#mem_vault_search").val() || "");
    memRenderDashboard();
    updateMemoryVisuals(); // Remove the gray styling from the restored messages
}

// Universal Language Tokenizer: Automatically handles English, Arabic, Russian, and CJK (Chinese/Japanese/Korean)
function memExtractKeywords(text) {
    let rawWords = [];

    // 1. Use modern native JS segmenter which understands Japanese/Chinese word boundaries!
    if (window.Intl && Intl.Segmenter) {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
        for (const { segment, isWordLike } of segmenter.segment(text)) {
            if (isWordLike) rawWords.push(segment.toLowerCase());
        }
    } else {
        // Fallback for extremely old browsers
        rawWords = text.match(/\p{L}+/gu) || [];
    }

    // 2. Filter the words smartly based on their language
    return [...new Set(rawWords)].filter(kw => {
        // Drop English stop words
        if (MEMORY_STOP_WORDS.has(kw)) return false;

        // If it contains CJK characters (Chinese, Japanese, Korean)
        if (/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(kw)) {
            return kw.length >= 1; // CJK nouns can be 1 character (e.g. 剣 "sword", 猫 "cat")
        }

        // Alphabetic languages (English, Arabic, Russian) need 3+ letters to filter out small junk
        return kw.length >= 3;
    });
}

// Calculates estimated tokens saved by the memory system
function memCalculateTokensSaved() {
    const context = typeof getContext === "function" ? getContext() : null;
    const mem = localProfile?.memoryCore;
    if (!context || !context.chat || !mem || !mem.enabled) return 0;

    let strippedChars = 0;
    for (let i = 0; i < context.chat.length; i++) {
        if (!context.chat[i].is_system && isMessageArchived(i, mem)) {
            strippedChars += context.chat[i].mes.length;
        }
    }

    let injectedChars = 0;
    if (mem.architecture === "raw_short_long" && mem.shortTermChunks) {
        mem.shortTermChunks.forEach(c => injectedChars += (c.summary || "").length);
    }

    // Assume top 3 vault entries injected
    const retrieved = memGetRelevantVaultEntries();
    retrieved.forEach(m => injectedChars += (m.text || m.summary || "").length);

    // Standard approximation: 4 characters = 1 token
    const savedTokens = Math.max(0, Math.ceil((strippedChars - injectedChars) / 4));
    return savedTokens;
}

// Expanded stop words including common RP verbs and adjectives
const MEMORY_STOP_WORDS = new Set(["about", "above", "across", "after", "again", "against", "almost", "alone", "along", "already", "always", "among", "another", "anybody", "anyone", "anything", "anywhere", "around", "asked", "became", "because", "become", "been", "before", "began", "behind", "being", "below", "beside", "besides", "between", "beyond", "both", "came", "cannot", "come", "could", "didn't", "does", "doesn't", "doing", "don't", "during", "each", "either", "enough", "even", "ever", "every", "everyone", "everything", "everywhere", "except", "feel", "find", "first", "from", "front", "gave", "getting", "give", "given", "going", "good", "great", "happened", "have", "having", "heard", "hello", "help", "here", "herself", "himself", "however", "inside", "itself", "just", "knew", "know", "known", "left", "less", "like", "little", "look", "looked", "looking", "made", "make", "many", "matter", "mean", "might", "more", "most", "much", "must", "myself", "never", "next", "nobody", "none", "nothing", "nowhere", "often", "only", "other", "others", "ought", "ourselves", "outside", "over", "perhaps", "please", "probably", "quite", "rather", "really", "right", "said", "same", "saying", "seem", "seemed", "seems", "several", "shall", "should", "since", "small", "some", "somebody", "someone", "something", "sometimes", "somewhere", "soon", "still", "such", "sure", "take", "tell", "than", "that", "their", "theirs", "them", "themselves", "then", "there", "these", "they", "thing", "things", "think", "this", "those", "though", "thought", "three", "through", "together", "told", "took", "toward", "towards", "tried", "under", "unless", "until", "upon", "very", "want", "wanted", "well", "went", "were", "what", "when", "where", "which", "while", "whom", "whose", "will", "with", "within", "without", "would", "wrong", "yeah", "your", "yours", "yourself", "yourselves", "details", "summary", "infoblock", "chatter", "dialogue", "narration", "narrative", "status", "tracker", "world", "state", "action", "words", "smiled", "nodded", "sighed", "walked", "eyes", "face", "turned", "replied", "whispered", "gazed", "stared", "glanced", "stepped", "shifted", "voice", "hands", "head", "fingers", "hair", "door", "room", "time", "back", "away", "down", "suddenly", "slowly", "softly", "quietly", "gently", "slightly", "single", "simply", "short", "sharp", "began"]);

// --- SEMANTIC EMBEDDING HELPERS ---

// Converts a string ID to a numeric hash (required by ST's Vectra backend)
function memStringHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

// Math: Calculates how similar two semantic vectors are (0.0 to 1.0)
function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0; let normA = 0; let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// NOTE: memGetEmbedding / memUpdateCurrentQueryVector / memUpdateVaultEmbeddings removed.
// ST's native /api/vector/* API does NOT expose raw embeddings. Embedding is done server-side
// during insert and query. We use the proper insert+query flow instead of client-side cosine math.

// --- SEMANTIC EMBEDDING HELPERS (NATIVE ST VECTRA) ---

let currentSemanticMatches = [];

// Creates a unique database collection name for this specific character/group
function memGetCollectionId() {
    const context = typeof getContext === "function" ? getContext() : null;
    if (!context) return "megumin_default";
    const charId = context.characterId !== undefined ? String(context.characterId) : "group_" + context.groupId;
    return ("megumin_" + charId).replace(/[^a-zA-Z0-9_]/g, "_");
}

// Inserts vault chunks into ST's native vector database
async function memInsertToVectorDB(chunks) {
    if (!chunks || chunks.length === 0) return;
    const collectionId = memGetCollectionId();
    // ST's /api/vector/insert requires items with { hash: Number, text: String, index: Number }
    const items = chunks.map((c, i) => ({
        hash: memStringHash(c.id),
        text: c.text || c.summary || "",
        index: i
    }));
    try {
        await fetch('/api/vector/insert', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ collectionId, items, source: 'transformers' })
        });
    } catch (e) { console.warn("Megumin Suite: Vector Insert failed.", e); }
}

// Deletes vault chunks from ST's native vector database
async function memDeleteFromVectorDB(ids) {
    if (!ids || ids.length === 0) return;
    const collectionId = memGetCollectionId();
    // ST's /api/vector/delete requires { hashes: Number[] }, not string ids
    const hashes = ids.map(id => memStringHash(id));
    try {
        await fetch('/api/vector/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ collectionId, hashes, source: 'transformers' })
        });
    } catch (e) { console.warn("Megumin Suite: Vector Delete failed.", e); }
}

// Background task: Queries the DB silently while you chat so the AI's prompt is always ready
async function memUpdateSemanticQuery() {
    const mem = localProfile?.memoryCore;
    if (!mem || mem.scannerEngine !== 'semantic' || !mem.longTermVault || mem.longTermVault.length === 0) {
        currentSemanticMatches = [];
        return;
    }
    const context = typeof getContext === "function" ? getContext() : null;
    if (!context || !context.chat) return;

    const recentCleanedText = context.chat.filter(m => !m.is_system).slice(-2).map(m => meguminCleanChatHistoryText(m.mes)).join(" ");
    if (!recentCleanedText.trim()) return;

    const collectionId = memGetCollectionId();
    try {
        const res = await fetch('/api/vector/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                collectionId,
                searchText: recentCleanedText,
                topK: 3,
                source: 'transformers',
                threshold: 0.2
            })
        });
        if (res.ok) {
            const data = await res.json();
            // ST returns { hashes: number[], metadata: object[] }
            if (data && Array.isArray(data.metadata)) {
                currentSemanticMatches = data.metadata.map(meta => {
                    // Match back to vault using the numeric hash
                    const vaultEntry = mem.longTermVault.find(v => memStringHash(v.id) === meta.hash);
                    if (vaultEntry) {
                        return { ...vaultEntry, score: 99, matchedWords: ["Semantic Embedding Match (Vectra)"] };
                    }
                    // Fallback: try text match if hash doesn't match
                    const textMatch = mem.longTermVault.find(v => (v.text || v.summary || "").substring(0, 100) === (meta.text || "").substring(0, 100));
                    if (textMatch) {
                        return { ...textMatch, score: 99, matchedWords: ["Semantic Embedding Match (Vectra)"] };
                    }
                    return null;
                }).filter(Boolean);
            }
        }
    } catch (e) {
        console.warn("Megumin Suite: Semantic query failed, falling back to TF-IDF.", e);
        currentSemanticMatches = [];
    }
}

// Dual-Engine Scorer: TF-IDF or Semantic Embeddings
function memGetRelevantVaultEntries() {
    const context = typeof getContext === "function" ? getContext() : null;
    const mem = localProfile?.memoryCore;

    if (!context || !context.chat || !mem || !mem.longTermVault || mem.longTermVault.length === 0) return [];

    const vault = mem.longTermVault;
    const engine = mem.scannerEngine || 'tfidf';

    // --- ENGINE 1: SEMANTIC EMBEDDINGS (ST API) ---
    if (engine === 'semantic') {
        if (currentSemanticMatches.length > 0) return currentSemanticMatches;
        // If ST's vector database fails to respond in time, it gracefully falls back to TF-IDF!
    }

    // --- ENGINE 2: TF-IDF MULTILINGUAL (Keywords / Fallback) ---
    const recentCleanedText = context.chat.filter(m => !m.is_system).slice(-2).map(m => meguminCleanChatHistoryText(m.mes)).join(" ").toLowerCase();
    const uniqueKeywords = memExtractKeywords(recentCleanedText);
    const totalDocs = vault.length;

    let scoredVault = vault.map(v => {
        let score = 0;
        let matchedWords = [];
        const vText = (v.text || v.summary || "").toLowerCase();

        uniqueKeywords.forEach(kw => {
            if (vText.includes(kw)) {
                let docCount = 0;
                vault.forEach(doc => { if ((doc.text || doc.summary || "").toLowerCase().includes(kw)) docCount++; });
                if (docCount < totalDocs * 0.5) {
                    let wordWeight = Math.round(50 / docCount);
                    score += wordWeight;
                    matchedWords.push(`${kw} (+${wordWeight})`);
                }
            }
        });
        return { ...v, score, matchedWords };
    });

    return scoredVault.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
}

// Rule B: Visual Fading Update (STRICT)
function updateMemoryVisuals() {
    const context = typeof getContext === "function" ? getContext() : null;
    if (!context || !context.chat || !context.chat.length) return;

    const mem = localProfile?.memoryCore;
    if (!mem?.enabled) {
        $(".mes .mes_text").removeClass("megumin_archived_text");
        return;
    }

    $(".mes").each(function () {
        const mesId = parseInt($(this).attr("mesid"));
        if (isNaN(mesId)) return;

        const msg = context.chat[mesId];
        if (!msg || msg.is_system) return;

        // ONLY dim the message if it actually exists inside a saved chunk
        if (isMessageArchived(mesId, mem)) {
            $(this).find(".mes_text").addClass("megumin_archived_text");
        } else {
            $(this).find(".mes_text").removeClass("megumin_archived_text");
        }
    });
    $("#mem_live_tokens_saved").text(`~${memCalculateTokensSaved()}`);
}

// Rule A: The Prompt Interceptor (STRICT)
window.megumin_memory_intercept = function (chat, _contextSize, _abort, type) {
    const mem = localProfile?.memoryCore;
    if (!mem?.enabled) return;

    const context = typeof getContext === "function" ? getContext() : null;
    if (!context || !context.symbols || !context.symbols.ignore) return;

    const IGNORE_SYMBOL = context.symbols.ignore;

    for (let i = 0; i < chat.length; i++) {
        if (chat[i].is_system) continue;

        // ONLY wipe the message from the prompt if it has been successfully summarized
        if (isMessageArchived(i, mem)) {
            chat[i] = structuredClone(chat[i]);
            if (!chat[i].extra) chat[i].extra = {};
            chat[i].extra[IGNORE_SYMBOL] = true;
            chat[i].mes = ""; // Bulletproof wipe
        }
    }
};

function toggleQuickGenButton() {
    const s = localProfile?.imageGen;
    if (s && s.enabled && s.triggerMode === 'manual') {
        $("#kazuma_quick_gen").css("display", "flex");
    } else {
        $("#kazuma_quick_gen").css("display", "none");
    }
}

async function igTestConnection() {
    try {
        const res = await fetch('/api/sd/comfy/ping', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: localProfile.imageGen.comfyUrl }) });
        if (res.ok) { toastr.success("ComfyUI Connected!"); await igFetchComfyLists(); } else throw new Error("Ping failed");
    } catch (e) { toastr.error("Connection Failed: " + e.message); }
}

async function igPopulateWorkflows() {
    const sel = $("#ig_workflow_list"); sel.empty();
    try {
        const res = await fetch('/api/sd/comfy/workflows', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ url: localProfile.imageGen.comfyUrl }) });
        if (res.ok) {
            const wfs = await res.json();
            wfs.forEach(w => sel.append(`<option value="${w}">${w}</option>`));
            if (localProfile.imageGen.currentWorkflowName && wfs.includes(localProfile.imageGen.currentWorkflowName)) {
                sel.val(localProfile.imageGen.currentWorkflowName);
            } else if (wfs.length > 0) {
                sel.val(wfs[0]); localProfile.imageGen.currentWorkflowName = wfs[0]; saveProfileToMemory();
            }
        }
    } catch (e) { sel.append('<option disabled>Failed to load</option>'); }
}

async function igNewWorkflowClick() {
    let name = await prompt("New workflow file name (e.g. 'my_flux.json'):");
    if (!name) return; if (!name.toLowerCase().endsWith('.json')) name += '.json';
    try {
        const res = await fetch('/api/sd/comfy/save-workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name, workflow: '{}' }) });
        if (!res.ok) throw new Error(await res.text());
        toastr.success("Workflow created!"); await igPopulateWorkflows(); $("#ig_workflow_list").val(name).trigger('change');
        setTimeout(igOpenWorkflowEditorClick, 500);
    } catch (e) { toastr.error(e.message); }
}

async function igDeleteWorkflowClick() {
    const name = localProfile.imageGen.currentWorkflowName;
    if (!name) return; if (!confirm(`Delete ${name}?`)) return;
    try {
        const res = await fetch('/api/sd/comfy/delete-workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name }) });
        if (!res.ok) throw new Error(await res.text());
        toastr.success("Deleted."); await igPopulateWorkflows();
    } catch (e) { toastr.error(e.message); }
}

async function igOpenWorkflowEditorClick() {
    const name = localProfile.imageGen.currentWorkflowName;
    if (!name) return toastr.warning("No workflow selected");
    let loadedContent = "{}";
    try {
        const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name }) });
        if (res.ok) {
            const rawBody = await res.json(); let jsonObj = rawBody;
            if (typeof rawBody === 'string') { try { jsonObj = JSON.parse(rawBody); } catch (e) { } }
            loadedContent = JSON.stringify(jsonObj, null, 4);
        }
    } catch (e) { toastr.error("Failed to load file. Starting empty."); }

    let currentJsonText = loadedContent;
    const $container = $(`
        <div style="display: flex; flex-direction: column; width: 100%; gap: 10px; font-family: 'Inter', sans-serif; color: var(--text-main);">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
                <h3 style="margin:0; color: var(--gold);">${name}</h3>
                <div style="display:flex; gap:8px;">
                    <button class="ps-modern-btn secondary wf-format" title="Beautify JSON"><i class="fa-solid fa-align-left"></i> Format</button>
                    <button class="ps-modern-btn secondary wf-import" title="Upload .json file"><i class="fa-solid fa-upload"></i> Import</button>
                    <button class="ps-modern-btn secondary wf-export" title="Download .json file"><i class="fa-solid fa-download"></i> Export</button>
                    <input type="file" class="wf-file-input" accept=".json" style="display:none;" />
                </div>
            </div>
            <div style="display: flex; gap: 15px;">
                <textarea class="ps-modern-input wf-textarea" spellcheck="false" style="flex: 1; min-height: 500px; font-family: 'Consolas', 'Monaco', monospace; white-space: pre; resize: none; font-size: 13px; line-height: 1.4; background: #000;"></textarea>
                <div style="width: 250px; flex-shrink: 0; display: flex; flex-direction: column; border-left: 1px solid var(--border-color); padding-left: 10px; max-height: 500px;">
                    <h4 style="margin: 0 0 10px 0; color: var(--text-muted);">Placeholders</h4>
                    <div class="wf-list" style="overflow-y: auto; flex: 1; padding-right: 5px;"></div>
                </div>
            </div>
        </div>
    `);

    const $textarea = $container.find('.wf-textarea'); const $list = $container.find('.wf-list'); const $fileInput = $container.find('.wf-file-input');
    $textarea.val(currentJsonText);

    KAZUMA_PLACEHOLDERS.forEach(item => {
        const $itemDiv = $('<div></div>').css({ 'padding': '8px', 'margin-bottom': '6px', 'background': 'rgba(255,255,255,0.05)', 'border-radius': '6px', 'border': '1px solid transparent', 'transition': '0.2s' });
        $itemDiv.append($('<span></span>').text(item.key).css({ 'font-weight': 'bold', 'color': 'var(--gold)', 'font-family': 'monospace' })).append($('<div></div>').text(item.desc).css({ 'font-size': '0.7rem', 'color': 'var(--text-muted)', 'margin-top': '4px' }));
        $list.append($itemDiv);
    });

    const updateState = () => {
        currentJsonText = $textarea.val();
        $list.children().each(function () {
            const cleanKey = $(this).find('span').first().text().replace(/"/g, '');
            if (currentJsonText.includes(cleanKey)) $(this).css({ 'border-color': '#10b981', 'background': 'rgba(16, 185, 129, 0.1)' });
            else $(this).css({ 'border-color': 'transparent', 'background': 'rgba(255,255,255,0.05)' });
        });
    };
    $textarea.on('input', updateState); setTimeout(updateState, 100);

    $container.find('.wf-format').on('click', () => { try { $textarea.val(JSON.stringify(JSON.parse($textarea.val()), null, 4)); updateState(); toastr.success("Formatted"); } catch (e) { toastr.warning("Invalid JSON"); } });
    $container.find('.wf-import').on('click', () => $fileInput.click());
    $fileInput.on('change', (e) => { if (!e.target.files[0]) return; const r = new FileReader(); r.onload = (ev) => { $textarea.val(ev.target.result); updateState(); toastr.success("Imported"); }; r.readAsText(e.target.files[0]); $fileInput.val(''); });
    $container.find('.wf-export').on('click', () => { try { JSON.parse(currentJsonText); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([currentJsonText], { type: "application/json" })); a.download = name; a.click(); } catch (e) { toastr.warning("Invalid content"); } });

    const popup = new Popup($container, POPUP_TYPE.CONFIRM, '', { okButton: 'Save Changes', cancelButton: 'Cancel', wide: true, large: true, onClosing: () => { try { JSON.parse(currentJsonText); return true; } catch (e) { toastr.error("Invalid JSON."); return false; } } });
    if (await popup.show()) {
        try {
            const res = await fetch('/api/sd/comfy/save-workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: name, workflow: JSON.stringify(JSON.parse(currentJsonText)) }) });
            if (!res.ok) throw new Error(await res.text()); toastr.success("Workflow Saved!");
        } catch (e) { toastr.error("Save Failed."); }
    }
}

function showKazumaProgress(text = "Processing...") {
    if ($("#kazuma_progress_overlay").length === 0) {
        $("body").append(`
            <div id="kazuma_progress_overlay" style="position: fixed; bottom: 20px; right: 20px; width: 300px; background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 15px; z-index: 99999; box-shadow: 0 10px 30px rgba(0,0,0,0.8); display: none; align-items: center; gap: 15px; font-family: 'Inter', sans-serif;">
                <div style="flex:1">
                    <span id="kazuma_progress_text" style="font-weight: 600; font-size: 0.85rem; color: #fff; margin-bottom: 8px; display: block;">Generating Image...</span>
                    <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                        <div style="height: 100%; width: 100%; background: linear-gradient(45deg, #a855f7 25%, transparent 25%, transparent 50%, #a855f7 50%, #a855f7 75%, transparent 75%, transparent); background-size: 20px 20px; animation: kazuma-stripe-anim 1s linear infinite;"></div>
                    </div>
                </div>
            </div>
            <style>@keyframes kazuma-stripe-anim { 0% { background-position: 0 0; } 100% { background-position: 20px 0; } }</style>
        `);
    }
    $("#kazuma_progress_text").text(text); $("#kazuma_progress_overlay").css("display", "flex");
}

async function igManualGenerate() {
    const s = localProfile?.imageGen;
    if (!s || !s.enabled) return;

    showKazumaProgress("Analyzing Scene...");

    try {
        let promptText;
        if (!s.generatorBackend || s.generatorBackend === "direct") {
            promptText = await generateImagePromptText();
        } else {
            // Use the "Megumin Image" preset, but still run the exact same prompt logic
            await useMeguminEngine(async () => {
                promptText = await generateImagePromptText();
            }, "Megumin Image");
        }

        const imgRegex = /<img\s+prompt=["'](.*?)["']\s*\/?>/i;
        const match = promptText.match(imgRegex);
        if (match) promptText = match[1];

        toastr.info("Sending to ComfyUI...", "Megumin Suite");
        igGenerateWithComfy(promptText, null);

    } catch (e) {
        console.error(e);
        $("#kazuma_progress_overlay").hide();
        toastr.error("Manual generation failed.");
    } finally {
        activeImageGenRequest = null;
    }
}

// New Helper Function for generating the prompt text
async function generateImagePromptText() {
    const s = localProfile.imageGen;
    const chat = getContext().chat;
    const badStuffRegex = /(<disclaimer>.*?<\/disclaimer>)|(<guifan>.*?<\/guifan>)|(<danmu>.*?<\/danmu>)|(<options>.*?<\/options>)|```start|```end|<done>|`<done>`|(.*?<\/(?:ksc??|think(?:ing)?)>(\n)?)|(<(?:ksc??|think(?:ing)?)>[\s\S]*?<\/(?:ksc??|think(?:ing)?)>(\n)?)/gs;

    const lastMessages = chat.filter(m => !m.is_system).slice(-5).map(m => {
        return `${m.name}: ${meguminCleanChatHistoryText(m.mes)}`;
    }).join("\n\n");

    let styleStr = s.promptStyle === "illustrious" ? "Use Danbooru-style tags separated by commas." : (s.promptStyle === "sdxl" ? "Use natural, descriptive prose and full sentences." : "Use a comma-separated list of detailed keywords and visual descriptors.");
    let perspStr = s.promptPerspective === "pov" ? "Frame the scene strictly from a First-Person (POV) perspective." : (s.promptPerspective === "character" ? "Focus intensely on the character's appearance." : "Describe the entire environment and atmosphere.");

    activeImageGenRequest = { chatText: lastMessages, styleStr: styleStr, perspStr: perspStr, extraStr: s.promptExtra || "None" };

    let rawOutput = await generateQuietPrompt({ prompt: "___PS_IMAGE_GEN___" });
    return rawOutput.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function igGenerateWithComfy(positivePrompt, target = null) {
    const s = localProfile.imageGen;
    let finalPrompt = positivePrompt;

    // --- INTERCEPT PROMPT IF PREVIEW IS ENABLED ---
    if (s.previewPrompt) {
        $("#kazuma_progress_overlay").hide(); // Hide the progress bar temporarily

        const $content = $(`
            <div style="display:flex; flex-direction:column; gap:10px; font-family: 'Inter', sans-serif;">
                <div style="font-size: 0.85rem; color: var(--text-muted);">Review or modify the prompt before it goes to ComfyUI.</div>
                <textarea class="ps-modern-input ig-preview-textarea" style="height: 150px; resize: vertical; font-family: monospace; font-size: 0.85rem; padding: 10px;">${finalPrompt}</textarea>
            </div>
        `);

        // CRITICAL FIX: SillyTavern destroys the popup HTML when it closes. 
        // We MUST capture the text while the user is typing!
        let liveText = finalPrompt;
        $content.find(".ig-preview-textarea").on("input", function () {
            liveText = $(this).val();
        });

        const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Preview Image Prompt", { okButton: "Send to ComfyUI", cancelButton: "Cancel", wide: true });
        const confirmed = await popup.show();

        if (!confirmed) {
            toastr.info("Generation cancelled.");
            return;
        }

        finalPrompt = liveText.trim();
        if (!finalPrompt) return toastr.warning("Prompt cannot be empty.");

        showKazumaProgress("Preparing to Render..."); // Bring progress bar back
    }

    let workflowRaw;
    try {
        const res = await fetch('/api/sd/comfy/workflow', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ file_name: s.currentWorkflowName }) });
        if (!res.ok) throw new Error("Load failed"); workflowRaw = await res.json();
    } catch (e) { return toastr.error(`Could not load ${s.currentWorkflowName}`); }

    let workflow = (typeof workflowRaw === 'string') ? JSON.parse(workflowRaw) : workflowRaw;
    let finalSeed = parseInt(s.customSeed); if (finalSeed === -1 || isNaN(finalSeed)) finalSeed = Math.floor(Math.random() * 1000000000);

    let seedInjected = false;
    for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (node.inputs) {
            for (const key in node.inputs) {
                const val = node.inputs[key];
                if (val === "%prompt%") node.inputs[key] = finalPrompt;
                if (val === "%negative_prompt%") node.inputs[key] = s.customNegative || "";
                if (val === "%seed%") { node.inputs[key] = finalSeed; seedInjected = true; }
                if (val === "%sampler%") node.inputs[key] = s.selectedSampler || "euler";
                if (val === "%model%") node.inputs[key] = s.selectedModel || "v1-5-pruned.ckpt";
                if (val === "%steps%") node.inputs[key] = parseInt(s.steps) || 20;
                if (val === "%scale%") node.inputs[key] = parseFloat(s.cfg) || 7.0;
                if (val === "%denoise%") node.inputs[key] = parseFloat(s.denoise) || 1.0;
                if (val === "%clip_skip%") node.inputs[key] = -Math.abs(parseInt(s.clipSkip)) || -1;
                if (val === "%lora1%") node.inputs[key] = s.selectedLora || "None";
                if (val === "%lora2%") node.inputs[key] = s.selectedLora2 || "None";
                if (val === "%lora3%") node.inputs[key] = s.selectedLora3 || "None";
                if (val === "%lora4%") node.inputs[key] = s.selectedLora4 || "None";
                if (val === "%lorawt1%") node.inputs[key] = parseFloat(s.selectedLoraWt) || 1.0;
                if (val === "%lorawt2%") node.inputs[key] = parseFloat(s.selectedLoraWt2) || 1.0;
                if (val === "%lorawt3%") node.inputs[key] = parseFloat(s.selectedLoraWt3) || 1.0;
                if (val === "%lorawt4%") node.inputs[key] = parseFloat(s.selectedLoraWt4) || 1.0;
                if (val === "%width%") node.inputs[key] = parseInt(s.imgWidth) || 512;
                if (val === "%height%") node.inputs[key] = parseInt(s.imgHeight) || 512;
            }
            if (!seedInjected && node.class_type === "KSampler" && 'seed' in node.inputs && typeof node.inputs['seed'] === 'number') { node.inputs.seed = finalSeed; }
        }
    }

    try {
        const res = await fetch(`${s.comfyUrl}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow }) });
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();

        showKazumaProgress("Rendering Image...");
        const checkInterval = setInterval(async () => {
            try {
                const h = await (await fetch(`${s.comfyUrl}/history/${data.prompt_id}`)).json();
                if (h[data.prompt_id]) {
                    clearInterval(checkInterval);
                    let finalImage = null;
                    for (const nodeId in h[data.prompt_id].outputs) {
                        const nodeOut = h[data.prompt_id].outputs[nodeId];
                        if (nodeOut.images && nodeOut.images.length > 0) { finalImage = nodeOut.images[0]; break; }
                    }
                    if (finalImage) {
                        showKazumaProgress("Downloading...");
                        const imgUrl = `${s.comfyUrl}/view?filename=${finalImage.filename}&subfolder=${finalImage.subfolder}&type=${finalImage.type}`;

                        // Download & Compress
                        const response = await fetch(imgUrl); const blob = await response.blob();
                        const base64Raw = await new Promise((res) => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(blob); });
                        let base64Clean = base64Raw; let format = "png";
                        if (s.compressImages) {
                            base64Clean = await new Promise((res) => { const img = new Image(); img.src = base64Raw; img.onload = () => { const cvs = document.createElement('canvas'); cvs.width = img.width; cvs.height = img.height; cvs.getContext('2d').drawImage(img, 0, 0); res(cvs.toDataURL("image/jpeg", 0.9)); }; img.onerror = () => res(base64Raw); });
                            format = "jpeg";
                        }

                        // Insert to Chat
                        const charName = getContext().characters[getContext().characterId]?.name || "User";
                        const savedPath = await saveBase64AsFile(base64Clean.split(',')[1], charName, `${charName}_${humanizedDateTime()}`, format);
                        const mediaAttach = {
                            url: savedPath,
                            type: "image",
                            source: "generated",
                            title: finalPrompt,
                            generation_type: "free"
                        };

                        if (target && target.message) {
                            if (!target.message.extra) target.message.extra = {}; if (!target.message.extra.media) target.message.extra.media = [];
                            target.message.extra.media_display = "gallery"; target.message.extra.media.push(mediaAttach); target.message.extra.media_index = target.message.extra.media.length - 1;
                            if (typeof appendMediaToMessage === "function") appendMediaToMessage(target.message, target.element);
                            await saveChat(); toastr.success("Gallery updated!");
                        } else {
                            const newMsg = { name: "Image Gen Kazuma", is_user: false, is_system: true, send_date: Date.now(), mes: "", extra: { media: [mediaAttach], media_display: "gallery", media_index: 0 }, force_avatar: "img/five.png" };
                            getContext().chat.push(newMsg); await saveChat();
                            if (typeof addOneMessage === "function") addOneMessage(newMsg); else await reloadCurrentChat();
                            toastr.success("Image inserted!");
                        }
                        $("#kazuma_progress_overlay").hide();
                    } else { $("#kazuma_progress_overlay").hide(); }
                }
            } catch (e) { }
        }, 1000);
    } catch (e) { $("#kazuma_progress_overlay").hide(); toastr.error("Comfy Error: " + e.message); }
}

// -------------------------------------------------------------
// AI GENERATION & BAN LIST HELPER FUNCTIONS (RESTORED)
// -------------------------------------------------------------
function getCleanedChatHistory() {
    const context = getContext();
    if (!context.chat || context.chat.length === 0) return "";

    const aiMessages = context.chat.filter(m => !m.is_user && !m.is_system).slice(-50);
    const badStuffRegex = /(<disclaimer>.*?<\/disclaimer>)|(<guifan>.*?<\/guifan>)|(<danmu>.*?<\/danmu>)|(<options>.*?<\/options>)|```start|```end|<done>|`<done>`|(.*?<\/(?:ksc??|think(?:ing)?)>(\n)?)|(<(?:ksc??|think(?:ing)?)>[\s\S]*?<\/(?:ksc??|think(?:ing)?)>(\n)?)/gs;

    let cleanedMessages = aiMessages.map(m => meguminCleanChatHistoryText(m.mes));

    cleanedMessages = cleanedMessages.filter(t => t.length > 0);
    return cleanedMessages.join("\n\n");
}

async function analyzeSlopDirectly(chatText) {
    activeBanListChat = chatText;
    try {
        let rawOutput = await generateQuietPrompt({ prompt: "___PS_BANLIST___" });
        return rawOutput.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    } catch (e) {
        console.error(`[${extensionName}] Ban List Analysis Failed:`, e);
        return null;
    } finally {
        activeBanListChat = null;
    }
}

async function analyzeSlopWithPreset(chatText) {
    let result = null;
    await useMeguminEngine(async () => {
        // We still use the interceptor! This just makes the engine switch first.
        result = await analyzeSlopDirectly(chatText);
    });
    return result;
}

async function useMeguminEngine(task, targetPreset = TARGET_PRESET_NAME) { // Added parameter with default value
    const selector = $("#settings_preset_openai");
    const option = selector.find(`option`).filter(function () { return $(this).text().trim() === targetPreset; }); // Use the new parameter
    let originalValue = null;

    if (option.length) {
        originalValue = selector.val();
        selector.val(option.val()).trigger("change");
        toastr.info(`Switched to ${targetPreset} preset... Please wait.`);
        await new Promise(r => setTimeout(r, 3000));
    } else {
        toastr.error(`"${targetPreset}" not found in OpenAI presets.`);
        return;
    }

    try {
        await task();
    } catch (e) {
        console.error(`[${extensionName}] AI Error:`, e);
    } finally {
        await new Promise(r => setTimeout(r, 500));
        selector.val(originalValue).trigger("change");
    }
}

async function runMeguminTask(orderText) {
    activeGenerationOrder = orderText;
    try {
        return await generateQuietPrompt({ prompt: "___PS_DUMMY___" });
    } finally {
        activeGenerationOrder = null;
    }
}

$("body").on("input", "#ps_main_current_rule", function () {
    localProfile.aiRule = $(this).val(); saveProfileToMemory();
});

// -------------------------------------------------------------
// EVENT LISTENERS & INITS
// -------------------------------------------------------------
function buildBaseDict() {
    const dict = {};
    if (!localProfile) return dict;

    // 1. GLOBAL DEFAULTS (Language, Pronouns, Word Count)
    const targetLang = (localProfile.userLanguage && localProfile.userLanguage.trim() !== "")
        ? localProfile.userLanguage.toUpperCase()
        : "ENGLISH";
    dict["[[Language]]"] = `[LANGUAGE RULE]\nALL OUTPUT EXCEPT THINKING MUST BE IN ${targetLang} ONLY.`;

    if (localProfile.userPronouns === "male") dict["[[pronouns]]"] = `{{user}} is male. Always portray and address him as such.`;
    else if (localProfile.userPronouns === "female") dict["[[pronouns]]"] = `{{user}} is female. Always portray and address her as such.`;

    const wordCountStr = (localProfile.userWordCount && String(localProfile.userWordCount).trim() !== "")
        ? String(localProfile.userWordCount).trim()
        : null;

    if (wordCountStr) {
        dict["[[count]]"] = `— maximum ${wordCountStr} words`;
    } else {
        dict["[[count]]"] = "";
    }

    // 2. STANDARD STAGE SELECTIONS (Stage 2, 4, 5, 6)

    // Personality (Stage 2) - Will be overwritten later if Custom Engine is active
    const pData = hardcodedLogic.personalities.find(p => p.id === localProfile.personality);
    dict["[[main]]"] = pData ? pData.content : "";
    dict["[[AI1]]"] = "Understood."; // Default
    dict["[[AI2]]"] = "Understood."; // Default

    if (localProfile.personality === "megumin") {
        dict["[[AI1]]"] = "Fine i read the rules.";
        dict["[[AI2]]"] = "OK i Understnd it.";
    }

    // Standard Toggles & Addons
    if (localProfile.toggles.ooc) dict["[[OOC]]"] = hardcodedLogic.toggles.ooc.content;
    if (localProfile.toggles.control) dict["[[control]]"] = hardcodedLogic.toggles.control.content;
    if (localProfile.aiRule) {
        if (localProfile.mode.startsWith("v7") && localProfile.activeStyleId !== "dir_v7") {
            dict["[[aiprompt]]"] = `<narrative_style>\n voice: ${localProfile.aiRule}\n  pacing: "Unhurried where it should be. A quiet moment can take a paragraph. A violent one can take a sentence. Match the rhythm to the content."\n  length_directive: "Typical outputs should run 3–6 substantial paragraphs, scaling with scene density. Lean toward the higher end during rich, atmospheric, or multi-character scenes. Go shorter — even a single paragraph — only when the moment genuinely demands economy: a held breath, a door closing, a line that hits harder alone. Never pad, never rush."\n</narrative_style>`;
        } else {
            dict["[[aiprompt]]"] = localProfile.aiRule;
        }
    }
    localProfile.addons.forEach(aId => {
        const item = hardcodedLogic.addons.find(a => a.id === aId);
        if (item) dict[item.trigger] = item.content;
    });

    // Stage 5 Defaults (Format Blocks)
    localProfile.blocks.forEach(bId => {
        const item = hardcodedLogic.blocks.find(b => b.id === bId);
        if (item) dict[item.trigger] = item.content;
    });

    // Stage 6 Defaults (CoT Framework & Language)
    const modData = hardcodedLogic.models.find(m => m.id === localProfile.model);
    if (modData) {
        dict["[[COT]]"] = modData.content;
        if (modData.prefill) dict["[[prefill]]"] = modData.prefill;
    } else {
        dict["[[COT]]"] = "";
    }

    // [[THINK]] Macro Logic (Only injects if Thinking V2 is ENABLED)
    if (localProfile.thinkingV2 && localProfile.model !== "cot-off") {
        dict["[[THINK]]"] = `<think>\n<think>\n<think>\n{Thinking}\n</think>`;
    } else {
        dict["[[THINK]]"] = "";
    }

    if (localProfile.dnRatio && localProfile.dnRatio.enabled) {
        const d = localProfile.dnRatio.dialogue;
        const n = 100 - d;
        dict["[[DNRATIO]]"] = `- Ratio: Maintain a balance of ${d}% Dialogue and ${n}% Narration.`;
    } else {
        dict["[[DNRATIO]]"] = "";
    }

    if (localProfile.onomatopoeia && localProfile.onomatopoeia.enabled) {
        let onoRule = `- Narration must utilize onomatopoeia. Use precise, context-specific phonetic representations for physical interactions (e.g., the click of a latch, the thud of a heavy object, the soughing of wind) rather than abstract descriptions of sound.`;
        if (localProfile.onomatopoeia.useStyling) {
            onoRule += `\nAll onomatopoeic words must animated and colored using HTML and CSS. The selected style tag and color must objectively correspond to the physical nature or movement of the sound produced; for example, a repetitive friction sound such as "shush-shush" must utilize a sliding animation tag to represent the physical action.`;
        }
        dict["[[onomato]]"] = onoRule;
    } else {
        dict["[[onomato]]"] = "";
    }

    // MVU Logic
    if (localProfile.blocks.includes("mvu")) {
        let baseMvu = hardcodedLogic.blocks.find(b => b.id === "mvu").content;
        if (wordCountStr) dict["[[MVU]]"] = baseMvu.replace("[[count]]", `maximum ${wordCountStr} words`);
        else dict["[[MVU]]"] = baseMvu.replace("[[count]]", "...");
    } else {
        dict["[[MVU]]"] = wordCountStr ? `{main response — maximum ${wordCountStr} words}` : `{main response}`;
    }

    // 3. ENGINE OVERRIDES (The "Superior" Layer)
    // This part runs last so it can overwrite standard Stage choices
    const allAvailableModes = [...hardcodedLogic.modes, ...(extension_settings[extensionName].customModes || [])];
    const activeEngine = allAvailableModes.find(m => m.id === localProfile.mode);
    const isCustom = activeEngine && !hardcodedLogic.modes.find(x => x.id === activeEngine.id);

    if (activeEngine) {
        // Map p1-p6
        for (let i = 1; i <= 6; i++) {
            const val = activeEngine[`p${i}`] || "";
            dict[`[[prompt${i}]]`] = val;
            dict[`[prompt${i}]`] = val;
        }

        // Custom Engines kill [[main]] personality ONLY if they are truly built from scratch
        if (isCustom && activeEngine.isCoreClone !== true) {
            dict["[[main]]"] = "";
        }

        // Engine-specific AI Prefills (If defined in the engine)
        if (activeEngine.A1) dict["[[AI1]]"] = activeEngine.A1;
        if (activeEngine.A2) dict["[[AI2]]"] = activeEngine.A2;

        // Engine-specific Block Overwrites
        const overrides = [
            { key: "cot", trigger: "[[COT]]", condition: true },
            { key: "prefill", trigger: "[[prefill]]", condition: true },
            { key: "think", trigger: "[[THINK]]", condition: localProfile.thinkingV2 },
            { key: "info", trigger: "[[infoblock]]", condition: localProfile.blocks.includes("info") },
            { key: "summary", trigger: "[[summary]]", condition: localProfile.blocks.includes("summary") },
            { key: "cyoa", trigger: "[[cyoa]]", condition: localProfile.blocks.includes("cyoa") },
            { key: "mvu", trigger: "[[MVU]]", condition: localProfile.blocks.includes("mvu") },
            { key: "death", trigger: "[[death]]", condition: localProfile.addons.includes("death") },
            { key: "combat", trigger: "[[combat]]", condition: localProfile.addons.includes("combat") },
            { key: "direct", trigger: "[[Direct]]", condition: localProfile.addons.includes("direct") },
            { key: "dn", trigger: "[[DN]]", condition: localProfile.addons.includes("dn") },
            { key: "dialogueColor", trigger: "[[COLOR]]", condition: localProfile.addons.includes("color") }, // FIXED NAME COLLISION
            { key: "npc_inner_chatter", trigger: "[[npc_inner_chatter]]", condition: localProfile.blocks.includes("npc_inner_chatter") || localProfile.blocks.includes("npc_inner_chatter_v2") },
            { key: "storytracker", trigger: "[[storytracker]]", condition: localProfile.storyPlan && localProfile.storyPlan.enabled },
            { key: "language", trigger: "[[Language]]", condition: true },
            { key: "pronouns", trigger: "[[pronouns]]", condition: true },
            { key: "count", trigger: "[[count]]", condition: true },
            { key: "dnratio", trigger: "[[DNRATIO]]", condition: localProfile.dnRatio && localProfile.dnRatio.enabled },
            { key: "onomato", trigger: "[[onomato]]", condition: localProfile.onomatopoeia && localProfile.onomatopoeia.enabled },
            { key: "banlist", trigger: "[[banlist]]", condition: true }
        ];

        overrides.forEach(o => {
            // Only inject the override if the toggle is ON (or if it's a global setting)
            if (o.condition && activeEngine[o.key] && activeEngine[o.key].trim() !== "") {
                dict[o.trigger] = activeEngine[o.key];
            }
        });

        // Custom Toggles Appender
        if (activeEngine.customToggles) {
            activeEngine.customToggles.forEach(ct => {
                if (localProfile.toggles[ct.id]) {
                    const targetKey = "[[prompt" + ct.attachPoint.replace('p', '') + "]]";
                    if (dict[targetKey] !== undefined) {
                        dict[targetKey] += `\n\n${ct.content}`;
                    }
                }
            });
        }

        // V7 Dynamic Stripping
        if (activeEngine.id.startsWith("v7")) {
            if (!localProfile.toggles.v7_ooc && dict["[[prompt1]]"]) {
                dict["[[prompt1]]"] = dict["[[prompt1]]"].replace(/<ooc_protocol>[\s\S]*?<\/ooc_protocol>/g, "");
            }
            if (dict["[[prompt4]]"]) {
                if (!localProfile.toggles.v7_pcsolo) {
                    dict["[[prompt4]]"] = dict["[[prompt4]]"].replace(/<pc_solo_physicality[\s\S]*?<\/pc_solo_physicality>/g, "");
                }
                if (!localProfile.toggles.v7_culture) {
                    dict["[[prompt4]]"] = dict["[[prompt4]]"].replace(/<cultural_anchoring>[\s\S]*?<\/cultural_anchoring>/g, "");
                }
                if (!localProfile.toggles.v7_scene) {
                    dict["[[prompt4]]"] = dict["[[prompt4]]"].replace(/<scene_choreography>[\s\S]*?<\/scene_choreography>/g, "");
                }
                if (!localProfile.toggles.v7_intro) {
                    dict["[[prompt4]]"] = dict["[[prompt4]]"].replace(/\s*introduction_protocol:\s*"[^"]*"/g, "");
                }
            }
        }
    }

    if (localProfile.mode.includes("v6-dream-team") || localProfile.mode.startsWith("v7")) {
        dict["[[main]]"] = "";
    }

    // NEW: Inject Thinking Effort to the absolute top of whatever [[COT]] is currently active
    let effort = localProfile.thinkEffort || "unspecified";
    if (effort !== "unspecified" && dict["[[COT]]"]) {
        let words = effort === "custom" ? (localProfile.customThinkEffort || "100") : effort;
        dict["[[COT]]"] = `Your Thinking must not be more than ${words} words.\n\n` + dict["[[COT]]"];
    }

    // Story Planner Injection
    if (localProfile.storyPlan && localProfile.storyPlan.enabled) {
        const planText = localProfile.storyPlan.currentPlan;
        if (planText && planText.trim() !== "") {
            dict["[[storyplan]]"] = `<Story_Plan>\nThis is a possible event for the story, take from it:\n${planText}\n</Story_Plan>`;
        } else {
            dict["[[storyplan]]"] = "";
        }

        // The refined tracker block you asked for
        dict["[[storytracker]]"] = `<Story_Tracker>\narc: The Arc that is now active.\nchapter: The chapter that is now active.\nEpisode: The episode that is now active.\nSecrets: Any secret that the user/{{user}} doesn't know.\n</Story_Tracker>`;
    } else {
        dict["[[storyplan]]"] = "";
        dict["[[storytracker]]"] = "";
    }

    // 4. FINAL INJECTIONS (Banlist & Image Gen)
    if (localProfile.banList && localProfile.banList.length > 0) {
        const banStr = localProfile.banList.map(b => `- ${b}`).join("\n");
        dict["[[banlist]]"] = `[BAN LIST]\nNever rely on these clichés, tropes, or repetitive patterns. They are dead language:\n${banStr}`;
    } else {
        dict["[[banlist]]"] = "";
    }

    if (localProfile.imageGen && localProfile.imageGen.enabled) {
        const ig = localProfile.imageGen;
        let shouldInject = false;
        let conditionalText = "";
        const mode = ig.triggerMode || "always";

        if (mode === "always") shouldInject = true;
        else if (mode === "frequency") {
            const chat = getContext().chat || [];
            const aiMsgCount = chat.filter(m => !m.is_user && !m.is_system).length;
            const freq = parseInt(ig.autoGenFreq) || 1;
            if ((aiMsgCount + 1) % freq === 0) shouldInject = true;
        } else if (mode === "conditional") {
            shouldInject = true;
            conditionalText = "CRITICAL INSTRUCTION: ONLY output the <img prompt=\"...\"> tag if the character is explicitly taking a photo, sending a picture, or sharing an image in this exact moment. If not, do NOT output the image tags at all.\n\n";
        }

        if (shouldInject) {
            let styleStr = ig.promptStyle === "illustrious" ? "Use Danbooru-style tags. Focus on anime." : (ig.promptStyle === "sdxl" ? "Use natural descriptive sentences. Focus on photorealism." : "Use keywords.");
            let perspStr = ig.promptPerspective === "pov" ? "First-Person (POV)." : (ig.promptPerspective === "character" ? "Focus on character appearance." : "Describe environment.");
            dict["[[img1]]"] = `[IMAGE GENERATION]\n${conditionalText}Style: ${styleStr}\nPerspective: ${perspStr}${ig.promptExtra ? `\nExtra: ${ig.promptExtra}` : ""}`;
            dict["[[img2]]"] = `<img prompt="prompt">`;
        } else {
            dict["[[img1]]"] = ""; dict["[[img2]]"] = "";
        }
    } else {
        dict["[[img1]]"] = ""; dict["[[img2]]"] = "";
    }

    if (localProfile.thinkingV2 && dict["[[prefill]]"]) {
        dict["[[prefill]]"] = dict["[[prefill]]"].replace(/\n<think>[\s\S]*/, "\n<think>\n<think>");
    }

    if (dict["[[cyoa]]"]) dict["[[cyoa2]]"] = "[CYOA block here]"; else dict["[[cyoa2]]"] = "";
    if (dict["[[infoblock]]"]) dict["[[infoblock2]]"] = "[Info block here]"; else dict["[[infoblock2]]"] = "";
    if (dict["[[summary]]"]) dict["[[summary2]]"] = "[Summary block here]"; else dict["[[summary2]]"] = "";
    if (dict["[[storytracker]]"]) dict["[[storytracker2]]"] = "[Story tracker here]"; else dict["[[storytracker2]]"] = "";
    if (dict["[[npc_inner_chatter]]"]) dict["[[npc_inner_chatter2]]"] = "[Npc inner chatter here]"; else dict["[[npc_inner_chatter2]]"] = "";

    // Resolve early-evaluated tokens inside all other strings to prevent them from being missed and then cleaned up
    const earlyTokens = ["[[count]]", "[[Language]]", "[[pronouns]]", "[[DNRATIO]]"];
    earlyTokens.forEach(et => {
        if (dict[et] !== undefined) {
            const val = dict[et];
            Object.keys(dict).forEach(k => {
                if (k !== et && typeof dict[k] === 'string' && dict[k].includes(et)) {
                    dict[k] = dict[k].split(et).join(val);
                }
            });
        }
    });

    // --- 5. MEMORY CORE INJECTION ---
    // Initialize them as empty strings by default so the tags cleanly vanish if there are no memories
    dict["[[long-Memory]]"] = "";
    dict["[[Short-memory]]"] = "";

    if (localProfile.memoryCore && localProfile.memoryCore.enabled) {
        const mem = localProfile.memoryCore;

        // A. Retrieve Long-Term Memories (Local TF-IDF Keyword Scoring)
        if (mem.longTermVault && mem.longTermVault.length > 0) {
            const retrieved = memGetRelevantVaultEntries();
            if (retrieved.length > 0) {
                let longXML = "<retrieved_archives>\n";
                retrieved.forEach(m => {
                    const dateStr = new Date(m.timestamp).toLocaleString();
                    const content = m.text || m.summary || "";
                    longXML += `<archive_memory time="${dateStr}">\n[Msg ${m.id}]:\n${content}\n</archive_memory>\n`;
                });
                longXML += "</retrieved_archives>";

                dict["[[long-Memory]]"] = `[LONG-TERM MEMORY VAULT]\nThe following are raw archives of highly relevant past events. Use timestamps to prevent context collapse. Do not hallucinate them as currently happening.\n${longXML}`;
            }
        }

        // B. Inject Short-Term Memories (Chronological)
        if (mem.shortTermChunks && mem.shortTermChunks.length > 0) {
            let shortXML = "<recent_state_extracts>\n";
            mem.shortTermChunks.forEach(m => {
                const dateStr = new Date(m.timestamp).toLocaleString();
                shortXML += `<archive_memory time="${dateStr}">[Msg ${m.id}]: ${m.summary}</archive_memory>\n`;
            });
            shortXML += "</recent_state_extracts>";

            dict["[[Short-memory]]"] = `[SHORT-TERM MEMORY]\nRecent state extractions:\n${shortXML}`;
        }
    }

    // --- 5.5 NPC BANK INJECTION ---
    dict["[[npc_dossier]]"] = "";
    dict["[[npc_dossier2]]"] = "";
    dict["[[npc list]]"] = "";

    if (localProfile.npcBank && localProfile.npcBank.enabled) {
        dict["[[npc_dossier]]"] = `<npc_dossier>
  trigger: "Generates ONLY when a new significant NPC is introduced not cashiers, bartenders, random passersby, or one-line background faces. A 'significant NPC' is one with a name, meaningful dialogue, and likely recurrence."
format: "Collapsible HTML details block. Dense, dashboard-style no prose."

  template: |
    <details>
    <summary>🆕 <b>New NPC: [Full Name]</b></summary>

    **Name:** [Full name, nickname if used] | **Age:** [Age] | **Sex:** [M/F/Other]
    **Appearance:**  [Hair, body, skin....etc]
    **Occupation:** [Specific current job/role]

    **Background:** [3–5 sentences. Where they grew up, how they got here, what shaped them. A life sketch not a résumé. Include details the PC may never learn.]

    **Inner Circle:**
    * [Name] — [Relationship] | [One-line: age, status, dynamic e.g., "Younger sister, 19, uni student in another city they text daily"]
    * [Name] — [Relationship] | [Same format]
    * [Name] — [Relationship] | [Include people the PC hasn't met and may never meet]

    **Personality Snapshot:** [2–3 contradictions or defining traits as behavior, not labels.]
    **Current Agenda:** [What they want RIGHT NOW in the story's context]
    **Hidden Layer:** [Something the PC doesn't know a secret, a motive.]

    </details>

  guidelines:
    inner_circle_rule: "Include 2–5 people. At least one must be unknown to the story a mother, an ex, a childhood friend. These are future plot seeds."
    hidden_layer: "For YOUR use as narrative engine. Drives NPC behavior the PC can't predict. Never reveal in narration unless the NPC actually discloses it."
</npc_dossier>`;
        dict["[[npc_dossier2]]"] = "[NPC Dossier block here]";

        if (localProfile.npcBank.npcs && localProfile.npcBank.npcs.length > 0) {
            const context = typeof getContext === 'function' ? getContext() : null;
            if (context && context.chat) {
                const recentText = context.chat.filter(m => !m.is_system).slice(-4).map(m => meguminCleanChatHistoryText(m.mes)).join(" ").toLowerCase();
                const keywords = typeof memExtractKeywords === 'function' ? memExtractKeywords(recentText) : [];
                if (keywords.length > 0) {
                    let scoredNpcs = [];
                    localProfile.npcBank.npcs.forEach(n => {
                        let score = 0;
                        let matchedWords = [];
                        const contentLower = npcBuildTextFromData(n).toLowerCase();
                        keywords.forEach(kw => {
                            if (contentLower.includes(kw)) { score++; matchedWords.push(kw); }
                        });
                        if (score >= 1) {
                            scoredNpcs.push({ ...n, score, matchedWords });
                        }
                    });
                    scoredNpcs.sort((a, b) => b.score - a.score);
                    const topNpcs = scoredNpcs.slice(0, 3);
                    if (topNpcs.length > 0) {
                        let npcXML = "<retrieved_npcs>\n";
                        topNpcs.forEach(n => { npcXML += `<${n.name}>\n${npcBuildTextFromData(n)}\n</${n.name}>\n\n`; });
                        npcXML += "</retrieved_npcs>";
                        dict["[[npc list]]"] = `[RELEVANT NPCs]\nThe following are details of known NPCs relevant to the current context:\n${npcXML}`;

                        // Collect pfp images for multimodal injection if enabled
                        activeNpcImages = [];
                        if (localProfile.npcBank.sendPortraitsToAi) {
                            topNpcs.forEach(n => {
                                if (n.pfp && n.pfp.startsWith("data:image")) {
                                    activeNpcImages.push({ name: n.name, base64: n.pfp });
                                }
                            });
                        }
                    }
                }
            }
        }
    }

    return dict;
}

function escapeRegex(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function handlePromptInjection(data, type) {
    const messages = data?.messages || data?.chat || (Array.isArray(data) ? data : null);
    if (!messages || !Array.isArray(messages)) return;
    const disablePrefill = localProfile && localProfile.disableUtilityPrefill === true;

    // --- INJECT STORY PLANNER PROMPT ---
    if (activeStoryPlanRequest) {
        messages.length = 0;

        // SillyTavern macro substitutions to get Lore and Persona
        const charLore = typeof substituteParams === 'function' ? substituteParams('{{description}}') : "No character description found.";
        const userPersona = typeof substituteParams === 'function' ? substituteParams('{{persona}}') : "No user persona found.";

        messages.push({
            "role": "system",
            "content": `Role: You are an expert Story Architect and Plot Planner.\n\n<lore>\n${charLore}\n</lore>\n\nUser Persona ({{user}}):\n<user_persona>\n${userPersona}\n</user_persona>\n\n<Story>\n${activeStoryPlanRequest}\n</Story>`
        });
        messages.push({
            "role": "user",
            "content": `Task: Brainstorm a minimum of 10 theoretical, medium-to-long-term plot developments based on the story so far.\n\nStrict Rules & Constraints:\n1. DO NOT write the immediate next scene. Skip past the current moment and look ahead to future structural milestones.\n2. Use Narrative Structure, NOT Timeframes: Do not use phrases like "three days later" or "next month." Instead, frame every idea as a theoretical future Arc, Chapter, or Episode.\n3. Create a Menu of Possibilities: Treat this list as a theoretical menu of branching paths. Focus on major plot shifts, new character introductions, or escalating conflicts that could anchor a future chapter.\n4. Zero Agency Theft: You are STRICTLY FORBIDDEN from writing dialogue, actions, thoughts, or emotional reactions for {{user}}. You must never describe what {{user}} does, feels, or says under any circumstances.\n5. No Assumptions or Suggestions: Do not predict, suggest, or assume what {{user}} will do next. Never end a response by telling or hinting at what {{user}} should do.\n\nFormat & Style: Keep the ideas punchy, plot-focused, and clearly labeled by narrative structure.`
        });
        messages.push({
            "role": "system",
            "content": "<thinking_steps>\nBefore creating the response, think deeply.\nThoughts must be wrapped in <think></think>. The first token must be <think>. The main text must immediately follow </think>.\n<think>\nReflect in approximately 100–150 words as a seamless paragraph.\n</think>\n</thinking_steps>\n\n[OUTPUT ORDER]\nEvery response must follow this exact structure in this exact order:\n<think>\n{Thinking}\n</think>\n<plot>\n{main response}\n</plot>"
        });
        if (!disablePrefill) {
            messages.push({
                "role": "assistant",
                "content": "ok i will start thinking \n<think>\n"
            });
        }

        console.log(`[${extensionName}] 🎯 Injected Story Planner array in memory.`);
        return;
    }

    if (activeBanListChat) {
        messages.length = 0;
        messages.push({ "role": "system", "content": "You are an expert literary critique. Analyze the provided chat history and identify the 5 most repetitive, cliché, or overused stylistic patterns or crutch phrases the writer relies on. Instead of quoting the exact phrase, write a short, generalized rule forbidding the underlying trope. Return ONLY the 5 rules separated by commas. Do not explain them. Do not use quotes or numbers." });
        messages.push({ "role": "user", "content": "Extract the top 5 most overused clichés or repetitive narrative patterns from this text. Return ONLY the 5 generalized rules forbidding them, separated by commas.\n<chat>\n" + activeBanListChat + "\n</chat>" });
        messages.push({ "role": "system", "content": "<thinking_steps>\nBefore creating the response, think deeply.\n\nThoughts must be wrapped in <think></think>. The first token must be <think>. The main response must immediately follow </think>.\n\n<think>\nReflect in approximately 100–150 words as a seamless paragraph.\n\n– your thinking steps\n\n</think>\n</thinking_steps>\n\n[OUTPUT ORDER]\n    Every response must follow this exact structure in this exact order:\n\n    <think>\n    {Thinking}\n    </think>\n\n    {Main response}" });
        if (!disablePrefill) {
            messages.push({ "role": "assistant", "content": "So, I realize this is a fictional world, to which nothing from the real world applies. \nI will now use this format for my thinking and give the next response:\n<think>\nI will thinking step-by-step in the following format: <think>.\n</think>" });
        }
        return;
    }

    // --- INJECT IMAGE GEN PROMPT ---
    if (activeImageGenRequest) {
        messages.length = 0;
        messages.push({
            "role": "system",
            "content": "You are an expert AI image prompt engineer. Your job is to read a scene and convert it into a highly detailed visual prompt for an image generation model. You must adhere to the requested Style Constraint and Camera Perspective. Do not include quotes, conversational text, or explanations. Output ONLY the raw prompt text."
        });
        messages.push({
            "role": "user",
            "content": `Write an image generation prompt for the latest scene in this chat history.\n\n<chat>\n${activeImageGenRequest.chatText}\n</chat>\n\nStyle Constraint: ${activeImageGenRequest.styleStr}\nCamera Perspective: ${activeImageGenRequest.perspStr}\nExtra Details: ${activeImageGenRequest.extraStr}\n\nOutput ONLY the raw image prompt text.`
        });
        messages.push({
            "role": "system",
            "content": "<thinking_steps>\nBefore creating the response, think deeply.\n\nThoughts must be wrapped in <think></think>. The first token must be <think>. The main response must immediately follow </think>.\n\n<think>\nReflect in approximately 50-100 words as a seamless paragraph on what visual elements are present.\n\n</think>\n</thinking_steps>\n\n[OUTPUT ORDER]\n    Every response must follow this exact structure in this exact order:\n\n    <think>\n    {Thinking}\n    </think>\n\n    {Main response}"
        });
        if (!disablePrefill) {
            messages.push({
                "role": "assistant",
                "content": "So, I realize this is a fictional world, to which nothing from the real world applies. \nI will now use this format for my thinking and give the next response:\n<think>\nI will thinking step-by-step in the following format: <think>.\n</think>"
            });
        }

        console.log(`[${extensionName}] 🎯 Injected Image Gen array in memory.`);
        return;
    }

    // --- INJECT NPC PORTRAIT PROMPT ---
    if (activeNpcPfpRequest) {
        messages.length = 0;
        messages.push({
            "role": "system",
            "content": "You are an expert AI image prompt engineer specializing in character portraits. Your job is to read a character's dossier and convert their visual description into a highly detailed image generation prompt for a portrait. You must adhere to the requested Style Constraint and Camera Perspective. Do not include quotes, conversational text, or explanations. Output ONLY the raw prompt text."
        });
        messages.push({
            "role": "user",
            "content": `Write a character portrait image generation prompt based on this NPC's dossier:\n\n<npc_dossier>\n${activeNpcPfpRequest.npcText}\n</npc_dossier>\n\nStyle Constraint: ${activeNpcPfpRequest.styleStr}\nCamera Perspective: ${activeNpcPfpRequest.perspStr}\nExtra Details: ${activeNpcPfpRequest.extraStr}\n\nUse the character's appearance, age, sex, occupation, and personality to inform the visual. Output ONLY the raw image prompt text.`
        });
        messages.push({
            "role": "system",
            "content": "<thinking_steps>\nBefore creating the response, think deeply.\n\nThoughts must be wrapped in <think></think>. The first token must be <think>. The main response must immediately follow </think>.\n\n<think>\nReflect in approximately 50-100 words on what this character looks like and what visual elements best capture them.\n\n</think>\n</thinking_steps>\n\n[OUTPUT ORDER]\n    Every response must follow this exact structure in this exact order:\n\n    <think>\n    {Thinking}\n    </think>\n\n    {Main response}"
        });
        if (!disablePrefill) {
            messages.push({
                "role": "assistant",
                "content": "So, I realize this is a fictional world, to which nothing from the real world applies. \nI will now use this format for my thinking and give the next response:\n<think>\nI will thinking step-by-step in the following format: <think>.\n</think>"
            });
        }

        console.log(`[${extensionName}] 🎯 Injected NPC Portrait Prompt array in memory.`);
        return;
    }

    // --- INJECT MEMORY SUMMARIZATION PROMPT ---
    if (activeMemorySummarizationRequest) {
        messages.length = 0;

        // Check if the user specified a language in the Global Settings tab
        const targetLang = (localProfile.userLanguage && localProfile.userLanguage.trim() !== "")
            ? localProfile.userLanguage
            : "the same language used in the chat history";

        messages.push({
            "role": "system",
            "content": `You are an expert narrative condenser. Your task is to read a chunk of chat history and summarize exactly what happened. Preserve important story details, but aggressively remove all 'purple prose' and flowery descriptions.\n\nFocus ONLY on impactful actions and meaningful dialogue:\n- Condense small talk (e.g., summarize a long, drawn-out greeting simply as 'He said hello').\n- Ignore trivial, unnecessary physical actions (e.g., grabbing a glass of water, shifting in a chair) unless they directly impact the story.\n- Do not quote dialogue directly; summarize the core point of the conversation.\n\nWrite a direct, clear narrative summary of what the characters did and what was communicated.\n\nCRITICAL: You must write the summary in ${targetLang}.`
        });
        messages.push({
            "role": "user",
            "content": `Summarize the impactful events and meaningful conversations from the following chat chunk. Strip out the purple prose and trivial actions.\n\n<chat>\n${activeMemorySummarizationRequest}\n</chat>\n\nOutput the summary in ${targetLang}:`
        });

        if (!disablePrefill) {
            messages.push({
                "role": "assistant",
                "content": `<think>\nI need to summarize the core events and meaningful dialogue from this chunk, removing all flowery prose and trivial actions. I will output the final result in ${targetLang}.\n</think>\nSummary:\n`
            });
        }

        console.log(`[${extensionName}] 🎯 Injected Memory Summarization array in memory.`);
        return;
    }

    if (activeGenerationOrder) {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].content && typeof messages[i].content === 'string') {
                if (messages[i].content.includes("___PS_DUMMY___")) { messages.splice(i, 1); continue; }
                if (messages[i].content.includes("[[order]]")) messages[i].content = messages[i].content.replace(/\[\[order\]\]/g, activeGenerationOrder);
            }
        }
    }

    if (!localProfile) return;
    const dict = buildBaseDict();

    if (localProfile.devOverrides) {
        Object.keys(localProfile.devOverrides).forEach(key => { if (dict[key] !== undefined) dict[key] = localProfile.devOverrides[key]; });
    }

    let replacementsMade = 0;
    for (const msg of messages) {
        if (msg.content && typeof msg.content === 'string') {
            Object.entries(dict).forEach(([trigger, replacement]) => {
                if (msg.content.includes(trigger)) {
                    const processed = typeof substituteParams === 'function' ? substituteParams(replacement) : replacement;

                    // If the replacement is empty, remove the tag AND the empty line it sits on
                    if (processed.trim() === "") {
                        msg.content = msg.content.replace(new RegExp(`^[ \\t]*${escapeRegex(trigger)}[ \\t]*\\r?\\n?`, 'gm'), "");
                    }

                    // Standard replacement for everything else
                    msg.content = msg.content.replace(new RegExp(escapeRegex(trigger), 'g'), processed);
                    replacementsMade++;
                }
            });

            // Cleanup unused tags (Removes the tag AND the line break)
            ["[[long-Memory]]", "[[Short-memory]]", "[[prompt1]]", "[[prompt2]]", "[[prompt3]]", "[[prompt4]]", "[[prompt5]]", "[[prompt6]]", "[prompt1]", "[prompt2]", "[prompt3]", "[prompt4]", "[prompt5]", "[prompt6]", "[[AI1]]", "[[AI2]]", "[[main]]", "[[OOC]]", "[[control]]", "[[aiprompt]]", "[[death]]", "[[combat]]", "[[Direct]]", "[[DN]]", "[[COLOR]]", "[[infoblock]]", "[[summary]]", "[[cyoa]]", "[[COT]]", "[[prefill]]", "[[order]]", "[[Language]]", "[[pronouns]]", "[[banlist]]", "[[count]]", "[[MVU]]", "[[img1]]", "[[img2]]", "[[storyplan]]", "[[storytracker]]", "[[DNRATIO]]", "[[THINK]]", "[[onomato]]", "[[npc_events]]", "[[cyoa2]]", "[[infoblock2]]", "[[summary2]]", "[[storytracker2]]", "[[npc_inner_chatter]]", "[[npc_inner_chatter2]]", "[[npc_dossier]]", "[[npc_dossier2]]", "[[npc list]]"].forEach(tr => {
                if (msg.content.includes(tr)) {
                    msg.content = msg.content.replace(new RegExp(`^[ \\t]*${escapeRegex(tr)}[ \\t]*\\r?\\n?`, 'gm'), "");
                    msg.content = msg.content.replace(new RegExp(escapeRegex(tr), 'g'), ""); // Catch-all for inline tags
                }
            });

            // Final Sweep: Collapse 3 or more blank lines into a standard double line break
            msg.content = msg.content.replace(/(?:\r?\n[ \t]*){3,}/g, '\n\n');
        }
    }

    // --- INJECT NPC PORTRAITS AS MULTIMODAL IMAGES ---
    if (activeNpcImages && activeNpcImages.length > 0) {
        // Find the message that contains the NPC list text and convert to multimodal
        for (const msg of messages) {
            if (msg.content && typeof msg.content === 'string' && msg.content.includes('[RELEVANT NPCs]')) {
                const parts = [{ type: "text", text: msg.content }];
                activeNpcImages.forEach(img => {
                    parts.push({ type: "text", text: `[Portrait of ${img.name}]` });
                    parts.push({ type: "image_url", image_url: { url: img.base64, detail: "low" } });
                });
                msg.content = parts;
                break;
            }
        }
        activeNpcImages = [];
    }

    if (replacementsMade > 0 && !activeGenerationOrder) {
        console.log(`[${extensionName}] ✅ Executed ${replacementsMade} block replacements.`);
    }

    // --- PROMPT PREVIEW ---
    const isBackgroundGen = activeStoryPlanRequest || activeBanListChat || activeImageGenRequest || activeNpcPfpRequest || activeMemorySummarizationRequest || activeGenerationOrder;

    // Prevent double-popups from Token Counting or rapid ST background triggers
    const now = Date.now();
    const isSpam = (now - lastPromptPreviewTime) < 2000;
    const isTokenCount = type === "count" || type === "quiet";

    if (localProfile.toggles && localProfile.toggles.promptPreview && !isBackgroundGen && !isTokenCount && !isSpam) {
        lastPromptPreviewTime = now; // Lock it immediately

        let promptString = "";
        messages.forEach(m => {
            let contentStr = "";
            if (typeof m.content === "string") contentStr = m.content;
            else if (Array.isArray(m.content)) {
                // Handle multimodal image data safely
                contentStr = m.content.map(c => c.type === "text" ? c.text : "[BASE64 IMAGE DATA]").join("\n");
            }
            promptString += `========== [ ${m.role.toUpperCase()} ] ==========\n${contentStr}\n\n`;
        });

        const $content = $(`
            <div style="display:flex; flex-direction:column; gap:10px; font-family: 'Inter', sans-serif;">
                <div style="font-size: 0.85rem; color: var(--text-muted);">This is the exact payload being sent to the AI API.</div>
                <textarea class="ps-modern-input" readonly style="height: 450px; resize: vertical; font-family: monospace; font-size: 0.75rem; padding: 10px; white-space: pre-wrap; background: rgba(0,0,0,0.5);"></textarea>
            </div>
        `);
        $content.find("textarea").val(promptString);

        const { Popup, POPUP_TYPE } = typeof getContext === "function" ? getContext() : window;
        const popup = new Popup($content, POPUP_TYPE.CONFIRM, "Prompt Payload Preview", { okButton: "Send to AI", cancelButton: "Cancel", wide: true, large: true });

        const confirmed = await popup.show();

        if (!confirmed) {
            messages.length = 0; // Safely aborts ST generation
            toastr.info("Generation cancelled by user.");
        }
    }
}


// -------------------------------------------------------------
// DEV MODE: VISUAL ENGINE BUILDER
// -------------------------------------------------------------
function renderDevMode(view = "landing", selectedModeId = null, passedModeData = null, returnTo = "landing") {
    const c = $("#ps_stage_content");
    c.empty();
    c.off(".devDirty");

    // Hide the dock and the apply to all button
    $(".dock").hide();
    $("#btn_apply_tab_all").hide();
    $("#ps_btn_save_close").hide();

    // Update Dev button visually
    $("#ps_btn_dev_mode").html(`<i class="fa-solid fa-right-from-bracket"></i> Exit Dev`).css("color", "#10b981");

    if (!extension_settings[extensionName].customModes) extension_settings[extensionName].customModes = [];

    // Inject custom headers depending on which Dev view we are in
    const devTitle = view === "landing" ? "Engine Builder" : "Visual Engine Builder";
    const devSub = view === "landing" ? "Design your own chronological AI logic flow. Clone an existing template or start from scratch." : "Configure your custom engine blocks.";

    // Update Dev button visuals
    $("#ps_btn_dev_mode")
        .html(`<i class="fa-solid fa-right-from-bracket"></i> Exit Dev`)
        .css("color", "#10b981");

    if (!extension_settings[extensionName].customModes) extension_settings[extensionName].customModes = [];

    // --- VIEW 1: DASHBOARD (Merged Landing & List) ---
    if (view === "landing") {
        isDevEngineDirty = false;
        $("#ps_stage_sub").text("Design your own chronological AI logic flow. Clone an existing template or start from scratch.");

        // Top Action Bar (Moved Import up here!)
        c.append(`
            <div style="display: flex; gap: 15px; margin-top: 10px; margin-bottom: 30px;">
                <button id="dev_btn_new" class="ps-modern-btn primary" style="background: #10b981; color: #fff; flex: 1; padding: 12px; font-size: 1rem;"><i class="fa-solid fa-wand-magic-sparkles"></i> Create Blank Engine</button>
                <button id="dev_btn_import" class="ps-modern-btn secondary" style="flex: 1; padding: 12px; font-size: 1rem;"><i class="fa-solid fa-file-import"></i> Import Engine (JSON)</button>
                <input type="file" id="dev_import_file" accept=".json" style="display:none;" />
            </div>
        `);

        // Event Listeners for Top Bar
        $("#dev_btn_new").on("click", () => renderDevMode("editor", "NEW"));
        $("#dev_btn_import").on("click", () => $("#dev_import_file").click());
        $("#dev_import_file").on("change", function (e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const imported = JSON.parse(e.target.result);
                    imported.id = "custom_" + Date.now(); // Ensure unique ID on import
                    extension_settings[extensionName].customModes.push(imported);
                    saveSettingsDebounced();
                    toastr.success(`Imported ${imported.label}!`);
                    renderDevMode("landing"); // Refresh UI
                } catch (e) { toastr.error("Invalid JSON file."); }
            };
            reader.readAsText(file);
        });

        // --- SECTION 1: CORE TEMPLATES (CLONE) ---
        c.append(`<div class="ps-rule-title" style="color: var(--gold); margin-bottom: 12px;"><i class="fa-solid fa-cube"></i> Core Templates (Clone)</div>`);
        const coreGrid = $(`<div class="ps-grid" style="margin-bottom: 30px;"></div>`); // Added margin-bottom so it breathes before the next section
        hardcodedLogic.modes.forEach(m => {
            const card = $(`
                <div class="ps-card" style="justify-content: space-between;">
                    <div style="width: 100%;">
                        <div class="ps-card-title"><span>${m.label}</span></div>
                        <div class="ps-card-desc">System Default Engine</div>
                    </div>
                    <div style="width: 100%; margin-top: 20px;">
                        <button class="ps-modern-btn secondary dev-clone" style="width: 100%; padding: 8px; font-size: 0.8rem; border-color: var(--gold); color: var(--gold);"><i class="fa-solid fa-copy"></i> Clone & Edit</button>
                    </div>
                </div>
            `);
            card.find(".dev-clone").on("click", () => renderDevMode("editor", m.id));
            coreGrid.append(card);
        });
        c.append(coreGrid);

        // --- SECTION 2: YOUR CUSTOM ENGINES ---
        const customModes = extension_settings[extensionName].customModes || [];
        c.append(`<div class="ps-rule-title" style="color: #10b981; margin-bottom: 12px;"><i class="fa-solid fa-microchip"></i> Your Custom Engines</div>`);

        if (customModes.length === 0) {
            c.append(`<div style="padding: 20px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-color); border-radius: 12px; margin-bottom: 30px;">No custom engines yet. Create or import one above!</div>`);
        } else {
            const customGrid = $(`<div class="ps-grid" style="margin-bottom: 30px;"></div>`);
            customModes.forEach(m => {
                const card = $(`
                    <div class="ps-card" style="border-color: #10b981; background: rgba(16, 185, 129, 0.05); justify-content: space-between;">
                        <div style="width: 100%;">
                            <div class="ps-card-title"><span style="color: #10b981;">${m.label}</span></div>
                            <div class="ps-card-desc">Custom User Logic Flow</div>
                        </div>
                        <div style="display: flex; gap: 8px; margin-top: 20px; width: 100%;">
                            <button class="ps-modern-btn secondary dev-export" style="flex: 1; padding: 6px; font-size: 0.8rem; border-color: rgba(255,255,255,0.2);" title="Export"><i class="fa-solid fa-download"></i></button>
                            <button class="ps-modern-btn primary dev-edit" style="flex: 2; padding: 6px; font-size: 0.8rem; background: var(--gold); color: #000;"><i class="fa-solid fa-pen"></i> Edit</button>
                            <button class="ps-modern-btn secondary dev-delete" style="flex: 1; padding: 6px; font-size: 0.8rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);" title="Delete"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                `);

                card.find(".dev-edit").on("click", () => renderDevMode("editor", m.id));
                card.find(".dev-export").on("click", () => {
                    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(m));
                    const downloadAnchorNode = document.createElement('a');
                    downloadAnchorNode.setAttribute("href", dataStr);
                    downloadAnchorNode.setAttribute("download", m.label.replace(/\s+/g, '_') + ".json");
                    document.body.appendChild(downloadAnchorNode);
                    downloadAnchorNode.click();
                    downloadAnchorNode.remove();
                });
                card.find(".dev-delete").on("click", () => {
                    if (confirm(`Delete ${m.label}?`)) {
                        extension_settings[extensionName].customModes = extension_settings[extensionName].customModes.filter(x => x.id !== m.id);
                        saveSettingsDebounced(); renderDevMode("landing");
                    }
                });
                customGrid.append(card);
            });
            c.append(customGrid);
        }

        return;
    }

    // --- VIEW 3: EDITOR ---
    if (view === "editor") {
        let modeData;
        let isNew = false;
        if (passedModeData) {
            modeData = passedModeData;
        } else if (selectedModeId === "NEW") {
            isNew = true;
            modeData = {
                id: "custom_" + Date.now(),
                label: "New Custom Engine",
                isCoreClone: false,
                p1: "", p2: "", p3: "", p4: "", p5: "", p6: "",
                cot: "", prefill: "", cyoa: "", info: "", summary: "",
                customToggles: []
            };
        } else {
            const coreMatch = hardcodedLogic.modes.find(m => m.id === selectedModeId);
            if (coreMatch) {
                isNew = true; modeData = JSON.parse(JSON.stringify(coreMatch));
                modeData.id = "custom_" + Date.now(); modeData.label = coreMatch.label + " (Copy)";
                modeData.isCoreClone = true;
                if (!modeData.cot) modeData.cot = "";
                if (!modeData.prefill) modeData.prefill = "";
                if (!modeData.cyoa) modeData.cyoa = "";
                if (!modeData.info) modeData.info = "";
                if (!modeData.summary) modeData.summary = "";
            } else {
                modeData = extension_settings[extensionName].customModes.find(m => m.id === selectedModeId);
            }
        }
        if (!modeData.customToggles) modeData.customToggles = [];

        c.append(`
            <div style="position: sticky; top: -11px; z-index: 100; background: var(--bg-panel); padding: 10px 0 15px 0; margin-top: -10px; margin-bottom: 20px; display: flex; gap: 10px; border-bottom: 1px solid var(--border-color); box-shadow: 0 10px 15px -10px rgba(0,0,0,0.6);">
                <button id="dev_back_list" class="ps-modern-btn secondary"><i class="fa-solid fa-arrow-left"></i> Back</button>
                <input type="text" id="dev_mode_name" class="ps-modern-input" value="${modeData.label}" style="flex: 1; font-weight: bold; font-size: 1.1rem; border-color: var(--gold);" />
                <button id="dev_save_mode" class="ps-modern-btn primary" style="background: #10b981; color: #fff;"><i class="fa-solid fa-floppy-disk"></i> Save Engine</button>
            </div>
        `);

        // NEW: Track if the user types anything
        c.off("input.devDirty change.devDirty").on("input.devDirty change.devDirty", "input, textarea, select", function () {
            isDevEngineDirty = true;
        });

        // NEW: Back button with unsaved changes warning
        $("#dev_back_list").on("click", () => {
            if (isDevEngineDirty) {
                if (!confirm("You have unsaved changes in this engine. Are you sure you want to go back? Changes will be lost.")) return;
            }
            isDevEngineDirty = false; // Reset tracker
            if (returnTo === "tab") { $(".ps-sidebar").show(); switchTab(0); }
            else { renderDevMode("landing"); }
        });

        const saveCurrentTextState = () => {
            modeData.label = $("#dev_mode_name").val();
            if ($("#dev_edit_p1").length) modeData.p1 = $("#dev_edit_p1").val();
            modeData.p3 = $("#dev_edit_p3").val();
            modeData.p4 = $("#dev_edit_p4").val(); modeData.p5 = $("#dev_edit_p5").val(); modeData.p6 = $("#dev_edit_p6").val();

            // Loop through all override fields
            const fields = ["cot", "prefill", "cyoa", "info", "summary", "death", "combat", "direct", "dn", "dialogueColor", "mvu", "storytracker", "think", "language", "pronouns", "count", "dnratio", "onomato", "banlist"];
            fields.forEach(f => {
                if ($(`#dev_edit_${f}`).length) modeData[f] = $(`#dev_edit_${f}`).val();
            });
        };

        // UI Helpers
        const createInsertPoint = (attach) => `<div class="dev-insert-point" data-attach="${attach}" style="text-align: center; padding: 10px; cursor: pointer; color: var(--gold); border: 2px dashed rgba(245,158,11,0.3); border-radius: 8px; margin: 10px 0;"><i class="fa-solid fa-plus"></i> Add Module Here</div>`;
        const createLockedBlock = (t, c) => `<div style="background: rgba(0,0,0,0.4); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 10px;"><div style="font-weight: bold; color: var(--text-muted); font-size: 0.8rem; margin-bottom: 6px;">${t} <i class="fa-solid fa-lock" style="float: right;"></i></div><div style="font-family: monospace; font-size: 0.75rem; color: #666; white-space: pre-wrap;">${c}</div></div>`;
        const createEditableBlock = (t, k, v) => `<div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 10px;"><div style="font-weight: bold; color: var(--accent-color); font-size: 0.8rem; margin-bottom: 6px;">${t}</div><textarea id="dev_edit_${k}" class="ps-modern-input" style="height: 80px; resize: vertical; font-family: monospace; font-size: 0.8rem;">${v || ""}</textarea></div>`;
        const createOverrideBlock = (t, k, v, presets) => {
            let btnsHtml = presets.map(p => {
                const isActive = (v || "") === p.value;
                const style = isActive ? 'background: rgba(16, 185, 129, 0.15); border-color: #10b981; color: #10b981;' : '';
                return `<button type="button" class="ps-modern-btn secondary dev-preset-btn" data-target="dev_edit_${k}" data-val="${encodeURIComponent(p.value)}" style="padding: 4px 10px; font-size: 0.7rem; border-radius: 4px; ${style}">${p.label}</button>`;
            }).join('');

            return `<div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <div style="font-weight: bold; color: var(--accent-color); font-size: 0.8rem;">${t}</div>
                    <div style="display: flex; gap: 6px;">${btnsHtml}</div>
                </div>
                <textarea id="dev_edit_${k}" class="ps-modern-input" style="height: 80px; resize: vertical; font-family: monospace; font-size: 0.8rem;">${v || ""}</textarea>
            </div>`;
        };

        // Special Dropdown for CoT Languages
        const createCotDropdownBlock = (t, k, v, type) => {
            let options = `<option value="">[ Clear Box ]</option>`;
            hardcodedLogic.models.forEach(m => {
                if (m.id === "cot-off") return;
                const val = (type === "cot") ? m.content : m.prefill;
                options += `<option value="${encodeURIComponent(val || '')}">${m.id}</option>`;
            });

            return `<div style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <div style="font-weight: bold; color: var(--accent-color); font-size: 0.8rem;">${t}</div>
                    <select class="ps-modern-input dev-preset-dropdown" data-target="dev_edit_${k}" style="width: 250px; padding: 4px; font-size: 0.75rem; cursor: pointer; color: var(--gold); border-color: var(--gold);">
                        <option value="" disabled selected>✨ Load Language Template...</option>
                        ${options}
                    </select>
                </div>
                <textarea id="dev_edit_${k}" class="ps-modern-input" style="height: 120px; resize: vertical; font-family: monospace; font-size: 0.8rem;">${v || ""}</textarea>
            </div>`;
        };

        const flow = $(`<div style="display: flex; flex-direction: column;"></div>`);

        if (modeData.isCoreClone) {
            flow.append(createLockedBlock("[[prompt1]]", modeData.p1));
            flow.append(createLockedBlock("[[prompt2]]", modeData.p2));
        } else {
            flow.append(createEditableBlock("[[prompt1]]", "p1", modeData.p1));
        }
        flow.append(createEditableBlock("[[prompt3]]", "p3", modeData.p3));

        // Custom Modules Logic
        const modRender = (ap) => {
            const wrap = $("<div></div>");
            modeData.customToggles.filter(t => t.attachPoint === ap).forEach(m => {
                const div = $(`
                    <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid #10b981; border-radius: 8px; padding: 10px; margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; font-weight: bold; color: #10b981; font-size: 0.75rem; margin-bottom: 5px;">
                            <span>${m.name}</span>
                            <div style="display:flex; gap: 8px;">
                                <i class="ps-btn-edit-mod fa-solid fa-pen-to-square" style="cursor:pointer; color:var(--gold);"></i>
                                <i class="ps-btn-del-mod fa-solid fa-trash" style="cursor:pointer; color:#ef4444;"></i>
                            </div>
                        </div>
                        <div style="font-size:0.7rem; opacity:0.8; font-family: monospace; white-space: pre-wrap;">${m.content}</div>
                    </div>
                `);
                div.find(".ps-btn-del-mod").on("click", () => { modeData.customToggles = modeData.customToggles.filter(x => x.id !== m.id); saveCurrentTextState(); renderDevMode("editor", modeData.id, modeData); isDevEngineDirty = true; });
                div.find(".ps-btn-edit-mod").on("click", async () => {
                    saveCurrentTextState();
                    const $p = $(`<div style="display:flex; flex-direction:column; gap:10px;"><input type="text" id="m_n" class="ps-modern-input" value="${m.name}" /><select id="m_l" class="ps-modern-input"><option value="settings" ${m.location === 'settings' ? 'selected' : ''}>Stage 4: Settings</option><option value="addons" ${m.location === 'addons' ? 'selected' : ''}>Stage 5: Add-ons</option></select><textarea id="m_c" class="ps-modern-input" style="height:150px;">${m.content}</textarea></div>`);
                    if (await new Popup($p, POPUP_TYPE.CONFIRM, "Edit Module", { okButton: "Save", cancelButton: "Cancel", wide: true }).show()) { m.name = $p.find("#m_n").val() || "Module"; m.location = $p.find("#m_l").val(); m.content = $p.find("#m_c").val(); renderDevMode("editor", modeData.id, modeData); isDevEngineDirty = true; }
                });
                wrap.append(div);
            });
            return wrap;
        };

        flow.append(modRender("p3")); flow.append(createInsertPoint("p3"));
        flow.append(createLockedBlock("[[AI1]]", "Understood."));
        flow.append(createEditableBlock("[[prompt4]]", "p4", modeData.p4));
        flow.append(createEditableBlock("[[prompt5]]", "p5", modeData.p5));
        flow.append(modRender("p5")); flow.append(createInsertPoint("p5"));
        flow.append(createEditableBlock("[[prompt6]]", "p6", modeData.p6));
        flow.append(modRender("p6")); flow.append(createInsertPoint("p6"));
        flow.append(createLockedBlock("[[AI2]]", "Understood."));

        // Fetch raw template data for overrides
        const getAddon = id => hardcodedLogic.addons.find(a => a.id === id)?.content || "";
        const getBlock = id => hardcodedLogic.blocks.find(b => b.id === id)?.content || "";

        // Section 1: CoT & Logic Overrides
        flow.append(`<div class="ps-rule-title" style="margin: 30px 0 10px 0; color: #3b82f6;"><i class="fa-solid fa-brain"></i> CoT & Logic Overrides</div>`);
        flow.append(createCotDropdownBlock("[[COT]]", "cot", modeData.cot, "cot"));
        flow.append(createCotDropdownBlock("[[prefill]]", "prefill", modeData.prefill, "prefill"));
        flow.append(createOverrideBlock("[[THINK]]", "think", modeData.think, [{ label: "No Change", value: "" }, { label: "Default", value: "<think>\n<think>\n<think>\n{Thinking}\n</think>" }]));

        // Section 2: Add-ons & Formatting
        flow.append(`<div class="ps-rule-title" style="margin: 30px 0 10px 0; color: #10b981;"><i class="fa-solid fa-puzzle-piece"></i> Add-ons & Formatting Overrides</div>`);
        flow.append(createOverrideBlock("[[cyoa]]", "cyoa", modeData.cyoa, [{ label: "No Change", value: "" }, { label: "Default", value: getBlock("cyoa") }]));
        flow.append(createOverrideBlock("[[infoblock]]", "info", modeData.info, [{ label: "No Change", value: "" }, { label: "Default", value: getBlock("info") }]));
        flow.append(createOverrideBlock("[[summary]]", "summary", modeData.summary, [{ label: "No Change", value: "" }, { label: "Default", value: getBlock("summary") }]));
        flow.append(createOverrideBlock("[[death]]", "death", modeData.death, [{ label: "No Change", value: "" }, { label: "Default", value: getAddon("death") }]));
        flow.append(createOverrideBlock("[[combat]]", "combat", modeData.combat, [{ label: "No Change", value: "" }, { label: "Default", value: getAddon("combat") }]));
        flow.append(createOverrideBlock("[[Direct]]", "direct", modeData.direct, [{ label: "No Change", value: "" }, { label: "Default", value: getAddon("direct") }]));
        flow.append(createOverrideBlock("[[DN]]", "dn", modeData.dn, [{ label: "No Change", value: "" }, { label: "Default", value: getAddon("dn") }]));
        flow.append(createOverrideBlock("[[COLOR]]", "dialogueColor", modeData.dialogueColor, [{ label: "No Change", value: "" }, { label: "Default", value: getAddon("color") }])); flow.append(createOverrideBlock("[[MVU]]", "mvu", modeData.mvu, [{ label: "No Change", value: "" }, { label: "Default", value: getBlock("mvu") }]));
        flow.append(createOverrideBlock("[[storytracker]]", "storytracker", modeData.storytracker, [{ label: "No Change", value: "" }, { label: "Default", value: "# at the very end of the response put this block:\n<Story_Tracker>\narc: The Arc that is now active.\nchapter: The chapter that is now active.\nEpisode: The episode that is now active.\nSecrets: Any secret that the user/{{user}} doesn't know.\n</Story_Tracker>" }]));

        // Section 3: Global Variables
        flow.append(`<div class="ps-rule-title" style="margin: 30px 0 10px 0; color: #f59e0b;"><i class="fa-solid fa-earth-americas"></i> Global Variables Overrides</div>`);
        flow.append(createOverrideBlock("[[Language]]", "language", modeData.language, [{ label: "No Change", value: "" }, { label: "English Template", value: "[LANGUAGE RULE]\nALL OUTPUT EXCEPT THINKING MUST BE IN ENGLISH ONLY." }]));
        flow.append(createOverrideBlock("[[pronouns]]", "pronouns", modeData.pronouns, [{ label: "No Change", value: "" }, { label: "Male Template", value: "{{user}} is male. Always portray and address him as such." }]));
        flow.append(createOverrideBlock("[[count]]", "count", modeData.count, [{ label: "No Change", value: "" }, { label: "Example 400", value: "— maximum 400 words" }]));
        flow.append(createOverrideBlock("[[DNRATIO]]", "dnratio", modeData.dnratio, [{ label: "No Change", value: "" }, { label: "Example 50/50", value: "- Ratio: Maintain a balance of 50% Dialogue and 50% Narration." }]));
        flow.append(createOverrideBlock("[[onomato]]", "onomato", modeData.onomato, [{ label: "No Change", value: "" }, { label: "Default", value: "- Narration must utilize onomatopoeia. Use precise, context-specific phonetic representations for physical interactions (e.g., the click of a latch, the thud of a heavy object, the soughing of wind) rather than abstract descriptions of sound." }]));
        flow.append(createOverrideBlock("[[banlist]]", "banlist", modeData.banlist, [{ label: "No Change", value: "" }, { label: "Example", value: "[BAN LIST]\nNever rely on these clichés, tropes, or repetitive patterns. They are dead language:\n- A shiver ran down their spine." }]));

        c.append(flow);

        // Events for Buttons & Dropdowns
        c.find(".dev-preset-btn").on("click", function () {
            const targetId = $(this).attr("data-target");
            const val = decodeURIComponent($(this).attr("data-val"));
            $("#" + targetId).val(val);
            $(this).siblings().css({ "background": "transparent", "border-color": "var(--border-color)", "color": "var(--text-main)" });
            $(this).css({ "background": "rgba(16, 185, 129, 0.15)", "border-color": "#10b981", "color": "#10b981" });
        });

        c.off("change.devPreset").on("change.devPreset", ".dev-preset-dropdown", function () {
            const targetId = $(this).attr("data-target");
            const val = decodeURIComponent($(this).val());
            if (val !== "null" && val !== undefined) {
                $("#" + targetId).val(val);
                isDevEngineDirty = true;
            }
            $(this).prop('selectedIndex', 0); // Reset dropdown
        });

        flow.find(".dev-insert-point").on("click", async function () {
            const ap = $(this).attr("data-attach"); saveCurrentTextState();
            const $p = $(`<div style="display:flex; flex-direction:column; gap:10px;"><input type="text" id="m_n" class="ps-modern-input" placeholder="Module Name" /><select id="m_l" class="ps-modern-input"><option value="settings">Stage 4: Settings</option><option value="addons">Stage 5: Add-ons</option></select><textarea id="m_c" class="ps-modern-input" placeholder="Prompt Content" style="height:100px;"></textarea></div>`);
            if (await new Popup($p, POPUP_TYPE.CONFIRM, "Add Module", { wide: true }).show()) {
                const content = $p.find("#m_c").val();
                if (content) { modeData.customToggles.push({ id: "mod_" + Date.now(), name: $p.find("#m_n").val() || "Module", location: $p.find("#m_l").val(), content: content, attachPoint: ap }); renderDevMode("editor", modeData.id, modeData); }
            }
        });

        $("#dev_save_mode").on("click", () => {
            saveCurrentTextState();
            isDevEngineDirty = false;
            if (isNew) { extension_settings[extensionName].customModes.push(modeData); }
            else { const idx = extension_settings[extensionName].customModes.findIndex(m => m.id === modeData.id); if (idx > -1) extension_settings[extensionName].customModes[idx] = modeData; }
            saveSettingsDebounced(); toastr.success("Engine Flow Saved!");
            if (returnTo === "tab") { $(".ps-sidebar").show(); switchTab(0); }
            else { renderDevMode("landing"); }
        });
    }
}
// UNIFIED DEV BUTTON CLICK LISTENER
$("body").off("click", "#ps_btn_dev_mode").on("click", "#ps_btn_dev_mode", function (e) {
    e.preventDefault();
    if ($(this).text().includes("Exit Dev")) {
        if (isDevEngineDirty) {
            if (!confirm("You have unsaved changes in your custom engine. Are you sure you want to exit? Changes will be lost.")) return;
        }
        isDevEngineDirty = false;
        switchTab(0);
    } else {
        renderDevMode("landing");
    }
});

jQuery(async () => {
    try {
        const h = await $.get(`${extensionFolderPath}/example.html`);
        $("body").append(h);
        $("body").append('<div id="ps-global-tooltip"></div>');
        // Modify DOM to transition from Wizard -> Tabs
        $(".ps-breadcrumbs").hide();
        $("#ps_btn_prev, #ps_btn_next").hide();

        $("body").off("click", "#btn_apply_tab_all").on("click", "#btn_apply_tab_all", applyTabToAll);

        $("body").on("mouseenter", ".ps-modern-tag", function () { const hint = $(this).attr("data-hint"); if (!hint) return; const title = $(this).text().trim(); $("#ps-global-tooltip").html(`<span class="ps-tooltip-title">${title}:</span> ${hint}`).addClass("visible"); });
        $("body").on("mouseenter", "#ps_live_token_count", function (e) {
            const hint = $(this).attr("data-breakdown");
            if (!hint) return;
            $("#ps-global-tooltip").html(hint).addClass("visible");
        });
        $("body").on("mousemove", "#ps_live_token_count", function (e) {
            const tooltip = $("#ps-global-tooltip");
            // Position to the left of the mouse so it doesn't go off the screen!
            let x = e.clientX - tooltip.outerWidth() - 15;
            let y = e.clientY + 15;
            tooltip.css({ left: x + 'px', top: y + 'px' });
        });
        $("body").on("mouseleave", "#ps_live_token_count", function () {
            $("#ps-global-tooltip").removeClass("visible");
        });
        $("body").on("mousemove", ".ps-modern-tag", function (e) { if (!$(this).attr("data-hint")) return; const tooltip = $("#ps-global-tooltip"); let x = e.clientX + 15; let y = e.clientY + 15; if (x + tooltip.outerWidth() > window.innerWidth) x = e.clientX - tooltip.outerWidth() - 15; if (y + tooltip.outerHeight() > window.innerHeight) y = e.clientY - tooltip.outerHeight() - 15; tooltip.css({ left: x + 'px', top: y + 'px' }); });
        $("body").on("mouseleave", ".ps-modern-tag", function () { $("#ps-global-tooltip").removeClass("visible"); });

        $("body").on("click", ".sidebar-step", function () { const index = parseInt($(this).attr("id").replace("dot_", "")); if (!isNaN(index)) switchTab(index); });

        $("body").on("click", "#ps_btn_reset", function () {
            if (confirm("Are you sure you want to completely reset this character's profile to the default template?")) {
                const key = getCharacterKey() || "default"; delete extension_settings[extensionName].profiles[key]; saveSettingsDebounced();
                initProfile(); switchTab(0); toastr.info("Profile has been reset to defaults.");
            }
        });

        $("body").on("click", "#ps_btn_save_close", function () { saveProfileToMemory(); $("#prompt-slot-modal-overlay").fadeOut(200); toastr.success("Workflow Configured & Applied Successfully!"); });

        if (typeof eventSource !== 'undefined' && typeof event_types !== 'undefined') {
            eventSource.on(event_types.APP_READY, () => {
                cleanGhostProfiles();
                discoverDefaultImages();
            });
            eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, handlePromptInjection);
            eventSource.on(event_types.CHAT_CHANGED, () => {
                initProfile(); updateCharacterDisplay();
                if ($("#prompt-slot-modal-overlay").is(":visible")) switchTab(currentTab);
                updateMemoryVisuals();
            });
            // Background Vectorization triggers for Semantic Mode
            eventSource.on(event_types.USER_MESSAGE_RENDERED, memUpdateSemanticQuery);
            eventSource.on(event_types.MESSAGE_EDITED, memUpdateSemanticQuery);
            eventSource.on(event_types.CHAT_CHANGED, memUpdateSemanticQuery);
            // Trigger visual update when user clicks "Show more messages"
            eventSource.on(event_types.MORE_MESSAGES_LOADED, updateMemoryVisuals);
            // IMAGE GEN AUTO-GEN & SWIPE TRIGGERS
            eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
                updateMemoryVisuals();

                // AUTO-TRIGGER STORY PLANNER
                const sp = localProfile?.storyPlan;
                if (sp && sp.enabled && sp.triggerMode === 'frequency') {
                    const chat = getContext().chat;
                    const aiMsgCount = chat.filter(m => !m.is_user && !m.is_system).length;
                    if (aiMsgCount > 0 && aiMsgCount % sp.autoFreq === 0) {
                        toastr.info("Auto-Generating new Story Plan...", "Megumin Suite");
                        setTimeout(async () => {
                            const chatText = getCleanedChatHistory();
                            if (chatText.length < 100) return;
                            try {
                                let output = sp.backend === "direct" ? await generateStoryPlanLogic(chatText) : await new Promise(r => useMeguminEngine(async () => r(await generateStoryPlanLogic(chatText))));
                                const plotMatch = output?.match(/<plot>([\s\S]*?)<\/plot>/i);
                                if (plotMatch) {
                                    sp.currentPlan = plotMatch[1].trim();
                                    saveProfileToMemory();
                                    if ($("#sp_current_plan").length) $("#sp_current_plan").val(sp.currentPlan);
                                    toastr.success("Story Plan Updated silently!");
                                }
                            } catch (e) { console.error("Story Plan auto-gen failed", e); }
                        }, 2000); // Small delay to let chat save first
                    }
                }

                // AUTO-TRIGGER MEMORY CORE
                const mem = localProfile?.memoryCore;
                if (mem && mem.enabled && mem.triggerMode === 'frequency') {
                    const chat = getContext().chat;
                    const aiMsgCount = chat.filter(m => !m.is_user && !m.is_system).length;

                    if (aiMsgCount > 0 && aiMsgCount % 10 === 0) {
                        toastr.info("Background Memory Scan Triggered...", "Megumin Suite");
                        // We run it after a small delay so ST finishes saving the chat first
                        setTimeout(async () => {
                            await memProcessPendingChunks();
                        }, 3000);
                    }
                }

                const s = localProfile?.imageGen;

                // AUTO-EXTRACT NPCs
                const npcBank = localProfile?.npcBank;
                if (npcBank && npcBank.enabled) {
                    const chat = getContext().chat;
                    if (chat && chat.length) {
                        const lastMsg = chat[chat.length - 1];
                        if (!lastMsg.is_user && !lastMsg.is_system) {
                            const npcRegex = /<details>[\s\S]*?<summary>.*?New NPC:\s*(.*?)<\/summary>([\s\S]*?)<\/details>/ig;
                            let match;
                            let added = false;
                            while ((match = npcRegex.exec(lastMsg.mes)) !== null) {
                                const npcName = match[1].trim().replace(/<\/?b>/ig, "");
                                const npcContent = match[0].trim();
                                if (!npcBank.npcs) npcBank.npcs = [];
                                if (!npcBank.npcs.find(n => (n.name || "").trim().toLowerCase() === npcName.toLowerCase())) {
                                    // Parse structured fields from the raw block
                                    const parsed = npcParseBlock(npcContent);
                                    npcBank.npcs.push({
                                        name: parsed.name || npcName,
                                        age: parsed.age || "",
                                        sex: parsed.sex || "",
                                        appearance: parsed.appearance || "",
                                        occupation: parsed.occupation || "",
                                        background: parsed.background || "",
                                        innerCircle: parsed.innerCircle || "",
                                        personality: parsed.personality || "",
                                        agenda: parsed.agenda || "",
                                        hiddenLayer: parsed.hiddenLayer || "",
                                        pfp: "",
                                        timestamp: Date.now()
                                    });
                                    added = true;
                                    toastr.success(`NPC added to Bank: ${npcName}`, "Megumin Suite");
                                    if ($("#npc_bank_list").length) renderNpcList();
                                }
                            }
                            if (added) saveProfileToMemory();
                        }
                    }
                }

                if (!s || !s.enabled) return;

                const chat = getContext().chat;
                if (!chat || !chat.length) return;

                const lastMsg = chat[chat.length - 1];
                if (lastMsg.is_user || lastMsg.is_system) return;

                // Look for the <img prompt="..."> tag in the AI's response
                const imgRegex = /<img\s+prompt=["'](.*?)["']\s*\/?>/i;
                const match = lastMsg.mes.match(imgRegex);

                if (match) {
                    const extractedPrompt = match[1];

                    // 1. Remove the raw tag from the chat text so the user doesn't see it
                    lastMsg.mes = lastMsg.mes.replace(imgRegex, "").trim();
                    await saveChat();
                    reloadCurrentChat(); // Refreshes the chat window instantly

                    // 2. Send the extracted prompt to ComfyUI!
                    setTimeout(() => {
                        toastr.info("Image tag detected. Sending to ComfyUI...");
                        igGenerateWithComfy(extractedPrompt, null);
                    }, 500);
                }
            });
            const meguminSwipeHandler = async (data) => {
                const s = localProfile?.imageGen;
                if (!s || !s.enabled) return;

                const { message, direction, element } = data;

                // Only trigger on right swipes
                if (direction !== "right") return;

                const media = message.extra?.media || [];
                const idx = message.extra?.media_index || 0;

                // Only trigger on the LAST image in the gallery (overswipe)
                if (idx < media.length - 1) return;

                const mediaObj = media[idx];

                // If there is no title (prompt), we can't regenerate it.
                if (!mediaObj || !mediaObj.title) return;

                // PRIORITY HACK: Temporarily stun both old and new ST Image Gen settings
                // so the native ST listener aborts itself!
                let ogPower = null;
                if (window.power_user && window.power_user.image_overswipe) {
                    ogPower = window.power_user.image_overswipe;
                    window.power_user.image_overswipe = "off";
                }

                let ogExt = null;
                if (extension_settings.image_generation && extension_settings.image_generation.overswipe) {
                    ogExt = extension_settings.image_generation.overswipe;
                    extension_settings.image_generation.overswipe = false;
                }

                // Restore ST's native settings 200ms later after the default listener aborts
                setTimeout(() => {
                    if (ogPower && window.power_user) window.power_user.image_overswipe = ogPower;
                    if (ogExt && extension_settings.image_generation) extension_settings.image_generation.overswipe = ogExt;
                }, 200);

                toastr.info("Regenerating Image...", "Megumin Suite");
                await igGenerateWithComfy(mediaObj.title, { message: message, element: $(element) });
            };

            // Bind the listener
            eventSource.on(event_types.IMAGE_SWIPED, meguminSwipeHandler);

            // FORCE IT TO THE FRONT OF THE REAL ARRAY
            // This ensures our extension evaluates the swipe BEFORE SillyTavern does.
            if (eventSource._events && Array.isArray(eventSource._events[event_types.IMAGE_SWIPED])) {
                const arr = eventSource._events[event_types.IMAGE_SWIPED];
                if (arr.length > 1 && arr[arr.length - 1] === meguminSwipeHandler) {
                    arr.unshift(arr.pop());
                }
            }
        }

        $("body").on("click", "#prompt-slot-fixed-btn", function () { initProfile(); updateCharacterDisplay(); switchTab(0); $("#prompt-slot-modal-overlay").fadeIn(250).css("display", "flex"); });
        $("body").off("click", "#close-prompt-slot-modal, #prompt-slot-modal-overlay").on("click", "#close-prompt-slot-modal, #prompt-slot-modal-overlay", function (e) {
            if (e.target === this) {
                if (isDevEngineDirty) {
                    if (!confirm("You have unsaved changes in your custom engine. Are you sure you want to close? Changes will be lost.")) return;
                    isDevEngineDirty = false;
                }
                saveProfileToMemory();
                $("#prompt-slot-modal-overlay").fadeOut(200);
            }
        });
        let att = 0;
        const int = setInterval(() => {
            if ($("#kazuma_quick_gen").length > 0) {
                clearInterval(int);
                return;
            }
            const b = `<div id="kazuma_quick_gen" class="interactable" title="Visualize Last Scene (Manual)" style="cursor: pointer; width: 35px; height: 35px; display: none; align-items: center; justify-content: center; margin-right: 5px; color: var(--gold);"><i class="fa-solid fa-image fa-lg"></i></div>`;
            let t = $("#send_but_sheld");
            if (!t.length) t = $("#send_textarea");
            if (t.length) {
                t.attr("id") === "send_textarea" ? t.before(b) : t.prepend(b);
                toggleQuickGenButton(); // Ensure correct visibility immediately upon injection
                clearInterval(int);
            }
            att++;
            if (att > 10) clearInterval(int);
        }, 1000);

        $(document).on("click", "#kazuma_quick_gen", function (e) {
            e.preventDefault();
            e.stopPropagation();
            igManualGenerate();
        });

    } catch (e) { console.error(`[${extensionName}] Failed to load:`, e); }
});

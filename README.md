# Megumin Suite for Lumiverse

Megumin Suite is now a standalone Lumiverse Spindle extension. It keeps the original Megumin workflow as an in-app tool: a small floating `M` button opens the full-window Megumin control surface for narrative engines, memory, NPC tracking, story planning, ban lists, and image generation.

This port does not use the original SillyTavern preset installer or placeholder preset blocks. The `Presets/` content is intentionally out of scope and is not required by the extension.

## Extension Shape

- `spindle.json` declares the `megumin_suite` extension and required permissions.
- `src/backend.ts` owns prompt interception, storage, quiet utility generations, UI asset delivery, memory pruning, NPC parsing, and image generation orchestration.
- `src/frontend.ts` owns the magic-wand floating widget and full-window app overlay.
- `src/prompt-engine.ts` assembles complete Megumin prompt blocks directly for Lumiverse generations.
- `src/megumin-data.js` preserves the original Megumin prompt database for the Lumiverse prompt engine.
- `dist/` contains the built backend and frontend entry files.

## Build

```powershell
bun install
bun run check
```

`bun run check` runs TypeScript validation, Bun tests, and bundles both extension entry points.

## Runtime Behavior

- The magic-wand float widget is always available through Lumiverse UI panels.
- Clicking the widget opens a full-window app overlay with the Megumin tabs.
- The overlay restores the original Megumin-style glass dock, hero image banner, action bar, section headers, filter pills, cards, toggles, dashboards, and image/NPC/memory panels.
- Settings are stored in Spindle storage under profile, memory, NPC, image, engine, story, and ban-list namespaces.
- The backend interceptor injects Megumin system blocks directly into Lumiverse generations.
- Memory Core prunes archived chat turns from the prompt payload while reinjecting relevant summaries.
- NPC dossiers and generated images are stored through Megumin-owned state and rendered through Lumiverse-safe frontend hooks.

## Notes

- `Presets/` is intentionally absent.
- Original SillyTavern runtime files are intentionally absent.
- Existing image and screenshot assets are kept for extension UI and documentation use.

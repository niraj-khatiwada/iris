# AGENTS.md

Guidelines for coding agents working on Iris.

## Commands

```bash
bun install                 # Install dependencies
bun run tauri:dev           # Native app + Vite on port 3002
bun run vite:dev            # Frontend only, browser preview
bun run tauri:build         # Production bundle
bun run tsc:check           # TypeScript 7 native compiler
bun run lint                # Biome
bun run lint:fix            # Biome auto-fix
bunx shadcn@latest add …    # Add an islandcn registry item
cd src-tauri && cargo check # Rust
cd src-tauri && cargo clippy
```

Pre-commit (Husky) runs `lint-staged` (Biome) and `tsc:check`.

## Architecture

- `src/components/` contains reusable UI: design-system wrappers and chat pieces.
- `src/components/dynamic-island/` is the app-owned island integration. `DynamicIsland` wraps the whole app with the island provider (the visible pill is temporarily hidden) and is mounted once in `src/main.tsx`.
- `src/components/islandcn/` and `src/lib/island/` are vendored islandcn files. Do not edit them; add kit pieces through the shadcn registry.
- `src/ui/` composes screens. `src/routes/` stays thin.
- `overlay.html` + `src/overlay.tsx` are the quick-chat window. Its UI lives in `src/ui/Overlay`; there is no router, sidebar, or Dynamic Island in that window.
- `canvas.html` + `src/canvas.tsx` are the full-screen, transparent, click-through canvas. It is deliberately empty and must not receive interaction; it is the future surface for annotations and agent output.
- `src/hooks/useOverlayWindow.ts` owns the overlay's native behaviour: size to the panel, reveal after the webview has painted, focus, and hide on Escape or an explicit action. Do not add blur-to-dismiss.
- Rust window management for the overlay and canvas is `src-tauri/src/sys/overlay.rs`; its commands are `src-tauri/src/tauri_commands/overlay.rs`. Both are converted to non-activating NSPanels with `tauri-nspanel`, so summoning Iris never activates the app, focuses the history window, or switches Spaces. Use panel show/hide, not `window.set_focus()`.
- `src/stores/` is Zustand only. Use selectors (`useChatStore((state) => state.x)`), never whole-store subscriptions.
- `src/tauri/commands/` contains typed `invoke` wrappers, one file per Rust command module. Tauri snake_case args are passed in camelCase from TypeScript.
- `src/services/` owns transport concerns. The UI never talks to the agent transport directly; the browser preview mock is there too.
- DeepSeek settings live in `src/stores/settingsStore.ts`: API key, base URL, model, auto-speak, and TTS voice. The API key is temporary localStorage storage, matching the demo; do not commit a real key. The future settings revamp should move it to the Keychain.
- Rust: `core/` for domain logic, `sys/` for platform helpers, `tauri_commands/` for command entry points, `utils/` for shared helpers.
- Keep the agent event contract (`chat:token`, `chat:done`, `chat:error`) stable. The DeepSeek protocol lives in `src-tauri/src/core/agent.rs`; automatic TTS lives in `src-tauri/src/sys/speech.rs`.
- The quick overlay uses the fixed `iris:quick` conversation (`ensureQuickConversation` / `resetQuickConversation`). Do not switch the history window's active conversation from the overlay.

## Code style

### TypeScript / React

- Biome: 2 spaces, 80 columns, single quotes, double quotes in JSX, no semicolons, trailing commas.
- Imports: node → packages → `@/` alias → relative. Biome organizes imports on save.
- Use `@/` for `src/`.
- Components are folder-per-component with an `index.tsx` (or a named file inside the folder). Export the component as default and set `displayName`.
- Use function declarations; React 19 ref-as-prop is fine.
- Prefer HeroUI v3 primitives and the wrappers in `src/components/` over raw HTML controls. The composer textarea is intentionally a HeroUI `TextArea`.
- Use `cn()` from `@/utils/tailwind` for class merging.
- Styling: Tailwind v4 utilities and HeroUI semantic tokens (`bg-background`, `bg-surface`, `text-muted`, `border-border`, `bg-accent-soft`). Avoid hard-coded palette colors.
- No translations in this project. User-facing copy is English.
- No `console.log`; use `log_error` from Rust or surface errors in the UI.

### Zustand

```typescript
export const useThingStore = create<ThingState>()(
  persist(
    (set, get) => ({
      value: 0,
      setValue: (value) => set({ value }),
    }),
    { name: 'iris.thing' },
  ),
)
```

- Read with selectors. Write with actions.
- Persist only durable data. Streaming flags and transient UI state stay out of storage.
- Sanitize persisted data in `merge` if its shape can go stale (see `chatStore`).

### Rust

- snake_case files and functions, PascalCase types, SCREAMING_SNAKE_CASE constants.
- Commands return `Result<T, String>` and use `#[tauri::command]`.
- Serialize payloads with `#[serde(rename_all = "camelCase")]` to match TypeScript.
- Keep blocking work off the main thread; use `tauri::async_runtime::spawn`.

## Notifications and the Dynamic Island

- The dynamic island is the app's notification surface. Use `useDynamicIslandNotice()` from `@/components/dynamic-island/notifications`; never add Sonner, Radix Toast, or a custom toast stack.
- The main window currently hides the island pill to keep the top bar clear. Its provider stays mounted so notices and activities are ready when the pill returns; do not add a second notification system in the meantime.
- Agent activity is already wired in `src/components/dynamic-island/agent-activity.tsx`: it follows `streamingRequestId` from the chat store, shows elapsed time and Stop when expanded, and alerts once on failure.
- Build new activities beside the feature that owns them, on the island engine (`useIslandActions` / `useActivity`). Do not install a preset unless it is an exact match.
- Keep the pill pure black. Use the island's content kit (`src/components/islandcn`) for glyphs, text, rings, buttons, and layout so it matches the reference hardware.
- `components.json` is required for the shadcn registry aliases (`@/lib`, `@/components`, `@/utils/tailwind`).
- To add a kit piece: `bunx shadcn@latest add https://islandcn.dev/r/<item>.json`. Files land in `src/components/islandcn`; do not hand-write replacements.
- Biome ignores `src/lib/island/**` and `src/components/islandcn/**` on purpose. Keep vendored code byte-for-byte close to the registry.

## UI conventions

- Dark is the default theme. Respect light and system modes through the existing `useThemeSync` hook.
- The palette uses one primary color (`--primary`) for the AI blob, success feedback, and HeroUI's accent. Surfaces stay neutral glass; do not reintroduce colored auroras, colored glass tints, or broad gradients.
- The main window uses an overlay title bar. The sidebar and chat headers sit at the very top and carry `data-tauri-drag-region`; the sidebar header keeps its left side empty for the macOS traffic lights.
- The dynamic island is hidden for now. Keep the top centre free of app chrome until it returns.
- Pressing `/` focuses the composer when focus is not already in a text field. The quick overlay and the history window both support this.
- **The quick overlay is the primary interface.** Keep it to one bottom input, Iris's status, and a single response block. No sidebar, no message bubbles, no user-message echo, no chat transcript.
- Processing is voice-first: show the blob/ring/wave effect and only **Cancel**; never render the reply while streaming or by default after completion. The small **Show response** control reveals it on demand.
- Voice input lives in the quick overlay. The mic records 16 kHz mono WAV and Rust posts it to `/v1/tools/asr`. `autoSendVoice` defaults on; when off, the transcript goes into the input. Overlay hide must cancel recording. `speech:start` / `speech:end` carry the conversation id and drive the speaking strip; use the blob's `listening` and `speaking` activities.
- Do not auto-dismiss on focus loss. The overlay stays until Escape, the close button, the shortcut, History, or Quit.
- The full-screen canvas is click-through and non-focusable. Do not put buttons or interactive UI on it; the input panel is a separate window above it.
- Animate state changes with `motion` springs; do not swap layouts abruptly. The native window height follows the animated panel height through the ResizeObserver.
- The overlay is always dark, single-card glass; it sits above other windows and on every workspace. It must **not** dismiss on focus loss: hide only on Escape, the close button, the shortcut, or an explicit action.
- The history window is secondary. It exists for old conversations and the Dynamic Island; do not redesign it until asked.
- The chat UI is provisional: **do not add new screens or redesign the chat** until the user provides the new UI direction.
- The assistant's identity is the AI blob (`src/components/IrisBlob`, powered by `src/components/AiBotAvatar`), not a generic avatar. Use its emotion/activity API (`listening`, `speaking`, `thinking`, `happy`, `sad`) rather than adding a static avatar.
- Keep animations subtle and honor `prefers-reduced-motion`; the AI blob engine already does.
- Glass is part of the design language. Reuse `.liquid-glass` for dark floating surfaces, and `.glass-rail`, `.glass-control`, and `.glass-dialog` for theme-aware surfaces. Do not replace them with flat solid fills.
- Inputs are intentionally quiet: no focus ring, outline, glow, or accent border on focus. Keep the caret as the only focus cue. Do not reintroduce HeroUI focus rings on text fields.

## Project conventions

- Bun is the package manager. Commit `bun.lock`.
- Dev server port is **3002** (3001 belongs to CompressO).
- No test framework configured yet. Do not invent test scripts.
- `src/routeTree.gen.ts` is generated by TanStack Router; do not hand-edit it.
- Tauri icons live in `src-tauri/icons/`.
- `components.json` points shadcn at our aliases and `src/global.css`.
- Window labels are `overlay` (quick chat), `canvas` (full-screen transparent surface), and `main` (history). Keep them in sync across `tauri.conf.json`, capabilities, and Rust. The canvas and overlay must stay `alwaysOnTop`, `visibleOnAllWorkspaces`, and at AppKit levels 25/27.
- The summon shortcut is configurable in Settings → Shortcuts (`openShortcut` in `settingsStore`). Rust registers `commandorcontrol+space` at startup, then `set_open_shortcut` replaces it with the recorded choice; the shortcut toggles the overlay and Escape closes it. There is no frontend shortcut plugin.
- A menu bar tray icon (`src-tauri/icons/tray.png`, generated from `assets/tray-icon.svg`) owns **Ask Iris**, **History**, and **Quit Iris**. `RunEvent::ExitRequested` is prevented only while both windows are hidden; the menu bar's Quit always quits.
- The overlay is CSS glass only. Do not apply a window-level native material to the overlay: it adds a second square window edge around the rounded card. Keep the transparent shadow gutter and the single `.liquid-glass` panel.
- Chat history is still in `localStorage`. Do not add SQLite or `tauri-plugin-sql` until the backend storage work starts; the planned schema is in `README.md`.
- Automatic read-aloud is backend-owned: chat completion triggers `/v1/tools/tts`, then `afplay`. Stop it on new messages, Cancel, New chat, and app exit. `speech:start` / `speech:end` carry the conversation id so the overlay can show a speaking strip. The overlay still hides reply text until Show response.
- Screen Recording and Microphone permissions are declared in `src-tauri/Info.plist`. Screen Recording is exposed by `src-tauri/src/sys/screen.rs` + `src/tauri/commands/screen.ts`; use it before the region-capture UI. Microphone access is used only for overlay voice input.

## Checklist before finishing

1. `bun run lint`
2. `bun run tsc:check`
3. `cd src-tauri && cargo check`
4. For island changes, verify idle, compact, expanded, and the light/dark keyline.
5. For overlay changes, verify idle, thinking, streaming, completed, and error states in `http://localhost:3002/overlay.html`, then check the native window with `bun run tauri:dev`.
6. For history UI changes, verify both dark and light themes.

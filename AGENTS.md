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
- DeepSeek settings live in `src/stores/settingsStore.ts`: base URL, model, system prompt, auto-speak, DeepThink, web search, and TTS voice. **Iris is DeepSeek-only.** There is no provider picker, API-format switch, capability probe, or separate speech/transcription URL: `core/endpoints.rs` derives `/anthropic/v1/messages`, `/v1/models`, `/v1/tools/tts`, and `/v1/tools/asr` from the base URL, which defaults to `https://api.deepseek.com` and only changes for a DeepSeek-compatible proxy. The Messages route is under `/anthropic`; the root `/v1/messages` returns 404. The composer toggles (`ChatToggles`) map to the request only: DeepThink sets `thinking` to `adaptive`, and Search declares DeepSeek's `deepseek_web_search` server tool. Any link in the newest user message also adds `deepseek_read_url`; with DeepThink and Search both on, only URL reading is declared because deep thinking search skips the user's links. DeepSeek's server tools cannot be mixed with other server tools. Settings → AI → Prompt has separate `islandSystemPrompt` and `mainSystemPrompt` fields; `mainUsesIslandPrompt` defaults on and makes the main chat reuse the island prompt. `runAssistantReply` sends the island prompt from the overlay window and the main prompt (or the shared island prompt) elsewhere, as `systemPrompt`; `core/agent.rs` falls back to `SYSTEM_PROMPT` when it is empty. The compressed summary is appended to whichever prompt is used. **The API key is never in the store**: it lives in the SQLite `credential` table (plain text) behind `src-tauri/src/tauri_commands/credentials.rs`, and the webview only ever learns `{ hint }` from `save_api_key`. Never add a command that reads the key back to the UI. The last-four hint is cached in `settingsStore.apiKeyHint` (localStorage) so the saved state is instant; once saved the field is gone and only Replace and Remove are offered. `send_message`, `list_models`, `speak_text`, and `transcribe_audio` read the key in Rust through `Storage::require_api_key`.
- Rust: `core/` for domain logic, `sys/` for platform helpers, `tauri_commands/` for command entry points, `utils/` for shared helpers.
- Keep the agent event contract (`chat:token`, `chat:done`, `chat:error`) stable. The DeepSeek protocol lives in `src-tauri/src/core/agent.rs`; automatic TTS lives in `src-tauri/src/sys/speech.rs`.
- `core/agent.rs` compresses long conversations before sending: once a conversation passes `CONTEXT_BUDGET_CHARS`, older turns are folded into a summary (cached per conversation in `SummaryCache`) while the newest `RECENT_BUDGET_CHARS` stay verbatim. The summary is injected into the system prompt, so the visible history and SQLite rows are never rewritten.
- The quick overlay uses the fixed `iris:quick` conversation (`ensureQuickConversation` / `resetQuickConversation`). Do not switch the history window's active conversation from the overlay.
- Images enter through paste or drag-and-drop only; there is intentionally no attach button. The overlay and main windows set `dragDropEnabled: false` so Tauri's native file-drop handler does not swallow HTML5 drops, and dropped images with no MIME type are recognized by extension. `useImageAttachments` resizes to 1280px JPEG data URLs (max 4), `AttachmentStrip` shows the draft thumbnails, and the user message carries `attachments`. Double-clicking a thumbnail or a sent-message image opens the full-screen `preview` panel above the overlay; Escape, the close button, or a backdrop click hides it and restores the window that opened it. The Rust agent turns them into base64 image blocks for the Messages API; summaries ignore images. SQLite stores them in the `messages.attachments` JSON column.

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
- Persist only durable data. Streaming flags and transient UI state stay out of storage. SQLite is the only conversation store; localStorage holds settings and the two selected conversation ids (`iris.chat.ui`). Never put conversations back into localStorage.
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
- Pressing `/` focuses the composer when focus is not already in a text field. The quick overlay and the history window both support this. The overlay's local shortcuts are configurable in Settings → Shortcuts: **Capture screen** (`⌘⇧S`), **New chat** (`⌘N`), **Previous conversation** (`⌘⇧N`), **Show / hide response** (`⌘B`), **DeepThink** (`⌘D`), **Web search** (`⌘S`), **Voice input** (`⌘I`), and **Stop read-aloud** (`⌘X`). `Cmd+,` still opens Settings. `sys/menu.rs` removes macOS's Close Window (`⌘W`) menu accelerator so it cannot dismiss the overlay; the history window handles `⌘W` itself with `hide_main_window` and hides exactly like its red close button. The overlay intercepts the Copy event if Capture is rebound to `⌘C`. `useStopSpeakingShortcut` catches the Cut event while read-aloud is active, and the stop binding only claims `⌘X` while speech is preparing or playing so Cut keeps working otherwise.
- **The quick overlay is the primary interface.** Keep it to one bottom input, Iris's status, and a single response block. No sidebar, no message bubbles, no user-message echo, no chat transcript. The response block ends with Copy, Read aloud, and (for the newest reply) Regenerate actions; never put Copy in the header.
- The Iris blob is the only status indicator. Primary green plus the `IRIS` label means ready (no `Ready` text, no status dot). Amber means a request is in flight; blue means read-aloud is preparing or playing (the wave is blue while speaking); red means an error. No spinner, play badge, or progress labels: only color and error text.
- Processing is voice-first: show the blob/ring/wave effect and only **Cancel**; never render the reply while streaming or by default after completion. The small **Show response** control reveals it on demand.
- Voice input lives in the quick overlay. The mic records 16 kHz mono WAV and Rust posts it to `/v1/tools/asr`. `autoSendVoice` defaults on; when off, the transcript goes into the input. While the voice strip is open, Enter stops and sends (even when auto-send is off) and Escape cancels the recording without hiding Iris. Overlay hide must cancel recording. `speech:start` / `speech:end` carry the conversation id and drive the speaking strip; use the blob's `listening` and `speaking` activities.
- Do not auto-dismiss on focus loss. The overlay stays until Escape, the close button, the shortcut, History, or Quit.
- The full-screen canvas is click-through and non-focusable. Do not put buttons or interactive UI on it; the input panel is a separate window above it. It draws the transient overlay snap guides and is the future surface for annotations and agent output.
- Animate state changes with `motion` springs; do not swap layouts abruptly. The native window height follows the animated panel height through the ResizeObserver.
- The overlay is dark by default but follows the macOS appearance (not the in-app theme setting):
  light glass with dark ink when the system is in light mode. It sits above other windows and on
  every workspace. It must **not** dismiss on focus loss: hide only on Escape, the close button,
  the shortcut, or an explicit action.
- The history window is secondary. It exists for old conversations and the Dynamic Island; do not redesign it until asked.
- The chat UI is provisional: **do not add new screens or redesign the chat** until the user provides the new UI direction.
- The assistant's identity is the AI blob (`src/components/IrisBlob`, powered by `src/components/AiBotAvatar`), not a generic avatar. Use its emotion/activity API (`listening`, `speaking`, `thinking`, `happy`, `sad`) rather than adding a static avatar.
- Keep animations subtle and honor `prefers-reduced-motion`; the AI blob engine already does.
- Glass is part of the design language. Reuse `.liquid-glass` for dark floating surfaces, and `.glass-rail`, `.glass-control`, and `.glass-dialog` for theme-aware surfaces. Do not replace them with flat solid fills.
- Cursors follow native macOS: only `a[href]` (and `[data-link]`) show the pointer. Buttons, tabs, toggles, and other controls keep the arrow via `--cursor-interactive: default`, `--cursor-disabled: default`, and the `[class*="cursor-pointer"]` override in `global.css`. Do not add `cursor-pointer` to app controls.
- The sidebar follows one rhythm: an 8px rail inset (`px-2`) for the New chat button and conversation list, 12px content inset (`pl-3`), 36px row height, 14px icons, and 13px labels. Conversation rows reserve 36px on the right (`pr-9`) for the hover actions. Keep new sidebar items on these values instead of inventing spacing.
- Inputs are intentionally quiet: no focus ring, outline, glow, or accent border on focus. Keep the caret as the only focus cue. Do not reintroduce HeroUI focus rings on text fields.

## Project conventions

- Bun is the package manager. Commit `bun.lock`.
- Release builds use `lto = "thin"` and `strip = "debuginfo"` in `src-tauri/Cargo.toml`. Do not restore `lto = true` with `strip = true`: that combination makes Rust unable to load proc-macro dylibs (`include_dir_macros`, `tauri_macros`) and fails with "can't find crate for ...".
- Dev server port is **3002** (3001 belongs to CompressO).
- No test framework configured yet. Do not invent test scripts.
- `src/routeTree.gen.ts` is generated by TanStack Router; do not hand-edit it.
- Tauri icons live in `src-tauri/icons/`.
- `components.json` points shadcn at our aliases and `src/global.css`.
- Window labels are `overlay` (quick chat), `canvas` (full-screen transparent surface), `capture` (screen selection and annotation), `preview` (full-screen image lightbox), and `main` (history). Keep them in sync across `tauri.conf.json`, capabilities, and Rust. The canvas, capture, overlay, and preview windows must stay `alwaysOnTop`, `visibleOnAllWorkspaces`, and at AppKit levels 25/26/27/28.
- The summon shortcut is configurable in Settings → Shortcuts (`openShortcut` in `settingsStore`). Rust registers `commandorcontrol+space` at startup, then `set_open_shortcut` replaces it with the recorded choice. If the overlay is hidden it opens and focuses; if it is visible but not focused it focuses; only a focused overlay closes on the next press. Every show/focus restores the webview first responder and emits `overlay:focused`; `useOverlayWindow` then focuses the quick-chat input and puts the caret at the end. Escape closes it. There is no frontend shortcut plugin.
- A menu bar tray icon (`src-tauri/icons/tray.png`, generated from `assets/tray-icon.svg`) owns **Ask Iris**, **History**, and **Quit Iris**. `RunEvent::ExitRequested` is prevented only while both windows are hidden; the menu bar's Quit always quits.
- The overlay is CSS glass only. Do not apply a window-level native material to the overlay: it adds a second square window edge around the rounded card. Keep the transparent shadow gutter and the single `.liquid-glass` panel.
- The overlay is draggable by its header and input-row background (`data-tauri-drag-region="deep"`). While dragging, `sys/overlay.rs` emits `overlay:guides`; the full-screen canvas draws two dashed lines at the centered panel's edges, and they turn primary green when the window center is within 24 px of the display center, where the window snaps horizontally. `sys/overlay.rs` keeps the bottom edge fixed while the panel resizes, saves the frame to `overlay-position.json` in the app data directory, restores it on the next show, and Reset Iris clears it. Programmatic placement suppresses the resulting Moved events so startup cannot overwrite the saved frame.
- The bundle identifier is `com.iris.desktop` (reverse-DNS, never ending in `.app`). `tauri:dev` and `tauri:build:debug` merge `src-tauri/tauri.dev.conf.json`, which switches to `com.iris.desktopdev` so development data never touches the installed app. `core/legacy.rs` copies the old `com.iris.app` Application Support and WebKit folders on launch, before the runtime starts.
- Settings → Storage keeps two destructive actions separate: **Clear** removes conversations only, and **Reset Iris** (`reset_app_data`) wipes conversations, summary cache, speech audio, old identifier folders, settings, and the stored API key, then reloads both webviews. Clear goes through `clearStoredConversations`, which pauses the SQLite mirror and waits for pending writes so a hydrate cannot restore what was just deleted. Reset does **not** call `app.restart()`: that raced the single-instance plugin and could leave Iris with no window; `Storage::reset_schema` drops and immediately rebuilds the schema, and `reload_app_windows` reloads the main and overlay webviews. `Storage::clear` vacuums the database and truncates the WAL.
- Chat history lives only in SQLite via `src-tauri/src/core/storage.rs` (`iris.db` in the app data directory). `useChatStorage` loads conversation summaries and mirrors changes incrementally (metadata upserts, per-message upserts, explicit deletes) after a short debounce; it never replaces a conversation with only the loaded page. `useConversationHistory` loads the newest 100 messages and fetches older pages on scroll-up; `react-virtuoso` renders only the visible window (with `historyStart` keeping prepended pages anchored) and the list fades at the bottom. The agent's `full_history` merges that request tail with the rest of the stored conversation, so pagination never truncates context. Focus reloads keep the overlay and history window in sync. The old `iris.chat` localStorage cache is imported once on launch and then removed; `iris.chat.ui` keeps only the selected ids. New quick chats use `move_conversation_messages` so all archived pages move with them. **Clear** emits `chat:cleared` so every window drops its in-memory copy.
- New conversations get a local fallback title immediately and then a short DeepSeek-generated title through `generate_conversation_title`. The title call runs in the background and can never block sending; it is applied only if the conversation still has its first user message and still carries the fallback title, so a manual rename or a New chat reset is never overwritten. The overlay header shows the same title as the sidebar (after `IRIS`, with a thin separator). **Previous conversation** (`⌘⇧N`) restores the quick chat that New chat moved aside; if the current quick chat has messages, it is moved aside too, making the shortcut a back/forward toggle.
- The schema is owned by `src-tauri/src/core/migrations.rs` through `rusqlite_migration`, versioned in SQLite's `user_version`. **Migrations are append-only**: never edit or reorder a step that has shipped, add a new `<NNN>-<name>/up.sql` folder to `src-tauri/migrations`. Do not put `PRAGMA` statements in a migration (`journal_mode` is ignored inside a transaction, and `foreign_keys` is per-connection); `Storage::open` applies those outside. A pre-versioning database is adopted as version 1 in place (missing columns and tables are added, rows are preserved) — never dropped. `rusqlite_migration` must stay on the 1.x line while `rusqlite` is 0.32 — 2.x requires rusqlite 0.34 and a second rusqlite would make its `Connection` type incompatible with ours.
- Deleting a conversation sets `archivedAt` instead of removing it. Archived chats are read-only: they are listed under the collapsible **Archives** section at the bottom of the sidebar (only while non-empty), can be restored to the active list, or deleted permanently. Archiving an empty conversation deletes it instead of keeping a blank archive entry. `sendMessage` and rename ignore archived conversations, and the composer is replaced by `ArchivedComposer`. Archiving the quick chat starts a fresh `iris:quick` and keeps the old content in the archive.
- Automatic read-aloud is backend-owned: chat completion triggers `/v1/tools/tts`, then `afplay`. Stop it on new messages, Cancel, New chat, and app exit. `speech:preparing`, `speech:start`, and `speech:end` carry the conversation id: the blob turns blue while the audio downloads, switches to the speaking animation with a blue wave during playback, and returns to green if TTS fails or finishes. The overlay still hides reply text until Show response. Only one reply is ever spoken: `sys/speech.rs` gives each request an epoch from `SpeechState::begin()`, so when two conversations both finish, the newest claim wins and the older download drops when it checks `is_current`. Keep that ordering — `stop()` bumps the epoch, so playback must call `interrupt()` (which does not) or it would cancel its own reservation. Completed replies also offer a manual **Read aloud** button (`speak_text`) in the overlay and on every assistant message in History; it speaks through the same endpoint and `speech:*` events. While that conversation is preparing or speaking, the button becomes **Stop** instead of restarting the same audio. Copy works on any completed reply and on user messages, read aloud works on completed replies, and Regenerate is limited to the newest reply. Editing the last user turn keeps the bubble at the rendered width and height and offers Copy alongside Save and Cancel.
- Read-aloud state lives in `src/stores/speechStore.ts` and is **not** scoped to a conversation. `useSpeechPlayback` subscribes to the speech events unfiltered (mount it once per window) because exactly one reply is spoken at a time. Filtering by conversation id used to leave `speaking` stuck when you switched chats, since the matching `speech:end` was ignored. `SpeechControl` renders beside the mic in both composers and nowhere else: the indicator and Stop stay in one predictable place instead of following the message. Its tooltip and the active `ReadAloudButton` show the configured stop shortcut (`⌘X` by default), and `useStopSpeakingShortcut` stops playback from either window.
- Screen Recording and Microphone permissions are declared in `src-tauri/Info.plist`; the overlay checks Screen Recording before capturing (`sys/screen.rs` + `src/tauri/commands/screen.ts`). If access is missing, the overlay shows a persistent notice with an **Open Settings** button that opens the Screen Recording pane directly; macOS only shows the TCC prompt once, and may require restarting Iris after granting. The quick overlay alone owns **screen capture**: `start_screen_capture` opens the full-screen `capture` panel at level 26 without taking a screenshot, so the screen keeps playing behind a live, transparent selection overlay, and re-shows the overlay passively above it at level 27 so Iris stays present and usable. There the user draws a region selection with eight resize handles, drags the toolbar's move icon directly to reposition the crop, and annotates it with Konva (pen, rectangle, arrow, four inks). `Cmd+Z` undoes the last stroke; the toolbar stays compact (28px tools, 16px inks). Attach (or Enter) hides the selection chrome, calls `capture_annotated_screen` (which hides Iris, captures the display including the annotation layer, then restores Iris passively), crops the selection at native resolution in the webview, and emits `capture:attached` as a JPEG that `useImageAttachments` adds to the overlay draft. While a capture is open, the overlay's capture button turns green; pressing it again closes the capture, discards the selection, and emits `capture:closed`. `close_screen_capture` restores the overlay. All AppKit window calls must run on the main thread; only the final `screencapture` runs on a blocking task. The capture UI lives in `src/capture.tsx` and is not part of the history window.

## Checklist before finishing

1. `bun run lint`
2. `bun run tsc:check`
3. `cd src-tauri && cargo check`
4. For island changes, verify idle, compact, expanded, and the light/dark keyline.
5. For overlay changes, verify idle, thinking, streaming, completed, and error states in `http://localhost:3002/overlay.html`, then check the native window with `bun run tauri:dev`.
6. For history UI changes, verify both dark and light themes.

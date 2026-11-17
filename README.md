# Iris

A personal, always-available desktop AI assistant for macOS — the Jarvis I actually want to use.

Iris is a native desktop app, not a browser tab. It opens instantly, stays out of the way, streams responses in place, and keeps its conversation history on your Mac.

> **Status:** foundation. The floating quick-chat overlay, history window, Dynamic Island, and settings are in place. The desktop backend streams DeepSeek replies and reads them aloud automatically with DeepSeek TTS.

## Stack

| Layer           | Choice                                       |
| --------------- | -------------------------------------------- |
| Desktop shell   | Tauri 2                                      |
| UI              | React 19 + Vite 8                            |
| Design system   | HeroUI v3 + Tailwind CSS v4                  |
| Model           | DeepSeek Messages API (deepseek-flash)       |
| Live status     | islandcn via the shadcn registry             |
| Motion          | `motion` springs for the overlay layout      |
| State           | Zustand                                      |
| Routing         | TanStack Router (file-based)                 |
| Language        | TypeScript 7 (the native Go compiler, `tsc`) |
| Package manager | Bun                                          |
| Lint / format   | Biome                                        |
| Git hooks       | Husky + lint-staged                          |
| Backend         | Rust 1.95                                    |

## Requirements

- macOS 14 or newer
- [Bun](https://bun.sh) 1.2+
- Rust 1.95 (`rustup` reads `rust-toolchain.toml`)
- Xcode Command Line Tools

## Getting started

```bash
bun install
bun run tauri:dev
```

The first Rust build takes a few minutes; later builds are incremental.

Open Settings (`⌘,`) and add your DeepSeek API key and, if needed, the API origin and model. The default origin is `https://api.deepseek.com` and the default model is `deepseek-flash`.

To work on the UI without the native shell:

```bash
bun run vite:dev
```

That runs a browser preview on [http://localhost:3002](http://localhost:3002) with the same streaming contract and a local mock reply. The quick overlay is at [http://localhost:3002/overlay.html](http://localhost:3002/overlay.html). Port 3002 is intentional so Iris and CompressO can run side by side.

## The quick overlay

Iris launches as a floating quick-chat window, not a normal app window.

- **⌘Space** summons or dismisses it from anywhere by default. Record any shortcut you want in
  Settings → Shortcuts. The overlay is a non-activating panel: it appears on the current Space
  without focusing Iris, the history window, or the app you are using.
- Click the microphone in the overlay to record. Stop to transcribe; **Send after listening**
  (Settings → Voice, on by default) sends the transcript immediately, or places it in the input
  when off. The blob switches to listening/speaking states.
- It sits above normal and full-screen apps and on every macOS Space, bottom-centred, with no
  sidebar and no message bubbles.
- A transparent, click-through canvas covers every display behind it. It is the future surface
  for screen annotations and agent output; the rest of the canvas stays invisible for now.
- It stays open when another app takes focus. **Esc** or the close button hides it; the shortcut
  toggles it.
- The clock button opens the history window, where the older conversation UI still lives.
- The AI blob in the menu bar offers **Ask Iris**, **History**, and **Quit Iris**. Iris keeps
  running when the overlay hides; quit from there.
- Quick chats are stored as one rolling **Quick chat** conversation, so they remain available in
  history. **+** starts a fresh one, and `⌘⇧N` restores the previous one. The header shows the same
  conversation title as the sidebar; new chats get a short DeepSeek-generated title with the first
  message as an instant fallback.
- The panel morphs between idle, processing, ready, and revealed states with springs, matching
  the Dynamic Island's motion language.
- The overlay is only revealed after the webview has painted, so there is no empty native
  surface or flash on launch.
- Processing is voice-first: Iris shows a blob/ring/wave effect and only a Cancel button. The
  response text is not shown. Once it finishes, a small **Show response** button reveals it.
- The history window stays hidden at launch; closing it does not quit Iris.

The overlay is its own webview (`overlay.html` → `src/ui/Overlay`). It shares the Zustand chat
store with the history window and rehydrates when history comes forward. It does not dismiss on
focus loss: it is a panel, not a transient popover.

## Scripts

| Script                      | What it does                                     |
| --------------------------- | ------------------------------------------------ |
| `bun run tauri:dev`         | Native app with hot reload                       |
| `bun run tauri:build`       | Production `.app` + `.dmg`                       |
| `bun run tauri:build:debug` | Debug bundle                                     |
| `bun run vite:dev`          | Frontend only, port 3002                         |
| `bun run vite:build`        | Build the frontend                               |
| `bun run tsc:check`         | Type-check with the TypeScript 7 native compiler |
| `bun run lint`              | Biome check                                      |
| `bun run lint:fix`          | Biome check and auto-fix                         |
| `bun run format`            | Format only                                      |

## Structure

```text
src/
├── components/     # App UI and the dynamic island wrapper
│   ├── dynamic-island/ # DynamicIsland, agent activity, notices
│   └── islandcn/       # Vendored islandcn content kit
├── constants/      # App constants and suggested prompts
├── hooks/          # Theme, shortcuts, overlay window, history sync
├── lib/            # Vendored engines (island/)
├── providers/      # App-level layout provider
├── routes/         # TanStack Router file routes (history window)
├── services/       # Agent transport (native + browser preview)
├── stores/         # Zustand stores (chat, settings, UI)
├── tauri/          # Typed wrappers for Rust commands and window UI
│   ├── commands/
│   └── components/
├── types/          # Shared TypeScript types
├── ui/             # Screen-level composition (ChatWorkspace, Overlay)
└── utils/          # Theme, formatting, ids, Tailwind merge

overlay.html        # Quick-chat webview entry
canvas.html         # Full-screen transparent canvas entry
src/overlay.tsx     # Quick-chat React root
src/canvas.tsx      # Transparent canvas root (future annotations)

src-tauri/src/
├── core/           # Agent runtime
├── sys/            # Platform helpers (overlay placement, screen permission)
├── tauri_commands/ # Commands exposed to the frontend
├── utils/          # Event names and shared helpers
├── Info.plist      # NSScreenCaptureUsageDescription
└── main.rs         # Tauri entry point, global shortcut, menu bar item
```

## Dynamic Island and notifications

The app mounts one `DynamicIsland` in `src/main.tsx`. It currently mounts the island provider
only; the visible pill is temporarily hidden while the top bar is reworked. The provider keeps the
activity and notice code ready for the next pass:

- **Agent responses** appear while a reply streams, with elapsed time, an expandable detail view,
  and a Stop control. Failures alert once and fold away.
- **App notices** use `useDynamicIslandNotice()` from `@/components/dynamic-island/notifications`. This is the
  app's toast. Do not add Sonner, Radix Toast, or another notification stack.

The island is **not** built from shadcn/ui components. It uses the shadcn CLI as a file registry
for the self-contained islandcn engine, which draws with inline styles. HeroUI stays the app's
design system; the island is a separate system layer with its own black hardware look.

```bash
# Add or update a kit piece from the registry
bunx shadcn@latest add https://islandcn.dev/r/<item>.json
```

`src/lib/island` and `src/components/islandcn` are vendored and excluded from Biome. Put app
activities and wrappers in `src/components/dynamic-island` instead of editing the engine.

## How a response flows

1. `src/stores/chatStore.ts` adds the user message and an empty assistant message.
2. `src/services/agent.ts` starts a run and subscribes to `chat:token` / `chat:done` / `chat:error`.
3. The Rust command `send_message` calls DeepSeek's Anthropic-compatible Messages API
   (`/anthropic/v1/messages`) and streams the response.
4. Tokens are emitted back to the webview and appended to the active message, which stays hidden
   in the overlay. `cancel_generation` stops the stream.
5. On completion, the backend automatically sends the reply to DeepSeek TTS
   (`/v1/tools/tts`), wraps the 24 kHz PCM in a WAV, and plays it with `afplay`. The overlay shows
   **Response ready** with a **Show response** control instead of the text.

The event contract is deliberately small, so the transport in `src-tauri/src/core/agent.rs` can
change without touching the UI.

## DeepSeek backend

`src-tauri/src/core/agent.rs` is the DeepSeek integration point. Iris supports only DeepSeek: the
base URL defaults to `https://api.deepseek.com` and can point at a DeepSeek-compatible proxy, but
there is no provider picker or wire-format switch. `core/endpoints.rs` derives
`/anthropic/v1/messages`, `/v1/models`, `/v1/tools/tts`, and `/v1/tools/asr` from that single
origin. The Messages route is under `/anthropic`; the root `/v1/messages` returns 404.

`src-tauri/src/sys/speech.rs` owns automatic read-aloud. It calls `/v1/tools/tts` with the selected
voice, wraps the raw PCM in a WAV, and plays it with macOS `afplay`. A new message, Cancel, New
chat, or quitting stops the current speech. The manual **Read aloud** button uses the same pipeline
through `speak_text`, so any completed reply can be spoken without regenerating it. While that
conversation is preparing or playing audio, the button turns into **Stop** instead of restarting.

The API key is stored in the Iris SQLite database (`credential`), saved from Settings → AI. The
webview never receives it: `send_message`, `speak_text`, and `transcribe_audio` read it inside Rust,
and once saved Settings shows a "Key saved" badge with Replace and Remove instead of the key itself.

Supporting another provider later is a product decision, not a settings toggle: it needs a full
feature-parity plan, not just a custom URL.

## Local data

- Conversations are stored in SQLite at `Application Support/com.iris.desktop/iris.db`. The quick
  overlay and the history window share the database, and `useChatStorage` mirrors changes into it
  while keeping `localStorage` as a fast cross-window cache and crash fallback. Existing local
  conversations are migrated on first launch.
- The bundle identifier is `com.iris.desktop` (reverse-DNS, no `.app` suffix). On first launch
  after the rename from `com.iris.app`, `core/legacy.rs` copies the old Application Support and
  WebKit folders into the new identifier so chats and settings survive.
- Development builds use `com.iris.desktopdev` through `src-tauri/tauri.dev.conf.json`, merged by
  `bun run tauri:dev` and `bun run tauri:build:debug`. Dev chats and settings therefore live in
  separate `Application Support` and WebKit folders and never clash with the installed app.
- The quick overlay has configurable local shortcuts in Settings → Shortcuts: Capture screen
  (`⌘⇧S`), New chat (`⌘N`), Previous conversation (`⌘⇧N`), Show / hide response (`⌘B`), DeepThink
  (`⌘D`), Web search (`⌘S`), Voice input (`⌘I`), and Stop read-aloud (`⌘X`). They never register
  with the OS. Stop read-aloud also works in the history window, and only claims `⌘X` while a reply
  is being prepared or spoken so Cut keeps working otherwise.
- Settings → Storage has two separate actions: **Clear** deletes only conversations, while
  **Reset Iris** wipes conversations, compressed summaries, speech audio, settings, the API key,
  and the pre-rename data copies, then reloads both webviews. The SQLite file is vacuumed and its
  WAL truncated so cleared messages are not recoverable from the database files.
- The quick overlay can be dragged by its header or input-row background. While dragging, two
  dashed guides mark the horizontal center of the display and turn primary green when the panel
  snaps there. Its frame is saved to `overlay-position.json` in the app data directory, restored on
  launch, and cleared by Reset Iris. The bottom edge stays fixed while the panel grows or shrinks.
- Deleting a conversation archives it (`archivedAt`). The sidebar shows a collapsible Archives
  section while anything is archived; archived chats open read-only and can be restored or
  permanently deleted. They never accept new messages or renames. Empty conversations are deleted
  outright instead of being archived.
- New quick chats move the previous quick conversation to a new id, so old messages stay in
  History instead of being discarded. `⌘⇧N` brings the previous quick conversation back.
- Settings live in `localStorage`; the DeepSeek API key lives in the SQLite `credential` table and
  is read only inside Rust.
- The composer has two request toggles: **DeepThink** sends `thinking: { type: "adaptive" }`, and
  **Search** adds DeepSeek's `deepseek_web_search` server tool. When the newest message contains a
  link, `deepseek_read_url` is added automatically so the model can read the page; with DeepThink
  and Search both on, URL reading wins so the links are actually read. Both toggles apply to the
  next message only.
- Images can be pasted or dropped into the composer or the quick overlay; there is no attach
  button, and non-image files are ignored until document support lands. They are resized to 1280px JPEGs, kept as attachments on the user message, and sent to
  the Messages API as base64 image blocks. Double-click a thumbnail or a sent image to open it in
  Iris's full-screen preview; Escape or a click outside closes it. The database stores them in
  `messages.attachments`.
- The quick overlay also supports **screen context** (overlay only): a capture button opens a live
  selection overlay without freezing the screen, lets you drag a region, resize it with eight
  handles, drag the toolbar handle to move it, and annotate it with a pen, rectangle, or arrow in
  four colours. `Cmd+Z` undoes the last stroke; **Attach** or **Enter** captures the selected region
  (with annotations) at native resolution and puts the JPEG into the overlay draft like any other
  image. Escape or Cancel returns to the overlay.
- Automatic read-aloud has a preparing phase: `speech:preparing` arrives when the reply ends and its
  audio starts downloading, so the blob and its wave turn blue while it waits. Playback then emits `speech:start`, and `speech:end` covers completion, Stop,
  or a TTS failure.
- Long conversations are summarized automatically. `core/agent.rs` keeps the newest turns
  verbatim and folds older ones into a compact summary (one extra non-streaming DeepSeek call per
  new block of history, cached per conversation), so a chat keeps working past the context window.
  The summary only affects the request; the stored messages stay untouched.
- No telemetry, no cloud sync, no network requests in the preview build.
- Only `core/agent.rs` and the DeepSeek tool calls in Rust talk to the network.

### Storage

Chat history is stored in Rust with `rusqlite`, not by reaching into SQL from the webview:

- `conversations` — id, title, created_at, updated_at, archived_at
- `messages` — id, conversation_id, role, content, created_at, status, error
- `credential` — name, api_key, updated_at (the single key used for every request)

The database lives at `Application Support/com.iris.desktop/iris.db`. Conversations are saved
individually after a short debounce; `localStorage` remains the immediate cross-window cache and
is merged by `updatedAt` on launch/focus. Attachments and FTS5 search are still planned. Store
screenshots and other large attachments as files under Application Support, with their paths in
SQLite. The API key is stored in plain text in `credential`; the webview still never reads it.

## Notes

- The quick overlay is a frameless, transparent, always-on-top window; the history window keeps
  full-height header drag regions; the Dynamic Island pill is hidden for now.
- The overlay is a single CSS **liquid-glass** card (sheen, noise, rim light) over the desktop.
  Its transparent window draws only the card, with a shadow gutter and no native window edge.
- The full-screen canvas is click-through (`set_ignore_cursor_events(true)`) and is raised on every
  Space with `CanJoinAllSpaces | FullScreenAuxiliary`; the input panel sits above it at a higher
  window level.
- The configured summon shortcut toggles the overlay. `Esc` hides it. The history window's
  shortcuts still work once it is open, and `⌘W` hides it like its red close button.
- The overlay is always dark; the history window follows light/dark/system.
- Screen Recording and Microphone permissions are declared in `src-tauri/Info.plist`.
  Screen Recording is exposed through `src-tauri/src/sys/screen.rs` +
  `src/tauri/commands/screen.ts`. If access is denied, the overlay shows a persistent notice with
  an **Open Settings** button that jumps to the Screen Recording pane; macOS only prompts once and
  may require restarting Iris after access is granted. The microphone is used only by the overlay's
  voice input.
- Text inputs are intentionally quiet: no focus ring, glow, or accent outline. The caret is the
  focus cue.
- Glass is a first-class part of the look: the overlay uses the `.liquid-glass` surface (sheen,
  noise, rim light), and the history window uses `.glass-rail`, `.glass-control`, and
  `.glass-dialog` plus a slow monochrome light pool behind the content.
- The chat interface is provisional; wait for the new UI direction before adding screens.
- Screen capture and screen context are not implemented yet; the overlay is ready for them.
- Browser preview (`bun run vite:dev`) uses a local mock reply; the desktop app uses DeepSeek.
- Responses are read aloud automatically when the **Read responses aloud** setting is on. The
  overlay keeps the text hidden until **Show response** is pressed.

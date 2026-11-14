# Iris

A personal, always-available desktop AI assistant for macOS — the Jarvis I actually want to use.

Iris is a native desktop app, not a browser tab. It opens instantly, stays out of the way, streams responses in place, and keeps its conversation history on your Mac.

> **Status:** foundation. The floating quick-chat overlay, history window, streaming pipeline, cancellation, persistence, settings, and the Dynamic Island are in place. The agent runtime currently runs a clearly-labelled local preview reply; a real model provider plugs into one file.

## Stack

| Layer           | Choice                                       |
| --------------- | -------------------------------------------- |
| Desktop shell   | Tauri 2                                      |
| UI              | React 19 + Vite 8                            |
| Design system   | HeroUI v3 + Tailwind CSS v4                  |
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

To work on the UI without the native shell:

```bash
bun run vite:dev
```

That runs a browser preview on [http://localhost:3002](http://localhost:3002) with the same streaming contract and a local mock reply. The quick overlay is at [http://localhost:3002/overlay.html](http://localhost:3002/overlay.html). Port 3002 is intentional so Iris and CompressO can run side by side.

## The quick overlay

Iris launches as a floating quick-chat window, not a normal app window.

- **⌥Space** summons or dismisses it from anywhere. **⌘⇧Space** is a fallback if another
  launcher already owns ⌥Space.
- It sits above normal and full-screen apps and on every macOS Space, bottom-centred, with no
  sidebar and no message bubbles.
- A transparent, click-through canvas covers every display behind it. It is the future surface
  for screen annotations and agent output; the rest of the canvas stays invisible for now.
- It stays open when another app takes focus. **Esc** or the close button hides it; the shortcut
  toggles it.
- The clock button opens the history window, where the older conversation UI still lives.
- The iris orb in the menu bar offers **Ask Iris**, **History**, and **Quit Iris**. Iris keeps
  running when the overlay hides; quit from there.
- Quick chats are stored as one rolling **Quick chat** conversation, so they remain available in
  history. **+** starts a fresh one.
- The panel morphs between idle, processing, ready, and revealed states with springs, matching
  the Dynamic Island's motion language.
- The overlay is only revealed after the webview has painted, so there is no empty native
  surface or flash on launch.
- Processing is voice-first: Iris shows an orb/ring/wave effect and only a Cancel button. The
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

The app mounts one `DynamicIsland` in `src/main.tsx`. It owns the island provider, the pill, and
the activities the app already has:

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
2. `src/services/agent.ts` starts a run and subscribes to `chat:token` / `chat:done`.
3. The Rust command `send_message` spawns `core::agent::stream_placeholder_reply`.
4. Tokens are emitted back to the webview and appended to the active message.
5. `cancel_generation` (or starting another run) stops the stream; a cancelled message with no text is removed.

The event contract is deliberately small, so replacing the preview with a streaming HTTP provider only touches `src-tauri/src/core/agent.rs`.

## Where to add the real model

`src-tauri/src/core/agent.rs` is the only integration point. Keep emitting `ChatTokenPayload` and end with `ChatDonePayload`; the frontend needs no changes. Provider credentials should live in the macOS Keychain rather than the webview.

## Local data

- Conversations and settings live in `localStorage` inside the webviews for now. The quick
  overlay and the history window share the same keys.
- No telemetry, no cloud sync, no network requests in the preview build.
- The future provider integration is the only thing that should talk to the network.

### Storage plan

SQLite is the right home for chat history once the Rust agent lands. Keep it in Rust (for
example `rusqlite` or `sqlx`) rather than reaching into SQL from the webview:

- `conversations` — id, title, created_at, updated_at, source (`quick` / `history`), archived
- `messages` — id, conversation_id, role, content, created_at, model, metadata JSON
- `attachments` — id, message_id, kind, path, mime_type, width, height
- `settings` — key/value for app preferences
- FTS5 index over message content for search

Store screenshots and other large attachments as files under Application Support, with their
paths in SQLite. Keep API keys in the macOS Keychain, never in the database. Add a small
migration table from day one.

## Notes

- The quick overlay is a frameless, transparent, always-on-top window; the history window keeps
  the overlay title bar and the Dynamic Island.
- The overlay is a single CSS **liquid-glass** card (sheen, noise, rim light) over the desktop.
  Its transparent window draws only the card, with a shadow gutter and no native window edge.
- The full-screen canvas is click-through (`set_ignore_cursor_events(true)`) and is raised on every
  Space with `CanJoinAllSpaces | FullScreenAuxiliary`; the input panel sits above it at a higher
  window level.
- **⌥Space** toggles the overlay (⌘⇧Space also works). `Esc` hides it. The history window's
  shortcuts still work once it is open.
- The overlay is always dark; the history window follows light/dark/system.
- Screen Recording permission is declared in `src-tauri/Info.plist` and exposed through
  `src-tauri/src/sys/screen.rs` + `src/tauri/commands/screen.ts`. The drag-to-select region capture
  will request it the same way Raycast does.
- Text inputs are intentionally quiet: no focus ring, glow, or accent outline. The caret is the
  focus cue.
- Glass is a first-class part of the look: the overlay uses the `.liquid-glass` surface (sheen,
  noise, rim light), and the history window uses `.glass-rail`, `.glass-control`, and
  `.glass-dialog` plus a slow aurora behind the content.
- The chat interface is provisional; wait for the new UI direction before adding screens.
- Screen capture and screen context are not implemented yet; the overlay is ready for them.

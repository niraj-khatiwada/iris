### ~~1. Selection actions — “Ask Iris about this” · Medium~~ — done

**What shipped**

- **Any app, one shortcut.** A configurable global shortcut (default `⌘⇧Space`) hides Iris, reads the frontmost app's selected text, and opens the action strip in the overlay.
- **Accessibility with a clipboard fallback.** Uses `AXSelectedText` when available, then a temporary `⌘C` in every app when not, including Chromium/Electron apps. The pasteboard must actually change before the text is accepted, and secure fields are rejected.
- **Editable action set.** Explain, Summarize, Improve (formerly Rewrite), Simplify, Translate, Fix grammar, Extract tasks, and Reply, plus user-created prompts with icons, rename, delete, drag-to-reorder, and restore defaults.
- **Custom instructions.** **Custom** carries the selection into the composer, where typed or dictated text is combined with it; the selection stays visible as a chip.
- **Result actions.** Copy the result, paste it at the source app's caret, or replace the original selection. Read aloud and regenerate remain in the normal response footer.
- **Drafts survive.** Selection prompts send any image, screenshot, or document already attached and keep the same quick chat so the files stay in the right folder.
- **Escape returns.** Escape cancels the selection strip and returns to the normal composer without hiding Iris.
- **Read aloud and metadata.** `autoSpeakSelection` (off by default) controls automatic speech for selection results; manual Read aloud always works. The source app, bundle id, pid, action, and selection stats are stored against the user message, and Accessibility errors use the shared permission notice.

~~Select text in any app → press a shortcut → a small action menu appears: **Explain, Summarize, Rewrite, Translate, Fix grammar, Extract tasks, Reply**. The result opens in the overlay, with **Copy** and **Replace selection**.~~

~~This is the highest-leverage feature you can add. It makes Iris useful in Mail, Safari, VS Code, PDFs, and every text field on the Mac without building a single new chat screen. It reuses the overlay and DeepSeek; the new work is macOS Accessibility (`AXSelectedText`), a configurable shortcut, and a permission flow. Fall back to clipboard when an app doesn’t expose selection, and never read secure/password fields.~~

### ~~2. Persistent memory · Medium~~ — v1 done

**What shipped**

- **Automatic learning.** After a reply has been idle for 20 seconds, a background writer reviews the newest typed exchange and stores up to three durable facts. There is no manual preference form.
- **Individual topics.** Each fact is a short, editable item. Corrections replace the previous version instead of piling up contradictory memories.
- **Safe by default.** Pasted text, selection prompts, screen captures, attachments, credentials, payment/account details, health data, government IDs, exact addresses, and sensitive categories are excluded before storage. A deterministic Rust filter backs up the extraction prompt.
- **Both surfaces.** Active, unpaused memories are injected into the quick overlay and history prompts, capped at 30 items / 1,500 characters. Explicit instructions take precedence.
- **Settings → Memory.** Search, edit, pause, delete, clear all, and undo the newest learned batch. User-edited memories are authoritative and are never overwritten automatically.
- **Data lifecycle.** Clearing conversations keeps memory; Reset Iris removes it and cancels pending memory tasks.
- **Still open.** Project-scoped memory and a per-chat memory toggle. Project scoping is deliberately deferred to the Projects feature.

~~Right now the summary cache compresses _one_ conversation. ChatGPT/Claude memory is different: a small, editable store of facts about you that follows you into every chat — “prefers concise answers,” “works on Iris,” “timezone is …,” “don’t suggest X.”~~

~~Add a `memories` table, inject a compact memory block into the system prompt in `core/agent.rs`, and add Settings → Memory with search, edit, delete, and pause. Auto-extract low-risk facts after a conversation and show “Iris remembered…” with an undo; ask before storing anything sensitive. Later, scope memories per project.~~

### ~~3. Island conversation switcher · Small-medium~~ — done

**What shipped**

- **Header search.** A search button in the overlay header, or **⌘F**, opens a compact title search above the composer. **⌘F** again refocuses the field. A second click or Escape closes it, and Escape does not hide Iris.
- **Title-only and instant.** It matches non-archived conversation titles in memory, shows the 8 most recent chats by default or up to 20 matches while searching, and never searches message bodies. The current chat is excluded.
- **Switch in place.** Choosing a chat flushes pending SQLite writes, settles the previous run, makes the chosen chat the current `quickConversationId`, loads its newest page, and keeps the previous chat one **Previous conversation** (`⌘⇧N`) away. The choice is persisted in `app_meta`.
- **Keyboard-first.** The search field focuses on open, arrow keys move through results, Enter opens the highlighted chat, and the active row scrolls into view.
- **No schema change.** It reuses the stored conversation summaries, `quickConversationId`, the existing message-page loader, and the same title rows the sidebar shows.

~~Today a finished quick chat is only reachable from History, and **Previous conversation** (`⌘⇧N`) toggles one step back. Add a **search** button in the overlay header that lets you jump to any earlier conversation:~~

- ~~**It searches conversations, not messages.** One query matches conversation titles and returns the recent chats, the same rows the sidebar shows. It is a “get me back to that chat” tool, not a transcript search, so it stays instant and the expanded state stays small.~~
- ~~**The island grows for it.** Tapping search expands the panel upward into a compact field with the matching chats underneath. Escape or a second tap collapses it back to the normal one-input, one-response layout; it is not a new window and not a chat redesign.~~
- ~~**Selecting a result switches context in place.** The chosen chat becomes the current quick conversation with its title, messages, and attachments, and the overlay keeps working exactly as it does after **Previous conversation** (`⌘⇧N`), just with the full list instead of one step.~~
- ~~**Nothing is lost on the way.** The current draft and its pending writes are flushed before the switch, and **New chat** still starts a fresh UUID conversation, so the old chat stays intact in History.~~
- ~~**Keyboard-first.** Arrow keys move through results and Enter opens the highlighted chat, so the switcher never requires the mouse.~~

~~No schema change is needed: it reuses the stored conversation list, `quickConversationId`, and the existing open-conversation path from History, so the work stays inside the overlay.~~

### 4. Scheduled tasks and reminders · Medium

Iris already lives in the menu bar and can run while hidden. Add:

- **Reminders** — “Remind me at 5 to call Sam.”
- **Recurring tasks** — “Every morning at 8, give me a brief.”
- **Background runs** — long research or generation tasks that notify you when done.

This needs a small Rust scheduler, a `tasks` table, catch-up after sleep, run history, and notifications. Use macOS notifications when Iris is hidden and the Dynamic Island notice system when a window is open. This is the feature that turns Iris from reactive to proactive.

Those four are the biggest jump in usefulness per unit of work.

### 5. REMIND ME: Delete `.commandcode` folder

## Next tier: the “do everything” layer

- **Native connectors + a tool loop · Large.** This is the real unlock: “What’s on my calendar tomorrow?”, “Add that to Reminders,” “Find the PDF I edited last week,” “Summarize this Safari tab.” Start read-only with Calendar, Reminders, Notes, and Finder/Spotlight; add writes only with confirmation. It requires extending `core/agent.rs` from text-only streaming to a `tool_use` → execute → `tool_result` loop, plus per-tool permissions and an audit log. It’s also the same foundation you’ll want later for the DeepSeek CLI, so it pays off twice.
- **Projects / Spaces · Medium-large.** A project holds a system prompt, reference files, pinned chats, default toggles, and later a memory scope. Claude Projects and ChatGPT Projects are the model. Add a compact space switcher in the overlay header, not a new chat redesign.
- **Dictation anywhere · Small-medium.** Hold a shortcut, speak, and paste a cleaned transcript into the frontmost app. This is different from the existing voice input, which sends to Iris. You already have 16 kHz recording and ASR; you mainly need a paste/Accessibility flow and a tiny recording indicator.
- **Screen ask · Small.** You already have region capture and annotation. Add a one-shot “Ask about this screen” that captures a region/window, attaches it, and focuses the prompt. “Explain this chart,” “What’s this error?”, “Translate this page.”
- **Menu bar control center + `iris://` + Shortcuts · Small.** Tray items for New chat, Dictate, Capture, recent chats, tasks, Settings. A URL scheme and macOS Shortcuts actions let you trigger Iris from Raycast, Alfred, or automations. Cheap, and it makes Iris feel like part of the OS.

## Later differentiators

- **Artifacts / Stage · Large.** Render HTML, SVG, Mermaid, charts, and documents in an interactive preview, iterate on them (“make the hero green”), and export. Your current `canvas` is deliberately click-through, so don’t make it interactive — add a separate `stage` window with a sandboxed iframe.
- **File generation · Medium.** “Make me a CSV/Markdown/PDF and save it to Downloads.” This is practical output and pairs well with artifacts.
- **Research mode · Large.** Multi-step plan → search → read sources → synthesize → cite, with progress and a final report. Your current Search toggle is one-shot; this is the ChatGPT/Claude Deep Research equivalent.
- **Voice conversation mode · Large.** Hands-free, turn-taking conversation with barge-in. Your current voice path is batch ASR → LLM → TTS, so start with push-to-talk turn-taking and set expectations; true realtime is a bigger latency project.
- **Local folder RAG · Large.** “Chat with my Mac” over selected folders, with file citations. Use FTS/BM25 or local embeddings; keep it local-first.
- **Meeting notes · Large.** Record system audio + mic, transcribe, summarize, extract action items. High value for a desktop assistant, but it needs ScreenCaptureKit audio, chunking, and diarization.

## Cheap table stakes to fold in

These aren’t exciting, but ChatGPT/Claude users expect them:

- **Pins** and tags/folders for conversations
- **Export** a chat as Markdown/JSON (and import)
- **Incognito chat** that isn’t saved
- **Duplicate / branch from here**
- **Quote/reply** to a specific message
- **Follow-up suggestion chips** after a reply
- **Usage/cost dashboard** for DeepSeek tokens
- **Auto-update** and an **encrypted local backup**

## What I’d deliberately not build yet

- **A provider picker or multi-model marketplace.** It contradicts the DeepSeek-only decision and doubles the testing surface.
- **Image/video generation.** DeepSeek isn’t the right backend for it; it would mean a second provider.
- **Team sharing, cloud sync, mobile apps.** Huge surfaces, and none are required for “one Mac, one assistant.”
- **A full document editor or IDE.** Artifact preview + export is enough; don’t compete with Notion or VS Code.
- **The DeepSeek CLI integration**, as you said. But note that the tool loop above is the bridge you’ll want when you do it.

## Suggested order

1. **Selection actions + dictation + screen ask** — make Iris reachable everywhere.
2. **Memory + pins/export/incognito** — make it personal and round out chat parity.
3. **Projects + island switcher + scheduled tasks** — context and autonomy.
4. **Connectors, read-only first** — calendar, reminders, notes, files.
5. **Artifacts + file output + research** — make it produce real work.
6. **Voice conversation + local RAG + meeting notes** — the moonshots.

Architecturally, most of this fits without redesigning the chat: new append-only migrations for `memories`, `projects`, and `tasks`; memory injection and the tool loop in `core/agent.rs`; a permission section in Settings; a separate interactive Stage window rather than changing the click-through canvas.

If I had to pick **one** to start with, it’s **selection actions**. It’s the feature that makes Iris feel like a layer over macOS instead of another chat window, and it’s a contained build compared with connectors or artifacts.

Want me to write a concrete implementation spec for selection actions — shortcut behavior, Accessibility/permission flow, UI states, fallback handling, and where it hooks into the overlay? Or start with memory, which is a smaller first step?

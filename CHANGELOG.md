# Changelog

All notable changes to Iris are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Movable capture toolbar.** In screen capture, drag the toolbar's empty space
  (the gaps and separators) to move it away from the area you want to annotate. The
  move icon still repositions the crop; the toolbar stays where you put it until
  the capture closes.
- **Stopped and cut-off replies are labeled.** If a stream is stopped after text
  has already arrived, the partial reply now says **Stopped** in History and the
  quick overlay instead of looking finished. A reply cut off by the output limit
  reports an error instead of being stored as complete.
- **Live thinking and sources.** While the model reasons, Iris now streams its
  reasoning instead of showing a silent wait. History shows a compact, collapsible
  **Thinking** panel above the reply; its label shimmers while the model is thinking
  and changes to **Thought** when it is done. The quick overlay shows a shimmering
  **Thinking** line in its header beside Stop, then keeps hiding the answer until
  **Show response**. Web results used by an answer appear as
  a small **Sources** pill under it in History, with clickable titles, site names,
  and snippets. Reasoning and sources are stored with the message, so they survive
  reloads. Reasoning is never read aloud, copied, or sent back to the model.
- **Automatic web search and thinking effort.** Web search is now always available and
  the model decides when to use it, so the Web search toggle and `⌘S` binding are
  gone. Thinking is always enabled; the DeepThink toggle and `⌘D` binding were
  replaced by a persisted **Low / High / Max** effort chip in both composers that
  cycles on click, defaulting to **Low**. Existing installs that had DeepThink on
  migrate to High.
- **Conversation switcher in the quick overlay.** A search button in the overlay
  header, or the **Search conversations** overlay shortcut (**⌘F** by default,
  configurable in Settings → Shortcuts), opens a compact title search for recent
  chats. The shortcut again refocuses the field. Arrow keys and Enter switch context
  in place; the current chat's pending writes are flushed first, and Escape closes
  the switcher without hiding Iris. The current chat is excluded, and the chat you
  left stays one **Previous conversation** (`⌘⇧N`) away.
- **Persistent memory.** Iris now learns durable preferences and facts from typed
  chats in the background and applies them to both Quick chat and History. Settings →
  Memory lists every remembered item with search, edit, pause, delete, clear all, and
  an Undo for the newest learned batch. Screen captures, attachments, and sensitive
  details are never saved; pasted and selected text is allowed. Clearing
  conversations keeps
  memory, while Reset Iris removes it.
- **One-request spoken summaries.** When automatic read-aloud summarizes replies,
  Iris asks DeepSeek to end long or code-heavy answers with a hidden
  `<spoken_summary>` block in the same stream. The block is stripped before it
  reaches the chat or SQLite history, cached, and spoken as soon as the reply
  finishes. Short answers skip it, and the separate summary call remains the
  fallback when the block is missing or malformed.
- **Model metadata per assistant message.** Migration `006-message-metadata` adds a
  JSON `metadata` column. Assistant replies store `{"ai_model":"..."}` so model
  performance can be compared later; user messages and older replies have no
  model metadata.
- **Menu bar direct toggle.** Left-click the Iris icon to show the overlay if
  hidden, or hide it if visible. Right-click opens **Ask Iris**, **History**, and
  **Quit Iris**.
- **Built-in quick prompts avoid em dashes.** Every pre-built prompt now includes
  `Do not use em-dash, use ";" instead of em-dash.` Existing saved built-ins are
  migrated once; prompts you create yourself are left exactly as written.
- **Ask about screen.** Press **⌘⇧A** to capture the whole display, attach it to
  the current quick chat, and focus the prompt. Nothing is sent until you type a
  question and press Enter. **⌘⇧S** remains the region/annotation capture.
- **Customizable quick prompts.** The selection strip's prompts are now editable in
  Settings → AI Prompts: change the name, icon, or instruction, add your own,
  delete one, or drag the list into a new order. The **API Key** panel now holds
  only the connection settings, while **AI Prompts** holds the two system
  prompts and the quick-prompt list. Type `/` in an empty composer to pick a
  quick prompt, then type or paste the text it should act on. The same order is
  used by the selection strip and both composers.
- **Quick prompts.** The selection action strip is now editable in Settings →
  AI Prompts → **Quick prompts**. Rename a prompt, change its icon or
  instruction, add your own, delete one, or drag the list into a new order; the
  strip and the new `/` menu use that order. Typing `/` in an empty composer
  opens the list, and choosing a prompt applies it to the text you type next.
- **Settings reorganized.** The old **AI** category is now **API Key** and holds
  only the connection settings. The system prompts moved to **AI Prompts**,
  alongside the quick prompts.
- **Read selection results aloud** is a separate Voice setting, off by default, so
  translation/rewrite results are not spoken unless requested. Manual Read aloud
  still works either way.
- **Selection actions.** Select text in any app and press **⌘⇧Space** to choose
  Explain, Summarize, Improve, Simplify, Translate, Fix grammar, Extract
  tasks, or Reply.
  The result opens in the overlay with Copy, Paste, and Replace selection.
  **Custom** opens the composer with the selected text attached so a typed or
  dictated instruction is sent together with it. Reading uses macOS Accessibility
  with a clipboard fallback, and secure fields are skipped. The source app,
  action, and selection stats are stored in SQLite linked to the user message.
- **Spoken summaries for long replies.** Automatic read-aloud now condenses long
  or code-heavy answers into a short spoken summary while the full reply stays
  on screen. Summaries are cached in SQLite and reused. Manual **Read aloud**
  still speaks the full original reply. Toggle automatic summaries in
  Settings → Voice.
- **Show summary in History.** Each assistant message with a cached spoken
  summary gets its own `…` menu with a **Show summary** switch. While it is on,
  that reply displays its spoken version, and Copy and Read aloud use that text;
  turning it off restores the original reply.
- **Start at login** in Settings → General → Startup, so Iris can launch in the
  menu bar when you sign in to your Mac. Reset Iris turns it off again.

### Fixed

- **New chat cleans up empty conversations.** Starting a new quick chat now
  removes unarchived conversations that contain no messages, after flushing
  pending writes. It keeps the new chat, the History window's active chat,
  archived chats, and every conversation with real messages. Both windows drop
  the removed rows immediately, so the storage mirror cannot save them again.
- Selection prompts, **Custom**, and `/` quick prompts now preserve a screenshot
  already attached to the draft and send it with the prompt. Iris keeps the current
  quick chat when an attachment is present so the image stays in the right folder.
- A selected quick prompt can now be sent with only an attachment and an empty
  composer. The prompt itself becomes the model instruction, and the empty
  `<selected_text>` wrapper is omitted.
- Accessibility permission errors now use the same neutral permission banner as
  Screen Recording, with one shared `PermissionNotice` component for both.
- Escape in the selection strip now cancels the selection and returns to the normal
  Iris composer without hiding the overlay. The header X still closes Iris.
- Selection actions now fall back to a temporary copy in every app when
  Accessibility cannot inspect the focused field, including T3 Code and other
  Chromium/Electron apps. Iris hides its own overlay before reading so it cannot
  remain the key window, and the clipboard fallback verifies the pasteboard
  actually changed before treating the text as a selection.
- The `/` quick-prompt menu now disappears when the text after the slash contains a
  space or matches no prompt. A slash followed by ordinary text is treated as plain
  input instead of showing an empty “No matches” panel.
- Quick-prompt matching now searches only the prompt name, so `/repl` shows Reply
  without instruction-based matches such as Improve.
- Double-clicking the conversation title in the overlay header now opens History on
  the current quick conversation. The Iris mascot is a status indicator and no longer
  reacts to double-clicks.
- Selection actions no longer crash when opening the overlay: AppKit window
  ordering now runs on the main thread instead of a Tokio worker.
- Selection actions now inspect the frontmost app's Accessibility tree, retry a
  transient missing focus, and use the clipboard in browsers when AX reports no
  focused element. Non-browser apps still require an inspectable, non-secure
  field.
- Release bundles no longer fail with `can't find crate for thiserror_impl`;
  proc-macro artifacts are built without stripping via the release
  `build-override` profile.

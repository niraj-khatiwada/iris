# Changelog

All notable changes to Iris are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- Selection prompts, **Custom**, and `/` quick prompts now preserve a screenshot
  already attached to the draft and send it with the prompt. Iris keeps the current
  quick chat when an attachment is present so the image stays in the right folder.
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
- Double-clicking the Iris mascot now opens History on the current quick
  conversation instead of leaving the history window on its previous selection.
- Selection actions no longer crash when opening the overlay: AppKit window
  ordering now runs on the main thread instead of a Tokio worker.
- Selection actions now inspect the frontmost app's Accessibility tree, retry a
  transient missing focus, and use the clipboard in browsers when AX reports no
  focused element. Non-browser apps still require an inspectable, non-secure
  field.
- Release bundles no longer fail with `can't find crate for thiserror_impl`;
  proc-macro artifacts are built without stripping via the release
  `build-override` profile.

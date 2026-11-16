# Taste
- Expects system appearance (macOS light/dark) to drive UI theming — the overlay should follow the OS setting, not the in-app theme selector, which he calls out as a distinct thing. Confidence: 0.6
- Prefers compact UI controls (smaller heights, tighter padding/gaps, smaller type and icons) over large, spacious ones; flags oversized nav buttons/sidebar items as "too large." Confidence: 0.55
- New keyboard shortcuts must be user-customizable, registered in the Settings → Shortcuts section alongside existing ones, not hardcoded defaults. Confidence: 0.6
- Names features by their literal function and corrects mislabeled terminology ("voice means microphone" — not voiceover/read-aloud); labels in settings and docs should match what the control actually does. Confidence: 0.55
- Dictation/voice input must compose with the existing draft rather than replace it: typed text, attached images, and the transcript should all be sent together as one message. Confidence: 0.6
- Expects single-instance semantics for audio playback: never allow two read-alouds to overlap — starting a newer one must supersede/stop the previous one, so the latest request always wins. Confidence: 0.6
- Dictates exact ordering of composer controls: the mic button stays rightmost, with the read-aloud indicator/stop to its left — corrects placement by specifying left/right position. Confidence: 0.5
- Prefers app-level, single-location controls for ongoing cross-cutting state (e.g. read-aloud wave + stop beside the mic in the chat input) rather than inline controls attached to the message that started it — wants one predictable, central place rather than a per-message indicator that follows context. Confidence: 0.55

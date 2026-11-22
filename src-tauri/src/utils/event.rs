/// A chunk of a streamed assistant response.
pub const CHAT_TOKEN: &str = "chat:token";

/// The end of a streamed response, whether it completed or was cancelled.
pub const CHAT_DONE: &str = "chat:done";

/// A streamed response failed after it started (HTTP, protocol, or provider error).
pub const CHAT_ERROR: &str = "chat:error";

/// A chunk of the model's reasoning while thinking mode is active.
pub const CHAT_THINKING: &str = "chat:thinking";

/// Web sources returned by DeepSeek's server tools for the current reply.
pub const CHAT_SOURCES: &str = "chat:sources";

/// The reply finished and its read-aloud audio is being prepared.
pub const SPEECH_PREPARING: &str = "speech:preparing";

/// Automatic read-aloud started playing.
pub const SPEECH_START: &str = "speech:start";

/// Automatic read-aloud finished, stopped, or was superseded.
pub const SPEECH_END: &str = "speech:end";

/// Automatic read-aloud failed before it could play, with the reason to show the user.
pub const SPEECH_ERROR: &str = "speech:error";

/// The quick overlay was hidden by the shortcut, Escape, or an explicit action.
pub const OVERLAY_HIDDEN: &str = "overlay:hidden";

/// The capture window received a fresh screenshot and waits for a region selection.
pub const CAPTURE_START: &str = "capture:start";

/// The global screen-ask shortcut fired; the overlay should capture the display and attach it.
pub const SCREEN_ASK: &str = "screen:ask";

/// The capture panel was closed without attaching, discarding the in-progress selection.
pub const CAPTURE_CLOSED: &str = "capture:closed";

/// The overlay was shown or brought forward; the webview should focus its input.
pub const OVERLAY_FOCUSED: &str = "overlay:focused";

/// A selection was captured and the overlay should show the selection action strip.
pub const SELECTION_OPEN: &str = "selection:open";

/// A selection could not be captured, or the user needs to grant Accessibility access.
pub const SELECTION_ERROR: &str = "selection:error";

/// The overlay is being dragged; the canvas draws the snap guides at these positions.
pub const OVERLAY_GUIDES: &str = "overlay:guides";

/// Every stored conversation was cleared; each window drops its local chat state too.
pub const CHAT_CLEARED: &str = "chat:cleared";

/// Empty conversations were removed; every window drops those rows from its local list.
pub const CONVERSATIONS_DELETED: &str = "conversations:deleted";

/// The background memory writer added or corrected persistent memories.
pub const MEMORY_CHANGED: &str = "memory:changed";

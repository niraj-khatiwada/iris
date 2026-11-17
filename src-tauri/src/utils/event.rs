/// A chunk of a streamed assistant response.
pub const CHAT_TOKEN: &str = "chat:token";

/// The end of a streamed response, whether it completed or was cancelled.
pub const CHAT_DONE: &str = "chat:done";

/// A streamed response failed after it started (HTTP, protocol, or provider error).
pub const CHAT_ERROR: &str = "chat:error";

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

/// The capture panel was closed without attaching, discarding the in-progress selection.
pub const CAPTURE_CLOSED: &str = "capture:closed";

/// The overlay was shown or brought forward; the webview should focus its input.
pub const OVERLAY_FOCUSED: &str = "overlay:focused";

/// The overlay is being dragged; the canvas draws the snap guides at these positions.
pub const OVERLAY_GUIDES: &str = "overlay:guides";

/// Every stored conversation was cleared; each window drops its local chat state too.
pub const CHAT_CLEARED: &str = "chat:cleared";

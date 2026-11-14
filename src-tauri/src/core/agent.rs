//! The agent runtime.
//!
//! The app currently ships a local preview agent so the full loop (streaming tokens,
//! cancellation, conversation state) works end to end before a model provider is chosen.
//! Replace `stream_placeholder_reply` with a real provider call and keep the same event
//! contract (`chat:token`, `chat:done`).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::tauri_commands::chat::{
    ChatDonePayload, ChatTokenPayload, GenerationState, SendMessageRequest,
};
use crate::utils::event;

/// Streams a deterministic preview reply for the latest user message.
pub async fn stream_placeholder_reply(
    app: AppHandle,
    request: SendMessageRequest,
    cancelled: Arc<AtomicBool>,
) {
    let request_id = request.request_id.clone();

    log::info!(
        "Streaming preview reply for conversation {}",
        request.conversation_id
    );

    // A small pause makes the transition from "sent" to "responding" feel natural.
    tokio::time::sleep(Duration::from_millis(220)).await;

    let reply = build_reply(&request);
    for token in reply.split_inclusive(' ') {
        if cancelled.load(Ordering::SeqCst) {
            break;
        }

        let payload = ChatTokenPayload {
            request_id: request_id.clone(),
            token: token.to_string(),
        };
        if app.emit(event::CHAT_TOKEN, payload).is_err() {
            break;
        }

        tokio::time::sleep(Duration::from_millis(14)).await;
    }

    let _ = app.emit(
        event::CHAT_DONE,
        ChatDonePayload {
            request_id: request_id.clone(),
            cancelled: cancelled.load(Ordering::SeqCst),
        },
    );
    app.state::<GenerationState>().finish(&request_id);
}

fn build_reply(request: &SendMessageRequest) -> String {
    let latest = request
        .messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| message.content.trim())
        .unwrap_or_default();

    let excerpt = truncate(latest, 320);

    if excerpt.is_empty() {
        return "I'm here. What would you like to work on?".to_string();
    }

    format!(
        "I'm **Iris**, your personal desktop assistant.\n\n\
         You said:\n\n> {excerpt}\n\n\
         This first build runs in **local preview mode**, so the voice is mine but the brain \
         is a placeholder. The desktop shell, streaming responses, cancellation, and conversation \
         history are all wired up and ready for a real model.\n\n\
         Next step: add your provider of choice in `src-tauri/src/core/agent.rs`."
    )
}

fn truncate(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::core::agent::AgentConfig;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageInput {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    /// Matches the streamed events to the message being rendered.
    pub request_id: String,
    pub conversation_id: String,
    pub messages: Vec<ChatMessageInput>,
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub auto_speak: bool,
    pub tts_voice: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTokenPayload {
    pub request_id: String,
    pub token: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDonePayload {
    pub request_id: String,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatErrorPayload {
    pub request_id: String,
    pub message: String,
}

struct ActiveGeneration {
    request_id: String,
    cancelled: Arc<AtomicBool>,
}

/// Only one response streams at a time; starting another cancels the previous one.
#[derive(Default)]
pub struct GenerationState(Mutex<Option<ActiveGeneration>>);

impl GenerationState {
    fn lock(&self) -> MutexGuard<'_, Option<ActiveGeneration>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn start(&self, request_id: String) -> Arc<AtomicBool> {
        let cancelled = Arc::new(AtomicBool::new(false));
        let previous = self.lock().replace(ActiveGeneration {
            request_id,
            cancelled: cancelled.clone(),
        });

        if let Some(previous) = previous {
            previous.cancelled.store(true, Ordering::SeqCst);
        }

        cancelled
    }

    pub fn cancel(&self, request_id: Option<&str>) {
        if let Some(active) = self.lock().as_ref() {
            let matches = match request_id {
                Some(id) => id == active.request_id,
                None => true,
            };
            if matches {
                active.cancelled.store(true, Ordering::SeqCst);
            }
        }
    }

    pub fn finish(&self, request_id: &str) {
        let mut active = self.lock();
        if active
            .as_ref()
            .is_some_and(|generation| generation.request_id == request_id)
        {
            *active = None;
        }
    }
}

#[tauri::command]
pub fn send_message(
    app: AppHandle,
    state: State<'_, GenerationState>,
    request: SendMessageRequest,
) -> Result<(), String> {
    if request.request_id.trim().is_empty() {
        return Err("The request is missing an id.".to_string());
    }
    if request.messages.is_empty() {
        return Err("There is nothing to send yet.".to_string());
    }

    let api_key = request.api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("Add your DeepSeek API key in Settings.".to_string());
    }

    let base_url = request.base_url.trim().to_string();
    if base_url.is_empty() {
        return Err("Add a DeepSeek API base URL in Settings.".to_string());
    }

    let model = request.model.trim().to_string();
    let model = if model.is_empty() {
        "deepseek-flash".to_string()
    } else {
        model
    };
    let tts_voice = if request.tts_voice == "tide" {
        "tide".to_string()
    } else {
        "stella".to_string()
    };
    let config = AgentConfig {
        api_key,
        base_url,
        model,
        auto_speak: request.auto_speak,
        tts_voice,
    };

    crate::sys::speech::stop(&app);
    let cancelled = state.start(request.request_id.clone());
    tauri::async_runtime::spawn(crate::core::agent::stream_reply(
        app, request, config, cancelled,
    ));
    Ok(())
}

#[tauri::command]
pub fn cancel_generation(
    app: AppHandle,
    state: State<'_, GenerationState>,
    request_id: Option<String>,
) -> Result<(), String> {
    state.cancel(request_id.as_deref());
    crate::sys::speech::stop(&app);
    Ok(())
}

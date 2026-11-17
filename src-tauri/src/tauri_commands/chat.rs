use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::core::agent::AgentConfig;
use crate::core::endpoints;
use crate::core::storage::Storage;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachmentInput {
    pub media_type: String,
    /// Base64 payload without the `data:` prefix. Empty for uploaded documents.
    #[serde(default)]
    pub data: String,
    /// DeepSeek Files API id for documents.
    #[serde(default)]
    pub file_id: Option<String>,
    /// Stored image preview inside the conversation's attachments folder; Rust reads it into
    /// `data` before the request.
    #[serde(default)]
    pub local_file: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageInput {
    /// The client message id, used to merge a paginated request tail with the stored history.
    #[serde(default)]
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub attachments: Vec<ChatAttachmentInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageRequest {
    /// Matches the streamed events to the message being rendered.
    pub request_id: String,
    pub conversation_id: String,
    pub messages: Vec<ChatMessageInput>,
    pub base_url: String,
    pub model: String,
    /// Instructions from Settings → AI → Prompt. Empty keeps the built-in default.
    #[serde(default)]
    pub system_prompt: String,
    pub auto_speak: bool,
    /// Enables DeepSeek's DeepThink before the reply.
    #[serde(default)]
    pub deep_think: bool,
    /// Declares the web search tool in addition to reading links.
    #[serde(default)]
    pub web_search: bool,
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
    storage: State<'_, Storage>,
    request: SendMessageRequest,
) -> Result<(), String> {
    if request.request_id.trim().is_empty() {
        return Err("The request is missing an id.".to_string());
    }
    if request.messages.is_empty() {
        return Err("There is nothing to send yet.".to_string());
    }

    // The key is read from the credential table here, never sent from the webview.
    let api_key = storage.require_api_key()?;

    let base_url = request.base_url.trim().to_string();
    if base_url.is_empty() {
        return Err("Add an API base URL in Settings.".to_string());
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
        base_url: base_url.clone(),
        model,
        auto_speak: request.auto_speak,
        deep_think: request.deep_think,
        web_search: request.web_search,
        tts_voice,
        tts_url: endpoints::url(&base_url, endpoints::TTS_PATH),
    };

    crate::sys::speech::stop(&app);
    let cancelled = state.start(request.request_id.clone());
    tauri::async_runtime::spawn(crate::core::agent::stream_reply(
        app, request, config, cancelled,
    ));
    Ok(())
}

/// Asks DeepSeek for a short title for a new conversation. The UI keeps its local fallback title
/// when this fails, so a title request can never block sending or lose the conversation.
#[tauri::command]
pub async fn generate_conversation_title(
    storage: State<'_, Storage>,
    base_url: String,
    model: String,
    prompt: String,
) -> Result<String, String> {
    let api_key = storage.require_api_key()?;
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("There is nothing to title yet.".to_string());
    }
    if base_url.trim().is_empty() {
        return Err("Add the API base URL in Settings.".to_string());
    }

    let model = if model.trim().is_empty() {
        "deepseek-flash"
    } else {
        model.trim()
    };
    let excerpt = prompt.chars().take(2000).collect::<String>();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Could not create the title client: {error}"))?;

    let response = client
        .post(endpoints::url(&base_url, endpoints::MESSAGES_PATH))
        .header("x-api-key", api_key)
        .header("accept", "application/json")
        .json(&json!({
            "model": model,
            "max_tokens": 32,
            "system": "You write short conversation titles. Use 2-5 words, no quotes, and no final punctuation. Reply with the title only.",
            "messages": [{
                "role": "user",
                "content": format!("Title this conversation:\n\n{excerpt}")
            }],
            "thinking": { "type": "disabled" },
            "stream": false
        }))
        .send()
        .await
        .map_err(|error| format!("Could not reach the title service: {error}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| body.chars().take(160).collect());
        return Err(format!("Title request failed ({status}): {detail}"));
    }

    let value: Value = serde_json::from_str(&body)
        .map_err(|_| "The title service returned an unexpected response.".to_string())?;
    let raw = value
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();
    let title = normalize_title(&raw);
    if title.is_empty() {
        return Err("The title service returned an empty title.".to_string());
    }

    Ok(title)
}

fn normalize_title(raw: &str) -> String {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = collapsed
        .trim_matches(|character: char| {
            character.is_whitespace()
                || matches!(
                    character,
                    '"' | '\'' | '`' | '“' | '”' | '‘' | '’' | '.' | ',' | '!' | '?' | ':' | ';'
                )
        })
        .trim();
    let title = text
        .strip_prefix("Title:")
        .or_else(|| text.strip_prefix("Conversation title:"))
        .unwrap_or(text)
        .trim();

    if title.chars().count() > 48 {
        let cut = title.chars().take(47).collect::<String>();
        format!("{}…", cut.trim_end())
    } else {
        title.to_string()
    }
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

#[cfg(test)]
mod tests {
    use super::normalize_title;

    #[test]
    fn titles_are_single_line_without_quotes_or_final_punctuation() {
        assert_eq!(
            normalize_title("  \"James Bond reboot.\"  "),
            "James Bond reboot"
        );
        assert_eq!(
            normalize_title("Title: A plan for the day"),
            "A plan for the day"
        );
        assert_eq!(normalize_title("New\n\nBond   movie!"), "New Bond movie");
        assert_eq!(normalize_title("   "), "");
    }

    #[test]
    fn long_titles_are_truncated() {
        let title = normalize_title(&"a".repeat(80));
        assert_eq!(title.chars().count(), 48);
        assert!(title.ends_with('…'));
    }
}

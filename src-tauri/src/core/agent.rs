//! DeepSeek chat runtime.
//!
//! The demo uses DeepSeek's Anthropic-compatible Messages API, with a separate TTS endpoint for
//! read-aloud. The UI never shows the reply by default, so tokens are still streamed into the
//! conversation for history and for the automatic voice playback at the end.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::sys::speech;
use crate::tauri_commands::chat::{
    ChatDonePayload, ChatErrorPayload, ChatTokenPayload, GenerationState, SendMessageRequest,
};
use crate::utils::event;

const SYSTEM_PROMPT: &str =
    "You are Iris, a personal desktop assistant. Be direct, warm, and concise. \
     The user will hear your reply read aloud, so write naturally and avoid unnecessary formatting.";

pub struct AgentConfig {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub auto_speak: bool,
    pub tts_voice: String,
}

enum Outcome {
    Completed(String),
    Cancelled,
    Empty,
}

/// Streams one DeepSeek response, then optionally speaks it automatically.
pub async fn stream_reply(
    app: AppHandle,
    request: SendMessageRequest,
    config: AgentConfig,
    cancelled: Arc<AtomicBool>,
) {
    let request_id = request.request_id.clone();
    log::info!(
        "Streaming DeepSeek reply for conversation {}",
        request.conversation_id
    );

    match run(&app, &request, &config, &cancelled).await {
        Ok(Outcome::Completed(text)) => {
            emit_done(&app, &request_id, false);
            app.state::<GenerationState>().finish(&request_id);

            if config.auto_speak && !text.trim().is_empty() {
                let speech_app = app.clone();
                let conversation_id = request.conversation_id.clone();
                let api_key = config.api_key;
                let base_url = config.base_url;
                let voice = config.tts_voice;
                tauri::async_runtime::spawn(async move {
                    speech::speak(speech_app, conversation_id, api_key, base_url, voice, text)
                        .await;
                });
            }
        }
        Ok(Outcome::Cancelled) => {
            emit_done(&app, &request_id, true);
            app.state::<GenerationState>().finish(&request_id);
        }
        Ok(Outcome::Empty) => {
            emit_error(
                &app,
                &request_id,
                "DeepSeek returned an empty response.".to_string(),
            );
            app.state::<GenerationState>().finish(&request_id);
        }
        Err(message) => {
            emit_error(&app, &request_id, message);
            app.state::<GenerationState>().finish(&request_id);
        }
    }
}

async fn run(
    app: &AppHandle,
    request: &SendMessageRequest,
    config: &AgentConfig,
    cancelled: &AtomicBool,
) -> Result<Outcome, String> {
    let url = format!(
        "{}/anthropic/v1/messages",
        config.base_url.trim_end_matches('/')
    );
    let messages = request
        .messages
        .iter()
        .filter_map(|message| match message.role.as_str() {
            "user" => Some(json!({
                "role": "user",
                "content": message.content
            })),
            "assistant" => Some(json!({
                "role": "assistant",
                "content": [{ "type": "text", "text": message.content }]
            })),
            _ => None,
        })
        .collect::<Vec<_>>();

    if messages.is_empty() {
        return Err("There is nothing to send yet.".to_string());
    }

    let body = json!({
        "model": config.model,
        "system": SYSTEM_PROMPT,
        "messages": messages,
        "thinking": { "type": "disabled" },
        "safety_check": { "level": "high" },
        "tools": [{ "type": "deepseek_read_url", "name": "deepseek_read_url" }],
        "stream": true
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| format!("Could not create the DeepSeek client: {error}"))?;

    let response = tokio::select! {
        response = client
            .post(url)
            .header("x-api-key", &config.api_key)
            .header("accept", "text/event-stream")
            .json(&body)
            .send() => response,
        _ = wait_for_cancel(cancelled) => return Ok(Outcome::Cancelled),
    }
    .map_err(|error| format!("Could not reach DeepSeek: {error}"))?;

    if !response.status().is_success() {
        return Err(read_error(response).await);
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !content_type.contains("text/event-stream") {
        return Err(read_error(response).await);
    }

    let mut stream = response.bytes_stream();
    let mut decoder = SseDecoder::default();
    let mut full_text = String::new();
    let mut stopped = false;

    'stream: loop {
        let chunk = tokio::select! {
            chunk = stream.next() => chunk,
            _ = wait_for_cancel(cancelled) => return Ok(Outcome::Cancelled),
        };

        let Some(chunk) = chunk else {
            break;
        };
        let chunk = chunk.map_err(|error| format!("DeepSeek stream failed: {error}"))?;

        for data in decoder.push(&chunk) {
            let event: Value = match serde_json::from_str(&data) {
                Ok(value) => value,
                Err(_) => continue,
            };

            if let Some(message) = event
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
            {
                return Err(message.to_string());
            }

            match event.get("type").and_then(Value::as_str) {
                Some("content_block_start") => {
                    if let Some(text) = event
                        .get("content_block")
                        .and_then(|block| block.get("text"))
                        .and_then(Value::as_str)
                    {
                        if !text.is_empty() {
                            emit_token(app, &request.request_id, text);
                            full_text.push_str(text);
                        }
                    }
                }
                Some("content_block_delta") => {
                    if let Some(text) = event
                        .get("delta")
                        .and_then(|delta| delta.get("text"))
                        .and_then(Value::as_str)
                    {
                        emit_token(app, &request.request_id, text);
                        full_text.push_str(text);
                    }
                }
                Some("message_stop") => {
                    stopped = true;
                    break 'stream;
                }
                Some("error") => {
                    let message = event
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("DeepSeek stream error");
                    return Err(message.to_string());
                }
                _ => {}
            }
        }
    }

    if cancelled.load(Ordering::SeqCst) {
        return Ok(Outcome::Cancelled);
    }
    if !stopped {
        return Err("DeepSeek ended the response unexpectedly.".to_string());
    }
    if full_text.trim().is_empty() {
        return Ok(Outcome::Empty);
    }

    Ok(Outcome::Completed(full_text))
}

fn emit_token(app: &AppHandle, request_id: &str, token: &str) {
    let _ = app.emit(
        event::CHAT_TOKEN,
        ChatTokenPayload {
            request_id: request_id.to_string(),
            token: token.to_string(),
        },
    );
}

fn emit_done(app: &AppHandle, request_id: &str, cancelled: bool) {
    let _ = app.emit(
        event::CHAT_DONE,
        ChatDonePayload {
            request_id: request_id.to_string(),
            cancelled,
        },
    );
}

fn emit_error(app: &AppHandle, request_id: &str, message: String) {
    log::warn!("DeepSeek request failed: {message}");
    let _ = app.emit(
        event::CHAT_ERROR,
        ChatErrorPayload {
            request_id: request_id.to_string(),
            message,
        },
    );
}

async fn wait_for_cancel(cancelled: &AtomicBool) {
    while !cancelled.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn read_error(response: reqwest::Response) -> String {
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|body| {
            body.get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| {
            if text.is_empty() {
                status.to_string()
            } else {
                text
            }
        });
    format!("DeepSeek error ({status}): {message}")
}

/// Incremental SSE parser. Events are separated by a blank line; `data:` lines are JSON.
#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
}

impl SseDecoder {
    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);
        let mut events = Vec::new();

        while let Some((index, separator_len)) = find_boundary(&self.buffer) {
            let block = self.buffer[..index].to_vec();
            self.buffer.drain(..index + separator_len);

            let text = String::from_utf8_lossy(&block);
            let data = text
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .map(|line| line.strip_prefix(' ').unwrap_or(line))
                .collect::<Vec<_>>()
                .join("\n");

            if !data.is_empty() {
                events.push(data);
            }
        }

        events
    }
}

fn find_boundary(buffer: &[u8]) -> Option<(usize, usize)> {
    let lf = buffer.windows(2).position(|window| window == b"\n\n");
    let crlf = buffer.windows(4).position(|window| window == b"\r\n\r\n");

    match (lf, crlf) {
        (Some(lf), Some(crlf)) if lf <= crlf => Some((lf, 2)),
        (Some(_), Some(crlf)) => Some((crlf, 4)),
        (Some(lf), None) => Some((lf, 2)),
        (None, Some(crlf)) => Some((crlf, 4)),
        (None, None) => None,
    }
}

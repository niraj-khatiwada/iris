//! DeepSeek chat runtime.
//!
//! The demo uses DeepSeek's Anthropic-compatible Messages API, with a separate TTS endpoint for
//! read-aloud. The UI never shows the reply by default, so tokens are still streamed into the
//! conversation for history and for the automatic voice playback at the end.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::sys::speech;
use crate::tauri_commands::chat::{
    ChatDonePayload, ChatErrorPayload, ChatMessageInput, ChatTokenPayload, GenerationState,
    SendMessageRequest,
};
use crate::utils::event;

const SYSTEM_PROMPT: &str =
    "You are Iris, a personal desktop assistant. Be direct, warm, and concise. \
     The user will hear your reply read aloud, so write naturally and avoid unnecessary formatting.";

/// Kept in the request whenever the conversation fits in this many characters.
const CONTEXT_BUDGET_CHARS: usize = 60_000;
/// The newest turns kept verbatim once the conversation is compressed.
const RECENT_BUDGET_CHARS: usize = 24_000;
/// The earlier turns folded into one summary request at a time.
const SUMMARY_INPUT_CHARS: usize = 40_000;

const SUMMARY_SYSTEM_PROMPT: &str =
    "You compress conversation history for a voice assistant. Write a compact summary in \
     third person that preserves the user's preferences, facts, decisions, open tasks, and \
     unresolved questions. Omit small talk, filler, and repeated phrasing. Return only the \
     summary, without a preamble.";

/// One conversation turn as sent by the webview.
struct Turn {
    role: String,
    content: String,
}

/// The request body after older turns have been compressed.
struct Prepared {
    system: String,
    messages: Vec<Value>,
}

/// Remembers the compressed prefix per conversation, so a long chat only folds in new turns
/// instead of re-summarizing everything on every request.
#[derive(Default)]
pub struct SummaryCache(Mutex<HashMap<String, CachedSummary>>);

struct CachedSummary {
    /// How many of the request's turns the summary already covers.
    covered: usize,
    summary: String,
}

impl SummaryCache {
    fn get(&self, conversation_id: &str) -> Option<(usize, String)> {
        self.lock()
            .get(conversation_id)
            .map(|entry| (entry.covered, entry.summary.clone()))
    }

    /// Drops all compressed summaries, e.g. when the user resets Iris.
    pub fn clear(&self) {
        self.lock().clear();
    }

    fn set(&self, conversation_id: &str, covered: usize, summary: String) {
        let mut cache = self.lock();
        // Conversations are unbounded; drop everything rather than grow without limit.
        if cache.len() >= 64 && !cache.contains_key(conversation_id) {
            cache.clear();
        }
        cache.insert(
            conversation_id.to_string(),
            CachedSummary { covered, summary },
        );
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, CachedSummary>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub struct AgentConfig {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub auto_speak: bool,
    pub deep_think: bool,
    pub web_search: bool,
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
    let Some(prepared) = prepare(app, request, config, cancelled).await? else {
        return Ok(Outcome::Cancelled);
    };

    let body = build_body(prepared.system, prepared.messages, config);

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

/// Turns the webview history into the request body, compressing older turns when the
/// conversation no longer fits in the context budget.
async fn prepare(
    app: &AppHandle,
    request: &SendMessageRequest,
    config: &AgentConfig,
    cancelled: &AtomicBool,
) -> Result<Option<Prepared>, String> {
    let cache = app.state::<SummaryCache>();
    prepare_with(
        &cache,
        &request.conversation_id,
        &request.messages,
        config,
        cancelled,
    )
    .await
}

async fn prepare_with(
    cache: &SummaryCache,
    conversation_id: &str,
    messages: &[ChatMessageInput],
    config: &AgentConfig,
    cancelled: &AtomicBool,
) -> Result<Option<Prepared>, String> {
    let turns = messages
        .iter()
        .filter(|message| match message.role.as_str() {
            "user" => true,
            "assistant" => !message.content.trim().is_empty(),
            _ => false,
        })
        .map(|message| Turn {
            role: message.role.clone(),
            content: message.content.clone(),
        })
        .collect::<Vec<_>>();

    if turns.is_empty() {
        return Err("There is nothing to send yet.".to_string());
    }

    let total_chars = turns.iter().map(|turn| turn.content.len()).sum::<usize>();
    if total_chars <= CONTEXT_BUDGET_CHARS {
        return Ok(Some(Prepared {
            system: SYSTEM_PROMPT.to_string(),
            messages: to_api_messages(&turns),
        }));
    }

    let split = match trim_to_user(&turns, split_index(&turns)) {
        index if index < turns.len() => index,
        // Defensive: always keep at least the latest user turn.
        _ => turns
            .iter()
            .rposition(|turn| turn.role == "user")
            .unwrap_or(0),
    };
    if split == 0 {
        // A single oversized turn; there is no earlier history to compress.
        return Ok(Some(Prepared {
            system: SYSTEM_PROMPT.to_string(),
            messages: to_api_messages(&turns),
        }));
    }
    if cancelled.load(Ordering::SeqCst) {
        return Ok(None);
    }

    let (cached_covered, cached_summary) = match cache.get(conversation_id) {
        Some((covered, summary)) if covered <= split => (covered, summary),
        // The window moved backwards or the history changed; start over.
        _ => (0, String::new()),
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Could not create the DeepSeek client: {error}"))?;
    let mut summary = if cached_covered > 0 {
        cached_summary
    } else {
        String::new()
    };
    let mut covered = cached_covered;
    let mut summarized = true;

    while covered < split {
        let end = chunk_end(&turns, covered, split);
        match summarize_chunk(&client, config, &summary, &turns[covered..end], cancelled).await {
            Ok(Some(next)) => {
                summary = next;
                covered = end;
            }
            Ok(None) => return Ok(None),
            Err(error) => {
                log::warn!(
                    "Could not summarize the earlier conversation {conversation_id}: {error}"
                );
                summarized = false;
                break;
            }
        }
    }

    if summarized && !summary.trim().is_empty() {
        cache.set(conversation_id, split, summary.clone());
        log::info!("Compressed {split} earlier turns for conversation {conversation_id}");
    }

    let system = if summary.trim().is_empty() {
        SYSTEM_PROMPT.to_string()
    } else {
        format!(
            "{SYSTEM_PROMPT}\n\nEarlier in this conversation (compressed):\n{summary}\n\n\
             The most recent turns follow verbatim. Continue from them."
        )
    };

    Ok(Some(Prepared {
        system,
        messages: to_api_messages(&turns[split..]),
    }))
}

fn to_api_messages(turns: &[Turn]) -> Vec<Value> {
    turns
        .iter()
        .map(|turn| match turn.role.as_str() {
            "assistant" => json!({
                "role": "assistant",
                "content": [{ "type": "text", "text": turn.content }]
            }),
            _ => json!({
                "role": "user",
                "content": turn.content
            }),
        })
        .collect()
}

/// Index of the first turn that fits within the recent-turns budget.
fn split_index(turns: &[Turn]) -> usize {
    let mut chars = 0;
    for (index, turn) in turns.iter().enumerate().rev() {
        chars += turn.content.len();
        if chars >= RECENT_BUDGET_CHARS {
            return index;
        }
    }
    0
}

/// The Anthropic API expects a request to start with a user turn.
fn trim_to_user(turns: &[Turn], mut index: usize) -> usize {
    while index < turns.len() && turns[index].role != "user" {
        index += 1;
    }
    index
}

/// The end of the next slice of prefix turns sent to one summary request.
fn chunk_end(turns: &[Turn], start: usize, limit: usize) -> usize {
    let mut chars = 0;
    let mut end = start;
    while end < limit && chars < SUMMARY_INPUT_CHARS {
        chars += turns[end].content.len();
        end += 1;
    }
    end.max(start + 1).min(limit)
}

async fn summarize_chunk(
    client: &reqwest::Client,
    config: &AgentConfig,
    previous: &str,
    turns: &[Turn],
    cancelled: &AtomicBool,
) -> Result<Option<String>, String> {
    let transcript = turns
        .iter()
        .map(|turn| {
            let speaker = if turn.role == "user" { "User" } else { "Iris" };
            format!("{speaker}: {}", turn.content)
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let prompt = if previous.trim().is_empty() {
        format!("Conversation transcript:\n\n{transcript}\n\nWrite the summary.")
    } else {
        format!(
            "Existing summary of the earlier conversation:\n\n{previous}\n\n\
             Newer transcript to fold in:\n\n{transcript}\n\n\
             Rewrite the summary so it covers everything, keeping it compact."
        )
    };

    let url = format!(
        "{}/anthropic/v1/messages",
        config.base_url.trim_end_matches('/')
    );
    let body = json!({
        "model": config.model,
        "system": SUMMARY_SYSTEM_PROMPT,
        "messages": [{ "role": "user", "content": prompt }],
        "max_tokens": 700,
        "thinking": { "type": "disabled" },
        "stream": false
    });

    let response = tokio::select! {
        response = client
            .post(url)
            .header("x-api-key", &config.api_key)
            .header("accept", "application/json")
            .json(&body)
            .send() => response,
        _ = wait_for_cancel(cancelled) => return Ok(None),
    }
    .map_err(|error| format!("Could not reach DeepSeek: {error}"))?;

    if !response.status().is_success() {
        return Err(read_error(response).await);
    }

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Could not read the DeepSeek summary: {error}"))?;
    let summary = body
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();

    if summary.trim().is_empty() {
        return Err("DeepSeek returned an empty summary.".to_string());
    }

    Ok(Some(summary.trim().to_string()))
}

/// Builds the streaming request body. Both composer toggles only affect the request.
fn build_body(system: String, messages: Vec<Value>, config: &AgentConfig) -> Value {
    let thinking = if config.deep_think {
        "enabled"
    } else {
        "disabled"
    };
    let tools = if config.web_search {
        json!([
            { "type": "deepseek_read_url", "name": "deepseek_read_url" },
            { "type": "deepseek_web_search", "name": "deepseek_web_search" }
        ])
    } else {
        json!([{ "type": "deepseek_read_url", "name": "deepseek_read_url" }])
    };

    json!({
        "model": config.model,
        "system": system,
        "messages": messages,
        "thinking": { "type": thinking },
        "safety_check": { "level": "high" },
        "tools": tools,
        "stream": true
    })
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

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};

    use serde_json::Value;

    use super::{
        build_body, chunk_end, prepare_with, split_index, to_api_messages, trim_to_user,
        AgentConfig, SummaryCache, Turn, RECENT_BUDGET_CHARS,
    };
    use crate::tauri_commands::chat::ChatMessageInput;

    /// A tiny DeepSeek stand-in: answers every request with a JSON summary and records the body.
    struct MockDeepSeek {
        base_url: String,
        requests: Arc<Mutex<Vec<Value>>>,
    }

    fn mock_server() -> MockDeepSeek {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let address = listener.local_addr().expect("mock address");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();

        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut raw = Vec::new();
                let mut buffer = [0u8; 4096];
                let header_end = loop {
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    if read == 0 {
                        break None;
                    }
                    raw.extend_from_slice(&buffer[..read]);
                    if let Some(index) = raw.windows(4).position(|window| window == b"\r\n\r\n") {
                        break Some(index + 4);
                    }
                };
                let Some(header_end) = header_end else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&raw[..header_end]).to_string();
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let lower = line.to_ascii_lowercase();
                        lower
                            .strip_prefix("content-length:")
                            .map(|value| value.trim().parse::<usize>().unwrap_or(0))
                    })
                    .unwrap_or(0);
                while raw.len() < header_end + length {
                    let read = stream.read(&mut buffer).unwrap_or(0);
                    if read == 0 {
                        break;
                    }
                    raw.extend_from_slice(&buffer[..read]);
                }

                let body =
                    serde_json::from_slice::<Value>(&raw[header_end..]).unwrap_or(Value::Null);
                let reply = {
                    let mut captured = captured.lock().unwrap();
                    captured.push(body);
                    format!(
                        r#"{{"content":[{{"type":"text","text":"summary-{}"}}]}}"#,
                        captured.len()
                    )
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\
                     content-length: {}\r\nconnection: close\r\n\r\n{}",
                    reply.len(),
                    reply
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });

        MockDeepSeek {
            base_url: format!("http://{address}"),
            requests,
        }
    }

    fn turn(role: &str, tag: &str) -> ChatMessageInput {
        let mut content = "x".repeat(16_250);
        content.replace_range(..tag.len(), tag);
        ChatMessageInput {
            role: role.to_string(),
            content,
        }
    }

    #[test]
    fn toggles_shape_the_request() {
        let mut config = AgentConfig {
            api_key: "test-key".to_string(),
            base_url: "http://127.0.0.1".to_string(),
            model: "deepseek-flash".to_string(),
            auto_speak: false,
            deep_think: false,
            web_search: false,
            tts_voice: "stella".to_string(),
        };

        let off = build_body("system".to_string(), vec![], &config);
        assert_eq!(off["thinking"]["type"], "disabled");
        assert_eq!(off["tools"].as_array().unwrap().len(), 1);

        config.deep_think = true;
        config.web_search = true;
        let on = build_body("system".to_string(), vec![], &config);
        assert_eq!(on["thinking"]["type"], "enabled");
        let tools = on["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[1]["name"], "deepseek_web_search");
    }

    #[tokio::test]
    async fn compresses_long_conversations_and_reuses_the_summary() {
        let server = mock_server();
        let cache = SummaryCache::default();
        let config = AgentConfig {
            api_key: "test-key".to_string(),
            base_url: server.base_url.clone(),
            model: "deepseek-flash".to_string(),
            auto_speak: false,
            deep_think: false,
            web_search: false,
            tts_voice: "stella".to_string(),
        };
        let cancelled = AtomicBool::new(false);

        let mut messages = vec![
            turn("user", "alpha"),
            turn("assistant", "beta"),
            turn("user", "gamma"),
            turn("assistant", "delta"),
        ];
        let first = prepare_with(&cache, "conversation", &messages, &config, &cancelled)
            .await
            .expect("first preparation")
            .expect("first request");
        assert!(first.system.contains("summary-1"));
        assert_eq!(first.messages.len(), 2);
        assert_eq!(first.messages[0]["role"], "user");

        messages.push(turn("user", "epsilon"));
        messages.push(turn("assistant", "zeta"));
        let second = prepare_with(&cache, "conversation", &messages, &config, &cancelled)
            .await
            .expect("second preparation")
            .expect("second request");
        assert!(second.system.contains("summary-2"));
        assert_eq!(second.messages.len(), 2);

        let requests = server.requests.lock().unwrap().clone();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0]["stream"], false);
        let prompt = requests[1]["messages"][0]["content"]
            .as_str()
            .expect("summary prompt");
        assert!(prompt.contains("summary-1"));
        assert!(!prompt.contains("alpha"));
    }

    fn turns(lens: &[(bool, usize)]) -> Vec<Turn> {
        lens.iter()
            .map(|(user, len)| Turn {
                role: if *user { "user" } else { "assistant" }.to_string(),
                content: "x".repeat(*len),
            })
            .collect()
    }

    #[test]
    fn keeps_everything_when_it_fits() {
        let history = turns(&[(true, 10), (false, 10)]);
        assert_eq!(split_index(&history), 0);
        assert_eq!(trim_to_user(&history, 0), 0);
    }

    #[test]
    fn splits_inside_the_recent_budget() {
        let history = turns(&[(true, 60_000), (false, 60_000), (true, 10)]);
        assert_eq!(split_index(&history), 1);
        assert_eq!(trim_to_user(&history, 1), 2);
    }

    #[test]
    fn recent_window_starts_with_a_user_turn() {
        let history = turns(&[
            (true, RECENT_BUDGET_CHARS / 2),
            (false, RECENT_BUDGET_CHARS / 2),
            (true, RECENT_BUDGET_CHARS / 2),
            (false, RECENT_BUDGET_CHARS / 2),
        ]);
        let split = trim_to_user(&history, split_index(&history));
        assert!(split < history.len());
        assert_eq!(history[split].role, "user");
    }

    #[test]
    fn chunking_always_makes_progress() {
        let history = turns(&[(true, 100_000), (false, 10), (true, 10)]);
        assert_eq!(chunk_end(&history, 0, 3), 1);
        assert_eq!(chunk_end(&history, 1, 3), 3);
    }

    #[test]
    fn assistant_turns_use_text_blocks() {
        let messages = to_api_messages(&turns(&[(true, 3), (false, 3)]));
        assert_eq!(messages[0]["content"], "xxx");
        assert_eq!(messages[1]["content"][0]["text"], "xxx");
    }
}

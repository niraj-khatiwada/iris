//! Chat runtime: provider-neutral, with the DeepSeek protocol as the current default.
//!
//! The demo uses DeepSeek's Anthropic-compatible Messages API, with a separate TTS endpoint for
//! read-aloud. The UI never shows the reply by default, so tokens are still streamed into the
//! conversation for history and for the automatic voice playback at the end. When automatic
//! read-aloud summarizes replies, the model appends a hidden `<spoken_summary>` block to the same
//! stream; the agent strips it from the visible text and hands it to speech.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use futures_util::StreamExt;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::core::attachments;
use crate::core::memory;
use crate::core::read_aloud;
use crate::core::storage::{Storage, StoredMessage};
use crate::sys::speech;
use crate::tauri_commands::chat::{
    ChatAttachmentInput, ChatDonePayload, ChatErrorPayload, ChatMessageInput, ChatSource,
    ChatSourcesPayload, ChatThinkingPayload, ChatTokenPayload, GenerationState, SendMessageRequest,
};
use crate::utils::event;

const SYSTEM_PROMPT: &str =
    "You are Iris, a personal desktop assistant. Be direct, warm, and concise. The user wants the reply to be like how a human have conversation, so write naturally in summarized form and avoid unnecessary formatting.";

/// Kept in the request whenever the conversation fits in this many characters.
const CONTEXT_BUDGET_CHARS: usize = 60_000;
/// The newest turns kept verbatim once the conversation is compressed.
const RECENT_BUDGET_CHARS: usize = 24_000;
/// The earlier turns folded into one summary request at a time.
const SUMMARY_INPUT_CHARS: usize = 40_000;
/// Anthropic's Messages API requires `max_tokens`; a reply sized for speech fits comfortably.
const MAX_OUTPUT_TOKENS: u32 = 8_192;
/// Required whenever a document block references a Files API `file_id`.
const FILES_BETA: &str = "files-api-2025-04-14";
/// The Messages API rejects a request that references more than this many document blocks.
const MAX_DOCUMENTS_PER_REQUEST: usize = 20;

/// Counts document blocks across every prepared turn.
fn document_count(messages: &[Value]) -> usize {
    messages
        .iter()
        .filter_map(|message| message.get("content").and_then(Value::as_array))
        .flat_map(|blocks| blocks.iter())
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("document"))
        .count()
}

const SUMMARY_SYSTEM_PROMPT: &str =
    "You compress conversation history for a voice assistant. Write a compact summary in \
     third person that preserves the user's preferences, facts, decisions, open tasks, and \
     unresolved questions. Omit small talk, filler, and repeated phrasing. Return only the \
     summary, without a preamble.";

/// One conversation turn as sent by the webview.
struct Turn {
    role: String,
    content: String,
    attachments: Vec<ChatAttachmentInput>,
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

#[derive(Clone)]
pub struct AgentConfig {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub auto_speak: bool,
    pub summarize_speech: bool,
    /// Thinking is always enabled; this is `low`, `high`, or `max`.
    pub thinking_effort: String,
    /// Learn durable facts from this conversation and inject remembered ones into the prompt.
    pub memory_enabled: bool,
    pub tts_voice: String,
    /// Full TTS endpoint derived from the base URL.
    pub tts_url: String,
}

enum Outcome {
    Completed {
        text: String,
        /// The reply's own spoken summary, when automatic read-aloud asked for one.
        spoken_summary: Option<String>,
    },
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
        "Streaming reply for conversation {}",
        request.conversation_id
    );

    match run(&app, &request, &config, &cancelled).await {
        Ok(Outcome::Completed {
            text,
            spoken_summary,
        }) => {
            emit_done(&app, &request_id, false);
            app.state::<GenerationState>().finish(&request_id);

            if config.memory_enabled && !text.trim().is_empty() {
                memory::schedule(
                    app.clone(),
                    config.clone(),
                    request.conversation_id.clone(),
                    &request.messages,
                    text.clone(),
                );
            }

            if config.auto_speak && !text.trim().is_empty() {
                let speech_app = app.clone();
                let speech_request = speech::SpeechRequest {
                    conversation_id: request.conversation_id.clone(),
                    message_id: request.assistant_message_id.clone(),
                    text,
                    voice: config.tts_voice,
                    api_key: config.api_key,
                    base_url: config.base_url,
                    model: config.model,
                    tts_url: config.tts_url,
                    // The block is only requested with summarization on; ignore it otherwise.
                    spoken_summary: if config.summarize_speech {
                        spoken_summary
                    } else {
                        None
                    },
                    summarize: config.summarize_speech,
                };
                tauri::async_runtime::spawn(async move {
                    speech::speak(speech_app, speech_request).await;
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
                "The model returned an empty response.".to_string(),
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
    // DeepSeek's Messages endpoint; the base URL only changes the origin (e.g. a proxy).
    let base = config.base_url.trim_end_matches('/');
    let url = crate::core::endpoints::url(base, crate::core::endpoints::MESSAGES_PATH);
    let Some(prepared) = prepare(app, request, config, cancelled).await? else {
        return Ok(Outcome::Cancelled);
    };

    let read_url = newest_user_message(&request.messages).is_some_and(contains_url);
    let documents = document_count(&prepared.messages);
    if documents > MAX_DOCUMENTS_PER_REQUEST {
        return Err(format!(
            "This conversation references {documents} documents, but the API allows at most {MAX_DOCUMENTS_PER_REQUEST} per request. Start a new chat or remove an older attachment."
        ));
    }
    let includes_document = documents > 0;
    let system = if config.memory_enabled {
        memory::inject(app, prepared.system)
    } else {
        prepared.system
    };
    let body = build_body(system, prepared.messages, config, read_url);

    let client = crate::utils::http::client()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| format!("Could not create the AI client: {error}"))?;

    let mut http = client
        .post(url)
        .header("x-api-key", &config.api_key)
        .header("accept", "text/event-stream");
    if includes_document {
        http = http.header("anthropic-beta", FILES_BETA);
    }

    let response = tokio::select! {
        response = http.json(&body).send() => response,
        _ = wait_for_cancel(cancelled) => return Ok(Outcome::Cancelled),
    }
    .map_err(|error| format!("Could not reach the AI service: {error}"))?;

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
    // Only hide the block when this request asked for it; otherwise leave the text untouched.
    let mut summary_filter = (config.auto_speak && config.summarize_speech)
        .then(read_aloud::SpokenSummaryFilter::default);
    let mut stopped = false;

    'stream: loop {
        let chunk = tokio::select! {
            chunk = stream.next() => chunk,
            _ = wait_for_cancel(cancelled) => return Ok(Outcome::Cancelled),
        };

        let Some(chunk) = chunk else {
            break;
        };
        let chunk = chunk.map_err(|error| format!("The reply stream failed: {error}"))?;

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
                    if let Some(block) = event.get("content_block") {
                        match block.get("type").and_then(Value::as_str) {
                            Some("thinking") => {
                                if let Some(thinking) =
                                    block.get("thinking").and_then(Value::as_str)
                                {
                                    if !thinking.is_empty() {
                                        emit_thinking(app, &request.request_id, thinking);
                                    }
                                }
                            }
                            Some("web_search_tool_result") | Some("web_fetch_tool_result") => {
                                let sources = sources_from_block(block);
                                emit_sources(app, &request.request_id, sources);
                            }
                            _ => {}
                        }

                        if let Some(text) = block.get("text").and_then(Value::as_str) {
                            if !text.is_empty() {
                                let visible = match summary_filter.as_mut() {
                                    Some(filter) => filter.push(text),
                                    None => text.to_string(),
                                };
                                if !visible.is_empty() {
                                    emit_token(app, &request.request_id, &visible);
                                    full_text.push_str(&visible);
                                }
                            }
                        }
                    }
                }
                Some("content_block_delta") => {
                    if let Some(delta) = event.get("delta") {
                        if let Some(thinking) = delta.get("thinking").and_then(Value::as_str) {
                            if !thinking.is_empty() {
                                emit_thinking(app, &request.request_id, thinking);
                            }
                        }

                        if let Some(text) = delta.get("text").and_then(Value::as_str) {
                            if !text.is_empty() {
                                let visible = match summary_filter.as_mut() {
                                    Some(filter) => filter.push(text),
                                    None => text.to_string(),
                                };
                                if !visible.is_empty() {
                                    emit_token(app, &request.request_id, &visible);
                                    full_text.push_str(&visible);
                                }
                            }
                        }
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
                        .unwrap_or("Stream error");
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
        return Err("The response ended unexpectedly.".to_string());
    }
    if let Some(filter) = summary_filter.as_mut() {
        let visible = filter.finish();
        if !visible.is_empty() {
            emit_token(app, &request.request_id, &visible);
            full_text.push_str(&visible);
        }
    }
    if full_text.trim().is_empty() {
        return Ok(Outcome::Empty);
    }

    Ok(Outcome::Completed {
        text: full_text,
        spoken_summary: summary_filter.and_then(|filter| filter.summary()),
    })
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
    let mut messages = full_history(app, request);
    resolve_local_images(app, &request.conversation_id, &mut messages);
    prepare_with(
        &cache,
        &request.conversation_id,
        &messages,
        &request.system_prompt,
        config,
        cancelled,
    )
    .await
}

/// The UI only loads the newest page of messages, but the agent needs the whole conversation.
/// The request's tail is authoritative; older database messages are prepended by id.
fn full_history(app: &AppHandle, request: &SendMessageRequest) -> Vec<ChatMessageInput> {
    let Some(storage) = app.try_state::<Storage>() else {
        return request.messages.clone();
    };
    let stored = match storage.load_all_messages(&request.conversation_id) {
        Ok(messages) => messages,
        Err(error) => {
            log::warn!("Could not load the full conversation for the agent: {error}");
            return request.messages.clone();
        }
    };
    if stored.is_empty() {
        return request.messages.clone();
    }

    if request.messages.iter().all(|message| message.id.is_empty()) {
        return request.messages.clone();
    }

    let first = request.messages.iter().find_map(|message| {
        if message.id.is_empty() {
            return None;
        }
        stored.iter().position(|stored| stored.id == message.id)
    });
    let older = match first {
        Some(index) => &stored[..index],
        None => &stored[..],
    };

    let mut merged = older.iter().map(stored_to_input).collect::<Vec<_>>();
    merged.extend(request.messages.iter().cloned());
    merged
}

fn stored_to_input(message: &StoredMessage) -> ChatMessageInput {
    ChatMessageInput {
        id: message.id.clone(),
        role: message.role.clone(),
        content: message.content.clone(),
        pasted: message
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.get("pasted"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        attachments: message
            .attachments
            .iter()
            .filter_map(|attachment| {
                if let Some(file_id) = attachment
                    .file_id
                    .as_deref()
                    .filter(|file_id| !file_id.is_empty())
                {
                    return Some(ChatAttachmentInput {
                        media_type: attachment.media_type.clone(),
                        data: String::new(),
                        file_id: Some(file_id.to_string()),
                        local_file: None,
                    });
                }
                if let Some(preview) = attachment
                    .preview_name
                    .as_deref()
                    .filter(|preview| !preview.is_empty())
                {
                    return Some(ChatAttachmentInput {
                        media_type: attachment.media_type.clone(),
                        data: String::new(),
                        file_id: None,
                        local_file: Some(preview.to_string()),
                    });
                }
                let (_, data) = attachment.data_url.split_once(";base64,")?;
                Some(ChatAttachmentInput {
                    media_type: attachment.media_type.clone(),
                    data: data.to_string(),
                    file_id: None,
                    local_file: None,
                })
            })
            .collect(),
    }
}

/// New images keep their resized JPEG on disk instead of a data URL in SQLite. Read those files
/// into the request just before building the turns; legacy data URLs are already inline.
fn resolve_local_images(app: &AppHandle, conversation_id: &str, messages: &mut [ChatMessageInput]) {
    for message in messages {
        for attachment in &mut message.attachments {
            if attachment.file_id.is_some()
                || !attachment.media_type.starts_with("image/")
                || !attachment.data.is_empty()
            {
                continue;
            }
            let Some(local_file) = attachment
                .local_file
                .as_deref()
                .filter(|file| !file.is_empty())
            else {
                continue;
            };
            let Ok(path) = attachments::path_for(app, conversation_id, local_file) else {
                log::warn!("Invalid local attachment path {local_file}");
                continue;
            };
            match std::fs::read(path) {
                Ok(bytes) if !bytes.is_empty() => {
                    attachment.data = base64::engine::general_purpose::STANDARD.encode(bytes);
                }
                Ok(_) => log::warn!("Image attachment {local_file} is empty"),
                Err(error) => {
                    log::warn!("Could not read image attachment {local_file}: {error}");
                }
            }
        }
    }
}

async fn prepare_with(
    cache: &SummaryCache,
    conversation_id: &str,
    messages: &[ChatMessageInput],
    system_prompt: &str,
    config: &AgentConfig,
    cancelled: &AtomicBool,
) -> Result<Option<Prepared>, String> {
    // Settings → AI → Prompt; an empty field keeps the built-in Iris instructions.
    let system_prompt = if system_prompt.trim().is_empty() {
        SYSTEM_PROMPT
    } else {
        system_prompt.trim()
    };

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
            attachments: message.attachments.clone(),
        })
        .collect::<Vec<_>>();

    if turns.is_empty() {
        return Err("There is nothing to send yet.".to_string());
    }

    let total_chars = turns.iter().map(|turn| turn.content.len()).sum::<usize>();
    if total_chars <= CONTEXT_BUDGET_CHARS {
        return Ok(Some(Prepared {
            system: system_prompt.to_string(),
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
            system: system_prompt.to_string(),
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

    let client = crate::utils::http::client()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Could not create the AI client: {error}"))?;
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
        system_prompt.to_string()
    } else {
        format!(
            "{system_prompt}\n\nEarlier in this conversation (compressed):\n{summary}\n\n\
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
            _ => {
                let mut blocks = turn
                    .attachments
                    .iter()
                    .filter_map(|attachment| {
                        if let Some(file_id) = attachment
                            .file_id
                            .as_deref()
                            .filter(|file_id| !file_id.is_empty())
                        {
                            return Some(json!({
                                "type": "document",
                                "source": { "type": "file", "file_id": file_id }
                            }));
                        }
                        if attachment.media_type.starts_with("image/")
                            && !attachment.data.is_empty()
                        {
                            return Some(json!({
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": attachment.media_type,
                                    "data": attachment.data
                                }
                            }));
                        }
                        None
                    })
                    .collect::<Vec<_>>();

                if blocks.is_empty() {
                    return json!({
                        "role": "user",
                        "content": turn.content
                    });
                }
                if !turn.content.trim().is_empty() {
                    blocks.push(json!({ "type": "text", "text": turn.content }));
                }

                json!({
                    "role": "user",
                    "content": blocks
                })
            }
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

    let url = crate::core::endpoints::url(&config.base_url, crate::core::endpoints::MESSAGES_PATH);
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
    .map_err(|error| format!("Could not reach the AI service: {error}"))?;

    if !response.status().is_success() {
        return Err(read_error(response).await);
    }

    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Could not read the conversation summary: {error}"))?;
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
        return Err("The model returned an empty summary.".to_string());
    }

    Ok(Some(summary.trim().to_string()))
}

/// Builds the streaming request body for a reply. Thinking is always enabled at the selected
/// effort, web search is always available, and URL reading is added when the newest user message
/// contains a link.
fn build_body(
    mut system: String,
    messages: Vec<Value>,
    config: &AgentConfig,
    read_url: bool,
) -> Value {
    // Automatic read-aloud asks for its summary in the same completion. The block is hidden by
    // `SpokenSummaryFilter`, and short answers are told to skip it.
    if config.auto_speak && config.summarize_speech {
        system.push_str("\n\n");
        system.push_str(read_aloud::SPOKEN_SUMMARY_INSTRUCTION);
    }

    let mut body = json!({
        "model": config.model,
        // Required by the Messages API; omitting it is rejected with a 400.
        "max_tokens": MAX_OUTPUT_TOKENS,
        "system": system,
        "messages": messages,
        "stream": true
    });

    body["thinking"] = json!({ "type": "enabled" });
    let effort = match config.thinking_effort.trim().to_ascii_lowercase().as_str() {
        "high" => "high",
        "max" => "max",
        _ => "low",
    };
    body["output_config"] = json!({ "effort": effort });

    // DeepSeek's own server tools; the model decides whether to search. They cannot be mixed with
    // other server tools, so the legacy `web_search_20250305` is gone.
    let mut tools = vec![json!({
        "type": "deepseek_web_search",
        "name": "deepseek_web_search"
    })];
    if read_url {
        tools.push(json!({ "type": "deepseek_read_url", "name": "deepseek_read_url" }));
    }
    body["tools"] = Value::Array(tools);

    body
}

/// DeepSeek reads links only from the newest user message, so only that message is checked.
fn newest_user_message(messages: &[ChatMessageInput]) -> Option<&str> {
    messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .map(|message| message.content.as_str())
}

/// Presence check for a link, not a URL parser: the service decides which links to read. Bare
/// `www.` links are included because people often paste them without a scheme.
fn contains_url(text: &str) -> bool {
    let lowered = text.to_ascii_lowercase();
    ["https://", "http://", "www."].iter().any(|prefix| {
        lowered.match_indices(prefix).any(|(index, _)| {
            lowered[index + prefix.len()..]
                .chars()
                .next()
                .is_some_and(|next| next.is_ascii_alphanumeric())
        })
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

fn emit_thinking(app: &AppHandle, request_id: &str, token: &str) {
    let _ = app.emit(
        event::CHAT_THINKING,
        ChatThinkingPayload {
            request_id: request_id.to_string(),
            token: token.to_string(),
        },
    );
}

fn emit_sources(app: &AppHandle, request_id: &str, sources: Vec<ChatSource>) {
    if sources.is_empty() {
        return;
    }
    let _ = app.emit(
        event::CHAT_SOURCES,
        ChatSourcesPayload {
            request_id: request_id.to_string(),
            sources,
        },
    );
}

/// Collects the web results carried by a `web_search_tool_result` or `web_fetch_tool_result`
/// block. DeepSeek sends the whole block in one `content_block_start`.
fn sources_from_block(block: &Value) -> Vec<ChatSource> {
    let Some(content) = block.get("content") else {
        return Vec::new();
    };
    let entries: Vec<&Value> = match content {
        Value::Array(items) => items.iter().collect(),
        Value::Object(_) => vec![content],
        _ => return Vec::new(),
    };

    entries.into_iter().filter_map(source_from_value).collect()
}

fn source_from_value(value: &Value) -> Option<ChatSource> {
    if value
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| kind.ends_with("_error"))
    {
        return None;
    }

    let url = value.get("url").and_then(Value::as_str)?.trim();
    if url.is_empty() {
        return None;
    }
    let title = optional_string(value, "title").unwrap_or_else(|| url.to_string());

    Some(ChatSource {
        title,
        url: url.to_string(),
        snippet: optional_string(value, "snippet"),
        site_name: optional_string(value, "site_name"),
        site_icon: optional_string(value, "site_icon"),
        page_age: optional_string(value, "page_age"),
    })
}

fn optional_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
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
    format!("AI service error ({status}): {message}")
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
        build_body, chunk_end, contains_url, document_count, newest_user_message, prepare_with,
        sources_from_block, split_index, stored_to_input, to_api_messages, trim_to_user,
        AgentConfig, SummaryCache, Turn, RECENT_BUDGET_CHARS,
    };
    use crate::core::storage::{StoredAttachment, StoredMessage};
    use crate::tauri_commands::chat::{ChatAttachmentInput, ChatMessageInput};
    use serde_json::json;

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
            id: format!("{role}-{tag}"),
            role: role.to_string(),
            content,
            attachments: Vec::new(),
            pasted: false,
        }
    }

    #[test]
    fn stored_documents_reuse_the_files_api_id() {
        let message = StoredMessage {
            id: "m1".to_string(),
            role: "user".to_string(),
            content: "Summarize this.".to_string(),
            created_at: 1,
            status: "complete".to_string(),
            error: None,
            metadata: None,
            attachments: vec![
                StoredAttachment {
                    id: "doc".to_string(),
                    name: "report.pdf".to_string(),
                    media_type: "application/pdf".to_string(),
                    data_url: String::new(),
                    file_name: Some("doc-report.pdf".to_string()),
                    preview_name: None,
                    file_id: Some("file-api-123".to_string()),
                    purpose: Some("rich_layout_recognition".to_string()),
                    size: Some(42),
                },
                StoredAttachment {
                    id: "image".to_string(),
                    name: "screen.jpg".to_string(),
                    media_type: "image/jpeg".to_string(),
                    data_url: "data:image/jpeg;base64,abc".to_string(),
                    file_name: None,
                    preview_name: None,
                    file_id: None,
                    purpose: None,
                    size: None,
                },
                StoredAttachment {
                    id: "local-image".to_string(),
                    name: "photo.png".to_string(),
                    media_type: "image/jpeg".to_string(),
                    data_url: String::new(),
                    file_name: Some("local-image-original.png".to_string()),
                    preview_name: Some("local-image-preview.jpg".to_string()),
                    file_id: None,
                    purpose: None,
                    size: Some(10),
                },
            ],
        };

        let input = stored_to_input(&message);
        assert_eq!(input.attachments.len(), 3);
        assert_eq!(
            input.attachments[0].file_id.as_deref(),
            Some("file-api-123")
        );
        assert!(input.attachments[0].data.is_empty());
        assert_eq!(input.attachments[1].data, "abc");
        assert!(input.attachments[1].file_id.is_none());
        assert_eq!(
            input.attachments[2].local_file.as_deref(),
            Some("local-image-preview.jpg")
        );
        assert!(input.attachments[2].data.is_empty());
    }

    #[test]
    fn user_documents_become_file_blocks() {
        let turn = Turn {
            role: "user".to_string(),
            content: "Summarize this.".to_string(),
            attachments: vec![ChatAttachmentInput {
                media_type: "application/pdf".to_string(),
                data: String::new(),
                file_id: Some("file-api-123".to_string()),
                local_file: None,
            }],
        };

        let messages = to_api_messages(&[turn]);
        let blocks = messages[0]["content"].as_array().unwrap();
        assert_eq!(blocks[0]["type"], "document");
        assert_eq!(blocks[0]["source"]["type"], "file");
        assert_eq!(blocks[0]["source"]["file_id"], "file-api-123");
        assert_eq!(blocks[1]["type"], "text");
        assert_eq!(document_count(&messages), 1);
    }

    #[test]
    fn inline_images_do_not_require_the_files_beta() {
        let turn = Turn {
            role: "user".to_string(),
            content: "What is this?".to_string(),
            attachments: vec![ChatAttachmentInput {
                media_type: "image/jpeg".to_string(),
                data: "abc".to_string(),
                file_id: None,
                local_file: None,
            }],
        };
        let messages = to_api_messages(&[turn]);
        assert_eq!(document_count(&messages), 0);
    }

    #[test]
    fn user_images_become_content_blocks() {
        let turn = Turn {
            role: "user".to_string(),
            content: "What is this?".to_string(),
            attachments: vec![ChatAttachmentInput {
                media_type: "image/jpeg".to_string(),
                data: "abc".to_string(),
                file_id: None,
                local_file: None,
            }],
        };

        let messages = to_api_messages(&[turn]);
        let blocks = messages[0]["content"].as_array().unwrap();
        assert_eq!(blocks[0]["type"], "image");
        assert_eq!(blocks[0]["source"]["media_type"], "image/jpeg");
        assert_eq!(blocks[0]["source"]["data"], "abc");
        assert_eq!(blocks[1]["type"], "text");
    }

    #[test]
    fn thinking_effort_and_web_search_shape_the_request() {
        let mut config = AgentConfig {
            api_key: "test-key".to_string(),
            base_url: "http://127.0.0.1".to_string(),
            model: "deepseek-flash".to_string(),
            auto_speak: false,
            summarize_speech: false,
            thinking_effort: "low".to_string(),
            memory_enabled: false,
            tts_voice: "stella".to_string(),
            tts_url: String::new(),
        };

        let body = build_body("system".to_string(), vec![], &config, false);
        assert_eq!(body["thinking"]["type"], "enabled");
        assert_eq!(body["output_config"]["effort"], "low");
        let tools = body["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "deepseek_web_search");

        config.thinking_effort = "high".to_string();
        assert_eq!(
            build_body("system".to_string(), vec![], &config, false)["output_config"]["effort"],
            "high"
        );
        config.thinking_effort = "max".to_string();
        assert_eq!(
            build_body("system".to_string(), vec![], &config, false)["output_config"]["effort"],
            "max"
        );
        // Unknown legacy values fall back to the low default instead of reaching the API.
        config.thinking_effort = "adaptive".to_string();
        assert_eq!(
            build_body("system".to_string(), vec![], &config, false)["output_config"]["effort"],
            "low"
        );
    }

    #[test]
    fn links_add_url_reading_to_the_always_available_search_tool() {
        let config = AgentConfig {
            api_key: "test-key".to_string(),
            base_url: "http://127.0.0.1".to_string(),
            model: "deepseek-flash".to_string(),
            auto_speak: false,
            summarize_speech: false,
            thinking_effort: "low".to_string(),
            memory_enabled: false,
            tts_voice: "stella".to_string(),
            tts_url: String::new(),
        };

        assert!(contains_url("Read https://example.com/a?b=1 for me."));
        assert!(contains_url("Try WWW.Example.com"));
        assert!(!contains_url("There is no link here."));
        assert!(!contains_url("https://"));

        let no_link = build_body("system".to_string(), vec![], &config, false);
        let tools = no_link["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], "deepseek_web_search");

        let with_link = build_body("system".to_string(), vec![], &config, true);
        let tools = with_link["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0]["name"], "deepseek_web_search");
        assert_eq!(tools[1]["name"], "deepseek_read_url");
    }

    #[test]
    fn web_search_blocks_become_sources() {
        let block = json!({
            "type": "web_search_tool_result",
            "content": [
                {
                    "type": "web_search_result",
                    "title": "DeepSeek",
                    "url": "https://www.deepseek.com/",
                    "snippet": "The official site.",
                    "site_name": "DeepSeek",
                    "site_icon": null,
                    "page_age": "2026-11-23T00:00:00Z"
                },
                {
                    "type": "web_search_tool_result_error",
                    "error_code": "unavailable"
                }
            ]
        });

        let sources = sources_from_block(&block);
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].title, "DeepSeek");
        assert_eq!(sources[0].url, "https://www.deepseek.com/");
        assert_eq!(sources[0].snippet.as_deref(), Some("The official site."));
        assert_eq!(sources[0].site_name.as_deref(), Some("DeepSeek"));
        assert_eq!(sources[0].page_age.as_deref(), Some("2026-11-23T00:00:00Z"));
    }

    #[test]
    fn only_the_newest_user_message_is_checked_for_links() {
        let messages = vec![
            ChatMessageInput {
                id: "m1".to_string(),
                role: "user".to_string(),
                content: "https://example.com".to_string(),
                attachments: Vec::new(),
                pasted: false,
            },
            ChatMessageInput {
                id: "m2".to_string(),
                role: "assistant".to_string(),
                content: "I read it.".to_string(),
                attachments: Vec::new(),
                pasted: false,
            },
            ChatMessageInput {
                id: "m3".to_string(),
                role: "user".to_string(),
                content: "And what about this?".to_string(),
                attachments: Vec::new(),
                pasted: false,
            },
        ];

        assert_eq!(newest_user_message(&messages), Some("And what about this?"));
        assert!(!newest_user_message(&messages).is_some_and(contains_url));
    }

    #[tokio::test]
    async fn uses_the_custom_system_prompt() {
        let cache = SummaryCache::default();
        let config = AgentConfig {
            api_key: "test-key".to_string(),
            base_url: "http://127.0.0.1".to_string(),
            model: "deepseek-flash".to_string(),
            auto_speak: false,
            summarize_speech: false,
            thinking_effort: "low".to_string(),
            memory_enabled: false,
            tts_voice: "stella".to_string(),
            tts_url: String::new(),
        };
        let cancelled = AtomicBool::new(false);
        let messages = vec![turn("user", "hello")];

        let prepared = prepare_with(
            &cache,
            "conversation",
            &messages,
            "You are a pirate. Answer briefly.",
            &config,
            &cancelled,
        )
        .await
        .expect("preparation")
        .expect("request");

        assert_eq!(prepared.system, "You are a pirate. Answer briefly.");
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
            summarize_speech: false,
            thinking_effort: "low".to_string(),
            memory_enabled: false,
            tts_voice: "stella".to_string(),
            tts_url: String::new(),
        };
        let cancelled = AtomicBool::new(false);

        let mut messages = vec![
            turn("user", "alpha"),
            turn("assistant", "beta"),
            turn("user", "gamma"),
            turn("assistant", "delta"),
        ];
        let first = prepare_with(&cache, "conversation", &messages, "", &config, &cancelled)
            .await
            .expect("first preparation")
            .expect("first request");
        assert!(first.system.contains("summary-1"));
        assert_eq!(first.messages.len(), 2);
        assert_eq!(first.messages[0]["role"], "user");

        messages.push(turn("user", "epsilon"));
        messages.push(turn("assistant", "zeta"));
        let second = prepare_with(&cache, "conversation", &messages, "", &config, &cancelled)
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
                attachments: Vec::new(),
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

#[cfg(test)]
mod format_tests {
    use super::*;

    fn config() -> AgentConfig {
        AgentConfig {
            api_key: "k".to_string(),
            base_url: "https://example.test".to_string(),
            model: "m".to_string(),
            auto_speak: false,
            summarize_speech: false,
            thinking_effort: "high".to_string(),
            memory_enabled: false,
            tts_voice: "stella".to_string(),
            tts_url: String::new(),
        }
    }

    /// The reply body uses the Messages API shape, always enables thinking, and always offers
    /// web search.
    #[test]
    fn the_body_uses_the_messages_shape() {
        let body = build_body("sys".to_string(), vec![], &config(), false);
        assert_eq!(body["system"], "sys");
        // Required by the Messages API.
        assert_eq!(body["max_tokens"], MAX_OUTPUT_TOKENS);
        assert_eq!(body["thinking"]["type"], "enabled");
        assert_eq!(body["output_config"]["effort"], "high");
        assert_eq!(body["tools"][0]["name"], "deepseek_web_search");
        assert!(body.get("reasoning_effort").is_none());
    }

    /// Unknown effort strings from old settings never reach the API.
    #[test]
    fn the_body_falls_back_to_low_for_an_unknown_effort() {
        let mut config = config();
        config.thinking_effort = "adaptive".to_string();

        let body = build_body("sys".to_string(), vec![], &config, false);
        assert_eq!(body["thinking"]["type"], "enabled");
        assert_eq!(body["output_config"]["effort"], "low");
        assert_eq!(body["max_tokens"], MAX_OUTPUT_TOKENS);
    }

    /// Automatic read-aloud asks for its spoken summary in the same completion.
    #[test]
    fn the_body_requests_an_in_band_summary_only_when_read_aloud_summarizes() {
        let mut on = config();
        on.auto_speak = true;
        on.summarize_speech = true;

        let body = build_body("sys".to_string(), vec![], &on, false);
        let system = body["system"].as_str().expect("system prompt");
        assert!(system.starts_with("sys"));
        assert!(system.contains("<spoken_summary>"));
        assert!(system.contains("</spoken_summary>"));

        on.summarize_speech = false;
        let body = build_body("sys".to_string(), vec![], &on, false);
        assert!(!body["system"]
            .as_str()
            .unwrap()
            .contains("<spoken_summary>"));

        on.auto_speak = false;
        on.summarize_speech = true;
        let body = build_body("sys".to_string(), vec![], &on, false);
        assert!(!body["system"]
            .as_str()
            .unwrap()
            .contains("<spoken_summary>"));
    }
}

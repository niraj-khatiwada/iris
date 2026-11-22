//! Persistent memory: a small, auto-learned store of durable facts and preferences.
//!
//! The memory writer runs after a reply has been idle for a moment. It sees the latest typed
//! exchange plus the current memories, and returns only additions or corrections. Validation and
//! sensitive-data filtering happen here in Rust, not in the prompt, so a model mistake cannot put
//! a password or a payment amount into the store.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::core::agent::AgentConfig;
use crate::core::endpoints;
use crate::core::storage::{MemoryWrite, Storage, StoredMemory};
use crate::tauri_commands::chat::ChatMessageInput;
use crate::utils::event;

/// Wait for the conversation to settle before spending a model call on memory extraction.
const MEMORY_IDLE_SECS: u64 = 20;
/// The extractor only needs the newest exchange, not the whole conversation.
const MAX_TRANSCRIPT_TURNS: usize = 6;
const MAX_TURN_CHARS: usize = 2_000;
const MAX_TRANSCRIPT_CHARS: usize = 8_000;
/// A memory is one short sentence, not a paragraph.
const MAX_MEMORY_CHARS: usize = 180;
/// At most this many new memories are accepted from one extraction.
const MAX_MEMORIES_PER_BATCH: usize = 3;
/// How many existing memories the extractor may see when looking for corrections.
const MAX_EXISTING_MEMORIES: usize = 50;
/// How many memories are injected into a request.
const MAX_INJECTED_MEMORIES: usize = 30;
/// The injected block is deliberately small so it never crowds out conversation context.
const MAX_MEMORY_BLOCK_CHARS: usize = 1_500;

const MEMORY_SYSTEM_PROMPT: &str = "\
You maintain long-term memory for Iris, a personal desktop assistant. \
Extract only durable, reusable facts about the user from the conversation excerpt. \
Good memories are stable preferences, communication style, role, ongoing projects, tools, \
timezone, names of people or pets the user introduces, and standing instructions. \
Only store facts the user stated about themselves or clearly confirmed. Do not turn a question, \
a hypothetical, or the assistant's suggestion into a memory. \
Do not store one-off tasks, temporary context, or anything already covered by the existing \
memories unless it needs correcting.

Never store sensitive information, including passwords, API keys, tokens, financial or bank \
details, payment amounts, government IDs, health or medical information, immigration or criminal \
history, religion, politics, ethnicity, gender identity, sexual orientation, or exact home \
addresses. Never store clipboard selections, screenshots, or attachments; those \
are excluded before you see the conversation.

Return JSON only, with this shape:
{\"memories\":[{\"action\":\"add\",\"content\":\"...\"},{\"action\":\"update\",\"id\":\"...\",\"content\":\"...\"}]}

Rules:
- Write each memory as a short third-person statement under 160 characters.
- Use \"add\" for a new durable fact.
- Use \"update\" only when a fact contradicts an existing memory; include that memory's id.
- Do not duplicate an existing memory.
- Return {\"memories\":[]} when nothing should change.
- At most three memories per response.";

/// One eligible turn shown to the memory writer. Selection prompts and attachment content never
/// reach this struct; pasted text is allowed.
#[derive(Clone, Debug)]
struct MemoryTurn {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct MemoryResponse {
    #[serde(default)]
    memories: Vec<MemoryCandidate>,
}

#[derive(Deserialize)]
struct MemoryCandidate {
    #[serde(default)]
    action: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    content: String,
}

/// Per-conversation epochs make a newer reply cancel a memory run that is still waiting for idle.
#[derive(Default)]
pub struct MemoryState {
    epochs: Mutex<HashMap<String, u64>>,
    last_turn: Mutex<HashMap<String, u64>>,
    generation: AtomicU64,
}

impl MemoryState {
    /// Claims a conversation turn for extraction. The fingerprint includes the user message id
    /// and content, so editing and resending the same id can still trigger a fresh run.
    fn claim(&self, conversation_id: &str, fingerprint: u64) -> bool {
        let mut last_turn = self
            .last_turn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if last_turn.get(conversation_id).copied() == Some(fingerprint) {
            return false;
        }
        // Conversations are unbounded; drop stale entries rather than grow without limit.
        if last_turn.len() >= 128 && !last_turn.contains_key(conversation_id) {
            last_turn.clear();
        }
        last_turn.insert(conversation_id.to_string(), fingerprint);
        true
    }

    fn begin(&self, conversation_id: &str) -> u64 {
        let mut epochs = self
            .epochs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if epochs.len() >= 128 && !epochs.contains_key(conversation_id) {
            epochs.clear();
        }
        let epoch = epochs.get(conversation_id).copied().unwrap_or(0) + 1;
        epochs.insert(conversation_id.to_string(), epoch);
        epoch
    }

    fn is_current(&self, conversation_id: &str, epoch: u64) -> bool {
        self.epochs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(conversation_id)
            .copied()
            == Some(epoch)
    }

    fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Invalidates every pending run, e.g. when Reset Iris wipes the database.
    pub fn cancel_all(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.epochs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
        self.last_turn
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
    }
}

/// Schedules one background memory extraction after the reply has been idle.
///
/// A selection prompt or an attached file excludes the run entirely. Pasted text is allowed;
/// the sensitive-data filter still applies to whatever the writer proposes.
pub fn schedule(
    app: AppHandle,
    config: AgentConfig,
    conversation_id: String,
    messages: &[ChatMessageInput],
    assistant_text: String,
) {
    if !config.memory_enabled {
        return;
    }

    let Some(last_user) = messages.iter().rev().find(|message| message.role == "user") else {
        return;
    };
    if !eligible_user(last_user) || last_user.id.is_empty() {
        return;
    }

    let turns = transcript(messages, &assistant_text);
    if turns.is_empty() {
        return;
    }

    let fingerprint = fingerprint(last_user);
    let source_message_id = last_user.id.clone();
    let state = app.state::<MemoryState>();
    if !state.claim(&conversation_id, fingerprint) {
        return;
    }
    let epoch = state.begin(&conversation_id);
    let generation = state.generation();

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(MEMORY_IDLE_SECS)).await;
        {
            let state = app.state::<MemoryState>();
            if state.generation() != generation || !state.is_current(&conversation_id, epoch) {
                return;
            }
        }

        if let Err(error) = extract(
            app.clone(),
            &config,
            &conversation_id,
            Some(&source_message_id),
            &turns,
            generation,
        )
        .await
        {
            log::warn!("Could not update persistent memory: {error}");
        }
    });
}

fn fingerprint(message: &ChatMessageInput) -> u64 {
    let mut hasher = DefaultHasher::new();
    message.id.hash(&mut hasher);
    message.content.hash(&mut hasher);
    message.pasted.hash(&mut hasher);
    message.attachments.len().hash(&mut hasher);
    hasher.finish()
}

/// Appends the active memory block to a system prompt. A storage failure leaves the request intact.
pub fn inject(app: &AppHandle, system: String) -> String {
    let Some(storage) = app.try_state::<Storage>() else {
        return system;
    };
    let memories = match storage.active_memories(MAX_INJECTED_MEMORIES) {
        Ok(memories) => memories,
        Err(error) => {
            log::warn!("Could not read persistent memory: {error}");
            return system;
        }
    };

    let block = format_memory_block(&memories);
    if block.is_empty() {
        system
    } else {
        format!("{system}\n\n{block}")
    }
}

async fn extract(
    app: AppHandle,
    config: &AgentConfig,
    conversation_id: &str,
    source_message_id: Option<&str>,
    turns: &[MemoryTurn],
    generation: u64,
) -> Result<(), String> {
    if config.base_url.trim().is_empty() {
        return Err("Add an API base URL in Settings.".to_string());
    }

    let existing = {
        let storage = app
            .try_state::<Storage>()
            .ok_or_else(|| "Persistent memory is not available yet.".to_string())?;
        storage
            .list_memories()?
            .into_iter()
            .take(MAX_EXISTING_MEMORIES)
            .collect::<Vec<_>>()
    };

    let prompt = extraction_prompt(&existing, turns);
    let client = crate::utils::http::client()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|error| format!("Could not create the memory client: {error}"))?;

    let response = client
        .post(endpoints::url(&config.base_url, endpoints::MESSAGES_PATH))
        .header("x-api-key", &config.api_key)
        .header("accept", "application/json")
        .json(&json!({
            "model": config.model,
            "max_tokens": 500,
            "system": MEMORY_SYSTEM_PROMPT,
            "messages": [{ "role": "user", "content": prompt }],
            "thinking": { "type": "disabled" },
            "stream": false
        }))
        .send()
        .await
        .map_err(|error| format!("Could not reach the memory service: {error}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail = error_detail(&body);
        return Err(format!("Memory extraction failed ({status}): {detail}"));
    }

    let value: Value = serde_json::from_str(&body)
        .map_err(|error| format!("The memory service returned an unexpected response: {error}"))?;
    let raw = value
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

    let candidates = parse_candidates(&raw)?;
    let writes = validate_candidates(&existing, candidates);
    if writes.is_empty() {
        return Ok(());
    }

    // Reset Iris may have wiped the database while the model call was in flight.
    {
        let state = app.state::<MemoryState>();
        if state.generation() != generation {
            return Ok(());
        }
    }

    let batch_id = uuid::Uuid::new_v4().to_string();
    let applied = {
        let storage = app
            .try_state::<Storage>()
            .ok_or_else(|| "Persistent memory is not available yet.".to_string())?;
        storage.apply_memories(&batch_id, conversation_id, source_message_id, &writes)?
    };

    if applied > 0 {
        log::info!("Learned {applied} persistent memories from conversation {conversation_id}");
        let _ = app.emit(event::MEMORY_CHANGED, ());
    }
    Ok(())
}

fn extraction_prompt(existing: &[StoredMemory], turns: &[MemoryTurn]) -> String {
    let existing = existing
        .iter()
        .map(|memory| json!({ "id": memory.id, "content": memory.content }))
        .collect::<Vec<_>>();
    let existing = serde_json::to_string(&existing).unwrap_or_else(|_| "[]".to_string());
    let transcript = turns
        .iter()
        .map(|turn| {
            let speaker = if turn.role == "user" { "User" } else { "Iris" };
            format!("{speaker}: {}", turn.content)
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        "Existing memories:\n{existing}\n\nConversation excerpt:\n\n{transcript}\n\n\
         Return only the JSON object."
    )
}

/// Keeps user turns and the assistant replies that follow them. Selection prompts and messages
/// with attachments are skipped; pasted text is included.
fn transcript(messages: &[ChatMessageInput], assistant_text: &str) -> Vec<MemoryTurn> {
    let mut turns = Vec::new();
    let mut include_assistant = false;

    for message in messages {
        match message.role.as_str() {
            "user" => {
                include_assistant = eligible_user(message);
                if include_assistant {
                    turns.push(MemoryTurn {
                        role: "user".to_string(),
                        content: clip(&message.content, MAX_TURN_CHARS),
                    });
                }
            }
            "assistant" if include_assistant => {
                if !message.content.trim().is_empty() {
                    turns.push(MemoryTurn {
                        role: "assistant".to_string(),
                        content: clip(&message.content, MAX_TURN_CHARS),
                    });
                }
                include_assistant = false;
            }
            _ => {}
        }
    }

    if include_assistant && !assistant_text.trim().is_empty() {
        turns.push(MemoryTurn {
            role: "assistant".to_string(),
            content: clip(assistant_text, MAX_TURN_CHARS),
        });
    }

    if turns.len() > MAX_TRANSCRIPT_TURNS {
        turns = turns.split_off(turns.len() - MAX_TRANSCRIPT_TURNS);
    }

    let mut used = 0;
    let mut kept = Vec::new();
    for turn in turns.into_iter().rev() {
        if used + turn.content.chars().count() > MAX_TRANSCRIPT_CHARS {
            break;
        }
        used += turn.content.chars().count();
        kept.push(turn);
    }
    kept.reverse();

    if kept.iter().any(|turn| turn.role == "user")
        && kept.iter().any(|turn| turn.role == "assistant")
    {
        kept
    } else {
        Vec::new()
    }
}

fn eligible_user(message: &ChatMessageInput) -> bool {
    message.attachments.is_empty()
        && !message.content.contains("<selected_text>")
        && !message.content.trim().is_empty()
}

fn parse_candidates(raw: &str) -> Result<Vec<MemoryCandidate>, String> {
    let start = raw
        .find('{')
        .ok_or_else(|| "The memory service returned no JSON object.".to_string())?;
    let end = raw
        .rfind('}')
        .ok_or_else(|| "The memory service returned incomplete JSON.".to_string())?;
    if end <= start {
        return Err("The memory service returned incomplete JSON.".to_string());
    }
    let value: Value = serde_json::from_str(&raw[start..=end])
        .map_err(|error| format!("The memory service returned invalid JSON: {error}"))?;
    let response: MemoryResponse = serde_json::from_value(value)
        .map_err(|error| format!("The memory service returned an unexpected shape: {error}"))?;
    Ok(response.memories)
}

/// Validates model output before it can touch the database. Invalid or sensitive candidates are
/// dropped silently; a model mistake must never make the chat fail.
fn validate_candidates(
    existing: &[StoredMemory],
    candidates: Vec<MemoryCandidate>,
) -> Vec<MemoryWrite> {
    let mut writes = Vec::new();
    let mut seen = existing
        .iter()
        .map(|memory| normalize_content(&memory.content))
        .collect::<Vec<_>>();

    for candidate in candidates.into_iter().take(MAX_MEMORIES_PER_BATCH) {
        let content = normalize_content(&candidate.content);
        if content.is_empty()
            || content.chars().count() > MAX_MEMORY_CHARS
            || is_sensitive(&content)
            || seen.iter().any(|previous| previous == &content)
        {
            continue;
        }

        let replace = match candidate.action.as_str() {
            "add" => None,
            "update" => {
                let id = candidate.id.as_deref().unwrap_or_default();
                if !existing
                    .iter()
                    .any(|memory| memory.id == id && !memory.user_edited)
                {
                    // An update must point at a current, automatically managed memory. A stale or
                    // user-edited id is ignored rather than turned into a duplicate add.
                    continue;
                }
                Some(id.to_string())
            }
            _ => continue,
        };

        // An update that repeats the old text is a no-op.
        if let Some(id) = replace.as_deref() {
            if let Some(previous) = existing.iter().find(|memory| memory.id == id) {
                if normalize_content(&previous.content) == content {
                    continue;
                }
            }
        }

        seen.push(content.clone());
        writes.push(MemoryWrite { replace, content });
    }

    writes
}

fn normalize_content(content: &str) -> String {
    content
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|character: char| {
            matches!(character, '"' | '\'' | '`' | '“' | '”' | '‘' | '’')
        })
        .to_string()
}

/// Shared validation for a memory edited in Settings. Rejects the same sensitive categories as
/// automatic extraction so a manual correction cannot bypass the privacy rules.
pub fn validate_manual_memory(content: &str) -> Result<String, String> {
    let content = normalize_content(content);
    if content.is_empty() {
        return Err("A memory needs some text.".to_string());
    }
    if content.chars().count() > MAX_MEMORY_CHARS {
        return Err(format!(
            "Keep a memory under {MAX_MEMORY_CHARS} characters."
        ));
    }
    if is_sensitive(&content) {
        return Err("That looks sensitive, so Iris will not store it.".to_string());
    }
    Ok(content)
}

/// Sensitive facts are dropped entirely. There is intentionally no "store but hide" state.
fn is_sensitive(content: &str) -> bool {
    let lower = content.to_lowercase();

    const TERMS: &[&str] = &[
        "password",
        "passcode",
        "api key",
        "apikey",
        "secret key",
        "private key",
        "access token",
        "refresh token",
        "recovery code",
        "one-time code",
        "2fa",
        "social security",
        "ssn",
        "passport",
        "driver's license",
        "drivers license",
        "government id",
        "bank account",
        "routing number",
        "account number",
        "card number",
        "credit card",
        "debit card",
        "cvv",
        "iban",
        "swift code",
        "car payment",
        "mortgage",
        "rent payment",
        "salary",
        "income",
        "debt",
        "loan",
        "medical",
        "diagnosis",
        "medication",
        "prescription",
        "therapy",
        "hospital",
        "cancer",
        "hiv",
        "depression",
        "anxiety",
        "religion",
        "religious",
        "christian",
        "muslim",
        "hindu",
        "jewish",
        "buddhist",
        "politics",
        "political",
        "democrat",
        "republican",
        "ethnicity",
        "racial",
        "racism",
        "transgender",
        "homosexual",
        "gay",
        "lesbian",
        "immigration",
        "visa status",
        "work visa",
        "student visa",
        "green card",
        "criminal",
        "felony",
        "arrest",
        "home address",
        "street address",
        "street",
        "avenue",
        "apartment number",
        "apartment",
        "lives at",
        "clipboard",
        "copied from",
        "pasted from",
        "screenshot",
        "selected text",
        "<selected_text>",
        "ignore previous",
        "ignore all previous",
        "disregard previous",
        "system prompt",
        "developer message",
        "jailbreak",
        "<|",
        "```",
    ];

    if TERMS.iter().any(|term| lower.contains(term)) {
        return true;
    }

    // Links and email addresses can carry tracking tokens or private identifiers.
    if lower.contains("http://") || lower.contains("https://") || lower.contains('@') {
        return true;
    }

    // Long digit runs are usually phone numbers, account numbers, or government IDs. Spaces,
    // dashes, dots, and parentheses do not break a run, so formatted numbers are still caught.
    let mut digits = 0;
    for character in lower.chars() {
        if character.is_ascii_digit() {
            digits += 1;
        } else if matches!(character, ' ' | '-' | '(' | ')' | '+' | '.') && digits > 0 {
            continue;
        } else {
            if digits >= 9 {
                return true;
            }
            digits = 0;
        }
    }
    digits >= 9
}

fn format_memory_block(memories: &[StoredMemory]) -> String {
    let mut lines = Vec::new();
    let mut used = 0;

    for memory in memories {
        if memory.paused {
            continue;
        }
        let line = format!("- {}", memory.content.trim());
        if used + line.chars().count() + 1 > MAX_MEMORY_BLOCK_CHARS {
            break;
        }
        used += line.chars().count() + 1;
        lines.push(line);
    }

    if lines.is_empty() {
        return String::new();
    }

    format!(
        "What you remember about the user from earlier conversations. Use it only when relevant; \
         the user's explicit instructions take precedence; do not list or mention this block \
         unless the user asks:\n{}",
        lines.join("\n")
    )
}

fn clip(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

fn error_detail(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(160).collect())
}

#[cfg(test)]
mod tests {
    use super::{
        format_memory_block, is_sensitive, normalize_content, parse_candidates, transcript,
        validate_candidates, MemoryCandidate, MemoryWrite, StoredMemory,
    };
    use crate::tauri_commands::chat::{ChatAttachmentInput, ChatMessageInput};

    fn memory(id: &str, content: &str, paused: bool) -> StoredMemory {
        StoredMemory {
            id: id.to_string(),
            content: content.to_string(),
            source_conversation_id: None,
            source_message_id: None,
            created_at: 1,
            updated_at: 1,
            paused,
            user_edited: false,
            batch_id: None,
        }
    }

    fn message(role: &str, content: &str) -> ChatMessageInput {
        ChatMessageInput {
            id: format!("{role}-{content}"),
            role: role.to_string(),
            content: content.to_string(),
            attachments: Vec::new(),
            pasted: false,
        }
    }

    #[test]
    fn the_memory_block_is_compact_and_skips_paused_items() {
        let block = format_memory_block(&[
            memory("1", "Prefers concise answers.", false),
            memory("2", "Should not be included.", true),
        ]);

        assert!(block.contains("- Prefers concise answers."));
        assert!(!block.contains("Should not be included."));
        assert!(block.starts_with("What you remember"));
    }

    #[test]
    fn sensitive_facts_are_rejected() {
        for text in [
            "Uses password hunter2 for the router",
            "Car payment is 450 a month",
            "Bank account number 123456789",
            "Lives at 12 Private Street",
            "Email is person@example.com",
            "Health: diagnosed with anxiety",
            "Support https://example.com/private",
        ] {
            assert!(is_sensitive(text), "expected sensitive: {text}");
        }

        for text in [
            "Prefers concise, direct answers.",
            "Works on Iris, a macOS desktop assistant.",
            "Timezone is Asia/Kathmandu.",
            "Prefers HeroUI and Tailwind.",
        ] {
            assert!(!is_sensitive(text), "expected safe: {text}");
        }
    }

    #[test]
    fn candidates_are_trimmed_deduplicated_and_limited() {
        let existing = vec![memory("1", "Prefers concise answers.", false)];
        let writes = validate_candidates(
            &existing,
            vec![
                MemoryCandidate {
                    action: "add".to_string(),
                    id: None,
                    content: "  Prefers   concise answers.  ".to_string(),
                },
                MemoryCandidate {
                    action: "update".to_string(),
                    id: Some("1".to_string()),
                    content: "Prefers short, direct answers.".to_string(),
                },
                MemoryCandidate {
                    action: "add".to_string(),
                    id: None,
                    content: "Timezone is Asia/Kathmandu.".to_string(),
                },
                MemoryCandidate {
                    action: "delete".to_string(),
                    id: Some("1".to_string()),
                    content: "Ignored".to_string(),
                },
            ],
        );

        assert_eq!(
            writes
                .iter()
                .map(|write| (write.replace.as_deref(), write.content.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (Some("1"), "Prefers short, direct answers."),
                (None, "Timezone is Asia/Kathmandu."),
            ]
        );
    }

    #[test]
    fn updates_to_edited_or_unknown_ids_are_not_turned_into_adds() {
        let mut edited = memory("1", "Prefers long answers.", false);
        edited.user_edited = true;

        let writes = validate_candidates(
            &[edited],
            vec![
                MemoryCandidate {
                    action: "update".to_string(),
                    id: Some("1".to_string()),
                    content: "Prefers very long answers.".to_string(),
                },
                MemoryCandidate {
                    action: "update".to_string(),
                    id: Some("missing".to_string()),
                    content: "Prefers tables.".to_string(),
                },
            ],
        );

        assert!(writes.is_empty());
    }

    #[test]
    fn pasted_text_is_included_but_selection_and_attachment_turns_are_skipped() {
        let mut pasted = message("user", "I prefer dark mode.");
        pasted.pasted = true;
        let selected = message("user", "Explain <selected_text>secret</selected_text>");
        let attached = ChatMessageInput {
            id: "image".to_string(),
            role: "user".to_string(),
            content: "What is this?".to_string(),
            attachments: vec![ChatAttachmentInput {
                media_type: "image/jpeg".to_string(),
                data: "abc".to_string(),
                file_id: None,
                local_file: None,
            }],
            pasted: false,
        };

        let turns = transcript(
            &[
                pasted,
                selected,
                attached,
                message("user", "I prefer concise answers."),
            ],
            "Understood.",
        );

        assert_eq!(turns.len(), 3);
        assert_eq!(turns[0].content, "I prefer dark mode.");
        assert_eq!(turns[1].content, "I prefer concise answers.");
        assert_eq!(turns[2].content, "Understood.");
    }

    #[test]
    fn json_wrapped_in_prose_is_accepted() {
        let candidates = parse_candidates(
            "Here is the result:\n```json\n{\"memories\":[{\"action\":\"add\",\"content\":\"Likes tea.\"}]}\n```",
        )
        .expect("parse");

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].content, "Likes tea.");
    }

    #[test]
    fn invalid_json_is_an_error_not_a_panic() {
        assert!(parse_candidates("no json here").is_err());
        assert!(parse_candidates("{\"memories\":").is_err());
    }

    #[test]
    fn normalized_content_collapses_whitespace() {
        assert_eq!(
            normalize_content("  “One   two.”\nThree.  "),
            "One two.” Three."
        );
    }

    #[test]
    fn writes_are_a_small_public_shape() {
        let write = MemoryWrite {
            replace: None,
            content: "Likes tea.".to_string(),
        };
        assert_eq!(write.content, "Likes tea.");
    }

    #[test]
    fn manual_edits_use_the_same_sensitive_filter() {
        assert_eq!(
            super::validate_manual_memory("  Prefers   tea. ").expect("safe"),
            "Prefers tea."
        );
        assert!(super::validate_manual_memory("Car payment is 450 a month").is_err());
        assert!(super::validate_manual_memory("").is_err());
    }

    #[test]
    fn edited_turns_can_trigger_a_new_run() {
        let state = super::MemoryState::default();
        assert!(state.claim("conversation", 1));
        assert!(!state.claim("conversation", 1));
        assert!(state.claim("conversation", 2));

        state.cancel_all();
        assert!(state.claim("conversation", 1));
    }
}

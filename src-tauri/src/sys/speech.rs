use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};

use crate::utils::event;

const TTS_SAMPLE_RATE: u32 = 24_000;
const TTS_CHANNELS: u16 = 1;
const TTS_BITS_PER_SAMPLE: u16 = 16;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeechEventPayload {
    conversation_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeechErrorPayload {
    conversation_id: String,
    /// The reason to show the user, e.g. an HTTP status from the TTS endpoint.
    message: String,
}

struct ActiveSpeech {
    child: Child,
    path: std::path::PathBuf,
    conversation_id: String,
}

/// One spoken reply at a time. `epoch` invalidates a TTS request that was superseded while
/// its audio was still downloading.
#[derive(Default)]
pub struct SpeechState {
    active: Mutex<Option<ActiveSpeech>>,
    /// Conversation whose read-aloud audio is still being fetched, if any.
    preparing: Mutex<Option<String>>,
    epoch: AtomicU64,
}

impl SpeechState {
    fn preparing(&self) -> MutexGuard<'_, Option<String>> {
        self.preparing
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Reserves a unique epoch for a new request. Anything holding an older epoch is superseded.
    fn begin(&self) -> u64 {
        self.epoch.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Whether `epoch` still belongs to the request that should be spoken.
    fn is_current(&self, epoch: u64) -> bool {
        self.epoch.load(Ordering::SeqCst) == epoch
    }
}

/// Stops the current read-aloud and invalidates any TTS request still in flight.
pub fn stop(app: &AppHandle) {
    let Some(state) = app.try_state::<SpeechState>() else {
        return;
    };

    state.epoch.fetch_add(1, Ordering::SeqCst);

    if let Some(conversation_id) = state.preparing().take() {
        let _ = app.emit(event::SPEECH_END, SpeechEventPayload { conversation_id });
    }

    let active = state
        .active
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    if let Some(mut active) = active {
        let conversation_id = active.conversation_id.clone();
        let _ = active.child.kill();
        let _ = active.child.wait();
        let _ = std::fs::remove_file(active.path);
        let _ = app.emit(event::SPEECH_END, SpeechEventPayload { conversation_id });
    }
}

/// Fetches the configured TTS audio and plays it automatically. The response is filtered by the
/// service (`filter_markdown`) before it is spoken.
pub async fn speak(
    app: AppHandle,
    conversation_id: String,
    api_key: String,
    tts_url: String,
    voice: String,
    text: String,
) {
    let Some(state) = app.try_state::<SpeechState>() else {
        return;
    };

    // Claim the newest epoch: a later reply supersedes this one, and vice versa. Without this a
    // slower download from an older conversation could start playing after a newer one.
    let epoch = state.begin();
    *state.preparing() = Some(conversation_id.clone());
    let _ = app.emit(
        event::SPEECH_PREPARING,
        SpeechEventPayload {
            conversation_id: conversation_id.clone(),
        },
    );

    // The full endpoint comes from Settings, so providers can host speech elsewhere.
    let url = tts_url.trim().to_string();
    if url.is_empty() {
        log::warn!("No TTS endpoint is configured; skipping read-aloud");
        fail(
            &app,
            &state,
            &conversation_id,
            epoch,
            "Read-aloud needs a speech URL in Settings.".to_string(),
        );
        return;
    }
    let client = match crate::utils::http::client()
        .timeout(Duration::from_secs(300))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            fail(
                &app,
                &state,
                &conversation_id,
                epoch,
                format!("Could not create the speech client: {error}"),
            );
            return;
        }
    };

    let response = match client
        .post(url)
        .bearer_auth(api_key)
        .json(&json!({
            "text": text,
            "voice_id": voice,
            "format": "pcm",
            "filter_markdown": true
        }))
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            fail(
                &app,
                &state,
                &conversation_id,
                epoch,
                format!("Could not reach the speech endpoint: {error}"),
            );
            return;
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        // Surface the provider's own reason: a 401 or 404 here points at the key or the URL.
        let detail = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| body.chars().take(160).collect());
        let message = if detail.trim().is_empty() {
            format!("Read-aloud failed ({status}).")
        } else {
            format!("Read-aloud failed ({status}): {detail}")
        };
        fail(&app, &state, &conversation_id, epoch, message);
        return;
    }

    let pcm = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            fail(
                &app,
                &state,
                &conversation_id,
                epoch,
                format!("Could not read the speech audio: {error}"),
            );
            return;
        }
    };

    // A newer message or Stop invalidated this request while it was downloading.
    if !state.is_current(epoch) {
        // `stop` already ended the preparing state for this request.
        return;
    }

    let path = match app.path().app_cache_dir().map(|dir| {
        dir.join(format!(
            "iris-speech-{}.wav",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or_default()
        ))
    }) {
        Ok(path) => path,
        Err(error) => {
            log::warn!("Could not resolve the speech cache directory: {error}");
            abort(&app, &state, &conversation_id, epoch);
            return;
        }
    };

    if let Some(parent) = path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            log::warn!("Could not create the speech cache directory: {error}");
            abort(&app, &state, &conversation_id, epoch);
            return;
        }
    }

    if let Err(error) = write_wav(&path, &pcm) {
        log::warn!("Could not write the speech audio: {error}");
        abort(&app, &state, &conversation_id, epoch);
        return;
    }

    if !state.is_current(epoch) {
        let _ = std::fs::remove_file(&path);
        return;
    }

    // Playback is about to start; clear the preparing state without ending it. Only this request's
    // entry is cleared, so a newer reply that already started preparing keeps its spinner.
    {
        let mut preparing = state.preparing();
        if preparing.as_deref() == Some(conversation_id.as_str()) {
            *preparing = None;
        }
    }
    play(&app, path, conversation_id, epoch);
}

/// Stops whatever is audible without touching the epoch, so the caller's reservation survives.
fn interrupt(app: &AppHandle) {
    let Some(state) = app.try_state::<SpeechState>() else {
        return;
    };

    if let Some(conversation_id) = state.preparing().take() {
        let _ = app.emit(event::SPEECH_END, SpeechEventPayload { conversation_id });
    }

    let active = state
        .active
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    if let Some(mut active) = active {
        let conversation_id = active.conversation_id.clone();
        let _ = active.child.kill();
        let _ = active.child.wait();
        let _ = std::fs::remove_file(active.path);
        let _ = app.emit(event::SPEECH_END, SpeechEventPayload { conversation_id });
    }
}

/// Drops the preparing state when this request never reaches playback. Ignored when a newer
/// request already replaced it.
fn abort(app: &AppHandle, state: &SpeechState, conversation_id: &str, epoch: u64) {
    if !state.is_current(epoch) {
        return;
    }

    if state.preparing().take().is_some() {
        let _ = app.emit(
            event::SPEECH_END,
            SpeechEventPayload {
                conversation_id: conversation_id.to_string(),
            },
        );
    }
}

/// Like `abort`, but also tells the UI why read-aloud failed, so it is never a silent no-op.
fn fail(app: &AppHandle, state: &SpeechState, conversation_id: &str, epoch: u64, message: String) {
    if !state.is_current(epoch) {
        return;
    }

    log::warn!("Read-aloud failed: {message}");
    abort(app, state, conversation_id, epoch);
    let _ = app.emit(
        event::SPEECH_ERROR,
        SpeechErrorPayload {
            conversation_id: conversation_id.to_string(),
            message,
        },
    );
}

fn play(app: &AppHandle, path: std::path::PathBuf, conversation_id: String, epoch: u64) {
    let Some(state) = app.try_state::<SpeechState>() else {
        let _ = std::fs::remove_file(path);
        return;
    };

    // A newer reply may have claimed the epoch while this audio was downloading. Bail before
    // touching the shared state so a stale request cannot silence the one that superseded it.
    if !state.is_current(epoch) {
        let _ = std::fs::remove_file(path);
        return;
    }

    // Silence whatever is playing, but keep this request's epoch: `stop` would bump it and make
    // the caller bail out on its own reservation.
    interrupt(app);

    let mut command = Command::new("/usr/bin/afplay");
    command
        .arg(&path)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    match command.spawn() {
        Ok(child) => {
            let pid = child.id();

            *state
                .active
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(ActiveSpeech {
                child,
                path,
                conversation_id: conversation_id.clone(),
            });
            let _ = app.emit(
                event::SPEECH_START,
                SpeechEventPayload {
                    conversation_id: conversation_id.clone(),
                },
            );
            reap_finished(app.clone(), pid, conversation_id);
        }
        Err(error) => {
            log::warn!("Could not play the spoken reply: {error}");
            let _ = std::fs::remove_file(path);
            let _ = app.emit(event::SPEECH_END, SpeechEventPayload { conversation_id });
        }
    }
}

/// Waits for `afplay` to finish, then reaps it and removes the temporary WAV. The active speech is
/// cleared only if it still belongs to this process; a newer reply or Stop wins the race.
fn reap_finished(app: AppHandle, pid: u32, conversation_id: String) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(250));

        let Some(state) = app.try_state::<SpeechState>() else {
            return;
        };
        let mut active = state
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let finished = match active.as_mut() {
            Some(speech) if speech.child.id() == pid => match speech.child.try_wait() {
                Ok(Some(_)) | Err(_) => true,
                Ok(None) => false,
            },
            _ => return,
        };

        if finished {
            if let Some(speech) = active.take() {
                let _ = std::fs::remove_file(speech.path);
            }
            let _ = app.emit(event::SPEECH_END, SpeechEventPayload { conversation_id });
            return;
        }
    });
}

/// Wraps the raw 24 kHz mono 16-bit PCM returned by DeepSeek TTS in a WAV container.
fn write_wav(path: &std::path::Path, pcm: &[u8]) -> std::io::Result<()> {
    use std::io::Write;

    let byte_rate = TTS_SAMPLE_RATE * u32::from(TTS_CHANNELS) * u32::from(TTS_BITS_PER_SAMPLE) / 8;
    let block_align = TTS_CHANNELS * TTS_BITS_PER_SAMPLE / 8;
    let data_len = pcm.len() as u32;
    let riff_len = 36 + data_len;

    let mut file = std::fs::File::create(path)?;
    file.write_all(b"RIFF")?;
    file.write_all(&riff_len.to_le_bytes())?;
    file.write_all(b"WAVEfmt ")?;
    file.write_all(&16u32.to_le_bytes())?;
    file.write_all(&1u16.to_le_bytes())?; // PCM
    file.write_all(&TTS_CHANNELS.to_le_bytes())?;
    file.write_all(&TTS_SAMPLE_RATE.to_le_bytes())?;
    file.write_all(&byte_rate.to_le_bytes())?;
    file.write_all(&block_align.to_le_bytes())?;
    file.write_all(&TTS_BITS_PER_SAMPLE.to_le_bytes())?;
    file.write_all(b"data")?;
    file.write_all(&data_len.to_le_bytes())?;
    file.write_all(pcm)?;
    file.flush()
}

#[cfg(test)]
mod tests {
    use super::SpeechState;

    /// Two replies finishing close together must not both play: the newer claim wins and the
    /// older download is dropped when it checks its epoch.
    #[test]
    fn a_newer_request_supersedes_an_older_one() {
        let state = SpeechState::default();

        let first = state.begin();
        let second = state.begin();

        assert!(!state.is_current(first), "the older reply must stand down");
        assert!(state.is_current(second), "the newest reply must play");
    }

    /// Stop bumps the epoch, which is what invalidates a download that is still in flight.
    #[test]
    fn stop_invalidates_the_current_request() {
        let state = SpeechState::default();
        let epoch = state.begin();

        state
            .epoch
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        assert!(!state.is_current(epoch));
    }
}

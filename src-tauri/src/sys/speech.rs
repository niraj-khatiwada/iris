use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
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
    epoch: AtomicU64,
}

/// Stops the current read-aloud and invalidates any TTS request still in flight.
pub fn stop(app: &AppHandle) {
    let Some(state) = app.try_state::<SpeechState>() else {
        return;
    };

    state.epoch.fetch_add(1, Ordering::SeqCst);
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

/// Fetches the DeepSeek TTS stream and plays it automatically. The response is filtered by the
/// service (`filter_markdown`) before it is spoken.
pub async fn speak(
    app: AppHandle,
    conversation_id: String,
    api_key: String,
    base_url: String,
    voice: String,
    text: String,
) {
    let Some(state) = app.try_state::<SpeechState>() else {
        return;
    };

    let epoch = state.epoch.load(Ordering::SeqCst);
    let url = format!("{}/v1/tools/tts", base_url.trim_end_matches('/'));
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            log::warn!("Could not create the TTS client: {error}");
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
            log::warn!("TTS request failed: {error}");
            return;
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        log::warn!("TTS request failed ({status}): {body}");
        return;
    }

    let pcm = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => {
            log::warn!("Could not read the TTS audio: {error}");
            return;
        }
    };

    // A newer message or Stop invalidated this request while it was downloading.
    if state.epoch.load(Ordering::SeqCst) != epoch {
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
            return;
        }
    };

    if let Some(parent) = path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            log::warn!("Could not create the speech cache directory: {error}");
            return;
        }
    }

    if let Err(error) = write_wav(&path, &pcm) {
        log::warn!("Could not write the speech audio: {error}");
        return;
    }

    if state.epoch.load(Ordering::SeqCst) != epoch {
        let _ = std::fs::remove_file(&path);
        return;
    }

    play(&app, path, conversation_id);
}

fn play(app: &AppHandle, path: std::path::PathBuf, conversation_id: String) {
    stop(app);

    let mut command = Command::new("/usr/bin/afplay");
    command
        .arg(&path)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    match command.spawn() {
        Ok(mut child) => {
            let pid = child.id();
            let Some(state) = app.try_state::<SpeechState>() else {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_file(path);
                return;
            };

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

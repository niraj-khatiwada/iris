use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::core::endpoints;
use crate::core::storage::Storage;
use crate::sys::speech::{self, SpeechRequest};

/// Stops the current read-aloud. Also called when a new message starts or generation is cancelled.
#[tauri::command]
pub fn stop_speaking(app: AppHandle) {
    crate::sys::speech::stop(&app);
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakTextRequest {
    pub conversation_id: String,
    pub text: String,
    pub base_url: String,
    pub voice: String,
}

/// Reads a specific message aloud on demand, e.g. a reply picked from history.
///
/// Automatic read-aloud is still backend-owned; this command lets the UI speak any completed
/// reply, not just the newest one. Playback reports through the same `speech:*` events.
#[tauri::command]
pub fn speak_text(
    app: AppHandle,
    storage: State<'_, Storage>,
    request: SpeakTextRequest,
) -> Result<(), String> {
    let SpeakTextRequest {
        conversation_id,
        text,
        base_url,
        voice,
    } = request;

    let text = text.trim();
    if text.is_empty() {
        return Err("There is nothing to read aloud.".to_string());
    }
    let base_url = base_url.trim().to_string();
    if base_url.is_empty() {
        return Err("Add a base URL in Settings.".to_string());
    }

    let api_key = storage.require_api_key()?;
    let voice = if voice == "tide" { "tide" } else { "stella" };
    let tts_url = endpoints::url(&base_url, endpoints::TTS_PATH);

    tauri::async_runtime::spawn(speech::speak(
        app,
        SpeechRequest {
            conversation_id,
            message_id: None,
            text: text.to_string(),
            voice: voice.to_string(),
            api_key,
            base_url,
            model: String::new(),
            tts_url,
            spoken_summary: None,
            // Manual Read aloud always speaks the original reply, never the cached summary.
            summarize: false,
        },
    ));
    Ok(())
}

/// Sends a recorded WAV to DeepSeek's ASR tool under the configured base URL.
#[tauri::command]
pub async fn transcribe_audio(
    storage: State<'_, Storage>,
    base_url: String,
    audio_base64: String,
) -> Result<String, String> {
    // The key is read from the credential table here, never sent from the webview.
    let api_key = storage.require_api_key()?;

    if base_url.trim().is_empty() {
        return Err("Add a base URL in Settings.".to_string());
    }

    let asr_url = endpoints::url(&base_url, endpoints::ASR_PATH);

    let audio = STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|_| "The recording could not be read.".to_string())?;
    if audio.is_empty() {
        return Err("Nothing was recorded. Try again.".to_string());
    }
    if audio.len() > 8 * 1024 * 1024 {
        return Err("The recording is too long. Keep it under two minutes.".to_string());
    }

    let part = reqwest::multipart::Part::bytes(audio)
        .file_name("recording.wav")
        .mime_str("audio/wav")
        .map_err(|error| format!("Could not prepare the recording: {error}"))?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let client = crate::utils::http::client()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| format!("Could not create the voice client: {error}"))?;
    let response = client
        .post(asr_url)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("Could not reach voice transcription: {error}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        let message = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| {
                if body.is_empty() {
                    status.to_string()
                } else {
                    body
                }
            });
        return Err(format!("Voice transcription failed: {message}"));
    }

    let value: Value = serde_json::from_str(&body)
        .map_err(|_| "Voice transcription returned an unexpected response.".to_string())?;
    let text = value
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();

    if text.is_empty() {
        Err("Iris didn't catch that. Try again.".to_string())
    } else {
        Ok(text)
    }
}

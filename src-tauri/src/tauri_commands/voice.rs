use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::Value;
use tauri::AppHandle;

/// Stops the current read-aloud. Also called when a new message starts or generation is cancelled.
#[tauri::command]
pub fn stop_speaking(app: AppHandle) {
    crate::sys::speech::stop(&app);
}

/// Sends a recorded WAV to the DeepSeek ASR endpoint and returns the transcript.
#[tauri::command]
pub async fn transcribe_audio(
    api_key: String,
    base_url: String,
    audio_base64: String,
) -> Result<String, String> {
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("Add your DeepSeek API key in Settings.".to_string());
    }

    let base_url = base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("Add the API base URL in Settings.".to_string());
    }

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

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| format!("Could not create the voice client: {error}"))?;
    let response = client
        .post(format!("{base_url}/v1/tools/asr"))
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

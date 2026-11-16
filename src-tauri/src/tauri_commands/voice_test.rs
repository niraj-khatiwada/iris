use std::time::Duration;

use tauri::AppHandle;

use crate::tauri_commands::keychain;

/// Result of probing a configured voice endpoint.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointTest {
    pub ok: bool,
    /// What the endpoint did, suitable for showing under the field.
    pub message: String,
}

/// TTS_SAMPLE_TEXT is short and cheap; the point is reachability and auth, not quality.
const TTS_SAMPLE_TEXT: &str = "Hello.";

/// Generates a 1 kHz WAV of a fraction of a second, so the transcription test needs no assets and
/// no microphone permission.
fn sample_wav() -> Vec<u8> {
    const RATE: u32 = 16_000;
    const CHANNELS: u16 = 1;
    const BITS: u16 = 16;
    // 0.25s of near-silence with a quiet tone keeps the payload tiny.
    let frames = RATE / 4;
    let mut pcm = Vec::with_capacity(frames as usize * 2);
    for index in 0..frames {
        let time = index as f32 / RATE as f32;
        let sample = (time * 1000.0 * std::f32::consts::TAU).sin() * 1200.0;
        pcm.extend_from_slice(&(sample as i16).to_le_bytes());
    }

    let byte_rate = RATE * u32::from(CHANNELS) * u32::from(BITS) / 8;
    let block_align = CHANNELS * BITS / 8;
    let data_len = pcm.len() as u32;
    let mut out = Vec::with_capacity(44 + pcm.len());
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&CHANNELS.to_le_bytes());
    out.extend_from_slice(&RATE.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&BITS.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend_from_slice(&pcm);
    out
}

fn describe(status: reqwest::StatusCode, body: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(serde_json::Value::as_str)
                .or_else(|| value.get("message").and_then(serde_json::Value::as_str))
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(160).collect());

    if detail.trim().is_empty() {
        status.to_string()
    } else {
        format!("{status}: {detail}")
    }
}

/// Sends a short line to the configured TTS endpoint and reports whether audio came back.
#[tauri::command]
pub async fn test_tts_url(_app: AppHandle, tts_url: String, voice: String) -> EndpointTest {
    if tts_url.trim().is_empty() {
        return EndpointTest {
            ok: false,
            message: "Add a speech URL first.".to_string(),
        };
    }

    let Ok(api_key) = keychain::api_key() else {
        return EndpointTest {
            ok: false,
            message: "Add your API key first.".to_string(),
        };
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return EndpointTest {
                ok: false,
                message: format!("Could not create the client: {error}"),
            }
        }
    };

    let response = client
        .post(tts_url.trim())
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "text": TTS_SAMPLE_TEXT,
            "voice_id": voice,
            "format": "wav",
            "filter_markdown": true,
        }))
        .send()
        .await;

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            return EndpointTest {
                ok: false,
                message: format!("Could not reach the endpoint: {error}"),
            }
        }
    };

    let status = response.status();
    let bytes = response.bytes().await.unwrap_or_default();
    if !status.is_success() {
        let body = String::from_utf8_lossy(&bytes);
        return EndpointTest {
            ok: false,
            message: describe(status, &body),
        };
    }

    // Require real audio: a 2xx with an empty body means the path is wrong.
    if bytes.len() < 44 || &bytes[..4] != b"RIFF" {
        return EndpointTest {
            ok: false,
            message: format!(
                "Reached the endpoint but got {} bytes, not WAV audio.",
                bytes.len()
            ),
        };
    }

    EndpointTest {
        ok: true,
        message: format!("OK · received {} KB of audio.", bytes.len() / 1024),
    }
}

/// Sends a generated sample recording to the configured transcription endpoint.
#[tauri::command]
pub async fn test_asr_url(_app: AppHandle, asr_url: String) -> EndpointTest {
    if asr_url.trim().is_empty() {
        return EndpointTest {
            ok: false,
            message: "Add a transcription URL first.".to_string(),
        };
    }

    let Ok(api_key) = keychain::api_key() else {
        return EndpointTest {
            ok: false,
            message: "Add your API key first.".to_string(),
        };
    };

    let part = match reqwest::multipart::Part::bytes(sample_wav())
        .file_name("sample.wav")
        .mime_str("audio/wav")
    {
        Ok(part) => part,
        Err(error) => {
            return EndpointTest {
                ok: false,
                message: format!("Could not prepare the test recording: {error}"),
            }
        }
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return EndpointTest {
                ok: false,
                message: format!("Could not create the client: {error}"),
            }
        }
    };

    let response = client
        .post(asr_url.trim())
        .bearer_auth(api_key)
        .multipart(reqwest::multipart::Form::new().part("file", part))
        .send()
        .await;

    let response = match response {
        Ok(response) => response,
        Err(error) => {
            return EndpointTest {
                ok: false,
                message: format!("Could not reach the endpoint: {error}"),
            }
        }
    };

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return EndpointTest {
            ok: false,
            message: describe(status, &body),
        };
    }

    // Any well-formed JSON answer means the endpoint works; the tone may transcribe as empty.
    match serde_json::from_str::<serde_json::Value>(&body) {
        Ok(value) if value.get("text").is_some() => EndpointTest {
            ok: true,
            message: "OK · the endpoint returned a transcript.".to_string(),
        },
        Ok(_) => EndpointTest {
            ok: false,
            message: "Reached the endpoint but the reply had no transcript.".to_string(),
        },
        Err(_) => EndpointTest {
            ok: false,
            message: "Reached the endpoint but the reply was not JSON.".to_string(),
        },
    }
}

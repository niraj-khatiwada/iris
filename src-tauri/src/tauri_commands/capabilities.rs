use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::tauri_commands::keychain;

/// What the configured provider actually accepts. Probed with real requests, because most
/// providers do not advertise this in their model catalogue.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityReport {
    pub text: bool,
    pub image: bool,
    /// Human-readable summary, e.g. "Text and images are supported."
    pub message: String,
}

/// An 8×8 solid red PNG, built here so the probe needs no asset and no network beyond the API.
fn sample_png() -> String {
    const W: u32 = 8;
    const H: u32 = 8;

    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xffff_ffffu32;
        for byte in data {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                let mask = (crc & 1).wrapping_neg();
                crc = (crc >> 1) ^ (0xedb8_8320 & mask);
            }
        }
        !crc
    }

    fn chunk(kind: &[u8], data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        out.extend_from_slice(kind);
        out.extend_from_slice(data);
        let mut crc_input = kind.to_vec();
        crc_input.extend_from_slice(data);
        out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
        out
    }

    // Raw scanlines: each row is a filter byte then RGB triples.
    let mut raw = Vec::with_capacity((W as usize * 3 + 1) * H as usize);
    for _ in 0..H {
        raw.resize(raw.len() + 1, 0u8);
        for _ in 0..W {
            raw.extend_from_slice(&[0xff, 0x00, 0x00]);
        }
    }

    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&W.to_be_bytes());
    ihdr.extend_from_slice(&H.to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]); // 8-bit, truecolour, no interlace

    let mut png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    png.extend_from_slice(&chunk(b"IHDR", &ihdr));
    png.extend_from_slice(&chunk(b"IDAT", &zlib_store(&raw)));
    png.extend_from_slice(&chunk(b"IEND", b""));

    base64_encode(&png)
}

/// Minimal zlib stream with stored (uncompressed) deflate blocks, so no compression dependency
/// is needed for the probe payload.
fn zlib_store(data: &[u8]) -> Vec<u8> {
    let mut out = vec![0x78, 0x01];
    let mut offset = 0;
    while offset < data.len() {
        let end = (offset + 65_535).min(data.len());
        let block = &data[offset..end];
        let last = end == data.len();
        out.push(u8::from(last));
        out.extend_from_slice(&(block.len() as u16).to_le_bytes());
        out.extend_from_slice(&(!(block.len() as u16)).to_le_bytes());
        out.extend_from_slice(block);
        offset = end;
    }
    let (mut a, mut b) = (1u32, 0u32);
    for byte in data {
        a = (a + u32::from(*byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    out.extend_from_slice(&((b << 16) | a).to_be_bytes());
    out
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD.encode(bytes)
}

/// Builds a one-turn probe body for the given wire format.
fn probe_body(format: &str, model: &str, with_image: bool) -> Value {
    let prompt = if with_image {
        "Reply with the single word: red"
    } else {
        "Reply with the single word: ok"
    };

    if format == "openai" {
        let content = if with_image {
            json!([
                { "type": "text", "text": prompt },
                { "type": "image_url", "image_url": {
                    "url": format!("data:image/png;base64,{}", sample_png())
                }}
            ])
        } else {
            json!(prompt)
        };

        return json!({
            "model": model,
            "max_tokens": 16,
            "messages": [{ "role": "user", "content": content }],
            "stream": false
        });
    }

    let content = if with_image {
        json!([
            { "type": "image", "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": sample_png()
            }},
            { "type": "text", "text": prompt }
        ])
    } else {
        json!(prompt)
    };

    json!({
        "model": model,
        "max_tokens": 16,
        "messages": [{ "role": "user", "content": content }],
        "stream": false
    })
}

async fn probe(
    base_url: &str,
    format: &str,
    model: &str,
    api_key: &str,
    with_image: bool,
) -> bool {
    let base = base_url.trim_end_matches('/');
    let url = if format == "openai" {
        format!("{base}/v1/chat/completions")
    } else {
        format!("{base}/v1/messages")
    };

    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
    else {
        return false;
    };

    let mut request = client
        .post(url)
        .header("content-type", "application/json")
        .json(&probe_body(format, model, with_image));

    request = if format == "openai" {
        request.bearer_auth(api_key)
    } else {
        request
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
    };

    match request.send().await {
        Ok(response) => response.status().is_success(),
        Err(_) => false,
    }
}

/// Checks which content types the configured provider accepts for the selected model.
#[tauri::command]
pub async fn test_capabilities(
    base_url: String,
    api_format: String,
    model: String,
) -> Result<CapabilityReport, String> {
    let api_key = keychain::api_key()?;

    if base_url.trim().is_empty() {
        return Err("Add the API base URL in Settings.".to_string());
    }
    if model.trim().is_empty() {
        return Err("Choose a model first.".to_string());
    }

    let format = if api_format == "openai" {
        "openai"
    } else {
        "anthropic"
    };

    let text = probe(&base_url, format, &model, &api_key, false).await;
    if !text {
        return Ok(CapabilityReport {
            text: false,
            image: false,
            message: "Text requests failed. Check the key, base URL, format, and model.".to_string(),
        });
    }

    let image = probe(&base_url, format, &model, &api_key, true).await;
    Ok(CapabilityReport {
        text: true,
        image,
        message: if image {
            "Text and images are supported.".to_string()
        } else {
            "Text is supported; this model rejected images.".to_string()
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{probe_body, sample_png};

    #[test]
    fn the_sample_image_is_a_png() {
        let encoded = sample_png();
        let bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            encoded.as_bytes(),
        )
        .expect("valid base64");
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn the_untested_format_with_an_image_becomes_content_parts() {
        let body = probe_body("openai", "m", true);
        assert_eq!(body["messages"][0]["content"][1]["type"], "image_url");
        assert!(body["messages"][0]["content"][1]["image_url"]["url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
    }

    #[test]
    fn the_anthropic_probe_uses_base64_source_blocks() {
        let body = probe_body("anthropic", "m", true);
        assert_eq!(body["messages"][0]["content"][0]["type"], "image");
        assert_eq!(
            body["messages"][0]["content"][0]["source"]["media_type"],
            "image/png"
        );
        // Text-only probes stay plain strings for maximum compatibility.
        let plain = probe_body("anthropic", "m", false);
        assert!(plain["messages"][0]["content"].is_string());
    }
}

/// Exercises the real probe against a live provider, skipped unless IRIS_TEST_BASE_URL is set.
#[cfg(test)]
mod live_tests {
    #[test]
    fn the_probe_reports_what_the_provider_accepts() {
        let Ok(base_url) = std::env::var("IRIS_TEST_BASE_URL") else {
            eprintln!("Skipping: set IRIS_TEST_BASE_URL to probe a live provider");
            return;
        };
        let model = std::env::var("IRIS_TEST_MODEL").unwrap_or_default();
        if model.is_empty() {
            eprintln!("Skipping: set IRIS_TEST_MODEL too");
            return;
        }
        let format = std::env::var("IRIS_TEST_FORMAT").unwrap_or_else(|_| "anthropic".to_string());

        let report = tauri::async_runtime::block_on(super::test_capabilities(
            base_url, format, model,
        ))
        .expect("the probe should run");

        eprintln!("text={} image={} ({})", report.text, report.image, report.message);
        assert!(report.text, "the provider should accept text");
    }
}

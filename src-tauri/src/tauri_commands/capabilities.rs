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
    /// Accepts the format's reasoning/thinking control.
    pub thinking: bool,
    /// Accepts the format's server-side web search tool.
    pub web_search: bool,
    /// Human-readable summary.
    pub message: String,
}

/// A probe varies one request field; the model either accepts it or rejects it.
#[derive(Clone, Copy, PartialEq)]
enum Probe {
    Text,
    Image,
    Thinking,
    WebSearch,
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

/// Builds a one-turn probe body for the given wire format and capability.
///
/// The extras match what `core/agent.rs` sends, so a pass here means the real requests will work:
/// Anthropic uses `thinking: adaptive` and the `web_search_20250305` server tool, OpenAI uses
/// `reasoning_effort` and `web_search_options`.
fn probe_body(format: &str, model: &str, probe: Probe) -> Value {
    let with_image = probe == Probe::Image;
    // Search and thinking probes need a prompt that cannot be answered from memory, plus room to
    // answer; the plain probes only need a byte of output.
    let (prompt, max_tokens) = match probe {
        Probe::Image => ("Reply with the single word: red", 16),
        Probe::Text => ("Reply with the single word: ok", 16),
        Probe::Thinking => ("A farmer has 17 sheep, all but 9 run away. How many remain?", 600),
        Probe::WebSearch => ("What is the current price of Bitcoin today?", 600),
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

        let mut body = json!({
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{ "role": "user", "content": content }],
            "stream": false
        });

        match probe {
            // Same value the chat runtime sends, so a pass here means real requests will work.
            Probe::Thinking => body["reasoning_effort"] = json!("medium"),
            Probe::WebSearch => body["web_search_options"] = json!({}),
            _ => {}
        }

        return body;
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

    let mut body = json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{ "role": "user", "content": content }],
        "stream": false
    });

    match probe {
        Probe::Thinking => body["thinking"] = json!({ "type": "adaptive" }),
        Probe::WebSearch => {
            body["tools"] = json!([{ "type": "web_search_20250305", "name": "web_search" }])
        }
        _ => {}
    }

    body
}

/// Did the reply actually reason? Many providers accept the parameter and then ignore it, so an
/// HTTP 200 proves nothing; only content or token counts count as evidence.
fn reasoned(format: &str, body: &Value) -> bool {
    if format == "openai" {
        let message = body
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"));
        let text = message
            .and_then(|message| message.get("reasoning_content"))
            .and_then(Value::as_str)
            .is_some_and(|text| !text.trim().is_empty());
        let tokens = body["usage"]["completion_tokens_details"]["reasoning_tokens"]
            .as_u64()
            .unwrap_or(0);
        return text || tokens > 0;
    }

    let block = body
        .get("content")
        .and_then(Value::as_array)
        .is_some_and(|blocks| {
            blocks.iter().any(|block| {
                block.get("type").and_then(Value::as_str) == Some("thinking")
                    && block
                        .get("thinking")
                        .and_then(Value::as_str)
                        .is_some_and(|text| !text.trim().is_empty())
            })
        });
    let tokens = body["usage"]["output_tokens_details"]["thinking_tokens"]
        .as_u64()
        .unwrap_or(0);
    block || tokens > 0
}

/// Did the reply actually consult the web? Requires a server-side search result or citation, not
/// merely an accepted `tools` field.
fn searched(format: &str, body: &Value) -> bool {
    if format == "openai" {
        return body
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("annotations"))
            .and_then(Value::as_array)
            .is_some_and(|annotations| !annotations.is_empty());
    }

    body.get("content")
        .and_then(Value::as_array)
        .is_some_and(|blocks| {
            blocks.iter().any(|block| {
                matches!(
                    block.get("type").and_then(Value::as_str),
                    Some("web_search_tool_result") | Some("server_tool_use")
                )
            })
        })
}

/// Runs one probe and returns the parsed reply, or `None` when the request itself failed.
async fn probe(
    base_url: &str,
    format: &str,
    model: &str,
    api_key: &str,
    probe: Probe,
) -> Option<Value> {
    let base = base_url.trim_end_matches('/');
    let url = if format == "openai" {
        format!("{base}/v1/chat/completions")
    } else {
        format!("{base}/v1/messages")
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .ok()?;

    let mut request = client
        .post(url)
        .header("content-type", "application/json")
        .json(&probe_body(format, model, probe));

    request = if format == "openai" {
        request.bearer_auth(api_key)
    } else {
        request
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
    };

    let response = request.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().await.ok()
}

/// Checks which content types and options the configured provider accepts for the model.
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

    let text = probe(&base_url, format, &model, &api_key, Probe::Text)
        .await
        .is_some();
    if !text {
        return Ok(CapabilityReport {
            text: false,
            image: false,
            thinking: false,
            web_search: false,
            message: "Text requests failed. Check the key, base URL, format, and model.".to_string(),
        });
    }

    // Each extra is a separate request so one rejection cannot be confused with another.
    let image = probe(&base_url, format, &model, &api_key, Probe::Image).await;
    let thinking = probe(&base_url, format, &model, &api_key, Probe::Thinking)
        .await
        .is_some_and(|body| reasoned(format, &body));
    let web_search = probe(&base_url, format, &model, &api_key, Probe::WebSearch)
        .await
        .is_some_and(|body| searched(format, &body));

    let mut supported = vec!["Text"];
    if image.is_some() {
        supported.push("images");
    }
    if thinking {
        supported.push("thinking");
    }
    if web_search {
        supported.push("web search");
    }
    let missing = [
        (image.is_none(), "images"),
        (!thinking, "thinking"),
        (!web_search, "web search"),
    ]
    .into_iter()
    .filter_map(|(absent, name)| absent.then_some(name))
    .collect::<Vec<_>>();

    let message = if missing.is_empty() {
        format!("This model supports {}.", supported.join(", "))
    } else {
        format!(
            "This model supports {}. Not supported: {}.",
            supported.join(", "),
            missing.join(", ")
        )
    };

    Ok(CapabilityReport {
        text,
        image: image.is_some(),
        thinking,
        web_search,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::{probe_body, reasoned, sample_png, searched, Probe};

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
    fn the_openai_image_probe_becomes_content_parts() {
        let body = probe_body("openai", "m", Probe::Image);
        assert_eq!(body["messages"][0]["content"][1]["type"], "image_url");
        assert!(body["messages"][0]["content"][1]["image_url"]["url"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,"));
    }

    #[test]
    fn the_anthropic_probe_uses_base64_source_blocks() {
        let body = probe_body("anthropic", "m", Probe::Image);
        assert_eq!(body["messages"][0]["content"][0]["type"], "image");
        assert_eq!(
            body["messages"][0]["content"][0]["source"]["media_type"],
            "image/png"
        );
        // Text-only probes stay plain strings for maximum compatibility.
        let plain = probe_body("anthropic", "m", Probe::Text);
        assert!(plain["messages"][0]["content"].is_string());
    }

    /// Each format's thinking and web-search controls match what the chat runtime sends.
    #[test]
    fn the_probes_use_the_format_specific_optional_fields() {
        let anthropic_thinking = probe_body("anthropic", "m", Probe::Thinking);
        assert_eq!(anthropic_thinking["thinking"]["type"], "adaptive");
        assert!(anthropic_thinking.get("reasoning_effort").is_none());

        let anthropic_search = probe_body("anthropic", "m", Probe::WebSearch);
        assert_eq!(anthropic_search["tools"][0]["name"], "web_search");

        let openai_thinking = probe_body("openai", "m", Probe::Thinking);
        assert_eq!(openai_thinking["reasoning_effort"], "medium");
        assert!(openai_thinking.get("thinking").is_none());

        let openai_search = probe_body("openai", "m", Probe::WebSearch);
        assert!(openai_search.get("web_search_options").is_some());

        // A plain text probe carries none of the optional fields.
        let plain = probe_body("openai", "m", Probe::Text);
        assert!(plain.get("reasoning_effort").is_none());
        assert!(plain.get("web_search_options").is_none());
    }

    /// A 200 with no reasoning content means the provider accepted and ignored the parameter, which
    /// is common: the report must say "not supported" rather than trust the status code.
    #[test]
    fn a_reply_without_reasoning_is_not_evidence_of_thinking() {
        let ignored = serde_json::json!({
            "content": [{ "type": "text", "text": "4" }],
            "usage": { "output_tokens_details": { "thinking_tokens": 0 } }
        });
        assert!(!reasoned("anthropic", &ignored));

        let reasoned_anthropic = serde_json::json!({
            "content": [{ "type": "thinking", "thinking": "9 remain" }],
            "usage": { "output_tokens_details": { "thinking_tokens": 42 } }
        });
        assert!(reasoned("anthropic", &reasoned_anthropic));

        let ignored_openai = serde_json::json!({
            "choices": [{ "message": { "content": "4", "reasoning_content": "" } }],
            "usage": { "completion_tokens_details": { "reasoning_tokens": 0 } }
        });
        assert!(!reasoned("openai", &ignored_openai));

        let reasoned_openai = serde_json::json!({
            "choices": [{ "message": { "content": "4", "reasoning_content": "9 remain" } }],
            "usage": { "completion_tokens_details": { "reasoning_tokens": 56 } }
        });
        assert!(reasoned("openai", &reasoned_openai));
    }

    /// The same for search: the tool being accepted says nothing unless a result or citation came
    /// back.
    #[test]
    fn an_accepted_tool_is_not_evidence_of_search() {
        let ignored = serde_json::json!({
            "content": [{ "type": "text", "text": "I can't search the web." }]
        });
        assert!(!searched("anthropic", &ignored));

        let searched_anthropic = serde_json::json!({
            "content": [
                { "type": "server_tool_use", "name": "web_search" },
                { "type": "web_search_tool_result" }
            ]
        });
        assert!(searched("anthropic", &searched_anthropic));

        let ignored_openai = serde_json::json!({
            "choices": [{ "message": { "content": "I can't search." } }]
        });
        assert!(!searched("openai", &ignored_openai));

        let searched_openai = serde_json::json!({
            "choices": [{ "message": { "content": "It is $90k.", "annotations": [{ "type": "url_citation" }] } }]
        });
        assert!(searched("openai", &searched_openai));
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

        eprintln!(
            "text={} image={} thinking={} web_search={} ({})",
            report.text, report.image, report.thinking, report.web_search, report.message
        );
        assert!(report.text, "the provider should accept text");
    }
}

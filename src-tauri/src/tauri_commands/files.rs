use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::core::attachments;
use crate::core::endpoints;
use crate::core::storage::Storage;

/// Plain text, code, spreadsheets, and ebooks are uploaded as user data; parsed documents use
/// a layout-recognition purpose. The API matches the original file's content, not its extension.
const USER_DATA_MAX_BYTES: usize = 32 * 1024 * 1024;
const PARSED_MAX_BYTES: usize = 100 * 1024 * 1024;
const FILES_BETA: &str = "files-api-2025-04-14";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedDocument {
    pub id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadDocumentRequest {
    pub base_url: String,
    pub conversation_id: String,
    pub file_name: String,
    pub display_name: String,
    pub mime_type: String,
    pub purpose: String,
}

/// Uploads one attachment to DeepSeek's Files API and returns the file id that later chat turns
/// reference. The API key never leaves Rust. The frontend enforces format and size limits as well;
/// this check is the final guard before the request is sent.
#[tauri::command]
pub async fn upload_document(
    app: AppHandle,
    storage: State<'_, Storage>,
    request: UploadDocumentRequest,
) -> Result<UploadedDocument, String> {
    let UploadDocumentRequest {
        base_url,
        conversation_id,
        file_name,
        display_name,
        mime_type,
        purpose,
    } = request;
    let api_key = storage.require_api_key()?;
    if base_url.trim().is_empty() {
        return Err("Add the API base URL in Settings.".to_string());
    }
    if display_name.trim().is_empty() {
        return Err("The file is missing a name.".to_string());
    }

    let limit = match purpose.as_str() {
        "user_data" => USER_DATA_MAX_BYTES,
        "text_recognition" | "rich_layout_recognition" => PARSED_MAX_BYTES,
        _ => return Err("Unsupported document purpose.".to_string()),
    };

    let path = attachments::path_for(&app, &conversation_id, &file_name)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|error| format!("Could not read the attachment: {error}"))?
        .map_err(|error| format!("Could not read the attachment: {error}"))?;
    if bytes.is_empty() {
        return Err("The file is empty.".to_string());
    }
    if bytes.len() > limit {
        return Err(format!(
            "The file is larger than the {} MB limit.",
            limit / 1024 / 1024
        ));
    }

    let id = post_document(
        &api_key,
        base_url.trim(),
        display_name.trim(),
        &mime_type,
        &purpose,
        bytes,
    )
    .await?;
    Ok(UploadedDocument { id })
}

/// Sends the multipart request. The purpose field must precede the file field, and the
/// Anthropic-compatible Files API needs the files-api beta header.
async fn post_document(
    api_key: &str,
    base_url: &str,
    file_name: &str,
    mime_type: &str,
    purpose: &str,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let byte_len = bytes.len();
    let mime = mime_type
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .trim();
    let mime = if mime.is_empty() {
        "application/octet-stream"
    } else {
        mime
    };
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name.to_string())
        .mime_str(mime)
        .map_err(|error| format!("Could not prepare the file upload: {error}"))?;
    let form = reqwest::multipart::Form::new()
        .text("purpose", purpose.to_string())
        .part("file", part);

    let client = crate::utils::http::client()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| format!("Could not create the upload client: {error}"))?;

    let response = client
        .post(endpoints::url(base_url, endpoints::FILES_PATH))
        .header("x-api-key", api_key)
        .header("anthropic-beta", FILES_BETA)
        .header("accept", "application/json")
        .multipart(form)
        .send()
        .await
        .map_err(|error| format!("Could not reach the file service: {error}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| body.chars().take(200).collect());
        return Err(format!("Document upload failed ({status}): {detail}"));
    }

    let id = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|value| value.get("id").and_then(Value::as_str).map(str::to_string))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The file service did not return a file id.".to_string())?;

    log::info!("Uploaded {file_name} for {purpose} as {id} ({byte_len} bytes)");
    Ok(id)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    use super::post_document;

    #[tokio::test]
    async fn uploads_with_the_files_endpoint_and_beta_header() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock server");
        let address = listener.local_addr().expect("mock address");
        let captured = Arc::new(Mutex::new(String::new()));
        let sink = captured.clone();

        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
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
                return;
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

            *sink.lock().unwrap() = String::from_utf8_lossy(&raw).to_string();
            let reply = r#"{"id":"file-api-test"}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\
                 content-length: {}\r\nconnection: close\r\n\r\n{}",
                reply.len(),
                reply
            );
            let _ = stream.write_all(response.as_bytes());
        });

        let id = post_document(
            "test-key",
            &format!("http://{address}"),
            "report.pdf",
            "application/pdf",
            "rich_layout_recognition",
            b"PDFDATA".to_vec(),
        )
        .await
        .expect("upload");
        assert_eq!(id, "file-api-test");

        let request = captured.lock().unwrap().clone();
        assert!(request.starts_with("POST /anthropic/v1/files HTTP/1.1"));
        let lower = request.to_ascii_lowercase();
        assert!(lower.contains("x-api-key: test-key"));
        assert!(lower.contains("anthropic-beta: files-api-2025-04-14"));

        let purpose = request.find(r#"name="purpose""#).expect("purpose field");
        let file = request.find(r#"name="file""#).expect("file field");
        assert!(purpose < file, "purpose must be sent before file");
        assert!(request.contains("rich_layout_recognition"));
        assert!(request.contains("filename=\"report.pdf\""));
        assert!(request.contains("PDFDATA"));
    }
}

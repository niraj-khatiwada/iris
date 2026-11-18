use std::time::Duration;

use serde_json::Value;
use tauri::State;

use crate::core::endpoints;
use crate::core::storage::Storage;

/// Fetches the models the configured key can use, in DeepSeek's own order.
///
/// The key stays in Rust: this command reads it from the credential table just like a chat request,
/// so the webview never sees it.
#[tauri::command]
pub async fn list_models(
    storage: State<'_, Storage>,
    base_url: String,
) -> Result<Vec<ModelEntry>, String> {
    let api_key = storage.require_api_key()?;
    fetch_models(&base_url, &api_key).await
}

async fn fetch_models(base_url: &str, api_key: &str) -> Result<Vec<ModelEntry>, String> {
    if base_url.trim().is_empty() {
        return Err("Add the API base URL in Settings.".to_string());
    }

    let url = endpoints::url(base_url, endpoints::MODELS_PATH);
    let client = crate::utils::http::client()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Could not create the models client: {error}"))?;

    let response = client
        .get(url)
        .bearer_auth(api_key)
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|error| format!("Could not reach the model catalogue: {error}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(describe_error(status.as_u16(), &body));
    }

    let models = parse_models(&body);
    if models.is_empty() {
        return Err("The API did not return any models for this key.".to_string());
    }

    Ok(models)
}

/// One catalogue entry: the id to send.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub id: String,
}

/// Reads a model list from whichever shape DeepSeek returns, keeping the API's own order.
fn parse_models(body: &str) -> Vec<ModelEntry> {
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return Vec::new();
    };

    let list = value
        .get("data")
        .or_else(|| value.get("models"))
        .or_else(|| value.get("items"));

    let mut models: Vec<ModelEntry> = match list {
        Some(Value::Array(entries)) => entries
            .iter()
            .filter_map(|entry| match entry {
                Value::String(id) => Some(ModelEntry {
                    id: id.trim().to_string(),
                }),
                Value::Object(fields) => fields
                    .get("id")
                    .or_else(|| fields.get("name"))
                    .and_then(Value::as_str)
                    .map(|id| ModelEntry {
                        id: id.trim().to_string(),
                    }),
                _ => None,
            })
            .collect(),
        // Some endpoints answer with a bare array of ids.
        None => match value {
            Value::Array(entries) => entries
                .iter()
                .filter_map(|entry| {
                    entry.as_str().map(|id| ModelEntry {
                        id: id.trim().to_string(),
                    })
                })
                .collect(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    };

    models.retain(|model| !model.id.is_empty());
    models.dedup_by(|a, b| a.id == b.id);
    models
}

fn describe_error(status: u16, body: &str) -> String {
    let message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| body.to_string());

    if message.trim().is_empty() {
        format!("The model catalogue failed ({status}).")
    } else {
        format!("The model catalogue failed ({status}): {message}")
    }
}

#[cfg(test)]
mod tests {
    use super::parse_models;

    fn ids(body: &str) -> Vec<String> {
        parse_models(body).into_iter().map(|m| m.id).collect()
    }

    #[test]
    fn reads_the_deepseek_data_shape() {
        let body = r#"{"data":[{"id":"deepseek-flash"},{"id":"deepseek-pro"}]}"#;
        assert_eq!(ids(body), ["deepseek-flash", "deepseek-pro"]);
    }

    #[test]
    fn reads_a_bare_array_and_skips_junk() {
        let body = r#"["alpha", "", "beta"]"#;
        assert_eq!(ids(body), ["alpha", "beta"]);
    }

    #[test]
    fn reads_names_and_tolerates_an_unknown_shape() {
        assert_eq!(ids(r#"{"models":[{"name":"x"}]}"#), ["x"]);
        assert!(parse_models(r#"{"unexpected":true}"#).is_empty());
        assert!(parse_models("not json").is_empty());
    }
}

/// Exercises the real command against the live DeepSeek API, so the URL and auth header are
/// verified rather than assumed. The base URL and key come from the environment because the stored
/// credential is not exposed to tests. Skipped when either is unset.
#[cfg(test)]
mod live_tests {
    #[test]
    fn list_models_returns_the_live_catalogue() {
        let Ok(base_url) = std::env::var("IRIS_TEST_BASE_URL") else {
            eprintln!("Skipping: set IRIS_TEST_BASE_URL to exercise the live API");
            return;
        };

        let Ok(key) = std::env::var("IRIS_TEST_API_KEY") else {
            eprintln!("Skipping: set IRIS_TEST_API_KEY to exercise the live API");
            return;
        };
        if key.trim().is_empty() {
            eprintln!("Skipping: IRIS_TEST_API_KEY is empty");
            return;
        }

        let models = tauri::async_runtime::block_on(super::fetch_models(&base_url, key.trim()))
            .expect("the live catalogue should load");

        assert!(!models.is_empty(), "no models returned");
        eprintln!("live models: {models:?}");
    }
}

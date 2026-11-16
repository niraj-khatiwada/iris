use std::time::Duration;

use serde_json::Value;

/// Fetches the models the configured key can use, in the API's own order.
///
/// The key stays in Rust: this command reads the Keychain just like a chat request, so the
/// webview never sees it.
#[tauri::command]
pub async fn list_models(base_url: String) -> Result<Vec<ModelEntry>, String> {
    let api_key = crate::tauri_commands::keychain::api_key()?;

    let base_url = base_url.trim().trim_end_matches('/').to_string();
    if base_url.is_empty() {
        return Err("Add the API base URL in Settings.".to_string());
    }

    // Both wire formats expose the catalogue at `/v1/models`; verified against the live API.
    let url = format!("{base_url}/v1/models");
    let client = reqwest::Client::builder()
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

/// Reads a model list from whichever shape the API returns, keeping the API's own order.
/// One catalogue entry: the id to send, plus the endpoints it accepts when the provider says so.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub id: String,
    /// Endpoint paths the provider declares for this model, e.g. `/messages` or
    /// `/chat/completions`. Empty when the provider does not report them.
    pub endpoints: Vec<String>,
}

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
                    endpoints: Vec::new(),
                }),
                Value::Object(fields) => fields
                    .get("id")
                    .or_else(|| fields.get("name"))
                    .and_then(Value::as_str)
                    .map(|id| ModelEntry {
                        id: id.trim().to_string(),
                        endpoints: fields
                            .get("supported_endpoints")
                            .and_then(Value::as_array)
                            .map(|items| {
                                items
                                    .iter()
                                    .filter_map(Value::as_str)
                                    .map(|endpoint| endpoint.trim().to_string())
                                    .collect()
                            })
                            .unwrap_or_default(),
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
                        endpoints: Vec::new(),
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
    use super::{parse_models, ModelEntry};

    fn ids(body: &str) -> Vec<String> {
        parse_models(body).into_iter().map(|m| m.id).collect()
    }

    #[test]
    fn reads_the_anthropic_data_shape() {
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

    /// The provider declares which endpoint each model accepts; that decides the request format.
    #[test]
    fn reads_the_supported_endpoints_for_each_model() {
        let body = r#"{"data":[
            {"id":"claude-sonnet-5-5","supported_endpoints":["/messages"]},
            {"id":"deepseek/deepseek-v4-flash","supported_endpoints":["/chat/completions","/responses"]}
        ]}"#;

        assert_eq!(
            parse_models(body),
            vec![
                ModelEntry {
                    id: "claude-sonnet-5-5".to_string(),
                    endpoints: vec!["/messages".to_string()],
                },
                ModelEntry {
                    id: "deepseek/deepseek-v4-flash".to_string(),
                    endpoints: vec![
                        "/chat/completions".to_string(),
                        "/responses".to_string(),
                    ],
                },
            ]
        );
    }
}

/// Exercises the real command against a live API, so the URL and auth header are verified rather
/// than assumed. The base URL comes from the environment, because Iris is provider-neutral now and
/// the stored key may belong to any provider. Skipped when unset or no key is stored.
#[cfg(test)]
mod live_tests {
    #[test]
    fn list_models_returns_the_live_catalogue() {
        use std::process::Command;

        let Ok(base_url) = std::env::var("IRIS_TEST_BASE_URL") else {
            eprintln!("Skipping: set IRIS_TEST_BASE_URL to exercise a live provider");
            return;
        };

        let key = Command::new("/usr/bin/security")
            .args([
                "find-generic-password",
                "-s",
                "com.iris.desktop",
                "-a",
                "deepseek-api-key",
                "-w",
            ])
            .output()
            .ok()
            .filter(|out| out.status.success())
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .map(|value| value.trim().to_string());

        if key.filter(|value| !value.is_empty()).is_none() {
            eprintln!("Skipping: no API key in the Keychain");
            return;
        }

        let models = tauri::async_runtime::block_on(super::list_models(base_url))
            .expect("the live catalogue should load");

        assert!(!models.is_empty(), "no models returned");
        eprintln!("live models: {models:?}");
    }
}

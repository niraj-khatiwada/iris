/// DeepSeek-owned API paths. The UI only configures the origin, so every feature stays on the same
/// host and a proxy only has to forward DeepSeek's own routes.
pub const MESSAGES_PATH: &str = "/v1/messages";
pub const MODELS_PATH: &str = "/v1/models";
pub const TTS_PATH: &str = "/v1/tools/tts";
pub const ASR_PATH: &str = "/v1/tools/asr";

/// Joins the configured API origin with a fixed path, tolerating a trailing slash.
pub fn url(base_url: &str, path: &str) -> String {
    format!("{}{path}", base_url.trim().trim_end_matches('/'))
}

#[cfg(test)]
mod tests {
    use super::url;

    #[test]
    fn joins_an_origin_and_a_path() {
        assert_eq!(
            url("https://api.deepseek.com", "/v1/models"),
            "https://api.deepseek.com/v1/models"
        );
        assert_eq!(
            url("https://proxy.example.com/", "/v1/tools/tts"),
            "https://proxy.example.com/v1/tools/tts"
        );
        assert_eq!(url("  ", "/v1/messages"), "/v1/messages");
    }
}

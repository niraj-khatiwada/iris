/// Iris is a desktop app and talks to the configured API origin directly. Shell proxy variables
/// (`HTTP_PROXY`, `HTTPS_PROXY`, …) are often left behind by developer tools such as Proxyman and
/// must not redirect API traffic or break it when the proxy is no longer running.
pub fn client() -> reqwest::ClientBuilder {
    reqwest::Client::builder().no_proxy()
}

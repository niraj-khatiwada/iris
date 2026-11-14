/// The operating system this build runs on (`macos`, `windows`, `linux`).
pub fn name() -> &'static str {
    std::env::consts::OS
}

/// The CPU architecture this build targets (`aarch64`, `x86_64`, ...).
pub fn arch() -> &'static str {
    std::env::consts::ARCH
}

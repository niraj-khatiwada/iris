// Screen capture permission and settings. The region-capture UI will use these before invoking
// `screencapture`, so Iris asks for Screen Recording the same way Raycast does.
#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

pub fn has_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        // Safe: the function only reads the process's current TCC state.
        unsafe { CGPreflightScreenCaptureAccess() }
    }

    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

/// Shows the system's Screen Recording prompt once. The result is the state at prompt time;
/// macOS usually requires the app to be restarted after the user grants access.
pub fn request_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe { CGRequestScreenCaptureAccess() }
    }

    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

pub fn open_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

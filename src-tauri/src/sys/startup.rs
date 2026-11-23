//! Start-at-login plumbing. macOS owns the LaunchAgent, so the autostart plugin passes
//! `--autostart` when it launches Iris at sign-in. That argument is the only reliable way to
//! tell a login launch from a manual one, and it is what lets Iris stay in the menu bar without
//! revealing a window.

use std::path::PathBuf;

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt as AutostartExt;

/// Passed by the login item, never by a manual launch.
pub const AUTOSTART_ARG: &str = "--autostart";

/// The LaunchAgent's filename. It must match the name handed to the autostart plugin.
#[cfg(debug_assertions)]
pub const AUTOSTART_APP_NAME: &str = "Iris Dev";
#[cfg(not(debug_assertions))]
pub const AUTOSTART_APP_NAME: &str = "Iris";

/// Whether this process was started by the login item rather than opened by the user.
pub fn launched_at_login() -> bool {
    std::env::args_os().any(|arg| arg.to_string_lossy() == AUTOSTART_ARG)
}

/// Rewrites the login item when it predates the autostart argument. `is_enabled` only checks
/// that the plist exists, so an entry created by an older Iris would otherwise keep launching
/// without the argument and open the overlay on sign-in.
pub fn ensure_registration(app: &AppHandle) {
    // The LaunchAgent is macOS-only; other platforms write the argument into their own entry.
    if !cfg!(target_os = "macos") {
        return;
    }

    let autolaunch = app.autolaunch();

    match autolaunch.is_enabled() {
        Ok(true) if !registration_has_argument() => {
            if let Err(error) = autolaunch.enable() {
                log::warn!("Could not update the start at login entry: {error}");
            }
        }
        Ok(_) => {}
        Err(error) => log::warn!("Could not read the start at login state: {error}"),
    }
}

fn registration_has_argument() -> bool {
    let Some(home) = std::env::var_os("HOME") else {
        return false;
    };

    let path = PathBuf::from(home)
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{AUTOSTART_APP_NAME}.plist"));

    std::fs::read_to_string(path)
        .map(|contents| contents.contains(AUTOSTART_ARG))
        .unwrap_or(false)
}

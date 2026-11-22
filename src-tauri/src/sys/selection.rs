//! System-wide selected-text capture for the overlay's selection actions.
//!
//! The overlay is a non-activating panel, so the app the user selected text in stays frontmost
//! while Iris appears. Reading uses the Accessibility API first. When an app does not expose
//! `AXSelectedText`, Iris briefly copies the selection, restores the previous clipboard text, and
//! uses that instead. Secure fields are rejected whenever Accessibility can identify them.

use std::sync::Mutex;
use std::time::Duration;

use accessibility::{AXAttribute, AXUIElement, AXUIElementAttributes};
use accessibility_sys::{
    kAXTrustedCheckOptionPrompt, AXIsProcessTrusted, AXIsProcessTrustedWithOptions,
    AXUIElementGetPid,
};
use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use core_foundation::ConcreteCFType;
use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use objc2_app_kit::{
    NSApplicationActivationOptions, NSPasteboard, NSPasteboardTypeString, NSRunningApplication,
    NSWorkspace,
};
use objc2_foundation::NSString;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::utils::event;

/// DeepSeek can handle far more, but a selection action is not a document upload. This keeps a
/// stray ⌘A in a huge document from turning into a very large request.
const MAX_SELECTION_CHARS: usize = 24_000;
const COPY_SETTLE: Duration = Duration::from_millis(140);
const ACTIVATION_SETTLE: Duration = Duration::from_millis(250);
/// Keep the reply on the pasteboard long enough for a busy browser to handle ⌘V.
const CLIPBOARD_RESTORE_DELAY: Duration = Duration::from_millis(1_500);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectionOpenPayload {
    text: String,
    app_name: String,
    bundle_id: Option<String>,
    pid: i32,
    character_count: usize,
    from_clipboard: bool,
    truncated: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectionErrorPayload {
    message: String,
    permission_required: bool,
}

/// The selection is kept in Rust so the Replace action can return to the app the text came from.
#[derive(Default)]
pub struct SelectionState {
    current: Mutex<Option<SelectionContext>>,
}

struct SelectionContext {
    pid: i32,
    app_name: String,
}

impl SelectionState {
    fn store(&self, pid: i32, app_name: &str) {
        *self
            .current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(SelectionContext {
            pid,
            app_name: app_name.to_string(),
        });
    }

    fn current(&self) -> Option<(i32, String)> {
        self.current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(|context| (context.pid, context.app_name.clone()))
    }

    fn clear(&self) {
        *self
            .current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
    }
}

struct CapturedSelection {
    text: String,
    pid: i32,
    app_name: String,
    bundle_id: Option<String>,
    from_clipboard: bool,
    truncated: bool,
}

struct SelectionFailure {
    message: String,
    permission_required: bool,
}

impl SelectionFailure {
    fn permission() -> Self {
        Self {
            message: "Iris needs Accessibility access to read the selection. Enable Iris in \
                      System Settings → Privacy & Security → Accessibility, then try again. \
                      You may need to restart Iris after granting access."
                .to_string(),
            permission_required: true,
        }
    }

    fn secure() -> Self {
        Self {
            message: "Iris does not read or replace secure and password fields.".to_string(),
            permission_required: false,
        }
    }

    fn no_selection() -> Self {
        Self {
            message: "Select some text in another app, then use the selection shortcut again."
                .to_string(),
            permission_required: false,
        }
    }

    fn other(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            permission_required: false,
        }
    }
}

enum ReadError {
    Secure,
    NoSelectedText,
    /// The focused field could not be inspected. The caller may use the clipboard fallback.
    Unavailable(String),
}

/// Captures the frontmost app's selection and opens the overlay with the action strip.
pub fn trigger(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // If the overlay is already open it can be the key window while the source app remains
        // frontmost. Hide it first so Accessibility and the clipboard fallback see the app the
        // user actually selected text in.
        let hide_app = app.clone();
        if let Err(error) = on_main(&app, move || crate::sys::overlay::hide(&hide_app)) {
            log::warn!("Could not hide Iris before capturing the selection: {error}");
        }
        tokio::time::sleep(Duration::from_millis(80)).await;

        let result = capture(&app).await;

        // Show Iris after reading the selection, while the source app still has focus. AppKit
        // window ordering must run on the main thread; doing this on the Tokio worker trapped
        // inside NSWMWindowCoordinator.
        let show_app = app.clone();
        match on_main(&app, move || crate::sys::overlay::show(&show_app)) {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                log::warn!("Could not show Iris for selection actions: {error}");
            }
            Err(error) => {
                log::warn!("Could not reach the main thread to show Iris: {error}");
            }
        }

        match result {
            Ok(selection) => {
                log::info!(
                    "Captured {} selection characters from {} (clipboard fallback: {})",
                    selection.text.chars().count(),
                    selection.app_name,
                    selection.from_clipboard
                );
                if let Some(state) = app.try_state::<SelectionState>() {
                    state.store(selection.pid, &selection.app_name);
                }
                let character_count = selection.text.chars().count();
                let _ = app.emit(
                    event::SELECTION_OPEN,
                    SelectionOpenPayload {
                        text: selection.text,
                        app_name: selection.app_name,
                        bundle_id: selection.bundle_id,
                        pid: selection.pid,
                        character_count,
                        from_clipboard: selection.from_clipboard,
                        truncated: selection.truncated,
                    },
                );
            }
            Err(failure) => {
                log::warn!("Selection capture failed: {}", failure.message);
                if failure.permission_required {
                    let _ = on_main(&app, request_permission);
                }
                let _ = app.emit(
                    event::SELECTION_ERROR,
                    SelectionErrorPayload {
                        message: failure.message,
                        permission_required: failure.permission_required,
                    },
                );
            }
        }
    });
}

/// Replaces the captured selection with `text`. Returns an error when no selection is active or
/// the source app no longer accepts a write.
pub async fn replace(app: AppHandle, text: String) -> Result<(), String> {
    let Some((pid, _app_name)) = app
        .try_state::<SelectionState>()
        .and_then(|state| state.current())
    else {
        return Err("There is no captured selection to replace.".to_string());
    };

    if text.trim().is_empty() {
        return Err("There is nothing to put into the selection.".to_string());
    }
    if !is_trusted() {
        return Err(
            "Accessibility access is needed to replace the selection. Enable Iris in System \
             Settings → Privacy & Security → Accessibility."
                .to_string(),
        );
    }

    match set_ax_selection(pid, &text) {
        WriteResult::Written => {
            log::info!("Replaced the captured selection through Accessibility");
            let _ = activate_app(&app, pid);
            clear_context(&app);
            return Ok(());
        }
        WriteResult::Secure => {
            return Err("Iris does not write into secure and password fields.".to_string());
        }
        WriteResult::Unavailable => {
            log::info!("Accessibility focus is unavailable; using the clipboard to replace");
        }
        WriteResult::NotSettable => {}
    }

    paste_via_clipboard(&app, pid, &text).await?;
    log::info!("Replaced the captured selection through the clipboard fallback");
    clear_context(&app);
    Ok(())
}

/// Inserts `text` at the source app's current caret. Unlike Replace, this targets whatever text
/// field is focused in the source app, which is how a generated reply gets into a reply composer.
pub async fn paste(app: AppHandle, text: String) -> Result<(), String> {
    let Some((pid, _app_name)) = app
        .try_state::<SelectionState>()
        .and_then(|state| state.current())
    else {
        return Err("There is no captured selection to paste into.".to_string());
    };

    if text.trim().is_empty() {
        return Err("There is nothing to paste.".to_string());
    }
    if !is_trusted() {
        return Err(
            "Accessibility access is needed to paste into the source app. Enable Iris in System \
             Settings → Privacy & Security → Accessibility."
                .to_string(),
        );
    }

    // Prefer inserting into the focused editable field. This is the reliable path for a reply
    // composer and avoids the keyboard/clipboard race entirely.
    match paste_ax_editable(pid, &text) {
        WriteResult::Written => {
            log::info!("Pasted the result into the focused editable field");
            let _ = activate_app(&app, pid);
            return Ok(());
        }
        WriteResult::Secure => {
            return Err("Iris does not write into secure and password fields.".to_string());
        }
        WriteResult::NotSettable | WriteResult::Unavailable => {}
    }

    // Fall back to activating the source app and sending ⌘V. Do not use AXSelectedText here when
    // the focused element is not an editable text field: that could overwrite the original tweet.
    paste_via_clipboard(&app, pid, &text).await?;
    log::info!("Pasted the result at the source app's caret through the clipboard");
    Ok(())
}

fn paste_ax_editable(pid: i32, text: &str) -> WriteResult {
    let application = AXUIElement::application(pid);
    let _ = application.set_messaging_timeout(2.0);
    let Ok(focused) = copy_attribute::<AXUIElement>(&application, "AXFocusedUIElement") else {
        return WriteResult::Unavailable;
    };
    if is_secure(&focused) {
        return WriteResult::Secure;
    }
    if !is_editable_text_element(&focused) {
        return WriteResult::NotSettable;
    }

    let selected_attribute = AXAttribute::new(&CFString::from_static_string("AXSelectedText"));
    if !focused.is_settable(&selected_attribute).unwrap_or(false) {
        return WriteResult::NotSettable;
    }

    match focused.set_attribute(&selected_attribute, CFString::new(text).as_CFType()) {
        Ok(()) => WriteResult::Written,
        Err(_) => WriteResult::NotSettable,
    }
}

fn is_editable_text_element(element: &AXUIElement) -> bool {
    let role = element
        .role()
        .map(|role| role.to_string())
        .unwrap_or_default();
    matches!(
        role.as_str(),
        "AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField"
    )
}

async fn paste_via_clipboard(app: &AppHandle, pid: i32, text: &str) -> Result<(), String> {
    // Some editor and browser surfaces expose the caret but do not let AX write it. Paste as a
    // fallback, restoring the user's previous clipboard text afterwards. Do not paste if the
    // source app vanished: the frontmost app at that point could be anything.
    let previous = on_main(app, clipboard_snapshot)
        .map_err(|error| format!("Could not read the clipboard: {error}"))?;

    // The overlay is a non-activating panel and can still be the key window. Hide it first so
    // the source app becomes key; otherwise ⌘V is delivered to Iris, not the reply composer.
    let hide_app = app.clone();
    let _ = on_main(app, move || crate::sys::overlay::hide(&hide_app));

    if !activate_app(app, pid) {
        return Err("The app that owned the selection is no longer available.".to_string());
    }

    let replacement = text.to_string();
    on_main(app, move || set_clipboard_text(Some(&replacement)))
        .map_err(|error| format!("Could not write the clipboard: {error}"))?;
    let expected_change_count = on_main(app, clipboard_change_count).unwrap_or_default();

    // Let the app activation settle, then post ⌘V. Keep the reply on the pasteboard for a while
    // after the key event; Chromium may handle the paste asynchronously.
    tokio::time::sleep(ACTIVATION_SETTLE).await;
    send_command_key(9); // V

    let restore_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(CLIPBOARD_RESTORE_DELAY).await;
        let _ = on_main(&restore_app, move || {
            // If the user copied something in the meantime, leave their clipboard alone.
            if clipboard_change_count() == expected_change_count {
                restore_clipboard(Some(previous));
            }
        });
    });
    Ok(())
}

fn clear_context(app: &AppHandle) {
    if let Some(state) = app.try_state::<SelectionState>() {
        state.clear();
    }
}

async fn capture(app: &AppHandle) -> Result<CapturedSelection, SelectionFailure> {
    if !is_trusted() {
        return Err(SelectionFailure::permission());
    }

    let (pid, app_name, bundle_id) = frontmost_app(app)?;
    if pid == std::process::id() as i32 {
        return Err(SelectionFailure::other(
            "Select text in another app before using the selection shortcut.",
        ));
    }
    // Browsers briefly report no focused element while a click or selection settles. Retry before
    // giving up so the shortcut is not a race against the page.
    let mut ax = read_ax_selection(pid);
    for _ in 0..2 {
        if !matches!(&ax, Err(ReadError::Unavailable(_))) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(90)).await;
        ax = read_ax_selection(pid);
    }

    match ax {
        Ok(text) => {
            let (text, truncated) = truncate(text);
            return Ok(CapturedSelection {
                text,
                pid,
                app_name,
                bundle_id,
                from_clipboard: false,
                truncated,
            });
        }
        Err(ReadError::Secure) => return Err(SelectionFailure::secure()),
        Err(ReadError::Unavailable(error)) => {
            log::info!(
                "Accessibility focus is unavailable in {app_name}; using the clipboard fallback: {error}"
            );
        }
        Err(ReadError::NoSelectedText) => {}
    }

    // Clipboard fallback. AX cannot see the selection in every app, but a temporary ⌘C can. Let
    // the shortcut's modifiers come up first so Shift+Command+Space does not turn into ⌘⇧C.
    tokio::time::sleep(Duration::from_millis(140)).await;
    let previous = on_main(app, clipboard_snapshot).ok();
    let previous_count = previous.as_ref().map(|snapshot| snapshot.change_count);
    send_command_key(8); // C
    tokio::time::sleep(COPY_SETTLE).await;
    let copied = on_main(app, clipboard_snapshot).ok();
    let changed = copied
        .as_ref()
        .is_some_and(|snapshot| Some(snapshot.change_count) != previous_count);
    let text = copied
        .and_then(|snapshot| snapshot.text)
        .unwrap_or_default();
    let _ = on_main(app, move || restore_clipboard(previous));

    // No change means the app did not copy anything; do not mistake the old clipboard for a
    // selection.
    if !changed || text.trim().is_empty() {
        return Err(SelectionFailure::no_selection());
    }

    let (text, truncated) = truncate(text);
    Ok(CapturedSelection {
        text,
        pid,
        app_name,
        bundle_id,
        from_clipboard: true,
        truncated,
    })
}

fn truncate(text: String) -> (String, bool) {
    if text.chars().count() <= MAX_SELECTION_CHARS {
        return (text, false);
    }

    let truncated = text.chars().take(MAX_SELECTION_CHARS).collect();
    (truncated, true)
}

fn read_ax_selection(frontmost_pid: i32) -> Result<String, ReadError> {
    let focused = focused_element(frontmost_pid)?;

    if is_secure(&focused) {
        return Err(ReadError::Secure);
    }

    let selected = match copy_attribute::<CFString>(&focused, "AXSelectedText") {
        Ok(selected) => selected,
        Err(error) => {
            log::debug!("The focused field does not expose AXSelectedText: {error}");
            return Err(ReadError::NoSelectedText);
        }
    };
    let text = selected.to_string();
    if text.trim().is_empty() {
        return Err(ReadError::NoSelectedText);
    }

    Ok(text)
}

fn focused_element(frontmost_pid: i32) -> Result<AXUIElement, ReadError> {
    // Prefer the app's own tree: browser web content lives in a renderer process with a different
    // pid, so a system-wide pid check against the app would reject valid selections.
    let application = AXUIElement::application(frontmost_pid);
    let _ = application.set_messaging_timeout(2.0);
    let app_error = match copy_attribute::<AXUIElement>(&application, "AXFocusedUIElement") {
        Ok(focused) => return Ok(focused),
        Err(error) => error,
    };

    // Some browser windows expose focus on the window rather than the application element.
    let window_error = match copy_attribute::<AXUIElement>(&application, "AXFocusedWindow")
        .and_then(|window| copy_attribute::<AXUIElement>(&window, "AXFocusedUIElement"))
    {
        Ok(focused) => return Ok(focused),
        Err(error) => error,
    };

    let system = AXUIElement::system_wide();
    let _ = system.set_messaging_timeout(2.0);
    let focused = match copy_attribute::<AXUIElement>(&system, "AXFocusedUIElement") {
        Ok(focused) => focused,
        Err(system_error) => {
            return Err(ReadError::Unavailable(format!(
                "app: {app_error}; window: {window_error}; system: {system_error}"
            )));
        }
    };

    // Never read Iris's own focused webview, even when it happens to be the system-wide focus.
    let mut focused_pid = 0;
    let pid_status =
        unsafe { AXUIElementGetPid(focused.as_concrete_TypeRef(), &mut focused_pid as *mut i32) };
    if pid_status == 0 && focused_pid == std::process::id() as i32 {
        return Err(ReadError::Unavailable(
            "system-wide focus belongs to Iris".to_string(),
        ));
    }

    Ok(focused)
}

fn copy_attribute<T: ConcreteCFType>(
    element: &AXUIElement,
    name: &'static str,
) -> Result<T, String> {
    let attribute = AXAttribute::new(&CFString::from_static_string(name));
    let value: CFType = element
        .attribute(&attribute)
        .map_err(|error| error.to_string())?;
    value
        .downcast::<T>()
        .ok_or_else(|| format!("The {name} attribute has an unexpected type."))
}

fn is_secure(element: &AXUIElement) -> bool {
    for value in [element.role(), element.subrole()].into_iter().flatten() {
        let value = value.to_string();
        if value == "AXSecureTextField" || value == "AXSecureTextArea" {
            return true;
        }
    }

    element
        .role_description()
        .ok()
        .is_some_and(|description| description.to_string().to_lowercase().contains("secure"))
}

enum WriteResult {
    Written,
    Secure,
    NotSettable,
    /// The focused field could not be inspected, so writing (even by paste) is not safe.
    Unavailable,
}

fn set_ax_selection(pid: i32, text: &str) -> WriteResult {
    let application = AXUIElement::application(pid);
    let _ = application.set_messaging_timeout(2.0);
    let Ok(focused) = copy_attribute::<AXUIElement>(&application, "AXFocusedUIElement") else {
        return WriteResult::Unavailable;
    };
    if is_secure(&focused) {
        return WriteResult::Secure;
    }

    let selected_attribute = AXAttribute::new(&CFString::from_static_string("AXSelectedText"));
    if !focused.is_settable(&selected_attribute).unwrap_or(false) {
        return WriteResult::NotSettable;
    }

    match focused.set_attribute(&selected_attribute, CFString::new(text).as_CFType()) {
        Ok(()) => WriteResult::Written,
        Err(_) => WriteResult::NotSettable,
    }
}

fn frontmost_app(app: &AppHandle) -> Result<(i32, String, Option<String>), SelectionFailure> {
    let result = on_main(app, || -> Result<(i32, String, Option<String>), String> {
        let workspace = NSWorkspace::sharedWorkspace();
        let application = workspace
            .frontmostApplication()
            .ok_or_else(|| "Could not find the frontmost app.".to_string())?;
        let pid = application.processIdentifier();
        let name = application
            .localizedName()
            .map(|name| name.to_string())
            .unwrap_or_else(|| "this app".to_string());
        let bundle_id = application
            .bundleIdentifier()
            .map(|bundle_id| bundle_id.to_string());
        Ok((pid, name, bundle_id))
    })
    .map_err(SelectionFailure::other)?;

    result.map_err(SelectionFailure::other)
}

fn activate_app(app: &AppHandle, pid: i32) -> bool {
    on_main(app, move || {
        let Some(application) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
        else {
            return false;
        };
        application.activateWithOptions(NSApplicationActivationOptions::empty())
    })
    .unwrap_or(false)
}

fn is_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

fn request_permission() -> bool {
    let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
    let options = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::true_value())]);
    unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) }
}

pub fn has_permission() -> bool {
    is_trusted()
}

pub fn prompt_for_permission() -> bool {
    request_permission()
}

pub fn open_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open System Settings: {error}"))
}

#[derive(Clone)]
struct ClipboardSnapshot {
    text: Option<String>,
    change_count: i64,
}

fn clipboard_snapshot() -> ClipboardSnapshot {
    let pasteboard = NSPasteboard::generalPasteboard();
    ClipboardSnapshot {
        text: pasteboard
            .stringForType(unsafe { NSPasteboardTypeString })
            .map(|value| value.to_string()),
        change_count: pasteboard.changeCount() as i64,
    }
}

fn clipboard_change_count() -> i64 {
    NSPasteboard::generalPasteboard().changeCount() as i64
}

fn restore_clipboard(snapshot: Option<ClipboardSnapshot>) {
    // Text is the only representation Iris snapshots. When the previous clipboard was an image
    // or file, leave the current pasteboard alone rather than clearing it.
    if let Some(text) = snapshot.and_then(|snapshot| snapshot.text) {
        set_clipboard_text(Some(&text));
    }
}

fn set_clipboard_text(text: Option<&str>) {
    let pasteboard = NSPasteboard::generalPasteboard();
    let _ = pasteboard.clearContents();
    if let Some(text) = text {
        if !text.is_empty() {
            let value = NSString::from_str(text);
            let _ = pasteboard.setString_forType(&value, unsafe { NSPasteboardTypeString });
        }
    }
}

fn send_command_key(keycode: u16) {
    let Ok(source) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) else {
        log::warn!("Could not create a keyboard event source for selection actions");
        return;
    };

    if let Ok(event) = CGEvent::new_keyboard_event(source.clone(), keycode, true) {
        event.set_flags(CGEventFlags::CGEventFlagCommand);
        event.post(CGEventTapLocation::HID);
    }

    // Some apps ignore a down/up pair posted in the same instant.
    std::thread::sleep(Duration::from_millis(20));

    if let Ok(event) = CGEvent::new_keyboard_event(source, keycode, false) {
        event.set_flags(CGEventFlags::CGEventFlagCommand);
        event.post(CGEventTapLocation::HID);
    }
}

/// Runs AppKit and pasteboard work on the main thread, where those APIs belong.
fn on_main<T: Send + 'static>(
    app: &AppHandle,
    task: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let (sender, receiver) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(task());
    })
    .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|error| format!("The main thread did not answer: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{truncate, MAX_SELECTION_CHARS};

    #[test]
    fn short_selections_are_left_alone() {
        let (text, truncated) = truncate("hello".to_string());
        assert_eq!(text, "hello");
        assert!(!truncated);
    }

    #[test]
    fn long_selections_are_capped() {
        let (text, truncated) = truncate("a".repeat(MAX_SELECTION_CHARS + 500));
        assert_eq!(text.chars().count(), MAX_SELECTION_CHARS);
        assert!(truncated);
    }
}

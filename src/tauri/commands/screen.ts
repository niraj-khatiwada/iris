import { invoke } from '@tauri-apps/api/core'

/** Whether macOS has already granted Iris Screen Recording access. */
export function getScreenCapturePermission() {
  return invoke<boolean>('get_screen_capture_permission')
}

/** Triggers the system Screen Recording prompt. macOS may require an app restart afterwards. */
export function requestScreenCapturePermission() {
  return invoke<boolean>('request_screen_capture_permission')
}

/** Opens System Settings -> Privacy & Security -> Screen Recording. */
export function openScreenCaptureSettings() {
  return invoke<void>('open_screen_capture_settings')
}

/** Opens the live selection overlay. The screen keeps playing; nothing is captured yet. */
export function startScreenCapture() {
  return invoke<void>('start_screen_capture')
}

/**
 * Captures the display under the live capture panel after its selection chrome is hidden. The
 * annotations are part of the capture window, so the returned image already includes them.
 */
export function captureAnnotatedScreen() {
  return invoke<string>('capture_annotated_screen')
}

/** Closes the capture window and brings the quick overlay back. */
export function closeScreenCapture() {
  return invoke<void>('close_screen_capture')
}

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

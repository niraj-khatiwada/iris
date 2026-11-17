import { invoke } from '@tauri-apps/api/core'

import type { AppInfo } from '@/types/app'

export function getAppInfo() {
  return invoke<AppInfo>('get_app_info')
}

export function showMainWindow() {
  return invoke<void>('show_main_window')
}

/** Reloads the main and overlay webviews without restarting the Iris process. */
export function reloadAppWindows() {
  return invoke<void>('reload_app_windows')
}

/** Wipes backend-owned Iris data: conversations, summaries, speech audio, and old data copies. */
export function resetAppData() {
  return invoke<void>('reset_app_data')
}

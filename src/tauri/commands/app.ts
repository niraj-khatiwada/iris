import { invoke } from '@tauri-apps/api/core'

import type { AppInfo } from '@/types/app'

export function getAppInfo() {
  return invoke<AppInfo>('get_app_info')
}

export function showMainWindow() {
  return invoke<void>('show_main_window')
}

export function restartApp() {
  return invoke<void>('restart_app')
}

/** Wipes backend-owned Iris data: conversations, summaries, speech audio, and old data copies. */
export function resetAppData() {
  return invoke<void>('reset_app_data')
}

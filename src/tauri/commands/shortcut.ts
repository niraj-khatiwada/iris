import { invoke } from '@tauri-apps/api/core'

/** Replaces the global shortcut that opens the quick overlay. */
export function setOpenShortcut(shortcut: string) {
  return invoke<void>('set_open_shortcut', { shortcut })
}

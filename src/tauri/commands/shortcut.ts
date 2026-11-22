import { invoke } from '@tauri-apps/api/core'

/** Replaces the global shortcut that opens the quick overlay. */
export function setOpenShortcut(shortcut: string) {
  return invoke<void>('set_open_shortcut', { shortcut })
}

/** Replaces the global shortcut that captures selected text. */
export function setSelectionShortcut(shortcut: string) {
  return invoke<void>('set_selection_shortcut', { shortcut })
}

/** Replaces the global shortcut that captures the whole display for a quick question. */
export function setScreenAskShortcut(shortcut: string) {
  return invoke<void>('set_screen_ask_shortcut', { shortcut })
}

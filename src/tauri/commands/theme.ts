import { invoke } from '@tauri-apps/api/core'

/**
 * Sets the history window's native appearance. The quick overlay is a separate window that
 * follows the macOS appearance, so this must not change the app-wide preferred appearance.
 */
export function setMainWindowTheme(theme: 'light' | 'dark' | null) {
  return invoke<void>('set_main_window_theme', { theme })
}

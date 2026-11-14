/** Whether the frontend is running inside a Tauri webview. */
export function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

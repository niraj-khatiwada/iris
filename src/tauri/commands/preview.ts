import { invoke } from '@tauri-apps/api/core'

/** Shows an attachment in the full-screen Iris preview window above the overlay. */
export function showImagePreview(source: string, dataUrl: string) {
  return invoke<void>('show_image_preview', { source, dataUrl })
}

/** Closes the preview and restores focus to the window it came from. */
export function closeImagePreview() {
  return invoke<void>('close_image_preview')
}

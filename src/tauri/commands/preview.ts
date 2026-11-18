import { invoke } from '@tauri-apps/api/core'

/** The image the preview should show, plus where its original bytes can be found. */
export type ImagePreviewRequest = {
  /** Label of the window that opened the preview (`overlay` or `main`). */
  source: string
  /** Asset-protocol URL or inline data URL shown in the lightbox. */
  url: string
  /** Name offered by the save dialog. */
  name: string
  /** Set when the image is a stored attachment. */
  conversationId?: string | null
  fileName?: string | null
}

/** Shows an attachment in the full-screen Iris preview window above the overlay. */
export function showImagePreview({
  source,
  url,
  name,
  conversationId,
  fileName,
}: ImagePreviewRequest) {
  return invoke<void>('show_image_preview', {
    source,
    url,
    name,
    conversationId: conversationId ?? null,
    fileName: fileName ?? null,
  })
}

/** Closes the preview and restores focus to the window it came from. */
export function closeImagePreview() {
  return invoke<void>('close_image_preview')
}

/** Copies the image on screen to the system clipboard. */
export function copyPreviewImage() {
  return invoke<void>('copy_preview_image')
}

/** Writes the image on screen to the path chosen in the save dialog. */
export function savePreviewImage(destination: string) {
  return invoke<void>('save_preview_image', { destination })
}

import { invoke } from '@tauri-apps/api/core'

export type StoredAttachmentFiles = {
  fileName: string
  previewName: string | null
}

/** Writes the original file (and the image preview) into the conversation's local folder. */
export function storeAttachment(request: {
  conversationId: string
  attachmentId: string
  name: string
  kind: 'image' | 'document'
  originalData: string
  previewData?: string
}) {
  return invoke<StoredAttachmentFiles>('store_attachment', request)
}

export function attachmentPath(conversationId: string, fileName: string) {
  return invoke<string>('attachment_path', { conversationId, fileName })
}

export function attachmentDataUrl(
  conversationId: string,
  fileName: string,
  mediaType: string,
) {
  return invoke<string>('attachment_data_url', {
    conversationId,
    fileName,
    mediaType,
  })
}

export function copyAttachment(request: {
  conversationId: string
  fileName: string
  destination: string
}) {
  return invoke<void>('copy_attachment', request)
}

export function deleteAttachmentFiles(
  conversationId: string,
  fileNames: string[],
) {
  return invoke<void>('delete_attachment_files', {
    conversationId,
    fileNames,
  })
}

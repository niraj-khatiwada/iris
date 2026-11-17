import { invoke } from '@tauri-apps/api/core'

import type { DocumentPurpose } from '@/types/chat'

export type UploadedDocument = { id: string }

/** Uploads one document to DeepSeek's Files API; the key stays in Rust. */
export function uploadDocument(request: {
  baseUrl: string
  conversationId: string
  fileName: string
  displayName: string
  mimeType: string
  purpose: DocumentPurpose
}) {
  return invoke<UploadedDocument>('upload_document', { request })
}

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type {
  SelectionErrorPayload,
  SelectionOpenPayload,
} from '@/types/selection'

export function subscribeToSelectionOpen(
  handler: (payload: SelectionOpenPayload) => void,
): Promise<UnlistenFn> {
  return listen<SelectionOpenPayload>('selection:open', (event) =>
    handler(event.payload),
  )
}

export function subscribeToSelectionError(
  handler: (payload: SelectionErrorPayload) => void,
): Promise<UnlistenFn> {
  return listen<SelectionErrorPayload>('selection:error', (event) =>
    handler(event.payload),
  )
}

/** Puts one reply into the selection captured when the action strip opened. */
export function replaceSelection(text: string) {
  return invoke<void>('replace_selection', { text })
}

/** Inserts one reply at the source app's current caret. */
export function pasteSelection(text: string) {
  return invoke<void>('paste_selection', { text })
}

export function getSelectionPermission() {
  return invoke<boolean>('get_selection_permission')
}

export function requestSelectionPermission() {
  return invoke<boolean>('request_selection_permission')
}

export function openSelectionSettings() {
  return invoke<void>('open_selection_settings')
}

export type SelectionMetadata = {
  messageId: string
  conversationId: string
  sourceApp: string
  sourceBundleId: string | null
  sourcePid: number
  /** The quick-prompt id (`explain`, `reply`, a generated id, or `custom`). */
  action: string
  characterCount: number
  truncated: boolean
  fromClipboard: boolean
}

/** Persists where a selection action came from, linked to its user message. */
export function saveSelectionMetadata(metadata: SelectionMetadata) {
  return invoke<void>('save_selection_metadata', { metadata })
}

/** Provenance rows for one conversation; reserved for a future source badge. */
export function loadSelectionMetadata(conversationId: string) {
  return invoke<SelectionMetadata[]>('load_selection_metadata', {
    conversationId,
  })
}

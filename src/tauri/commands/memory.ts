import { invoke } from '@tauri-apps/api/core'

/** One remembered fact from the persistent memory store. */
export type MemoryItem = {
  id: string
  content: string
  sourceConversationId: string | null
  sourceMessageId: string | null
  createdAt: number
  updatedAt: number
  paused: boolean
  userEdited: boolean
  batchId: string | null
}

/** Every current memory, newest first. */
export function listMemories() {
  return invoke<MemoryItem[]>('list_memories')
}

/** Corrects one memory. User edits are never overwritten by automatic learning. */
export function updateMemory(id: string, content: string) {
  return invoke<void>('update_memory', { id, content })
}

/** Pauses one memory without deleting it. */
export function setMemoryPaused(id: string, paused: boolean) {
  return invoke<void>('set_memory_paused', { id, paused })
}

export function deleteMemory(id: string) {
  return invoke<void>('delete_memory', { id })
}

export function clearMemories() {
  return invoke<void>('clear_memories')
}

/** Stops memory runs that are waiting for idle or still calling the model. */
export function cancelPendingMemory() {
  return invoke<void>('cancel_pending_memory')
}

/** Reverts the newest automatically learned batch and returns how many items changed. */
export function undoLastMemoryBatch() {
  return invoke<number>('undo_last_memory_batch')
}

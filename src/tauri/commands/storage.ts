import { invoke } from '@tauri-apps/api/core'

import type { Conversation } from '@/types/chat'

export function loadConversations() {
  return invoke<Conversation[]>('load_conversations')
}

export function saveConversation(conversation: Conversation) {
  return invoke<void>('save_conversation', { conversation })
}

export function saveConversations(conversations: Conversation[]) {
  return invoke<void>('save_conversations', { conversations })
}

export function deleteConversation(id: string) {
  return invoke<void>('delete_conversation', { id })
}

export function clearConversations() {
  return invoke<void>('clear_conversations')
}

import { invoke } from '@tauri-apps/api/core'

import type {
  ChatMessage,
  Conversation,
  ConversationSummary,
  MessagePage,
} from '@/types/chat'

export function loadConversations() {
  return invoke<ConversationSummary[]>('load_conversations')
}

export function loadMessagePage(
  conversationId: string,
  before: string | null,
  limit: number,
) {
  return invoke<MessagePage>('load_message_page', {
    conversationId,
    before,
    limit,
  })
}

export function saveConversationMeta(conversation: ConversationSummary) {
  return invoke<void>('save_conversation_meta', { conversation })
}

export function saveMessage(conversationId: string, message: ChatMessage) {
  return invoke<void>('save_message', { conversationId, message })
}

export function deleteMessages(ids: string[]) {
  return invoke<void>('delete_messages', { ids })
}

/** Moves every message to another conversation, used when quick chats are archived. */
export function moveConversationMessages(from: string, to: string) {
  return invoke<void>('move_conversation_messages', { from, to })
}

/** Restores a previous quick conversation, optionally retiring the current one first. */
export function restoreQuickConversation(
  quick: string,
  previous: string,
  retired: string | null,
) {
  return invoke<void>('restore_quick_conversation', {
    quick,
    previous,
    retired,
  })
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

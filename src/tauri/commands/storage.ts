import { invoke } from '@tauri-apps/api/core'

import type {
  ChatMessage,
  Conversation,
  ConversationSummary,
  MessagePage,
  SearchResults,
  SpokenSummary,
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

/** Cached spoken summaries for one conversation, used by the history summary view. */
export function loadSpokenSummaries(conversationId: string) {
  return invoke<SpokenSummary[]>('load_spoken_summaries', { conversationId })
}

/** Full-text search over conversation titles and message bodies. */
export function searchHistory(query: string, limit = 50) {
  return invoke<SearchResults>('search_history', { query, limit })
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

/** The normal UUID conversation the quick overlay should show. */
export function loadQuickConversationId() {
  return invoke<string | null>('quick_conversation_id')
}

/** Points the overlay at a conversation, or clears the pointer with `null`. */
export function saveQuickConversationId(id: string | null) {
  return invoke<void>('set_quick_conversation_id', { id })
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

/** Deletes unarchived conversations with no messages, keeping the given ids. */
export function deleteEmptyConversations(keepIds: string[]) {
  return invoke<string[]>('delete_empty_conversations', { keepIds })
}

export function clearConversations() {
  return invoke<void>('clear_conversations')
}

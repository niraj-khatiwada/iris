import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { AgentMessage, ChatSource } from '@/types/chat'
import type { ThinkingEffort } from '@/types/settings'

const CHAT_TOKEN_EVENT = 'chat:token'
const CHAT_THINKING_EVENT = 'chat:thinking'
const CHAT_SOURCES_EVENT = 'chat:sources'
const CHAT_DONE_EVENT = 'chat:done'
const CHAT_ERROR_EVENT = 'chat:error'

export type ChatTokenPayload = {
  requestId: string
  token: string
}

export type ChatThinkingPayload = {
  requestId: string
  token: string
}

export type ChatSourcesPayload = {
  requestId: string
  sources: ChatSource[]
}

export type ChatDonePayload = {
  requestId: string
  cancelled: boolean
}

export type ChatErrorPayload = {
  requestId: string
  message: string
}

export function sendMessage(request: {
  requestId: string
  conversationId: string
  messages: AgentMessage[]
  baseUrl: string
  model: string
  systemPrompt: string
  autoSpeak: boolean
  assistantMessageId: string
  summarizeSpeech: boolean
  thinkingEffort: ThinkingEffort
  memoryEnabled: boolean
  ttsVoice: string
}) {
  return invoke<void>('send_message', { request })
}

export function cancelGeneration(requestId?: string) {
  return invoke<void>('cancel_generation', { requestId })
}

/** Asks DeepSeek for a short title for the first message in a conversation. */
export function generateConversationTitle(request: {
  baseUrl: string
  model: string
  prompt: string
}) {
  return invoke<string>('generate_conversation_title', request)
}

export function subscribeToChatToken(
  handler: (payload: ChatTokenPayload) => void,
): Promise<UnlistenFn> {
  return listen<ChatTokenPayload>(CHAT_TOKEN_EVENT, (event) =>
    handler(event.payload),
  )
}

export function subscribeToChatThinking(
  handler: (payload: ChatThinkingPayload) => void,
): Promise<UnlistenFn> {
  return listen<ChatThinkingPayload>(CHAT_THINKING_EVENT, (event) =>
    handler(event.payload),
  )
}

export function subscribeToChatSources(
  handler: (payload: ChatSourcesPayload) => void,
): Promise<UnlistenFn> {
  return listen<ChatSourcesPayload>(CHAT_SOURCES_EVENT, (event) =>
    handler(event.payload),
  )
}

export function subscribeToChatDone(
  handler: (payload: ChatDonePayload) => void,
): Promise<UnlistenFn> {
  return listen<ChatDonePayload>(CHAT_DONE_EVENT, (event) =>
    handler(event.payload),
  )
}

export function subscribeToChatError(
  handler: (payload: ChatErrorPayload) => void,
): Promise<UnlistenFn> {
  return listen<ChatErrorPayload>(CHAT_ERROR_EVENT, (event) =>
    handler(event.payload),
  )
}

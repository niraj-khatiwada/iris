import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { AgentMessage } from '@/types/chat'

const CHAT_TOKEN_EVENT = 'chat:token'
const CHAT_DONE_EVENT = 'chat:done'
const CHAT_ERROR_EVENT = 'chat:error'

export type ChatTokenPayload = {
  requestId: string
  token: string
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
  apiKey: string
  baseUrl: string
  model: string
  autoSpeak: boolean
  deepThink: boolean
  webSearch: boolean
  ttsVoice: string
}) {
  return invoke<void>('send_message', { request })
}

export function cancelGeneration(requestId?: string) {
  return invoke<void>('cancel_generation', { requestId })
}

export function subscribeToChatToken(
  handler: (payload: ChatTokenPayload) => void,
): Promise<UnlistenFn> {
  return listen<ChatTokenPayload>(CHAT_TOKEN_EVENT, (event) =>
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

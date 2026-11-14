import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { AgentMessage } from '@/types/chat'

const CHAT_TOKEN_EVENT = 'chat:token'
const CHAT_DONE_EVENT = 'chat:done'

export type ChatTokenPayload = {
  requestId: string
  token: string
}

export type ChatDonePayload = {
  requestId: string
  cancelled: boolean
}

export function sendMessage(request: {
  requestId: string
  conversationId: string
  messages: AgentMessage[]
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

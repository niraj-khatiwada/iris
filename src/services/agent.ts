import {
  cancelGeneration,
  sendMessage,
  subscribeToChatDone,
  subscribeToChatError,
  subscribeToChatToken,
} from '@/tauri/commands/chat'
import type { AgentMessage } from '@/types/chat'
import type { TtsVoice } from '@/types/settings'
import { newId } from '@/utils/id'
import { isTauri } from '@/utils/tauri'

export type AgentRunOptions = {
  conversationId: string
  messages: AgentMessage[]
  apiKey: string
  baseUrl: string
  model: string
  autoSpeak: boolean
  ttsVoice: TtsVoice
  onToken: (token: string) => void
  onDone: (result: { cancelled: boolean }) => void
  onError: (message: string) => void
}

let activeRun: { cancel: () => void } | null = null

/** Cancels the in-flight response, if there is one. */
export function cancelActiveRun() {
  activeRun?.cancel()
  activeRun = null
}

/**
 * Starts a response and returns its request id immediately. Tokens arrive through the
 * callbacks; the returned id is used to ignore stale events in the chat store.
 */
export function startAgentRun(options: AgentRunOptions): string {
  cancelActiveRun()

  const requestId = newId()
  let finished = false
  let cleanup = () => {}

  const finish = (result: { cancelled: boolean }, error?: string) => {
    if (finished) {
      return
    }

    finished = true
    activeRun = null
    cleanup()

    if (error) {
      options.onError(error)
    } else {
      options.onDone(result)
    }
  }

  if (isTauri()) {
    activeRun = {
      cancel: () => {
        void cancelGeneration(requestId)
        finish({ cancelled: true })
      },
    }

    void (async () => {
      try {
        const offToken = await subscribeToChatToken((payload) => {
          if (payload.requestId === requestId) {
            options.onToken(payload.token)
          }
        })
        const offDone = await subscribeToChatDone((payload) => {
          if (payload.requestId === requestId) {
            finish({ cancelled: payload.cancelled })
          }
        })
        const offError = await subscribeToChatError((payload) => {
          if (payload.requestId === requestId) {
            finish({ cancelled: false }, payload.message)
          }
        })

        cleanup = () => {
          offToken()
          offDone()
          offError()
        }

        if (finished) {
          cleanup()
          return
        }

        await sendMessage({
          requestId,
          conversationId: options.conversationId,
          messages: options.messages,
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          model: options.model,
          autoSpeak: options.autoSpeak,
          ttsVoice: options.ttsVoice,
        })
      } catch (error) {
        finish(
          { cancelled: false },
          error instanceof Error ? error.message : String(error),
        )
      }
    })()

    return requestId
  }

  // Browser preview: same streaming contract, so the UI can be developed with `bun run vite:dev`.
  const chunks = buildPreviewReply(options.messages)
    .split(/(\s+)/)
    .filter(Boolean)
  let index = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = () => {
    if (finished) {
      return
    }

    const chunk = chunks.slice(index, index + 2).join('')
    index += 2

    if (chunk) {
      options.onToken(chunk)
    }

    if (index >= chunks.length) {
      finish({ cancelled: false })
      return
    }

    timer = setTimeout(tick, 20)
  }

  timer = setTimeout(tick, 320)
  activeRun = {
    cancel: () => {
      if (timer) {
        clearTimeout(timer)
      }
      finish({ cancelled: true })
    },
  }

  return requestId
}

function buildPreviewReply(messages: AgentMessage[]) {
  const latest = [...messages]
    .reverse()
    .find((message) => message.role === 'user')
    ?.content.trim()

  return [
    "You're running in **browser preview**.",
    latest ? `\n\nYou said: "${latest}"` : '',
    '\n\nOpen the desktop app with `bun run tauri:dev` to use the native streaming backend.',
  ].join('')
}

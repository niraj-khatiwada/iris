import { useEffect } from 'react'

import { useSpeechStore } from '@/stores/speechStore'
import { useSummaryStore } from '@/stores/summaryStore'
import {
  subscribeToSpeechEnd,
  subscribeToSpeechError,
  subscribeToSpeechPreparing,
  subscribeToSpeechStart,
} from '@/tauri/commands/voice'
import { isTauri } from '@/utils/tauri'

/**
 * Follows the backend's automatic read-aloud into the shared speech store.
 *
 * Events are not filtered by conversation: exactly one reply is spoken at a time, so the state
 * belongs to the app rather than to the conversation it started from. Mount this once per window.
 */
export function useSpeechPlayback() {
  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let disposed = false
    const cleanup: Array<() => void> = []
    const { setState } = useSpeechStore

    const track = (subscribe: () => Promise<() => void>) => {
      void subscribe().then((off) => {
        if (disposed) {
          off()
        } else {
          cleanup.push(off)
        }
      })
    }

    track(() =>
      subscribeToSpeechPreparing(({ conversationId }) => {
        setState({
          conversationId,
          preparing: true,
          speaking: false,
          error: null,
        })
      }),
    )
    track(() =>
      subscribeToSpeechStart(({ conversationId }) => {
        setState({
          conversationId,
          preparing: false,
          speaking: true,
          error: null,
        })
        // The backend stores the spoken summary before TTS starts, so this is the moment the
        // transcript can switch to it if the conversation's summary view is already on.
        void useSummaryStore.getState().load(conversationId, true)
      }),
    )
    track(() =>
      subscribeToSpeechEnd(() => {
        setState({ conversationId: null, preparing: false, speaking: false })
      }),
    )
    track(() =>
      subscribeToSpeechError(({ message }) => {
        // Keep the reason on screen: a silent failure leaves the user guessing.
        setState({
          conversationId: null,
          preparing: false,
          speaking: false,
          error: message,
        })
      }),
    )

    return () => {
      disposed = true
      for (const off of cleanup) {
        off()
      }
    }
  }, [])
}

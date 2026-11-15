import { useEffect, useState } from 'react'

import {
  subscribeToSpeechEnd,
  subscribeToSpeechPreparing,
  subscribeToSpeechStart,
} from '@/tauri/commands/voice'
import { isTauri } from '@/utils/tauri'

/**
 * Tracks the backend's automatic read-aloud. `preparing` covers the gap between the reply and
 * playback while the TTS audio is still downloading.
 */
export function useSpeechPlayback(conversationId?: string) {
  const [speaking, setSpeaking] = useState(false)
  const [preparing, setPreparing] = useState(false)

  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let disposed = false
    const cleanup: Array<() => void> = []

    const track = (
      subscribe: (
        handler: (payload: { conversationId: string }) => void,
      ) => Promise<() => void>,
      handler: (payload: { conversationId: string }) => void,
    ) => {
      void subscribe((payload) => {
        if (!conversationId || payload.conversationId === conversationId) {
          handler(payload)
        }
      }).then((off) => {
        if (disposed) {
          off()
        } else {
          cleanup.push(off)
        }
      })
    }

    track(subscribeToSpeechPreparing, () => {
      setPreparing(true)
    })
    track(subscribeToSpeechStart, () => {
      setPreparing(false)
      setSpeaking(true)
    })
    track(subscribeToSpeechEnd, () => {
      setPreparing(false)
      setSpeaking(false)
    })

    return () => {
      disposed = true
      for (const off of cleanup) {
        off()
      }
    }
  }, [conversationId])

  return { speaking, preparing }
}

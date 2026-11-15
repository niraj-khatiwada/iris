import { useEffect, useState } from 'react'

import {
  subscribeToSpeechEnd,
  subscribeToSpeechStart,
} from '@/tauri/commands/voice'
import { isTauri } from '@/utils/tauri'

/** Tracks the backend's automatic read-aloud so the overlay can show a speaking state. */
export function useSpeechPlayback(conversationId?: string) {
  const [speaking, setSpeaking] = useState(false)

  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let disposed = false
    let offStart: (() => void) | undefined
    let offEnd: (() => void) | undefined

    void subscribeToSpeechStart((payload) => {
      if (!conversationId || payload.conversationId === conversationId) {
        setSpeaking(true)
      }
    }).then((off) => {
      if (disposed) {
        off()
      } else {
        offStart = off
      }
    })
    void subscribeToSpeechEnd((payload) => {
      if (!conversationId || payload.conversationId === conversationId) {
        setSpeaking(false)
      }
    }).then((off) => {
      if (disposed) {
        off()
      } else {
        offEnd = off
      }
    })

    return () => {
      disposed = true
      offStart?.()
      offEnd?.()
    }
  }, [conversationId])

  return speaking
}

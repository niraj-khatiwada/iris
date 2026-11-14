import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'

import { useChatStore } from '@/stores/chatStore'
import { isTauri } from '@/utils/tauri'

/**
 * The overlay and the history window each have their own Zustand instance but share the same
 * localStorage. Rehydrate when the history window comes forward so quick chats started in the
 * overlay appear without a reload.
 */
export function useHistorySync() {
  useEffect(() => {
    if (!isTauri()) {
      return
    }

    const appWindow = getCurrentWindow()
    let unlisten: (() => void) | undefined

    void appWindow
      .onFocusChanged(({ payload: focused }) => {
        if (!focused || useChatStore.getState().streamingRequestId) {
          return
        }
        void useChatStore.persist.rehydrate()
      })
      .then((off) => {
        unlisten = off
      })

    return () => {
      unlisten?.()
    }
  }, [])
}

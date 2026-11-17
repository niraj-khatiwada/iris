import { useEffect } from 'react'

import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { hideMainWindow } from '@/tauri/commands/app'
import { isTauri } from '@/utils/tauri'

/** Global desktop shortcuts, matched to the habits of a macOS assistant. */
export function useKeyboardShortcuts() {
  const createConversation = useChatStore((state) => state.createConversation)
  const stopStreaming = useChatStore((state) => state.stopStreaming)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const openSettings = useUIStore((state) => state.openSettings)
  const closeSettings = useUIStore((state) => state.closeSettings)
  const focusComposer = useUIStore((state) => state.focusComposer)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (
        event.key === '/' &&
        !modifier &&
        !event.altKey &&
        !event.shiftKey &&
        !isTypingTarget(event.target) &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault()
        focusComposer()
        return
      }

      if (modifier && key === 'n') {
        event.preventDefault()
        createConversation()
        focusComposer()
        return
      }

      if (modifier && key === 'k') {
        event.preventDefault()
        focusComposer()
        return
      }

      if (modifier && key === ',') {
        event.preventDefault()
        openSettings()
        return
      }

      if (modifier && key === 'b') {
        event.preventDefault()
        toggleSidebar()
        return
      }

      if (modifier && !event.shiftKey && !event.altKey && key === 'w') {
        event.preventDefault()
        // The menu's Close Window accelerator is deliberately removed, so the history window
        // handles Cmd+W itself and hides the same way the red close button does.
        closeSettings()
        if (isTauri()) {
          void hideMainWindow()
        }
        return
      }

      if (event.key === 'Escape') {
        void stopStreaming()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    closeSettings,
    createConversation,
    focusComposer,
    openSettings,
    stopStreaming,
    toggleSidebar,
  ])
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

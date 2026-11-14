import { useEffect } from 'react'

import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'

/** Global desktop shortcuts, matched to the habits of a macOS assistant. */
export function useKeyboardShortcuts() {
  const createConversation = useChatStore((state) => state.createConversation)
  const stopStreaming = useChatStore((state) => state.stopStreaming)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const openSettings = useUIStore((state) => state.openSettings)
  const focusComposer = useUIStore((state) => state.focusComposer)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

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

      if (event.key === 'Escape') {
        void stopStreaming()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    createConversation,
    focusComposer,
    openSettings,
    stopStreaming,
    toggleSidebar,
  ])
}

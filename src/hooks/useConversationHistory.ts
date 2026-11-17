import { useEffect, useRef, useState } from 'react'

import { MESSAGE_PAGE_SIZE } from '@/constants'
import { useChatStore } from '@/stores/chatStore'
import { loadMessagePage } from '@/tauri/commands/storage'
import { isTauri } from '@/utils/tauri'

/**
 * Loads the active conversation's newest page from SQLite and exposes the next-older page for
 * infinite scroll. Only the loaded page lives in Zustand, so large conversations never arrive in
 * one request.
 */
export function useConversationHistory(conversationId?: string) {
  const conversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === conversationId),
  )
  const applyMessagePage = useChatStore((state) => state.applyMessagePage)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const loadingOlderRef = useRef(false)
  const loadingInitial = useRef(new Set<string>())

  useEffect(() => {
    if (!conversationId || conversation?.messagesLoaded) {
      return
    }

    if (!isTauri()) {
      if (conversation) {
        applyMessagePage(
          conversationId,
          {
            messages: conversation.messages,
            nextCursor: null,
            hasMore: false,
          },
          'replace',
        )
      }
      return
    }

    if (loadingInitial.current.has(conversationId)) {
      return
    }

    loadingInitial.current.add(conversationId)
    void loadMessagePage(conversationId, null, MESSAGE_PAGE_SIZE)
      .then((page) => {
        applyMessagePage(conversationId, page, 'replace')
      })
      .catch(() => {
        // Never leave the composer disabled behind a failed page request; the agent still reads
        // the full history from SQLite.
        const current = useChatStore
          .getState()
          .conversations.find((item) => item.id === conversationId)
        applyMessagePage(
          conversationId,
          {
            messages: current?.messages ?? [],
            nextCursor: null,
            hasMore: false,
          },
          'replace',
        )
      })
      .finally(() => {
        loadingInitial.current.delete(conversationId)
      })
  }, [applyMessagePage, conversation, conversationId])

  const hasOlder = Boolean(conversation?.hasOlderMessages)

  const loadOlder = async () => {
    if (
      !conversationId ||
      !conversation?.messagesLoaded ||
      !conversation.hasOlderMessages ||
      loadingOlder
    ) {
      return
    }

    setLoadingOlder(true)
    try {
      const page = await loadMessagePage(
        conversationId,
        conversation.historyCursor ?? null,
        MESSAGE_PAGE_SIZE,
      )
      applyMessagePage(conversationId, page, 'prepend')
    } catch {
      // The user can scroll again to retry.
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }

  return { hasOlder, loadingOlder, loadOlder }
}

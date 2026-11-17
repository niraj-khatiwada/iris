import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'

import { useChatStore } from '@/stores/chatStore'
import {
  clearConversations,
  deleteConversation,
  loadConversations,
  saveConversation,
  saveConversations,
} from '@/tauri/commands/storage'
import type { Conversation } from '@/types/chat'
import { isTauri } from '@/utils/tauri'

let suspended = false
let clearStored: (() => Promise<void>) | null = null

/** Stops the SQLite mirror while Iris resets its data, so a focus hydrate cannot undo the wipe. */
export function suspendChatStorage() {
  suspended = true
}

/**
 * Deletes every stored conversation while pausing the mirror. The debounced writer and an
 * in-flight focus hydrate are allowed to settle first, so neither can re-save a conversation
 * after the backend has cleared the table.
 */
export async function clearStoredConversations() {
  if (!clearStored) {
    await clearConversations()
    return
  }
  await clearStored()
}

/**
 * Mirrors the localStorage-backed chat state into SQLite. SQLite is the durable copy; localStorage
 * stays as the fast cross-window cache and crash fallback.
 */
export function useChatStorage() {
  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let disposed = false
    let ready = false
    let syncing = false
    let flushTimer: number | null = null
    let unlistenFocus: (() => void) | undefined
    let unsubscribe: (() => void) | undefined
    let previous = new Map<string, string>()
    let pending = new Map<string, Conversation>()
    let removed = new Set<string>()
    let activeFlush: Promise<void> | null = null
    let activeHydrate: Promise<void> | null = null

    const clearStoredForThisWindow = async () => {
      suspended = true
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer)
        flushTimer = null
      }

      try {
        // Let a writer that already started finish before deleting, then discard anything queued.
        if (activeFlush) {
          await activeFlush.catch(() => {})
        }
        if (activeHydrate) {
          await activeHydrate.catch(() => {})
        }
        pending = new Map()
        removed = new Set()
        await clearConversations()
        previous = new Map()
      } finally {
        suspended = false
      }
    }
    clearStored = clearStoredForThisWindow

    const snapshot = (conversations: Conversation[]) =>
      new Map(
        conversations.map((conversation) => [
          conversation.id,
          JSON.stringify(conversation),
        ]),
      )

    const scheduleFlush = () => {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer)
      }
      flushTimer = window.setTimeout(() => {
        const run = flush()
        activeFlush = run
        void run.finally(() => {
          if (activeFlush === run) {
            activeFlush = null
          }
        })
      }, 400)
    }

    const flush = async () => {
      flushTimer = null
      if (!ready || syncing || suspended) {
        return
      }

      const toSave = [...pending.values()]
      const toDelete = [...removed]
      pending = new Map()
      removed = new Set()

      for (const conversation of toSave) {
        try {
          await saveConversation(conversation)
          if (!disposed) {
            previous.set(conversation.id, JSON.stringify(conversation))
          }
        } catch {
          // Keep the localStorage cache; the next change or focus retries.
        }
      }

      for (const id of toDelete) {
        try {
          await deleteConversation(id)
          if (!disposed) {
            previous.delete(id)
          }
        } catch {
          // Keep the localStorage cache; the next change or focus retries.
        }
      }

      if (!disposed && (pending.size > 0 || removed.size > 0)) {
        scheduleFlush()
      }
    }

    const schedule = (conversations: Conversation[]) => {
      if (!ready || syncing || suspended) {
        return
      }

      const current = snapshot(conversations)
      for (const conversation of conversations) {
        if (current.get(conversation.id) !== previous.get(conversation.id)) {
          pending.set(conversation.id, conversation)
          removed.delete(conversation.id)
        }
      }
      for (const id of previous.keys()) {
        if (!current.has(id)) {
          pending.delete(id)
          removed.add(id)
        }
      }

      if (pending.size > 0 || removed.size > 0) {
        scheduleFlush()
      }
    }

    const hydrate = async () => {
      if (disposed || syncing || suspended) {
        return
      }
      if (useChatStore.getState().streamingRequestId) {
        return
      }

      syncing = true
      try {
        await useChatStore.persist.rehydrate()
        const stored = await loadConversations()
        if (suspended) {
          return
        }
        const local = useChatStore.getState().conversations
        const merged = mergeConversations(stored, local)
        useChatStore.getState().hydrateConversations(merged)

        const storedById = new Map(
          stored.map((conversation) => [conversation.id, conversation]),
        )
        const localById = new Map(
          local.map((conversation) => [conversation.id, conversation]),
        )
        const localNewer = merged.filter((conversation) => {
          const fromDatabase = storedById.get(conversation.id)
          if (!fromDatabase) {
            return true
          }
          const fromLocal = localById.get(conversation.id)
          return Boolean(
            fromLocal && fromLocal.updatedAt > fromDatabase.updatedAt,
          )
        })

        if (stored.length === 0 && local.length > 0) {
          await saveConversations(local)
        } else {
          for (const conversation of localNewer) {
            await saveConversation(conversation)
          }
        }

        previous = snapshot(useChatStore.getState().conversations)
        pending = new Map()
        removed = new Set()
        ready = true
      } catch {
        // LocalStorage remains the working copy when the database is unavailable.
      } finally {
        syncing = false
      }
    }

    const runHydrate = () => {
      const run = hydrate()
      activeHydrate = run
      void run.finally(() => {
        if (activeHydrate === run) {
          activeHydrate = null
        }
      })
    }

    runHydrate()

    unsubscribe = useChatStore.subscribe((state) => {
      schedule(state.conversations)
    })

    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          runHydrate()
        }
      })
      .then((off) => {
        if (disposed) {
          off()
        } else {
          unlistenFocus = off
        }
      })

    return () => {
      disposed = true
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer)
      }
      if (clearStored === clearStoredForThisWindow) {
        clearStored = null
      }
      unsubscribe?.()
      unlistenFocus?.()
    }
  }, [])
}

function mergeConversations(
  stored: Conversation[],
  local: Conversation[],
): Conversation[] {
  const streamingId = useChatStore.getState().streamingConversationId
  const merged = new Map(
    stored.map((conversation) => [conversation.id, conversation]),
  )

  for (const conversation of local) {
    const existing = merged.get(conversation.id)
    if (
      !existing ||
      conversation.id === streamingId ||
      conversation.updatedAt > existing.updatedAt
    ) {
      merged.set(conversation.id, conversation)
    }
  }

  return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

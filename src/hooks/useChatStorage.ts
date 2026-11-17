import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'

import { CHAT_STORAGE_KEY, CHAT_UI_STORAGE_KEY } from '@/constants'
import { useChatStore } from '@/stores/chatStore'
import {
  clearConversations,
  deleteConversation,
  deleteMessages,
  loadConversations,
  saveConversationMeta,
  saveConversations,
  saveMessage,
} from '@/tauri/commands/storage'
import type {
  ChatMessage,
  Conversation,
  ConversationSummary,
} from '@/types/chat'
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
    localStorage.removeItem(CHAT_STORAGE_KEY)
    return
  }
  await clearStored()
}

type StoredSelection = {
  activeConversationId: string | null
  lastQuickConversationId: string | null
}

type LegacyChat = StoredSelection & {
  conversations: Conversation[]
}

type MessageEntry = {
  conversationId: string
  message: ChatMessage
}

function readSelection(): StoredSelection | null {
  try {
    const raw = localStorage.getItem(CHAT_UI_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<StoredSelection>
    return {
      activeConversationId:
        typeof parsed.activeConversationId === 'string'
          ? parsed.activeConversationId
          : null,
      lastQuickConversationId:
        typeof parsed.lastQuickConversationId === 'string'
          ? parsed.lastQuickConversationId
          : null,
    }
  } catch {
    return null
  }
}

/** The old `iris.chat` cache held conversations; import it into SQLite once, then drop it. */
function readLegacyChat(): LegacyChat | null {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as {
      state?: {
        conversations?: unknown
        activeConversationId?: unknown
        lastQuickConversationId?: unknown
      }
    }
    const state = parsed.state
    const conversations = Array.isArray(state?.conversations)
      ? (state.conversations as Conversation[]).filter(
          (conversation) =>
            Boolean(conversation) &&
            typeof conversation.id === 'string' &&
            Array.isArray(conversation.messages),
        )
      : []
    return {
      conversations,
      activeConversationId:
        typeof state?.activeConversationId === 'string'
          ? state.activeConversationId
          : null,
      lastQuickConversationId:
        typeof state?.lastQuickConversationId === 'string'
          ? state.lastQuickConversationId
          : null,
    }
  } catch {
    return null
  }
}

function metaOf(conversation: Conversation): ConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    ...(conversation.archivedAt !== undefined
      ? { archivedAt: conversation.archivedAt }
      : {}),
  }
}

/**
 * SQLite is the only conversation store. This hook loads conversation metadata into Zustand,
 * pages messages on demand through `useConversationHistory`, mirrors metadata and message rows
 * back with a short debounce, and reloads on focus so the overlay and history window stay in
 * sync. Only the two selected ids live in localStorage.
 */
export function useChatStorage() {
  useEffect(() => {
    if (!isTauri()) {
      // The browser preview has no SQLite; keep its in-memory chat usable.
      useChatStore.getState().markHydrated()
      return
    }

    const isOverlay = getCurrentWindow().label === 'overlay'
    const legacy = readLegacyChat()
    const initialSelection =
      readSelection() ??
      (legacy
        ? {
            activeConversationId: legacy.activeConversationId,
            lastQuickConversationId: legacy.lastQuickConversationId,
          }
        : null)

    if (initialSelection) {
      useChatStore
        .getState()
        .restoreSelection(
          initialSelection.activeConversationId,
          initialSelection.lastQuickConversationId,
        )
    }

    let disposed = false
    let ready = false
    let syncing = false
    let flushTimer: number | null = null
    let unlistenFocus: (() => void) | undefined
    let unlistenClear: UnlistenFn | undefined
    let unsubscribe: (() => void) | undefined
    let previousMeta = new Map<string, string>()
    let previousMessages = new Map<string, MessageEntry>()
    let pendingMeta = new Map<string, ConversationSummary>()
    let pendingMessages = new Map<string, MessageEntry>()
    let pendingDeletedMessages = new Set<string>()
    let pendingDeletedConversations = new Set<string>()
    let activeFlush: Promise<void> | null = null
    let activeHydrate: Promise<void> | null = null

    const writeSelection = (state: {
      activeConversationId: string | null
      lastQuickConversationId: string | null
    }) => {
      const current = readSelection()
      const next: StoredSelection = {
        activeConversationId: isOverlay
          ? (current?.activeConversationId ?? state.activeConversationId)
          : state.activeConversationId,
        lastQuickConversationId: state.lastQuickConversationId,
      }
      try {
        localStorage.setItem(CHAT_UI_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // UI selection is a convenience; SQLite still owns the conversations.
      }
    }

    const clearStoredForThisWindow = async () => {
      suspended = true
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer)
        flushTimer = null
      }

      try {
        if (activeFlush) {
          await activeFlush.catch(() => {})
        }
        if (activeHydrate) {
          await activeHydrate.catch(() => {})
        }
        pendingMeta = new Map()
        pendingMessages = new Map()
        pendingDeletedMessages = new Set()
        pendingDeletedConversations = new Set()
        await clearConversations()
        localStorage.removeItem(CHAT_STORAGE_KEY)
        previousMeta = new Map()
        previousMessages = new Map()
      } finally {
        suspended = false
      }
    }
    clearStored = clearStoredForThisWindow

    const snapshotMeta = (conversations: Conversation[]) =>
      new Map(
        conversations.map((conversation) => [
          conversation.id,
          JSON.stringify(metaOf(conversation)),
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

      const meta = [...pendingMeta.values()]
      const messages = [...pendingMessages.values()]
      const deletedMessages = [...pendingDeletedMessages]
      const deletedConversations = [...pendingDeletedConversations]
      pendingMeta = new Map()
      pendingMessages = new Map()
      pendingDeletedMessages = new Set()
      pendingDeletedConversations = new Set()

      for (const conversation of meta) {
        try {
          await saveConversationMeta(conversation)
          if (!disposed) {
            previousMeta.set(conversation.id, JSON.stringify(conversation))
          }
        } catch {
          // The in-memory store keeps the change; the next edit or focus retries.
        }
      }

      for (const entry of messages) {
        try {
          await saveMessage(entry.conversationId, entry.message)
          if (!disposed) {
            previousMessages.set(entry.message.id, entry)
          }
        } catch {
          // The next change or focus retries.
        }
      }

      if (deletedMessages.length > 0) {
        try {
          await deleteMessages(deletedMessages)
          if (!disposed) {
            for (const id of deletedMessages) {
              previousMessages.delete(id)
            }
          }
        } catch {
          // The next change or focus retries.
        }
      }

      for (const id of deletedConversations) {
        try {
          await deleteConversation(id)
          if (!disposed) {
            previousMeta.delete(id)
          }
        } catch {
          // The next change or focus retries.
        }
      }

      if (
        !disposed &&
        (pendingMeta.size > 0 ||
          pendingMessages.size > 0 ||
          pendingDeletedMessages.size > 0 ||
          pendingDeletedConversations.size > 0)
      ) {
        scheduleFlush()
      }
    }

    const schedule = (conversations: Conversation[]) => {
      if (!ready || syncing || suspended) {
        return
      }

      const currentMeta = snapshotMeta(conversations)
      for (const conversation of conversations) {
        const meta = metaOf(conversation)
        const json = JSON.stringify(meta)
        if (previousMeta.get(conversation.id) !== json) {
          pendingMeta.set(conversation.id, meta)
        }
      }
      for (const id of previousMeta.keys()) {
        if (!currentMeta.has(id)) {
          pendingDeletedConversations.add(id)
        }
      }

      const currentMessages = new Map<string, MessageEntry>()
      for (const conversation of conversations) {
        for (const message of conversation.messages) {
          currentMessages.set(message.id, {
            conversationId: conversation.id,
            message,
          })
        }
      }
      for (const [id, entry] of currentMessages) {
        const previousEntry = previousMessages.get(id)
        if (
          !previousEntry ||
          previousEntry.conversationId !== entry.conversationId ||
          previousEntry.message !== entry.message
        ) {
          pendingMessages.set(id, entry)
        }
      }
      for (const id of previousMessages.keys()) {
        if (!currentMessages.has(id)) {
          pendingDeletedMessages.add(id)
        }
      }

      if (
        pendingMeta.size > 0 ||
        pendingMessages.size > 0 ||
        pendingDeletedMessages.size > 0 ||
        pendingDeletedConversations.size > 0
      ) {
        scheduleFlush()
      }
    }

    const hydrate = async (initial: boolean) => {
      if (disposed || syncing || suspended) {
        return
      }
      if (!initial && useChatStore.getState().streamingRequestId) {
        return
      }

      syncing = true
      try {
        if (!initial) {
          // The other window may have moved the quick chat or selected another conversation.
          const selection = readSelection()
          if (selection) {
            useChatStore
              .getState()
              .restoreSelection(
                selection.activeConversationId,
                selection.lastQuickConversationId,
              )
          }
        }

        // Import the old localStorage cache before reading summaries.
        if (initial && legacy) {
          const conversations = legacy.conversations.filter(
            (conversation) =>
              !(conversation.archivedAt && conversation.messages.length === 0),
          )
          if (conversations.length > 0) {
            await saveConversations(conversations)
          }
          localStorage.removeItem(CHAT_STORAGE_KEY)
        }

        const stored = await loadConversations()
        if (suspended) {
          return
        }
        useChatStore.getState().hydrateConversations(stored)

        const state = useChatStore.getState()
        if (initial) {
          // Summaries are already in SQLite; message pages will be loaded by the hooks.
          previousMeta = snapshotMeta(state.conversations)
          previousMessages = new Map()
          pendingMeta = new Map()
          pendingMessages = new Map()
          pendingDeletedMessages = new Set()
          pendingDeletedConversations = new Set()
          ready = true
          writeSelection(state)
          state.markHydrated()
        }
        writeSelection(state)
      } catch {
        if (initial) {
          // The database is unavailable: keep the legacy data usable in memory.
          const conversations = legacy?.conversations ?? []
          const summaries = conversations.map(
            ({ messages: _messages, ...summary }) => summary,
          )
          useChatStore.getState().hydrateConversations(summaries)
          for (const conversation of conversations) {
            useChatStore.getState().applyMessagePage(
              conversation.id,
              {
                messages: conversation.messages,
                nextCursor: null,
                hasMore: false,
              },
              'replace',
            )
          }
          const state = useChatStore.getState()
          previousMeta = new Map()
          previousMessages = new Map()
          ready = true
          writeSelection(state)
          state.markHydrated()
        }
      } finally {
        syncing = false
      }
    }

    const runHydrate = (initial = false) => {
      const run = hydrate(initial)
      activeHydrate = run
      void run.finally(() => {
        if (activeHydrate === run) {
          activeHydrate = null
        }
      })
    }

    runHydrate(true)

    unsubscribe = useChatStore.subscribe((state, previousState) => {
      schedule(state.conversations)
      if (
        state.activeConversationId !== previousState.activeConversationId ||
        state.lastQuickConversationId !== previousState.lastQuickConversationId
      ) {
        writeSelection(state)
      }
    })

    // Clear History runs in one window, but every window must drop its in-memory copy too.
    void listen('chat:cleared', () => {
      if (disposed) {
        return
      }
      previousMeta = new Map()
      previousMessages = new Map()
      pendingMeta = new Map()
      pendingMessages = new Map()
      pendingDeletedMessages = new Set()
      pendingDeletedConversations = new Set()
      useChatStore.getState().clearAll()
    }).then((off) => {
      if (disposed) {
        off()
      } else {
        unlistenClear = off
      }
    })

    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          runHydrate(false)
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
      unlistenClear?.()
    }
  }, [])
}

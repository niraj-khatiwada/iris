import { getCurrentWindow } from '@tauri-apps/api/window'
import { create } from 'zustand'

import { QUICK_CONVERSATION_ID, QUICK_CONVERSATION_TITLE } from '@/constants'
import { cancelActiveRun, startAgentRun } from '@/services/agent'
import { useSettingsStore } from '@/stores/settingsStore'
import { generateConversationTitle } from '@/tauri/commands/chat'
import {
  moveConversationMessages,
  restoreQuickConversation,
} from '@/tauri/commands/storage'
import type {
  AgentMessage,
  ChatAttachment,
  ChatMessage,
  Conversation,
  ConversationSummary,
  MessagePage,
} from '@/types/chat'
import { newId } from '@/utils/id'
import { attachmentToAgent } from '@/utils/image'
import { titleFromMessage } from '@/utils/string'
import { isTauri } from '@/utils/tauri'

const HISTORY_INDEX_BASE = 1_000_000

/** The quick overlay uses the island prompt; the history window uses the main prompt. */
function isIslandWindow() {
  if (isTauri()) {
    return getCurrentWindow().label === 'overlay'
  }
  return window.location.pathname.endsWith('/overlay.html')
}

type ChatState = {
  conversations: Conversation[]
  activeConversationId: string | null
  /** The quick conversation that the last New chat archived, so it can be restored. */
  lastQuickConversationId: string | null
  streamingRequestId: string | null
  streamingConversationId: string | null
  streamingMessageId: string | null
  /** False until the first SQLite hydration finishes. */
  hydrated: boolean
  markHydrated: () => void
  createConversation: () => string
  ensureQuickConversation: () => string
  hydrateConversations: (conversations: ConversationSummary[]) => void
  applyMessagePage: (
    conversationId: string,
    page: MessagePage,
    mode: 'replace' | 'prepend',
  ) => void
  restoreSelection: (
    activeConversationId: string | null,
    lastQuickConversationId: string | null,
  ) => void
  resetQuickConversation: () => void
  restorePreviousQuickConversation: () => void
  selectConversation: (id: string) => void
  archiveConversation: (id: string) => void
  restoreConversation: (id: string) => void
  deleteArchivedConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  clearAll: () => void
  sendMessage: (
    content: string,
    conversationId?: string,
    attachments?: ChatAttachment[],
  ) => Promise<void>
  /** Replaces an assistant reply with a fresh response to the same user message. */
  regenerate: (conversationId: string, messageId: string) => Promise<void>
  /** Rewrites a user message and answers again, dropping everything that followed it. */
  editAndResend: (
    conversationId: string,
    messageId: string,
    content: string,
  ) => Promise<void>
  stopStreaming: () => Promise<void>
}

/**
 * Turns stored messages into the request history: assistant turns only count once they have
 * content, so empty bubbles and failures are never sent back to the model.
 */
function toAgentHistory(messages: ChatMessage[]): AgentMessage[] {
  return messages
    .filter(
      (message) =>
        message.role === 'user' ||
        (message.role === 'assistant' &&
          message.status === 'complete' &&
          message.content.trim().length > 0),
    )
    .map((message) => {
      const agentAttachments = message.attachments
        ?.map(attachmentToAgent)
        .filter(
          (attachment): attachment is { mediaType: string; data: string } =>
            attachment !== null,
        )

      return {
        id: message.id,
        role: message.role,
        content: message.content,
        ...(agentAttachments?.length ? { attachments: agentAttachments } : {}),
      }
    })
}

function withMessage(
  conversations: Conversation[],
  conversationId: string,
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
) {
  return conversations.map((conversation) =>
    conversation.id === conversationId
      ? {
          ...conversation,
          updatedAt: Date.now(),
          messages: conversation.messages.map((message) =>
            message.id === messageId ? update(message) : message,
          ),
        }
      : conversation,
  )
}

function finishConversationMessages(
  conversations: Conversation[],
  conversationId: string,
  messageId: string,
  cancelled: boolean,
) {
  return conversations.map((conversation) => {
    if (conversation.id !== conversationId) {
      return conversation
    }

    const messages = conversation.messages.flatMap((message) => {
      if (message.id !== messageId) {
        return [message]
      }

      // A cancelled response with no text leaves no empty bubble behind.
      if (cancelled && !message.content.trim()) {
        return []
      }

      return [{ ...message, status: 'complete' as const }]
    })

    return { ...conversation, updatedAt: Date.now(), messages }
  })
}

type RunContext = {
  set: (
    partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>),
  ) => void
  get: () => ChatState
}

/**
 * Streams one assistant reply for an already-stored user turn. `sendMessage`, `regenerate`, and
 * `editAndResend` all differ only in how they prepare the conversation, so the request, streaming,
 * and error bookkeeping live here once.
 */
async function runAssistantReply({
  set,
  get,
  conversationId,
  assistantMessageId,
}: RunContext & { conversationId: string; assistantMessageId: string }) {
  const conversation = get().conversations.find(
    (item) => item.id === conversationId,
  )
  if (!conversation) {
    return
  }

  // The placeholder is already in the conversation, so it is excluded from the history.
  const history = toAgentHistory(
    conversation.messages.filter(
      (message) => message.id !== assistantMessageId,
    ),
  )

  // Another window (Settings) may have changed the model or base URL since this store hydrated.
  await useSettingsStore.persist.rehydrate()
  const settings = useSettingsStore.getState()

  const systemPrompt =
    isIslandWindow() || settings.mainUsesIslandPrompt
      ? settings.islandSystemPrompt
      : settings.mainSystemPrompt

  const requestId = startAgentRun({
    conversationId,
    messages: history,
    baseUrl: settings.baseUrl,
    model: settings.model,
    systemPrompt,
    autoSpeak: settings.autoSpeak,
    deepThink: settings.deepThink,
    webSearch: settings.webSearch,
    ttsVoice: settings.ttsVoice,
    onToken: (token) => {
      if (get().streamingRequestId !== requestId) {
        return
      }

      set((current) => ({
        conversations: withMessage(
          current.conversations,
          conversationId,
          assistantMessageId,
          (message) => ({
            ...message,
            content: message.content + token,
          }),
        ),
      }))
    },
    onDone: ({ cancelled }) => {
      if (get().streamingRequestId !== requestId) {
        return
      }

      set((current) => ({
        conversations: finishConversationMessages(
          current.conversations,
          conversationId,
          assistantMessageId,
          cancelled,
        ),
        streamingRequestId: null,
        streamingConversationId: null,
        streamingMessageId: null,
      }))
    },
    onError: (message) => {
      if (get().streamingRequestId !== requestId) {
        return
      }

      set((current) => ({
        conversations: withMessage(
          current.conversations,
          conversationId,
          assistantMessageId,
          (item) => ({
            ...item,
            status: 'error',
            error: message,
            content:
              item.content ||
              'Something went wrong while contacting the agent.',
          }),
        ),
        streamingRequestId: null,
        streamingConversationId: null,
        streamingMessageId: null,
      }))
    },
  })

  set({
    streamingRequestId: requestId,
    streamingConversationId: conversationId,
    streamingMessageId: assistantMessageId,
  })
}

export const useChatStore = create<ChatState>()((set, get) => ({
  conversations: [],
  activeConversationId: null,
  lastQuickConversationId: null,
  hydrated: false,
  streamingRequestId: null,
  streamingConversationId: null,
  streamingMessageId: null,

  createConversation: () => {
    const state = get()
    const current = state.conversations.find(
      (conversation) => conversation.id === state.activeConversationId,
    )
    if (current && !current.archivedAt && current.messages.length === 0) {
      return current.id
    }

    const id = newId()
    const now = Date.now()

    set((currentState) => ({
      conversations: [
        {
          id,
          title: 'New conversation',
          createdAt: now,
          updatedAt: now,
          messages: [],
          messagesLoaded: true,
          historyCursor: null,
          hasOlderMessages: false,
          historyStart: 0,
        },
        ...currentState.conversations,
      ],
      activeConversationId: id,
    }))

    return id
  },

  selectConversation: (id) => set({ activeConversationId: id }),

  ensureQuickConversation: () => {
    const existing = get().conversations.find(
      (conversation) => conversation.id === QUICK_CONVERSATION_ID,
    )
    if (existing) {
      return existing.id
    }

    const now = Date.now()
    set((state) => ({
      conversations: [
        {
          id: QUICK_CONVERSATION_ID,
          title: QUICK_CONVERSATION_TITLE,
          createdAt: now,
          updatedAt: now,
          messages: [],
          messagesLoaded: true,
          historyCursor: null,
          hasOlderMessages: false,
          historyStart: 0,
        },
        ...state.conversations,
      ],
    }))

    return QUICK_CONVERSATION_ID
  },

  markHydrated: () => set({ hydrated: true }),

  restoreSelection: (activeConversationId, lastQuickConversationId) =>
    set({ activeConversationId, lastQuickConversationId }),

  hydrateConversations: (summaries) =>
    set((state) => {
      const currentById = new Map(
        state.conversations.map((conversation) => [
          conversation.id,
          conversation,
        ]),
      )
      const merged: Conversation[] = summaries.map((summary) => {
        const current = currentById.get(summary.id)
        if (!current) {
          return {
            ...summary,
            messages: [],
            messagesLoaded: false,
            historyCursor: null,
            hasOlderMessages: false,
          }
        }

        const externalNewer = summary.updatedAt > current.updatedAt
        const base = externalNewer ? summary : current
        return {
          ...base,
          // Keep the loaded page; the history hook reloads it when the database is newer.
          messages: current.messages,
          messagesLoaded: externalNewer
            ? false
            : (current.messagesLoaded ?? false),
          historyCursor: current.historyCursor ?? null,
          hasOlderMessages: current.hasOlderMessages ?? false,
        }
      })

      // A conversation created in this window may not have been saved yet; do not drop it.
      const summaryIds = new Set(summaries.map((summary) => summary.id))
      for (const current of currentById.values()) {
        if (!summaryIds.has(current.id)) {
          merged.push(current)
        }
      }

      const normalized = merged
        // An archive whose page loaded and is empty is a stale legacy blank.
        .filter(
          (conversation) =>
            !(
              conversation.archivedAt &&
              conversation.messagesLoaded &&
              conversation.messages.length === 0
            ),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
      const activeConversationId =
        state.activeConversationId &&
        normalized.some(
          (conversation) => conversation.id === state.activeConversationId,
        )
          ? state.activeConversationId
          : (normalized.find((conversation) => !conversation.archivedAt)?.id ??
            null)
      const lastQuickConversationId =
        state.lastQuickConversationId &&
        normalized.some(
          (conversation) =>
            conversation.id === state.lastQuickConversationId &&
            conversation.id !== QUICK_CONVERSATION_ID,
        )
          ? state.lastQuickConversationId
          : null

      return {
        conversations: normalized,
        activeConversationId,
        lastQuickConversationId,
      }
    }),

  applyMessagePage: (conversationId, page, mode) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== conversationId) {
          return conversation
        }

        const existing = conversation.messages
        const pageIds = new Set(page.messages.map((message) => message.id))
        let messages: ChatMessage[]
        if (mode === 'prepend') {
          messages = [
            ...page.messages,
            ...existing.filter((message) => !pageIds.has(message.id)),
          ]
        } else {
          // Keep messages created locally after the page was requested; older loaded pages can
          // be fetched again from the cursor.
          const newest = page.messages[page.messages.length - 1]?.createdAt ?? 0
          messages = [
            ...page.messages,
            ...existing.filter(
              (message) =>
                !pageIds.has(message.id) && message.createdAt >= newest,
            ),
          ]
        }

        const historyStart =
          mode === 'prepend'
            ? (conversation.historyStart ?? HISTORY_INDEX_BASE) -
              page.messages.length
            : HISTORY_INDEX_BASE - page.messages.length

        return {
          ...conversation,
          messages,
          messagesLoaded: true,
          historyCursor: page.nextCursor,
          hasOlderMessages: page.hasMore,
          historyStart,
        }
      }),
    })),

  resetQuickConversation: () => {
    cancelActiveRun()
    const now = Date.now()
    let archivedId: string | null = null

    set((state) => {
      const quick = state.conversations.find(
        (conversation) => conversation.id === QUICK_CONVERSATION_ID,
      )
      // Keep the old quick chat in history under a new id instead of dropping it.
      const archived =
        quick && (quick.messages.length > 0 || quick.messagesLoaded === false)
          ? {
              ...quick,
              id: newId(),
              updatedAt: now,
              messages: quick.messages.map((message) =>
                message.status === 'streaming'
                  ? { ...message, status: 'complete' as const }
                  : message,
              ),
            }
          : null
      archivedId = archived?.id ?? null
      const fresh = {
        id: QUICK_CONVERSATION_ID,
        title: QUICK_CONVERSATION_TITLE,
        createdAt: now,
        updatedAt: now,
        messages: [],
        messagesLoaded: true,
        historyCursor: null,
        hasOlderMessages: false,
        historyStart: 0,
      }

      return {
        conversations: [
          fresh,
          ...(archived ? [archived] : []),
          ...state.conversations.filter(
            (conversation) => conversation.id !== QUICK_CONVERSATION_ID,
          ),
        ],
        // Remember what New chat put away so Cmd+Shift+N can bring it back.
        lastQuickConversationId: archived?.id ?? state.lastQuickConversationId,
        streamingRequestId: null,
        streamingConversationId: null,
        streamingMessageId: null,
      }
    })

    // The UI only has the newest page; move the rest of the rows in SQLite too.
    if (archivedId && isTauri()) {
      void moveConversationMessages(QUICK_CONVERSATION_ID, archivedId)
    }
  },

  restorePreviousQuickConversation: () => {
    cancelActiveRun()
    const now = Date.now()
    let previousId: string | null = null
    let retiredId: string | null = null

    set((state) => {
      const lastQuickId = state.lastQuickConversationId
      if (!lastQuickId) {
        return state
      }

      const previous = state.conversations.find(
        (conversation) =>
          conversation.id === lastQuickId &&
          conversation.id !== QUICK_CONVERSATION_ID,
      )
      if (!previous) {
        return { ...state, lastQuickConversationId: null }
      }

      const quick = state.conversations.find(
        (conversation) => conversation.id === QUICK_CONVERSATION_ID,
      )
      const retiredCurrent =
        quick && (quick.messages.length > 0 || quick.messagesLoaded === false)
          ? {
              ...quick,
              id: newId(),
              updatedAt: now,
              messages: quick.messages.map((message) =>
                message.status === 'streaming'
                  ? { ...message, status: 'complete' as const }
                  : message,
              ),
            }
          : null
      previousId = lastQuickId
      retiredId = retiredCurrent?.id ?? null
      const restored: Conversation = {
        ...previous,
        id: QUICK_CONVERSATION_ID,
        archivedAt: undefined,
        updatedAt: now,
        messages: previous.messages.map((message) =>
          message.status === 'streaming'
            ? { ...message, status: 'complete' as const }
            : message,
        ),
      }

      return {
        conversations: [
          restored,
          ...(retiredCurrent ? [retiredCurrent] : []),
          ...state.conversations.filter(
            (conversation) =>
              conversation.id !== QUICK_CONVERSATION_ID &&
              conversation.id !== lastQuickId,
          ),
        ],
        activeConversationId: QUICK_CONVERSATION_ID,
        lastQuickConversationId: retiredCurrent?.id ?? null,
        streamingRequestId: null,
        streamingConversationId: null,
        streamingMessageId: null,
      }
    })

    if (previousId && isTauri()) {
      void restoreQuickConversation(
        QUICK_CONVERSATION_ID,
        previousId,
        retiredId,
      )
    }
  },

  archiveConversation: (id) => {
    const wasStreaming = get().streamingConversationId === id
    if (wasStreaming) {
      cancelActiveRun()
    }

    const now = Date.now()
    const target = get().conversations.find(
      (conversation) => conversation.id === id,
    )
    if (!target) {
      return
    }

    // Empty chats have nothing worth keeping; remove them instead of archiving. An unloaded
    // conversation is not empty just because only the newest page has not arrived yet.
    if (target.messagesLoaded !== false && target.messages.length === 0) {
      set((state) => {
        const conversations = state.conversations.filter(
          (conversation) => conversation.id !== id,
        )
        const activeConversationId =
          state.activeConversationId === id
            ? (conversations.find((conversation) => !conversation.archivedAt)
                ?.id ?? null)
            : state.activeConversationId

        return {
          conversations,
          activeConversationId,
          ...(wasStreaming
            ? {
                streamingRequestId: null,
                streamingConversationId: null,
                streamingMessageId: null,
              }
            : {}),
        }
      })
      return
    }

    set((state) => {
      const archive = (
        conversation: Conversation,
        archivedId = conversation.id,
      ): Conversation => ({
        ...conversation,
        id: archivedId,
        archivedAt: now,
        updatedAt: now,
        messages: conversation.messages.map((message) =>
          message.status === 'streaming'
            ? { ...message, status: 'complete' as const }
            : message,
        ),
      })

      // The overlay always uses `iris:quick`; keep its content but start it fresh.
      if (id === QUICK_CONVERSATION_ID) {
        const quick = state.conversations.find(
          (conversation) => conversation.id === QUICK_CONVERSATION_ID,
        )
        if (!quick) {
          return state
        }

        const fresh: Conversation = {
          id: QUICK_CONVERSATION_ID,
          title: QUICK_CONVERSATION_TITLE,
          createdAt: now,
          updatedAt: now,
          messages: [],
        }
        const archivedQuickId = newId()

        return {
          conversations: [
            fresh,
            archive(quick, archivedQuickId),
            ...state.conversations.filter(
              (conversation) => conversation.id !== QUICK_CONVERSATION_ID,
            ),
          ],
          activeConversationId:
            state.activeConversationId === QUICK_CONVERSATION_ID
              ? fresh.id
              : state.activeConversationId,
          lastQuickConversationId: archivedQuickId,
          ...(wasStreaming
            ? {
                streamingRequestId: null,
                streamingConversationId: null,
                streamingMessageId: null,
              }
            : {}),
        }
      }

      const conversations = state.conversations.map((conversation) =>
        conversation.id === id ? archive(conversation) : conversation,
      )
      const activeConversationId =
        state.activeConversationId === id
          ? (conversations.find((conversation) => !conversation.archivedAt)
              ?.id ?? null)
          : state.activeConversationId

      return {
        conversations,
        activeConversationId,
        ...(wasStreaming
          ? {
              streamingRequestId: null,
              streamingConversationId: null,
              streamingMessageId: null,
            }
          : {}),
      }
    })
  },

  restoreConversation: (id) =>
    set((state) => {
      if (
        !state.conversations.some(
          (conversation) => conversation.id === id && conversation.archivedAt,
        )
      ) {
        return state
      }

      return {
        conversations: state.conversations.map((conversation) =>
          conversation.id === id
            ? {
                ...conversation,
                archivedAt: undefined,
                updatedAt: Date.now(),
              }
            : conversation,
        ),
        activeConversationId: id,
        lastQuickConversationId:
          state.lastQuickConversationId === id
            ? null
            : state.lastQuickConversationId,
      }
    }),

  deleteArchivedConversation: (id) =>
    set((state) => {
      if (
        !state.conversations.some(
          (conversation) => conversation.id === id && conversation.archivedAt,
        )
      ) {
        return state
      }

      const conversations = state.conversations.filter(
        (conversation) => conversation.id !== id,
      )
      const activeConversationId =
        state.activeConversationId === id
          ? (conversations.find((conversation) => !conversation.archivedAt)
              ?.id ?? null)
          : state.activeConversationId

      return {
        conversations,
        activeConversationId,
        lastQuickConversationId:
          state.lastQuickConversationId === id
            ? null
            : state.lastQuickConversationId,
      }
    }),

  renameConversation: (id, title) =>
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === id && !conversation.archivedAt
          ? { ...conversation, title: title.trim() || 'New conversation' }
          : conversation,
      ),
    })),

  clearAll: () => {
    cancelActiveRun()
    set({
      conversations: [],
      activeConversationId: null,
      lastQuickConversationId: null,
      streamingRequestId: null,
      streamingConversationId: null,
      streamingMessageId: null,
    })
  },

  sendMessage: async (content, targetConversationId, attachments) => {
    const text = content.trim()
    const files = attachments ?? []
    if (!text && files.length === 0) {
      return
    }

    cancelActiveRun()

    const state = get()
    let conversationId = targetConversationId ?? state.activeConversationId
    if (
      !conversationId ||
      !state.conversations.some(
        (conversation) => conversation.id === conversationId,
      )
    ) {
      if (targetConversationId) {
        return
      }
      conversationId = state.createConversation()
    }

    const conversation = get().conversations.find(
      (item) => item.id === conversationId,
    )
    if (!conversation || conversation.archivedAt) {
      // Archived conversations are read-only.
      return
    }

    const now = Date.now()
    const userMessage: ChatMessage = {
      id: newId(),
      role: 'user',
      content: text,
      createdAt: now,
      status: 'complete',
      ...(files.length > 0 ? { attachments: files } : {}),
    }
    const assistantMessage: ChatMessage = {
      id: newId(),
      role: 'assistant',
      content: '',
      createdAt: now,
      status: 'streaming',
    }

    const isUntitled =
      conversation.messages.length === 0 ||
      conversation.title === 'New conversation' ||
      conversation.title === QUICK_CONVERSATION_TITLE
    const fallbackTitle = text ? titleFromMessage(text) : 'Image'

    set((current) => ({
      conversations: current.conversations.map((item) =>
        item.id === conversationId
          ? {
              ...item,
              title: isUntitled ? fallbackTitle : item.title,
              updatedAt: now,
              messages: [...item.messages, userMessage, assistantMessage],
            }
          : item,
      ),
    }))

    if (isUntitled && isTauri()) {
      const settings = useSettingsStore.getState()
      void generateConversationTitle({
        baseUrl: settings.baseUrl,
        model: settings.model,
        prompt: text || 'The user shared an image with no text.',
      })
        .then((title) => {
          // Apply only if this is still the same conversation and the user has not renamed it.
          set((current) => ({
            conversations: current.conversations.map((item) =>
              item.id === conversationId &&
              !item.archivedAt &&
              item.title === fallbackTitle &&
              item.messages.some((message) => message.id === userMessage.id)
                ? { ...item, title }
                : item,
            ),
          }))
        })
        .catch(() => {
          // Keep the local fallback title when the service is unavailable.
        })
    }

    await runAssistantReply({
      set,
      get,
      conversationId: conversationId as string,
      assistantMessageId: assistantMessage.id,
    })
  },

  regenerate: async (conversationId, messageId) => {
    const conversation = get().conversations.find(
      (item) => item.id === conversationId,
    )
    if (!conversation || conversation.archivedAt) {
      return
    }

    const index = conversation.messages.findIndex(
      (message) => message.id === messageId,
    )
    if (index < 0 || conversation.messages[index].role !== 'assistant') {
      return
    }

    cancelActiveRun()

    const reply: ChatMessage = {
      id: newId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      status: 'streaming',
    }
    const kept = conversation.messages.slice(0, index)

    set((current) => ({
      conversations: current.conversations.map((item) =>
        item.id === conversationId
          ? {
              ...item,
              updatedAt: Date.now(),
              messages: [...kept, reply],
            }
          : item,
      ),
    }))

    await runAssistantReply({
      set,
      get,
      conversationId,
      assistantMessageId: reply.id,
    })
  },

  editAndResend: async (conversationId, messageId, content) => {
    const text = content.trim()
    const conversation = get().conversations.find(
      (item) => item.id === conversationId,
    )
    if (!conversation || conversation.archivedAt) {
      return
    }

    const index = conversation.messages.findIndex(
      (message) => message.id === messageId,
    )
    const original = conversation.messages[index]
    if (index < 0 || original.role !== 'user') {
      return
    }
    if (!text && !original.attachments?.length) {
      return
    }

    cancelActiveRun()

    const reply: ChatMessage = {
      id: newId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      status: 'streaming',
    }
    // Editing rewrites this turn: the old reply and everything after it are dropped.
    const kept = conversation.messages
      .slice(0, index)
      .concat({ ...original, content: text })
      .concat(reply)

    set((current) => ({
      conversations: current.conversations.map((item) =>
        item.id === conversationId
          ? { ...item, updatedAt: Date.now(), messages: kept }
          : item,
      ),
    }))

    await runAssistantReply({
      set,
      get,
      conversationId,
      assistantMessageId: reply.id,
    })
  },

  stopStreaming: async () => {
    if (!get().streamingRequestId) {
      return
    }

    cancelActiveRun()
  },
}))

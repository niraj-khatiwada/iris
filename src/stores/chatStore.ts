import { getCurrentWindow } from '@tauri-apps/api/window'
import { create } from 'zustand'

import { MESSAGE_PAGE_SIZE, QUICK_CONVERSATION_TITLE } from '@/constants'
import { cancelActiveRun, startAgentRun } from '@/services/agent'
import { useSettingsStore } from '@/stores/settingsStore'
import { generateConversationTitle } from '@/tauri/commands/chat'
import {
  loadMessagePage,
  saveQuickConversationId,
} from '@/tauri/commands/storage'
import type {
  AgentMessage,
  ChatAttachment,
  ChatMessage,
  ChatSource,
  Conversation,
  ConversationSummary,
  MessagePage,
} from '@/types/chat'
import { newId } from '@/utils/id'
import { attachmentToAgent } from '@/utils/image'
import { titleFromMessage } from '@/utils/string'
import { isTauri } from '@/utils/tauri'

const HISTORY_INDEX_BASE = 1_000_000

/** A quick chat is a normal conversation; this is its empty starting row. */
function emptyConversation(
  id: string,
  title: string,
  now: number,
): Conversation {
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
    messagesLoaded: true,
    historyCursor: null,
    hasOlderMessages: false,
    historyStart: 0,
  }
}

/** Unloaded conversations may still contain messages, so only a loaded empty chat is empty. */
function hasMessages(conversation: Conversation | undefined) {
  return Boolean(
    conversation &&
      (conversation.messages.length > 0 ||
        conversation.messagesLoaded === false),
  )
}

/** Leaving a quick chat cancels its run; no bubble may stay stuck in the streaming state. */
function settleConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    messages: conversation.messages.map((message) =>
      message.status === 'streaming'
        ? { ...message, status: 'complete' as const }
        : message,
    ),
  }
}

function persistQuickConversationId(id: string | null) {
  if (!isTauri()) {
    return
  }
  void saveQuickConversationId(id).catch(() => {
    // The in-memory selection still works; the next launch creates a fresh quick chat.
  })
}

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
  /** The normal conversation the quick overlay is currently showing. */
  quickConversationId: string | null
  /** The previous quick conversation, so Previous conversation can toggle back to it. */
  lastQuickConversationId: string | null
  streamingRequestId: string | null
  streamingConversationId: string | null
  streamingMessageId: string | null
  /** A message a search result asked to reveal; the message list scrolls to it once loaded. */
  focusedMessageId: string | null
  /** False until the first SQLite hydration finishes. */
  hydrated: boolean
  markHydrated: () => void
  createConversation: () => string
  ensureQuickConversation: () => string
  setQuickConversationId: (id: string | null) => void
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
  /** Switches the overlay to any stored conversation, keeping the current one in History. */
  openQuickConversation: (id: string) => void
  selectConversation: (id: string) => void
  /**
   * Opens a conversation and loads older pages until `messageId` is in memory, then asks the
   * message list to scroll to it. Deep hits stay local and quiet; pages load in the background.
   */
  focusMessage: (conversationId: string, messageId: string) => Promise<void>
  clearFocusedMessage: () => void
  archiveConversation: (id: string) => void
  restoreConversation: (id: string) => void
  deleteArchivedConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  /** Drops conversations deleted by the empty-chat cleanup in any window. */
  removeConversations: (ids: string[]) => void
  clearAll: () => void
  sendMessage: (
    content: string,
    conversationId?: string,
    attachments?: ChatAttachment[],
    /** A shorter title seed for prompts that wrap the user's actual text (selection actions). */
    titleSeed?: string,
    /** Overrides the normal auto-speak setting for this reply. */
    autoSpeak?: boolean,
    /**
     * Sent as the newest user turn while the stored message keeps `content`. Used by the `/`
     * quick-prompt menu so History shows the user's text, not the wrapped instruction.
     */
    requestPrompt?: string,
    /** True when the draft contained clipboard text; recorded as provenance. */
    pasted?: boolean,
  ) => Promise<string | null>
  /** Replaces an assistant reply with a fresh response to the same user message. */
  regenerate: (
    conversationId: string,
    messageId: string,
    autoSpeak?: boolean,
  ) => Promise<void>
  /** Rewrites a user message and answers again, dropping everything that followed it. */
  editAndResend: (
    conversationId: string,
    messageId: string,
    content: string,
    /** True when the edit included clipboard text; recorded as provenance. */
    pasted?: boolean,
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
      const agentAttachments = message.attachments?.flatMap((attachment) => {
        const mapped = attachmentToAgent(attachment)
        return mapped ? [mapped] : []
      })

      return {
        id: message.id,
        role: message.role,
        content: message.content,
        ...(message.metadata?.pasted ? { pasted: true } : {}),
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

      const thinking = message.thinking?.trim()
      const stopped = cancelled && Boolean(message.content.trim())
      return [
        {
          ...message,
          status: 'complete' as const,
          metadata: {
            ...message.metadata,
            ...(thinking ? { thinking } : {}),
            ...(stopped ? { stopped: true } : {}),
          },
        },
      ]
    })

    return { ...conversation, updatedAt: Date.now(), messages }
  })
}

/** Adds incoming sources once each, keeping the order the model returned them in. */
function mergeSources(
  existing: ChatSource[] | undefined,
  incoming: ChatSource[],
): ChatSource[] {
  const merged = [...(existing ?? [])]
  const seen = new Set(merged.map((source) => source.url))
  for (const source of incoming) {
    if (!source.url || seen.has(source.url)) {
      continue
    }
    seen.add(source.url)
    merged.push(source)
  }
  return merged.slice(0, 30)
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
  autoSpeak,
  requestPrompt,
}: RunContext & {
  conversationId: string
  assistantMessageId: string
  /** When set, overrides the global auto-speak setting for this reply. */
  autoSpeak?: boolean
  /** Replaces the newest user turn in the request history without touching the stored message. */
  requestPrompt?: string
}) {
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

  // A quick prompt wraps the user's text for this request only; the visible message stays clean.
  if (requestPrompt) {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].role === 'user') {
        history[index] = { ...history[index], content: requestPrompt }
        break
      }
    }
  }

  // Another window (Settings) may have changed the model or base URL since this store hydrated.
  await useSettingsStore.persist.rehydrate()
  const settings = useSettingsStore.getState()

  set((current) => ({
    conversations: withMessage(
      current.conversations,
      conversationId,
      assistantMessageId,
      (message) => ({
        ...message,
        metadata: {
          ...message.metadata,
          ai_model: settings.model,
          thinking_effort: settings.thinkingEffort,
        },
      }),
    ),
  }))

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
    autoSpeak: autoSpeak ?? settings.autoSpeak,
    assistantMessageId,
    summarizeSpeech: settings.summarizeSpeech,
    thinkingEffort: settings.thinkingEffort,
    memoryEnabled: settings.memoryEnabled,
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
    onThinking: (token) => {
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
            thinking: (message.thinking ?? '') + token,
          }),
        ),
      }))
    },
    onSources: (sources) => {
      if (get().streamingRequestId !== requestId || sources.length === 0) {
        return
      }

      set((current) => ({
        conversations: withMessage(
          current.conversations,
          conversationId,
          assistantMessageId,
          (message) => ({
            ...message,
            metadata: {
              ...message.metadata,
              sources: mergeSources(message.metadata?.sources, sources),
            },
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
            ...(item.thinking?.trim()
              ? {
                  metadata: {
                    ...item.metadata,
                    thinking: item.thinking.trim(),
                  },
                }
              : {}),
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
  quickConversationId: null,
  lastQuickConversationId: null,
  hydrated: false,
  streamingRequestId: null,
  streamingConversationId: null,
  streamingMessageId: null,
  focusedMessageId: null,

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

  selectConversation: (id) =>
    set({ activeConversationId: id, focusedMessageId: null }),

  focusMessage: async (conversationId, messageId) => {
    set({ activeConversationId: conversationId, focusedMessageId: messageId })
    const find = () =>
      get().conversations.find(
        (conversation) => conversation.id === conversationId,
      )

    try {
      let conversation = find()
      if (!conversation) {
        return
      }
      if (!conversation.messagesLoaded) {
        const page = await loadMessagePage(
          conversationId,
          null,
          MESSAGE_PAGE_SIZE,
        )
        get().applyMessagePage(conversationId, page, 'replace')
      }

      // Walk back from the newest page until the hit is loaded. Every page stays in memory, so
      // the user can keep reading around the match once it appears.
      for (let attempt = 0; attempt < 500; attempt += 1) {
        conversation = find()
        if (!conversation) {
          return
        }
        if (conversation.messages.some((message) => message.id === messageId)) {
          return
        }
        if (!conversation.hasOlderMessages) {
          break
        }
        const page = await loadMessagePage(
          conversationId,
          conversation.historyCursor ?? null,
          MESSAGE_PAGE_SIZE,
        )
        get().applyMessagePage(conversationId, page, 'prepend')
        if (page.messages.length === 0) {
          break
        }
      }
    } catch {
      // Selecting the conversation still happened; leave it at the newest page.
    } finally {
      const conversation = find()
      if (!conversation?.messages.some((message) => message.id === messageId)) {
        set({ focusedMessageId: null })
      }
    }
  },

  clearFocusedMessage: () => set({ focusedMessageId: null }),

  ensureQuickConversation: () => {
    const state = get()
    const current = state.quickConversationId
      ? state.conversations.find(
          (conversation) => conversation.id === state.quickConversationId,
        )
      : undefined
    if (current && !current.archivedAt) {
      return current.id
    }

    const id = newId()
    const now = Date.now()
    set((currentState) => ({
      conversations: [
        emptyConversation(id, QUICK_CONVERSATION_TITLE, now),
        ...currentState.conversations,
      ],
      quickConversationId: id,
    }))
    persistQuickConversationId(id)

    return id
  },

  setQuickConversationId: (id) => set({ quickConversationId: id }),

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
      const quickConversationId =
        state.quickConversationId &&
        normalized.some(
          (conversation) =>
            conversation.id === state.quickConversationId &&
            !conversation.archivedAt,
        )
          ? state.quickConversationId
          : null
      const lastQuickConversationId =
        state.lastQuickConversationId &&
        state.lastQuickConversationId !== quickConversationId &&
        normalized.some(
          (conversation) =>
            conversation.id === state.lastQuickConversationId &&
            !conversation.archivedAt,
        )
          ? state.lastQuickConversationId
          : null

      return {
        conversations: normalized,
        activeConversationId,
        quickConversationId,
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
    const id = newId()

    set((state) => {
      const current = state.quickConversationId
        ? state.conversations.find(
            (conversation) => conversation.id === state.quickConversationId,
          )
        : undefined
      // A chat with messages stays in history as an ordinary conversation. An empty loaded
      // chat is just discarded. An unloaded chat may have older messages, so keep it too.
      const keepCurrent = hasMessages(current) && !current?.archivedAt
      const kept = keepCurrent && current ? settleConversation(current) : null
      const conversations = state.conversations
        .filter(
          (conversation) =>
            keepCurrent ||
            conversation.archivedAt !== undefined ||
            conversation.id !== current?.id,
        )
        .map((conversation) =>
          kept && conversation.id === kept.id ? kept : conversation,
        )

      return {
        conversations: [
          emptyConversation(id, QUICK_CONVERSATION_TITLE, now),
          ...conversations,
        ],
        quickConversationId: id,
        // Remember what New chat put away so Cmd+Shift+N can bring it back.
        lastQuickConversationId: keepCurrent
          ? (current?.id ?? null)
          : state.lastQuickConversationId,
        streamingRequestId: null,
        streamingConversationId: null,
        streamingMessageId: null,
        focusedMessageId: null,
      }
    })
    persistQuickConversationId(id)
  },

  restorePreviousQuickConversation: () => {
    cancelActiveRun()
    let previousId: string | null = null

    set((state) => {
      const lastQuickId = state.lastQuickConversationId
      if (!lastQuickId || lastQuickId === state.quickConversationId) {
        return state
      }

      const previous = state.conversations.find(
        (conversation) =>
          conversation.id === lastQuickId && !conversation.archivedAt,
      )
      if (!previous) {
        return { ...state, lastQuickConversationId: null }
      }

      const current = state.quickConversationId
        ? state.conversations.find(
            (conversation) => conversation.id === state.quickConversationId,
          )
        : undefined
      const keepCurrent = hasMessages(current) && !current?.archivedAt
      const keptCurrent =
        keepCurrent && current ? settleConversation(current) : null
      previousId = lastQuickId

      return {
        conversations: keepCurrent
          ? state.conversations.map((conversation) =>
              keptCurrent && conversation.id === keptCurrent.id
                ? keptCurrent
                : conversation,
            )
          : state.conversations.filter(
              (conversation) =>
                conversation.id !== current?.id ||
                conversation.archivedAt !== undefined,
            ),
        quickConversationId: lastQuickId,
        // Toggle: pressing Previous again returns to the chat that was just left.
        lastQuickConversationId: keepCurrent ? (current?.id ?? null) : null,
        streamingRequestId: null,
        streamingConversationId: null,
        streamingMessageId: null,
        focusedMessageId: null,
      }
    })

    if (previousId) {
      persistQuickConversationId(previousId)
    }
  },

  openQuickConversation: (id) => {
    const state = get()
    if (id === state.quickConversationId) {
      return
    }
    if (
      !state.conversations.some(
        (conversation) => conversation.id === id && !conversation.archivedAt,
      )
    ) {
      return
    }

    cancelActiveRun()

    set((current) => {
      const currentQuick = current.quickConversationId
        ? current.conversations.find(
            (conversation) => conversation.id === current.quickConversationId,
          )
        : undefined
      const keepCurrent = hasMessages(currentQuick) && !currentQuick?.archivedAt
      const keptCurrent =
        keepCurrent && currentQuick ? settleConversation(currentQuick) : null

      return {
        conversations: keepCurrent
          ? current.conversations.map((conversation) =>
              keptCurrent && conversation.id === keptCurrent.id
                ? keptCurrent
                : conversation,
            )
          : current.conversations.filter(
              (conversation) =>
                conversation.id !== currentQuick?.id ||
                conversation.archivedAt !== undefined,
            ),
        quickConversationId: id,
        // Keep the chat that was just left one shortcut away.
        lastQuickConversationId: keepCurrent
          ? (currentQuick?.id ?? null)
          : null,
        streamingRequestId: null,
        streamingConversationId: null,
        streamingMessageId: null,
        focusedMessageId: null,
      }
    })
    persistQuickConversationId(id)
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
          quickConversationId:
            state.quickConversationId === id ? null : state.quickConversationId,
          lastQuickConversationId:
            state.lastQuickConversationId === id
              ? null
              : state.lastQuickConversationId,
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
      const archived: Conversation = {
        ...target,
        archivedAt: now,
        updatedAt: now,
        messages: target.messages.map((message) =>
          message.status === 'streaming'
            ? { ...message, status: 'complete' as const }
            : message,
        ),
      }
      const conversations = state.conversations.map((conversation) =>
        conversation.id === id ? archived : conversation,
      )
      const activeConversationId =
        state.activeConversationId === id
          ? (conversations.find((conversation) => !conversation.archivedAt)
              ?.id ?? null)
          : state.activeConversationId

      return {
        conversations,
        activeConversationId,
        // The overlay will create a fresh quick chat when it next hydrates.
        quickConversationId:
          state.quickConversationId === id ? null : state.quickConversationId,
        lastQuickConversationId:
          state.lastQuickConversationId === id
            ? null
            : state.lastQuickConversationId,
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
        quickConversationId:
          state.quickConversationId === id ? null : state.quickConversationId,
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

  removeConversations: (ids) =>
    set((state) => {
      if (ids.length === 0) {
        return state
      }

      const removed = new Set(ids)
      const conversations = state.conversations.filter(
        (conversation) => !removed.has(conversation.id),
      )
      const activeConversationId =
        state.activeConversationId && removed.has(state.activeConversationId)
          ? (conversations.find((conversation) => !conversation.archivedAt)
              ?.id ?? null)
          : state.activeConversationId
      const quickConversationId =
        state.quickConversationId && removed.has(state.quickConversationId)
          ? null
          : state.quickConversationId
      const lastQuickConversationId =
        state.lastQuickConversationId &&
        removed.has(state.lastQuickConversationId)
          ? null
          : state.lastQuickConversationId
      const streamingConversationId =
        state.streamingConversationId &&
        removed.has(state.streamingConversationId)
          ? null
          : state.streamingConversationId

      return {
        conversations,
        activeConversationId,
        quickConversationId,
        lastQuickConversationId,
        streamingRequestId:
          streamingConversationId === null ? null : state.streamingRequestId,
        streamingConversationId,
        streamingMessageId:
          streamingConversationId === null ? null : state.streamingMessageId,
      }
    }),

  clearAll: () => {
    cancelActiveRun()
    set({
      conversations: [],
      activeConversationId: null,
      quickConversationId: null,
      lastQuickConversationId: null,
      streamingRequestId: null,
      streamingConversationId: null,
      streamingMessageId: null,
      focusedMessageId: null,
    })
  },

  sendMessage: async (
    content,
    targetConversationId,
    attachments,
    titleSeed,
    autoSpeak,
    requestPrompt,
    pasted,
  ) => {
    const text = content.trim()
    const titleText = titleSeed?.trim() || text
    const files = attachments ?? []
    if (!text && files.length === 0) {
      return null
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
        return null
      }
      conversationId = state.createConversation()
    }

    const conversation = get().conversations.find(
      (item) => item.id === conversationId,
    )
    if (!conversation || conversation.archivedAt) {
      // Archived conversations are read-only.
      return null
    }

    const now = Date.now()
    const userMessage: ChatMessage = {
      id: newId(),
      role: 'user',
      content: text,
      createdAt: now,
      status: 'complete',
      ...(files.length > 0 ? { attachments: files } : {}),
      ...(pasted ? { metadata: { pasted: true } } : {}),
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
    const sharedFileNames = files
      .map((file) => file.name)
      .filter(Boolean)
      .join(', ')
    const fallbackTitle = titleText
      ? titleFromMessage(titleText)
      : (files[0]?.name ?? 'Attachment')

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
        prompt:
          titleText ||
          (sharedFileNames
            ? `The user shared ${sharedFileNames}.`
            : 'The user shared a file with no text.'),
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
      autoSpeak,
      requestPrompt,
    })

    return userMessage.id
  },

  regenerate: async (conversationId, messageId, autoSpeak) => {
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
      autoSpeak,
    })
  },

  editAndResend: async (conversationId, messageId, content, pasted) => {
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
    const edited: ChatMessage = {
      ...original,
      content: text,
      // Once a turn contained clipboard text, keep that provenance through later edits.
      metadata: pasted
        ? { ...original.metadata, pasted: true }
        : original.metadata,
    }
    // Editing rewrites this turn: the old reply and everything after it are dropped.
    const kept = conversation.messages
      .slice(0, index)
      .concat(edited)
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

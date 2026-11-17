import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  CHAT_STORAGE_KEY,
  QUICK_CONVERSATION_ID,
  QUICK_CONVERSATION_TITLE,
} from '@/constants'
import { cancelActiveRun, startAgentRun } from '@/services/agent'
import { useSettingsStore } from '@/stores/settingsStore'
import { generateConversationTitle } from '@/tauri/commands/chat'
import type {
  AgentMessage,
  ChatAttachment,
  ChatMessage,
  Conversation,
} from '@/types/chat'
import { newId } from '@/utils/id'
import { attachmentToAgent } from '@/utils/image'
import { titleFromMessage } from '@/utils/string'
import { isTauri } from '@/utils/tauri'

type ChatState = {
  conversations: Conversation[]
  activeConversationId: string | null
  /** The quick conversation that the last New chat archived, so it can be restored. */
  lastQuickConversationId: string | null
  streamingRequestId: string | null
  streamingConversationId: string | null
  streamingMessageId: string | null
  createConversation: () => string
  ensureQuickConversation: () => string
  hydrateConversations: (conversations: Conversation[]) => void
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
        role: message.role,
        content: message.content,
        ...(agentAttachments?.length ? { attachments: agentAttachments } : {}),
      }
    })
}

type PersistedChatState = Pick<
  ChatState,
  'conversations' | 'activeConversationId' | 'lastQuickConversationId'
>

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

  const requestId = startAgentRun({
    conversationId,
    messages: history,
    baseUrl: settings.baseUrl,
    model: settings.model,
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

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      lastQuickConversationId: null,
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
            },
            ...state.conversations,
          ],
        }))

        return QUICK_CONVERSATION_ID
      },

      hydrateConversations: (conversations) =>
        set((state) => {
          const normalized = conversations
            // Older builds could archive an empty chat; those are not worth keeping.
            .filter(
              (conversation) =>
                !(
                  conversation.archivedAt && conversation.messages.length === 0
                ),
            )
            .map((conversation) => ({
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.status === 'streaming'
                  ? { ...message, status: 'complete' as const }
                  : message,
              ),
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt)
          const activeConversationId =
            state.activeConversationId &&
            normalized.some(
              (conversation) => conversation.id === state.activeConversationId,
            )
              ? state.activeConversationId
              : (normalized.find((conversation) => !conversation.archivedAt)
                  ?.id ?? null)
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

      resetQuickConversation: () => {
        cancelActiveRun()
        const now = Date.now()

        set((state) => {
          const quick = state.conversations.find(
            (conversation) => conversation.id === QUICK_CONVERSATION_ID,
          )
          // Keep the old quick chat in history under a new id instead of dropping it.
          const archived =
            quick && quick.messages.length > 0
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
          const fresh = {
            id: QUICK_CONVERSATION_ID,
            title: QUICK_CONVERSATION_TITLE,
            createdAt: now,
            updatedAt: now,
            messages: [],
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
            lastQuickConversationId:
              archived?.id ?? state.lastQuickConversationId,
            streamingRequestId: null,
            streamingConversationId: null,
            streamingMessageId: null,
          }
        })
      },

      restorePreviousQuickConversation: () => {
        cancelActiveRun()
        const now = Date.now()

        set((state) => {
          const previousId = state.lastQuickConversationId
          if (!previousId) {
            return state
          }

          const previous = state.conversations.find(
            (conversation) =>
              conversation.id === previousId &&
              conversation.id !== QUICK_CONVERSATION_ID &&
              conversation.messages.length > 0,
          )
          if (!previous) {
            return { ...state, lastQuickConversationId: null }
          }

          const quick = state.conversations.find(
            (conversation) => conversation.id === QUICK_CONVERSATION_ID,
          )
          const retiredCurrent =
            quick && quick.messages.length > 0
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
                  conversation.id !== previousId,
              ),
            ],
            activeConversationId: QUICK_CONVERSATION_ID,
            lastQuickConversationId: retiredCurrent?.id ?? null,
            streamingRequestId: null,
            streamingConversationId: null,
            streamingMessageId: null,
          }
        })
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

        // Empty chats have nothing worth keeping; remove them instead of archiving.
        if (target.messages.length === 0) {
          set((state) => {
            const conversations = state.conversations.filter(
              (conversation) => conversation.id !== id,
            )
            const activeConversationId =
              state.activeConversationId === id
                ? (conversations.find(
                    (conversation) => !conversation.archivedAt,
                  )?.id ?? null)
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
              (conversation) =>
                conversation.id === id && conversation.archivedAt,
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
              (conversation) =>
                conversation.id === id && conversation.archivedAt,
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
    }),
    {
      name: CHAT_STORAGE_KEY,
      partialize: (state): PersistedChatState => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        lastQuickConversationId: state.lastQuickConversationId,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<PersistedChatState> | undefined
        const conversations = (saved?.conversations ?? [])
          .filter(
            (conversation) =>
              !(conversation.archivedAt && conversation.messages.length === 0),
          )
          .map((conversation) => ({
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.status === 'streaming'
                ? { ...message, status: 'complete' as const }
                : message,
            ),
          }))

        return {
          ...current,
          conversations,
          activeConversationId:
            saved?.activeConversationId &&
            conversations.some(
              (conversation) => conversation.id === saved.activeConversationId,
            )
              ? saved.activeConversationId
              : (conversations[0]?.id ?? null),
          lastQuickConversationId:
            saved?.lastQuickConversationId &&
            conversations.some(
              (conversation) =>
                conversation.id === saved.lastQuickConversationId &&
                conversation.id !== QUICK_CONVERSATION_ID,
            )
              ? saved.lastQuickConversationId
              : null,
        }
      },
    },
  ),
)

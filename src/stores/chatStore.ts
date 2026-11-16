import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  CHAT_STORAGE_KEY,
  QUICK_CONVERSATION_ID,
  QUICK_CONVERSATION_TITLE,
} from '@/constants'
import { cancelActiveRun, startAgentRun } from '@/services/agent'
import { useSettingsStore } from '@/stores/settingsStore'
import type { AgentMessage, ChatMessage, Conversation } from '@/types/chat'
import { newId } from '@/utils/id'
import { titleFromMessage } from '@/utils/string'

type ChatState = {
  conversations: Conversation[]
  activeConversationId: string | null
  streamingRequestId: string | null
  streamingConversationId: string | null
  streamingMessageId: string | null
  createConversation: () => string
  ensureQuickConversation: () => string
  hydrateConversations: (conversations: Conversation[]) => void
  resetQuickConversation: () => void
  selectConversation: (id: string) => void
  archiveConversation: (id: string) => void
  restoreConversation: (id: string) => void
  deleteArchivedConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  clearAll: () => void
  sendMessage: (content: string, conversationId?: string) => Promise<void>
  stopStreaming: () => Promise<void>
}

type PersistedChatState = Pick<
  ChatState,
  'conversations' | 'activeConversationId'
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

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
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

          return { conversations: normalized, activeConversationId }
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

            return {
              conversations: [
                fresh,
                archive(quick, newId()),
                ...state.conversations.filter(
                  (conversation) => conversation.id !== QUICK_CONVERSATION_ID,
                ),
              ],
              activeConversationId:
                state.activeConversationId === QUICK_CONVERSATION_ID
                  ? fresh.id
                  : state.activeConversationId,
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

          return { conversations, activeConversationId }
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
          streamingRequestId: null,
          streamingConversationId: null,
          streamingMessageId: null,
        })
      },

      sendMessage: async (content, targetConversationId) => {
        const text = content.trim()
        if (!text) {
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
        const history: AgentMessage[] = [...conversation.messages, userMessage]
          .filter(
            (message) =>
              message.role === 'user' ||
              (message.role === 'assistant' &&
                message.status === 'complete' &&
                message.content.trim().length > 0),
          )
          .map((message) => ({
            role: message.role,
            content: message.content,
          }))
        // Another window (Settings) may have saved a new API key after this store hydrated.
        await useSettingsStore.persist.rehydrate()
        const settings = useSettingsStore.getState()

        set((current) => ({
          conversations: current.conversations.map((item) =>
            item.id === conversationId
              ? {
                  ...item,
                  title: isUntitled ? titleFromMessage(text) : item.title,
                  updatedAt: now,
                  messages: [...item.messages, userMessage, assistantMessage],
                }
              : item,
          ),
        }))

        const requestId = startAgentRun({
          conversationId,
          messages: history,
          apiKey: settings.apiKey,
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
                conversationId as string,
                assistantMessage.id,
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
                conversationId as string,
                assistantMessage.id,
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
                conversationId as string,
                assistantMessage.id,
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
          streamingMessageId: assistantMessage.id,
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
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<PersistedChatState> | undefined
        const conversations = (saved?.conversations ?? []).map(
          (conversation) => ({
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.status === 'streaming'
                ? { ...message, status: 'complete' as const }
                : message,
            ),
          }),
        )

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
        }
      },
    },
  ),
)

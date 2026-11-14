import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  CHAT_STORAGE_KEY,
  QUICK_CONVERSATION_ID,
  QUICK_CONVERSATION_TITLE,
} from '@/constants'
import { cancelActiveRun, startAgentRun } from '@/services/agent'
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
  resetQuickConversation: () => void
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
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
        if (current && current.messages.length === 0) {
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

      resetQuickConversation: () => {
        cancelActiveRun()
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
            ...state.conversations.filter(
              (conversation) => conversation.id !== QUICK_CONVERSATION_ID,
            ),
          ],
          streamingRequestId: null,
          streamingConversationId: null,
          streamingMessageId: null,
        }))
      },

      deleteConversation: (id) =>
        set((state) => {
          const conversations = state.conversations.filter(
            (conversation) => conversation.id !== id,
          )
          const activeConversationId =
            state.activeConversationId === id
              ? (conversations[0]?.id ?? null)
              : state.activeConversationId

          return { conversations, activeConversationId }
        }),

      renameConversation: (id, title) =>
        set((state) => ({
          conversations: state.conversations.map((conversation) =>
            conversation.id === id
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
        if (!conversation) {
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
        const history: AgentMessage[] = [
          ...conversation.messages,
          userMessage,
        ].map((message) => ({
          role: message.role,
          content: message.content,
        }))

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

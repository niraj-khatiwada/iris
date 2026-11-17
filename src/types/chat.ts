export type ChatRole = 'user' | 'assistant' | 'system'

export type MessageStatus = 'streaming' | 'complete' | 'error'

/** A pasted or dropped image, stored as a data URL so SQLite and the UI share one shape. */
export type ChatAttachment = {
  id: string
  name: string
  mediaType: string
  dataUrl: string
}

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  status: MessageStatus
  error?: string
  attachments?: ChatAttachment[]
}

export type ConversationSummary = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** Set when the conversation is moved to the archive; archived chats are read-only. */
  archivedAt?: number
}

export type Conversation = ConversationSummary & {
  messages: ChatMessage[]
  /** False until the newest page has been fetched from SQLite. */
  messagesLoaded?: boolean
  /** Cursor for the page before the oldest loaded message. */
  historyCursor?: string | null
  hasOlderMessages?: boolean
  /** Index of the loaded window in the virtual list; decreases as older pages prepend. */
  historyStart?: number
}

/** One page of messages plus the cursor needed to fetch the page before it. */
export type MessagePage = {
  messages: ChatMessage[]
  nextCursor: string | null
  hasMore: boolean
}

/** The minimal shape sent to the agent backend. */
export type AgentMessage = {
  /** The chat message id, so the backend can merge a paginated request tail with the DB. */
  id: string
  role: ChatRole
  content: string
  attachments?: Array<{ mediaType: string; data: string }>
}

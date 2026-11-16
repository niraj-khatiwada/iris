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

export type Conversation = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** Set when the conversation is moved to the archive; archived chats are read-only. */
  archivedAt?: number
  messages: ChatMessage[]
}

/** The minimal shape sent to the agent backend. */
export type AgentMessage = {
  role: ChatRole
  content: string
  attachments?: Array<{ mediaType: string; data: string }>
}

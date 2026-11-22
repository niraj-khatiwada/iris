export type ChatRole = 'user' | 'assistant' | 'system'

export type MessageStatus = 'streaming' | 'complete' | 'error'

/** DeepSeek's two parsing purposes for uploaded documents. */
export type DocumentPurpose = 'user_data' | 'rich_layout_recognition'

/**
 * A pasted or dropped attachment. Images keep an inline resized data URL; documents are uploaded
 * to DeepSeek's Files API and keep the returned file id for every later turn.
 */
export type ChatAttachment = {
  id: string
  name: string
  mediaType: string
  /** Images only. Documents reference `fileId` instead. */
  dataUrl?: string
  /** DeepSeek Files API id; present on documents after upload. */
  fileId?: string
  /** Original file inside the conversation's local attachments folder. */
  fileName?: string
  /** Resized image JPEG used for display and for the model request. */
  previewName?: string
  /** Parsing purpose used for a document upload. */
  purpose?: DocumentPurpose
  size?: number
  /** Optional for older stored images; infer from `dataUrl` when absent. */
  kind?: 'image' | 'document'
}

export type UploadStatus = 'uploading' | 'ready' | 'error'

/** A draft attachment plus the transient state of its Files API upload. */
export type DraftAttachment = ChatAttachment & {
  uploadStatus: UploadStatus
  error?: string
}

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  status: MessageStatus
  error?: string
  /** JSON metadata such as the model that produced an assistant reply. */
  metadata?: MessageMetadata
  attachments?: ChatAttachment[]
}

export type MessageMetadata = {
  /** The DeepSeek model id used for this assistant reply. */
  ai_model?: string
  [key: string]: unknown
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

/** A spoken summary cached for one assistant message by automatic read-aloud. */
export type SpokenSummary = {
  messageId: string
  summary: string
}

/** One page of messages plus the cursor needed to fetch the page before it. */
export type MessagePage = {
  messages: ChatMessage[]
  nextCursor: string | null
  hasMore: boolean
}

/** A conversation whose title matched a search query. */
export type SearchConversationHit = {
  id: string
  title: string
  updatedAt: number
  archived: boolean
}

/** A message whose body matched a search query, with a snippet around the first match. */
export type SearchMessageHit = {
  conversationId: string
  conversationTitle: string
  messageId: string
  role: ChatRole
  /** Matched words are wrapped in `\u0002` / `\u0003` so the sidebar can highlight them. */
  snippet: string
  createdAt: number
  archived: boolean
}

export type SearchResults = {
  conversations: SearchConversationHit[]
  messages: SearchMessageHit[]
}

/** The minimal shape sent to the agent backend. */
export type AgentMessage = {
  /** The chat message id, so the backend can merge a paginated request tail with the DB. */
  id: string
  role: ChatRole
  content: string
  attachments?: Array<{
    mediaType: string
    data: string
    fileId?: string
    localFile?: string
  }>
}

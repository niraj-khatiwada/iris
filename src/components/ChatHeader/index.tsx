import IrisBlob from '@/components/IrisBlob'
import { useChatStore } from '@/stores/chatStore'
import { formatConversationTime } from '@/utils/format'

function ChatHeader() {
  const conversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === state.activeConversationId),
  )
  const streaming = useChatStore((state) => Boolean(state.streamingRequestId))

  return (
    <header
      data-tauri-drag-region
      className="flex h-14 shrink-0 items-center gap-3 border-b border-border/40 px-5"
    >
      <IrisBlob
        emotion={streaming ? 'thinking' : 'neutral'}
        size={26}
        tone={streaming ? 'pending' : 'primary'}
      />

      <div data-tauri-drag-region className="min-w-0 flex-1">
        <h1 className="truncate text-[13px] font-semibold tracking-tight">
          {conversation?.title ?? 'New conversation'}
        </h1>
        <p className="truncate text-[10px] text-muted">
          {streaming
            ? 'Responding…'
            : conversation?.archivedAt
              ? 'Archived · Read only'
              : conversation
                ? `Updated ${formatConversationTime(conversation.updatedAt)}`
                : 'Ready when you are'}
        </p>
      </div>
    </header>
  )
}

ChatHeader.displayName = 'ChatHeader'

export default ChatHeader

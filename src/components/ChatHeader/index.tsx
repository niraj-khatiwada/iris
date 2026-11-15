import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { formatConversationTime } from '@/utils/format'
import { cn } from '@/utils/tailwind'

function ChatHeader() {
  const conversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === state.activeConversationId),
  )
  const streaming = useChatStore((state) => Boolean(state.streamingRequestId))
  const model = useSettingsStore((state) => state.model)

  return (
    <header
      data-tauri-drag-region
      className="flex h-14 shrink-0 items-center gap-3 border-b border-border/40 px-5"
    >
      <div data-tauri-drag-region className="min-w-0 flex-1">
        <h1 className="truncate text-[13px] font-semibold tracking-tight">
          {conversation?.title ?? 'New conversation'}
        </h1>
        <p className="truncate text-[10px] text-muted">
          {streaming
            ? 'Responding…'
            : conversation
              ? `Updated ${formatConversationTime(conversation.updatedAt)}`
              : 'Ready when you are'}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full border border-border/60 bg-surface/40 px-2.5 py-1 text-[10px] text-muted sm:flex">
          <span
            className={cn(
              'size-1.5 rounded-full bg-primary',
              streaming && 'animate-pulse',
            )}
          />
          {model}
        </span>
      </div>
    </header>
  )
}

ChatHeader.displayName = 'ChatHeader'

export default ChatHeader

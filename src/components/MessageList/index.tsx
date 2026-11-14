import EmptyState from '@/components/EmptyState'
import MessageBubble from '@/components/MessageList/MessageBubble'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { useChatStore } from '@/stores/chatStore'

function MessageList() {
  const conversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === state.activeConversationId),
  )
  const lastMessage = conversation?.messages[conversation.messages.length - 1]
  const { ref, onScroll } = useAutoScroll<HTMLDivElement>(
    `${conversation?.id ?? ''}:${lastMessage?.content.length ?? 0}`,
  )

  if (!conversation || conversation.messages.length === 0) {
    return <EmptyState />
  }

  return (
    <div
      ref={ref}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={onScroll}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
        {conversation.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
    </div>
  )
}

MessageList.displayName = 'MessageList'

export default MessageList

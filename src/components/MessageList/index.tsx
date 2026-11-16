import EmptyState from '@/components/EmptyState'
import MessageBubble from '@/components/MessageList/MessageBubble'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { useSpeechPlayback } from '@/hooks/useSpeechPlayback'
import { useChatStore } from '@/stores/chatStore'

function MessageList() {
  const conversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === state.activeConversationId),
  )
  const streaming = useChatStore((state) => Boolean(state.streamingRequestId))
  const { speaking, preparing } = useSpeechPlayback(conversation?.id)
  const lastMessage = conversation?.messages[conversation.messages.length - 1]
  const { ref, onScroll } = useAutoScroll<HTMLDivElement>(
    `${conversation?.id ?? ''}:${lastMessage?.content.length ?? 0}`,
  )

  if (!conversation || conversation.messages.length === 0) {
    return <EmptyState />
  }

  const messages = conversation.messages
  const readOnly = Boolean(conversation.archivedAt)
  const lastIndex = messages.length - 1
  // Only the tail of the conversation is actionable: regenerating an earlier reply would need to
  // discard everything after it, and editing is limited to the latest user turn for the same
  // reason.
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === 'user',
  )

  return (
    <div
      ref={ref}
      className="min-h-0 flex-1 overflow-y-auto"
      onScroll={onScroll}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
        {messages.map((message, index) => {
          const isLast = index === lastIndex
          // Read-aloud always belongs to the newest reply, which is the one Iris just finished.
          const isSpeaking = isLast && message.role === 'assistant'

          return (
            <MessageBubble
              key={message.id}
              canEdit={!readOnly && index === lastUserIndex}
              canRegenerate={
                !readOnly && isLast && message.role === 'assistant'
              }
              conversationId={conversation.id}
              disabled={streaming}
              message={message}
              preparing={isSpeaking && preparing}
              speaking={isSpeaking && speaking}
            />
          )
        })}
      </div>
    </div>
  )
}

MessageList.displayName = 'MessageList'

export default MessageList

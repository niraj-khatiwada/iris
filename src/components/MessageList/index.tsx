import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'

import EmptyState from '@/components/EmptyState'
import MessageBubble from '@/components/MessageList/MessageBubble'
import { useConversationHistory } from '@/hooks/useConversationHistory'
import { useChatStore } from '@/stores/chatStore'

function MessageList() {
  const conversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === state.activeConversationId),
  )
  const streaming = useChatStore((state) => Boolean(state.streamingRequestId))
  const { hasOlder, loadingOlder, loadOlder } = useConversationHistory(
    conversation?.id,
  )
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  const initialScrolled = useRef(false)
  const conversationId = conversation?.id

  // Start every conversation at the newest message; older pages prepend above the viewport.
  useEffect(() => {
    initialScrolled.current = false
    if (!conversationId || !conversation?.messagesLoaded) {
      return
    }

    const frame = requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: 'LAST', align: 'end' })
      initialScrolled.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [conversationId, conversation?.messagesLoaded])

  if (!conversation) {
    return <EmptyState />
  }

  if (!conversation.messagesLoaded) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <LoaderCircle className="size-4 animate-spin text-muted/60" />
      </div>
    )
  }

  if (conversation.messages.length === 0) {
    return <EmptyState />
  }

  const messages = conversation.messages
  const readOnly = Boolean(conversation.archivedAt)
  const lastMessageId = messages[messages.length - 1]?.id
  const lastUserMessageId = messages.findLast(
    (message) => message.role === 'user',
  )?.id

  const onStartReached = () => {
    if (!initialScrolled.current || !hasOlder || loadingOlder) {
      return
    }
    void loadOlder()
  }

  return (
    <div className="relative min-h-0 flex-1">
      <Virtuoso
        ref={virtuosoRef}
        key={conversation.id}
        alignToBottom
        className="h-full"
        components={{
          Header: () => (
            <div className="pt-8">
              {loadingOlder ? (
                <div className="flex justify-center pb-2">
                  <LoaderCircle className="size-4 animate-spin text-muted/60" />
                </div>
              ) : null}
            </div>
          ),
          Footer: () => <div className="h-14" />,
        }}
        computeItemKey={(_index, message) => message.id}
        data={messages}
        firstItemIndex={conversation.historyStart ?? 0}
        initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
        followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
        increaseViewportBy={{ top: 400, bottom: 400 }}
        itemContent={(_index, message) => (
          <div className="mx-auto w-full max-w-3xl px-6 pb-6">
            <MessageBubble
              canEdit={!readOnly && message.id === lastUserMessageId}
              canRegenerate={
                !readOnly &&
                message.id === lastMessageId &&
                message.role === 'assistant'
              }
              conversationId={conversation.id}
              disabled={streaming}
              message={message}
            />
          </div>
        )}
        minOverscanItemCount={2}
        startReached={onStartReached}
        style={{ height: '100%' }}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-background via-background/70 to-transparent" />
    </div>
  )
}

MessageList.displayName = 'MessageList'

export default MessageList

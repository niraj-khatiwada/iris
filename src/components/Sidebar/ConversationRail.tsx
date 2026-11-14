import { Button, Tooltip } from '@heroui/react'
import { MessageSquare } from 'lucide-react'

import { useChatStore } from '@/stores/chatStore'

function ConversationRail() {
  const conversations = useChatStore((state) => state.conversations)
  const activeId = useChatStore((state) => state.activeConversationId)
  const selectConversation = useChatStore((state) => state.selectConversation)

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-1 pb-2">
      {conversations.slice(0, 14).map((conversation) => (
        <Tooltip key={conversation.id} delay={400}>
          <Button
            isIconOnly
            aria-label={conversation.title}
            size="sm"
            variant={conversation.id === activeId ? 'secondary' : 'ghost'}
            onPress={() => selectConversation(conversation.id)}
          >
            <MessageSquare className="size-4" />
          </Button>
          <Tooltip.Content>{conversation.title}</Tooltip.Content>
        </Tooltip>
      ))}
    </div>
  )
}

ConversationRail.displayName = 'ConversationRail'

export default ConversationRail

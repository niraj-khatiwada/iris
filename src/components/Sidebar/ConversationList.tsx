import { Button, ScrollShadow } from '@heroui/react'
import { MessageSquare, Trash2 } from 'lucide-react'

import { useChatStore } from '@/stores/chatStore'
import { groupConversations } from '@/utils/format'
import { cn } from '@/utils/tailwind'

function ConversationList() {
  const conversations = useChatStore((state) => state.conversations)
  const activeId = useChatStore((state) => state.activeConversationId)
  const selectConversation = useChatStore((state) => state.selectConversation)
  const deleteConversation = useChatStore((state) => state.deleteConversation)
  const groups = groupConversations(conversations)

  return (
    <nav className="mt-4 min-h-0 flex-1 px-2">
      <ScrollShadow className="h-full">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-xs leading-5 text-muted">
            No conversations yet. Start one above.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted/70">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((conversation) => {
                  const isActive = conversation.id === activeId

                  return (
                    <div key={conversation.id} className="group/item relative">
                      <Button
                        fullWidth
                        className={cn(
                          'h-9 justify-start gap-2 px-2 text-left',
                          isActive && 'bg-surface-secondary/80',
                        )}
                        variant={isActive ? 'secondary' : 'ghost'}
                        onPress={() => selectConversation(conversation.id)}
                      >
                        <MessageSquare className="size-3.5 shrink-0 text-muted" />
                        <span
                          className={cn(
                            'truncate text-[13px]',
                            isActive && 'font-medium',
                          )}
                        >
                          {conversation.title}
                        </span>
                      </Button>
                      <button
                        aria-label={`Delete ${conversation.title}`}
                        className="absolute right-1.5 top-1/2 z-10 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted transition hover:bg-danger-soft hover:text-danger group-hover/item:flex"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          deleteConversation(conversation.id)
                        }}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </ScrollShadow>
    </nav>
  )
}

ConversationList.displayName = 'ConversationList'

export default ConversationList

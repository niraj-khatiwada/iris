import { Button, Dropdown, Label } from '@heroui/react'
import { Archive, MoreHorizontal, Pencil } from 'lucide-react'

import { useChatStore } from '@/stores/chatStore'
import type { Conversation } from '@/types/chat'

type ConversationActionsProps = {
  conversation: Conversation
  onRename: (conversation: Conversation) => void
}

/** Rename and archive actions for one conversation row. */
function ConversationActions({
  conversation,
  onRename,
}: ConversationActionsProps) {
  const archiveConversation = useChatStore((state) => state.archiveConversation)

  return (
    <Dropdown>
      <Button
        isIconOnly
        aria-label={`Actions for ${conversation.title}`}
        className="absolute top-1/2 right-1.5 size-6 min-w-6 -translate-y-1/2 text-muted opacity-0 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100"
        size="sm"
        variant="ghost"
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
      <Dropdown.Popover className="min-w-40 rounded-lg">
        <Dropdown.Menu
          onAction={(key) => {
            if (key === 'rename') {
              onRename(conversation)
            } else if (key === 'archive') {
              archiveConversation(conversation.id)
            }
          }}
        >
          <Dropdown.Item id="rename" className="rounded-md" textValue="Rename">
            <Pencil className="size-3.5 text-muted" />
            <Label>Rename</Label>
          </Dropdown.Item>
          <Dropdown.Item
            id="archive"
            className="rounded-md"
            textValue="Archive"
          >
            <Archive className="size-3.5 text-muted" />
            <Label>Archive</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

ConversationActions.displayName = 'ConversationActions'

export default ConversationActions

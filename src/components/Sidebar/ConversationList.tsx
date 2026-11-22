import {
  Button,
  Input,
  Label,
  Modal,
  ScrollShadow,
  TextField,
} from '@heroui/react'
import { MessageSquare } from 'lucide-react'
import { useState } from 'react'

import ConversationActions from '@/components/Sidebar/ConversationActions'
import { NO_WRITING_ASSIST } from '@/constants'
import { useChatStore } from '@/stores/chatStore'
import { groupConversations } from '@/utils/format'
import { cn } from '@/utils/tailwind'

function ConversationList() {
  const conversations = useChatStore((state) => state.conversations)
  const activeId = useChatStore((state) => state.activeConversationId)
  const selectConversation = useChatStore((state) => state.selectConversation)
  const renameConversation = useChatStore((state) => state.renameConversation)
  const groups = groupConversations(
    conversations.filter((conversation) => !conversation.archivedAt),
  )
  const [renaming, setRenaming] = useState<{
    id: string
    title: string
  } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  return (
    <>
      <nav className="mt-2 min-h-0 flex-1 px-2">
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
                      <div
                        key={conversation.id}
                        className="group/item relative"
                      >
                        <Button
                          fullWidth
                          className={cn(
                            'h-9 justify-start gap-2 pr-9 pl-3 text-left',
                            isActive && 'bg-surface-secondary/80',
                          )}
                          variant={isActive ? 'secondary' : 'ghost'}
                          onPress={() => selectConversation(conversation.id)}
                        >
                          <MessageSquare className="size-3.5 shrink-0 text-muted" />
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate text-[13px]',
                              isActive && 'font-medium',
                            )}
                          >
                            {conversation.title}
                          </span>
                        </Button>

                        <ConversationActions
                          conversation={conversation}
                          onRename={(item) => {
                            setRenaming(item)
                            setRenameValue(item.title)
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </ScrollShadow>
      </nav>

      <Modal.Backdrop
        isOpen={renaming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenaming(null)
          }
        }}
      >
        <Modal.Container>
          <Modal.Dialog
            aria-label="Rename conversation"
            className="glass-dialog sm:max-w-sm"
          >
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Rename conversation</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TextField
                name="conversationTitle"
                value={renameValue}
                variant="secondary"
                onChange={setRenameValue}
              >
                <Label>Title</Label>
                <Input
                  {...NO_WRITING_ASSIST}
                  autoFocus
                  placeholder="Conversation title"
                />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="secondary">
                Cancel
              </Button>
              <Button
                slot="close"
                onPress={() => {
                  if (renaming) {
                    renameConversation(renaming.id, renameValue)
                  }
                }}
              >
                Save
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  )
}

ConversationList.displayName = 'ConversationList'

export default ConversationList

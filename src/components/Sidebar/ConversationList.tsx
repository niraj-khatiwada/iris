import {
  Button,
  Dropdown,
  Input,
  Label,
  Modal,
  ScrollShadow,
  TextField,
} from '@heroui/react'
import { MessageSquare, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useChatStore } from '@/stores/chatStore'
import { groupConversations } from '@/utils/format'
import { cn } from '@/utils/tailwind'

function ConversationList() {
  const conversations = useChatStore((state) => state.conversations)
  const activeId = useChatStore((state) => state.activeConversationId)
  const selectConversation = useChatStore((state) => state.selectConversation)
  const deleteConversation = useChatStore((state) => state.deleteConversation)
  const renameConversation = useChatStore((state) => state.renameConversation)
  const groups = groupConversations(conversations)
  const [renaming, setRenaming] = useState<{
    id: string
    title: string
  } | null>(null)
  const [renameValue, setRenameValue] = useState('')

  return (
    <>
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
                      <div
                        key={conversation.id}
                        className="group/item relative"
                      >
                        <Button
                          fullWidth
                          className={cn(
                            'h-9 justify-start gap-2 pr-9 pl-2 text-left',
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
                                  setRenaming(conversation)
                                  setRenameValue(conversation.title)
                                } else if (key === 'delete') {
                                  deleteConversation(conversation.id)
                                }
                              }}
                            >
                              <Dropdown.Item
                                id="rename"
                                className="rounded-md"
                                textValue="Rename"
                              >
                                <Pencil className="size-3.5 text-muted" />
                                <Label>Rename</Label>
                              </Dropdown.Item>
                              <Dropdown.Item
                                id="delete"
                                className="rounded-md"
                                textValue="Delete"
                                variant="danger"
                              >
                                <Trash2 className="size-3.5 text-danger" />
                                <Label>Delete</Label>
                              </Dropdown.Item>
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
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
                <Input autoFocus placeholder="Conversation title" />
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

import { Button, Dropdown, Label } from '@heroui/react'
import { ask } from '@tauri-apps/plugin-dialog'
import {
  Archive,
  ChevronDown,
  MessageSquare,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'

import { useChatStore } from '@/stores/chatStore'
import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'

/** Archived conversations are read-only; restoring puts one back into the active list. */
function ArchiveList() {
  const conversations = useChatStore((state) => state.conversations)
  const activeId = useChatStore((state) => state.activeConversationId)
  const selectConversation = useChatStore((state) => state.selectConversation)
  const restoreConversation = useChatStore((state) => state.restoreConversation)
  const deleteArchivedConversation = useChatStore(
    (state) => state.deleteArchivedConversation,
  )
  const [open, setOpen] = useState(false)

  const archived = conversations
    .filter((conversation) => conversation.archivedAt)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))

  if (archived.length === 0) {
    return null
  }

  const remove = async (id: string, title: string) => {
    const message = `Delete "${title}" permanently? This cannot be undone.`
    const confirmed = isTauri()
      ? await ask(message, {
          title: 'Delete conversation',
          kind: 'warning',
          okLabel: 'Delete',
          cancelLabel: 'Cancel',
        })
      : window.confirm(message)

    if (confirmed) {
      deleteArchivedConversation(id)
    }
  }

  return (
    <div className="shrink-0 border-t border-border/40 px-2 py-2">
      <button
        type="button"
        aria-expanded={open}
        className="flex h-8 w-full items-center gap-2 rounded-lg px-3 text-left text-[11px] text-muted transition-colors hover:bg-surface/50"
        onClick={() => setOpen((value) => !value)}
      >
        <Archive className="size-3.5 shrink-0" />
        <span className="font-medium">Archives</span>
        <span className="ml-auto rounded-full bg-surface/70 px-1.5 py-0.5 text-[10px] tabular-nums">
          {archived.length}
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <div className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
          {archived.map((conversation) => {
            const isActive = conversation.id === activeId

            return (
              <div key={conversation.id} className="group/item relative">
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
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
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
                  <Dropdown.Popover className="min-w-44 rounded-lg">
                    <Dropdown.Menu
                      onAction={(key) => {
                        if (key === 'restore') {
                          restoreConversation(conversation.id)
                        } else if (key === 'delete') {
                          void remove(conversation.id, conversation.title)
                        }
                      }}
                    >
                      <Dropdown.Item
                        id="restore"
                        className="rounded-md"
                        textValue="Restore"
                      >
                        <RotateCcw className="size-3.5 text-muted" />
                        <Label>Restore</Label>
                      </Dropdown.Item>
                      <Dropdown.Item
                        id="delete"
                        className="rounded-md"
                        textValue="Delete permanently"
                        variant="danger"
                      >
                        <Trash2 className="size-3.5 text-danger" />
                        <Label>Delete permanently</Label>
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

ArchiveList.displayName = 'ArchiveList'

export default ArchiveList

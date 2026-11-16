import { Button } from '@heroui/react'
import { ask } from '@tauri-apps/plugin-dialog'
import { Archive, RotateCcw, Trash2 } from 'lucide-react'

import { useChatStore } from '@/stores/chatStore'
import type { Conversation } from '@/types/chat'
import { isTauri } from '@/utils/tauri'

/**
 * Replaces the composer while an archived conversation is open. Archived chats are read-only,
 * so the only actions are restoring or deleting them permanently.
 */
function ArchivedComposer({ conversation }: { conversation: Conversation }) {
  const restoreConversation = useChatStore((state) => state.restoreConversation)
  const deleteArchivedConversation = useChatStore(
    (state) => state.deleteArchivedConversation,
  )

  const remove = async () => {
    const message = `Delete "${conversation.title}" permanently? This cannot be undone.`
    const confirmed = isTauri()
      ? await ask(message, {
          title: 'Delete conversation',
          kind: 'warning',
          okLabel: 'Delete',
          cancelLabel: 'Cancel',
        })
      : window.confirm(message)

    if (confirmed) {
      deleteArchivedConversation(conversation.id)
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-6 pt-2">
      <div className="glass-control flex items-center gap-3 rounded-3xl px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface/60 text-muted">
          <Archive className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">
            Archived conversation
          </p>
          <p className="truncate text-[11px] text-muted">
            Read only · restore it to continue chatting.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => restoreConversation(conversation.id)}
          >
            <RotateCcw className="size-3.5" />
            Restore
          </Button>
          <Button
            isIconOnly
            aria-label="Delete conversation permanently"
            size="sm"
            variant="danger-soft"
            onPress={() => void remove()}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

ArchivedComposer.displayName = 'ArchivedComposer'

export default ArchivedComposer

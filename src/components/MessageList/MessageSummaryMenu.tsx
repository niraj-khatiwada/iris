import { Button, Popover, Switch } from '@heroui/react'
import { MoreHorizontal } from 'lucide-react'

import { useSummaryStore } from '@/stores/summaryStore'

type MessageSummaryMenuProps = {
  messageId: string
}

/**
 * Per-message actions for a reply that has a cached spoken summary. The switch only changes this
 * message's transcript view; Copy and Read aloud follow the same text.
 */
function MessageSummaryMenu({ messageId }: MessageSummaryMenuProps) {
  const viewing = useSummaryStore((state) => state.viewing[messageId] ?? false)
  const setViewing = useSummaryStore((state) => state.setViewing)

  return (
    <Popover>
      <Button
        isIconOnly
        aria-label="Message actions"
        className="size-6 min-w-6 text-muted"
        size="sm"
        variant="ghost"
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
      <Popover.Content
        className="w-52 rounded-lg p-0"
        placement="top"
        offset={8}
      >
        <Popover.Dialog className="p-1">
          <Switch
            className="w-full"
            isSelected={viewing}
            size="sm"
            onChange={(enabled) => setViewing(messageId, enabled)}
          >
            <Switch.Content className="flex w-full items-center justify-between gap-4 px-2 py-1.5">
              <span className="text-[12px] text-muted">Show summary</span>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

MessageSummaryMenu.displayName = 'MessageSummaryMenu'

export default MessageSummaryMenu

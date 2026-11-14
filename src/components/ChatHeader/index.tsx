import { Button, Tooltip } from '@heroui/react'
import { PanelLeftOpen, Settings2 } from 'lucide-react'

import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { formatConversationTime } from '@/utils/format'

function ChatHeader() {
  const conversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === state.activeConversationId),
  )
  const streaming = useChatStore((state) => Boolean(state.streamingRequestId))
  const model = useSettingsStore((state) => state.model)
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const openSettings = useUIStore((state) => state.openSettings)

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/40 px-5">
      {!sidebarOpen ? (
        <Tooltip delay={400}>
          <Button
            isIconOnly
            aria-label="Show sidebar"
            size="sm"
            variant="ghost"
            onPress={toggleSidebar}
          >
            <PanelLeftOpen className="size-4" />
          </Button>
          <Tooltip.Content>Show sidebar</Tooltip.Content>
        </Tooltip>
      ) : null}

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[13px] font-semibold tracking-tight">
          {conversation?.title ?? 'New conversation'}
        </h1>
        <p className="truncate text-[10px] text-muted">
          {streaming
            ? 'Responding…'
            : conversation
              ? `Updated ${formatConversationTime(conversation.updatedAt)}`
              : 'Ready when you are'}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full border border-border/60 bg-surface/40 px-2.5 py-1 text-[10px] text-muted sm:flex">
          <span
            className={
              streaming
                ? 'size-1.5 animate-pulse rounded-full bg-accent'
                : 'size-1.5 rounded-full bg-success/80'
            }
          />
          {model}
        </span>
        <Tooltip delay={400}>
          <Button
            isIconOnly
            aria-label="Open settings"
            size="sm"
            variant="ghost"
            onPress={openSettings}
          >
            <Settings2 className="size-4" />
          </Button>
          <Tooltip.Content>Settings</Tooltip.Content>
        </Tooltip>
      </div>
    </header>
  )
}

ChatHeader.displayName = 'ChatHeader'

export default ChatHeader

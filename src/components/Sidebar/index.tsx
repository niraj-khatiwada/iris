import { Button } from '@heroui/react'
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'

import ArchiveList from '@/components/Sidebar/ArchiveList'
import ConversationList from '@/components/Sidebar/ConversationList'
import ConversationRail from '@/components/Sidebar/ConversationRail'
import SidebarFooter from '@/components/Sidebar/SidebarFooter'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'

function Sidebar() {
  const open = useUIStore((state) => state.sidebarOpen)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const createConversation = useChatStore((state) => state.createConversation)

  // Native windows draw the traffic lights over the top-left. The browser preview does not.
  const collapsedInset = isTauri() ? 'pt-8' : 'pt-2'

  return (
    <aside
      className={cn(
        'glass-rail flex h-full shrink-0 flex-col border-r border-border/40 transition-[width] duration-300 ease-out',
        open ? 'w-[280px]' : 'w-[68px]',
      )}
    >
      {open ? (
        <div
          data-tauri-drag-region
          className="flex h-14 shrink-0 items-center justify-end pr-2"
        >
          <Button
            isIconOnly
            aria-label="Collapse sidebar"
            size="sm"
            variant="ghost"
            onPress={toggleSidebar}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
      ) : (
        <div
          data-tauri-drag-region
          className={cn(
            'flex shrink-0 items-center justify-center px-1',
            collapsedInset,
          )}
        >
          <Button
            isIconOnly
            aria-label="Expand sidebar"
            className="size-8"
            size="sm"
            variant="ghost"
            onPress={toggleSidebar}
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        </div>
      )}

      <div className={cn('px-2 pt-2', !open && 'flex justify-center')}>
        <Button
          fullWidth={open}
          isIconOnly={!open}
          aria-label="New conversation"
          className={cn(open && 'justify-start gap-2 pl-3 pr-3 text-[13px]')}
          variant="secondary"
          onPress={() => createConversation()}
        >
          <Plus className="size-3.5" />
          {open ? <span>New chat</span> : null}
        </Button>
      </div>

      {open ? (
        <>
          <ConversationList />
          <ArchiveList />
        </>
      ) : (
        <ConversationRail />
      )}

      <SidebarFooter open={open} />
    </aside>
  )
}

Sidebar.displayName = 'Sidebar'

export default Sidebar

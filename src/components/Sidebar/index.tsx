import { Button } from '@heroui/react'
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'

import Logo from '@/components/Logo'
import ConversationList from '@/components/Sidebar/ConversationList'
import ConversationRail from '@/components/Sidebar/ConversationRail'
import SidebarFooter from '@/components/Sidebar/SidebarFooter'
import { APP_NAME } from '@/constants'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/utils/tailwind'

function Sidebar() {
  const open = useUIStore((state) => state.sidebarOpen)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const createConversation = useChatStore((state) => state.createConversation)

  return (
    <aside
      className={cn(
        'glass-rail flex h-full shrink-0 flex-col border-r border-border/40 transition-[width] duration-300 ease-out',
        open ? 'w-[280px]' : 'w-[68px]',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-3 px-4 pb-2 pt-3',
          !open && 'justify-center px-2',
        )}
      >
        <Logo size={28} />
        {open ? (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold tracking-tight">
                {APP_NAME}
              </p>
              <p className="truncate text-[10px] uppercase tracking-[0.2em] text-muted/70">
                Personal assistant
              </p>
            </div>
            <Button
              isIconOnly
              aria-label="Collapse sidebar"
              size="sm"
              variant="ghost"
              onPress={toggleSidebar}
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </>
        ) : null}
      </div>

      <div className={cn('px-3 pt-2', !open && 'px-2')}>
        <Button
          fullWidth={open}
          isIconOnly={!open}
          aria-label="New conversation"
          className={cn(open && 'justify-start gap-2')}
          variant="secondary"
          onPress={() => createConversation()}
        >
          <Plus className="size-4" />
          {open ? <span>New chat</span> : null}
        </Button>
        {!open ? (
          <Button
            isIconOnly
            fullWidth
            aria-label="Expand sidebar"
            className="mt-1"
            variant="ghost"
            onPress={toggleSidebar}
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        ) : null}
      </div>

      {open ? <ConversationList /> : <ConversationRail />}

      <SidebarFooter open={open} />
    </aside>
  )
}

Sidebar.displayName = 'Sidebar'

export default Sidebar

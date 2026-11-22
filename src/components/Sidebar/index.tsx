import { Button, Tooltip } from '@heroui/react'
import { PanelLeftOpen, Plus, Search } from 'lucide-react'
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

import ArchiveList from '@/components/Sidebar/ArchiveList'
import ConversationList from '@/components/Sidebar/ConversationList'
import SidebarFooter from '@/components/Sidebar/SidebarFooter'
import SidebarSearch from '@/components/Sidebar/SidebarSearch'
import SidebarTopActions from '@/components/Sidebar/SidebarTopActions'
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from '@/constants'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'

function clampWidth(width: number) {
  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)),
  )
}

function Sidebar() {
  const open = useUIStore((state) => state.sidebarOpen)
  const toggleSidebar = useUIStore((state) => state.toggleSidebar)
  const searching = useUIStore((state) => state.searchQuery.trim().length > 0)
  const setSearchQuery = useUIStore((state) => state.setSearchQuery)
  const focusSearch = useUIStore((state) => state.focusSearch)
  const createConversation = useChatStore((state) => state.createConversation)
  const savedWidth = useSettingsStore((state) => state.sidebarWidth)
  const setSidebarWidth = useSettingsStore((state) => state.setSidebarWidth)
  const [width, setWidth] = useState(() => clampWidth(savedWidth))
  const widthRef = useRef(width)
  const resizeOrigin = useRef<{ x: number; width: number } | null>(null)
  const [resizing, setResizing] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [pointerY, setPointerY] = useState<number | null>(null)

  // Native windows draw the traffic lights over the top-left. The browser preview does not.
  const collapsedInset = isTauri() ? 'pt-8' : 'pt-2'

  useEffect(() => {
    const next = clampWidth(savedWidth)
    widthRef.current = next
    setWidth(next)
  }, [savedWidth])

  // Keep the cursor and text selection stable while the pointer is captured by the border.
  useEffect(() => {
    if (!resizing) {
      return
    }
    const previousUserSelect = document.body.style.userSelect
    const previousCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    return () => {
      document.body.style.userSelect = previousUserSelect
      document.body.style.cursor = previousCursor
    }
  }, [resizing])

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!open || event.button !== 0) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeOrigin.current = { x: event.clientX, width: widthRef.current }
    setHovered(true)
    setPointerY(event.clientY - event.currentTarget.getBoundingClientRect().top)
    setResizing(true)
  }

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    setHovered(true)
    setPointerY(event.clientY - event.currentTarget.getBoundingClientRect().top)

    const origin = resizeOrigin.current
    if (!origin) {
      return
    }
    const next = clampWidth(origin.width + event.clientX - origin.x)
    widthRef.current = next
    setWidth(next)
  }

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeOrigin.current) {
      return
    }
    resizeOrigin.current = null
    setResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // Persist only the settled width, not every pointer move.
    setSidebarWidth(widthRef.current)
  }

  return (
    <aside
      className={cn(
        'glass-rail relative flex h-full shrink-0 flex-col border-r border-border/40',
        !resizing && 'transition-[width] duration-300 ease-out',
        !open && 'w-[68px]',
      )}
      style={open ? { width } : undefined}
    >
      {open ? (
        <div
          data-tauri-drag-region
          className="flex h-8 shrink-0 items-center justify-end pr-2"
        >
          <SidebarTopActions />
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
            className="size-8 min-w-8"
            size="sm"
            variant="ghost"
            onPress={toggleSidebar}
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        </div>
      )}

      {open ? (
        <SidebarSearch
          onCreate={() => {
            setSearchQuery('')
            createConversation()
          }}
        />
      ) : null}

      {!open ? (
        <>
          <div className="flex justify-center px-2 pt-2">
            <Tooltip delay={400}>
              <Button
                isIconOnly
                aria-label="New conversation"
                className="size-8 min-w-8"
                size="sm"
                variant="ghost"
                onPress={() => {
                  setSearchQuery('')
                  createConversation()
                }}
              >
                <Plus className="size-4" />
              </Button>
              <Tooltip.Content>New chat</Tooltip.Content>
            </Tooltip>
          </div>

          <div className="flex justify-center px-2 pt-2">
            <Tooltip delay={400}>
              <Button
                isIconOnly
                aria-label="Search chats"
                className="size-8 min-w-8"
                size="sm"
                variant="ghost"
                onPress={focusSearch}
              >
                <Search className="size-4" />
              </Button>
              <Tooltip.Content>Search chats</Tooltip.Content>
            </Tooltip>
          </div>
        </>
      ) : null}

      {open ? (
        searching ? null : (
          <>
            <ConversationList />
            <ArchiveList />
          </>
        )
      ) : (
        <div className="min-h-0 flex-1" />
      )}

      <div
        aria-label="Sidebar border"
        aria-orientation="vertical"
        className={cn(
          'absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 touch-none',
          open ? 'cursor-col-resize' : 'cursor-default',
        )}
        role="separator"
        title={
          open
            ? 'Drag to resize · Double-click to collapse'
            : 'Double-click to expand'
        }
        onDoubleClick={toggleSidebar}
        onPointerCancel={finishResize}
        onPointerDown={startResize}
        onPointerEnter={(event) => {
          setHovered(true)
          setPointerY(
            event.clientY - event.currentTarget.getBoundingClientRect().top,
          )
        }}
        onPointerLeave={() => {
          if (!resizing) {
            setHovered(false)
          }
        }}
        onPointerMove={moveResize}
        onPointerUp={finishResize}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 w-px rounded-full transition-opacity duration-150"
          style={{
            top: pointerY ?? 0,
            height: 100,
            transform: 'translate(-50%, -50%)',
            background:
              'linear-gradient(to bottom, transparent 0%, color-mix(in oklch, var(--primary) 30%, transparent) 30%, color-mix(in oklch, var(--primary) 65%, transparent) 50%, color-mix(in oklch, var(--primary) 30%, transparent) 70%, transparent 100%)',
            opacity: (hovered || resizing) && pointerY !== null ? 1 : 0,
          }}
        />
      </div>

      {open ? <SidebarFooter /> : null}
    </aside>
  )
}

Sidebar.displayName = 'Sidebar'

export default Sidebar

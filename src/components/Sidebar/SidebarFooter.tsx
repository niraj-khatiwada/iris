import { Avatar, Tooltip } from '@heroui/react'
import { Settings } from 'lucide-react'

import Button from '@/components/Button'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/utils/tailwind'

function SidebarFooter({ open }: { open: boolean }) {
  const openSettings = useUIStore((state) => state.openSettings)

  if (!open) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-border/50 p-2">
        <ThemeSwitcher />
        <Tooltip delay={400}>
          <Button
            isIconOnly
            aria-label="Settings"
            size="sm"
            variant="ghost"
            onPress={openSettings}
          >
            <Settings className="size-4" />
          </Button>
          <Tooltip.Content>Settings</Tooltip.Content>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className="border-t border-border/50 p-3">
      <div className={cn('flex items-center gap-2.5 px-1 py-1.5')}>
        <Avatar color="accent" size="sm">
          <Avatar.Fallback className="text-[10px]">You</Avatar.Fallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">You</p>
          <p className="truncate text-[10px] text-muted">Local workspace</p>
        </div>
        <ThemeSwitcher />
        <Tooltip delay={400}>
          <Button
            isIconOnly
            aria-label="Settings"
            size="sm"
            variant="ghost"
            onPress={openSettings}
          >
            <Settings className="size-4" />
          </Button>
          <Tooltip.Content>Settings</Tooltip.Content>
        </Tooltip>
      </div>
      <p className="flex items-center gap-1.5 px-1 pt-1 text-[10px] text-muted/70">
        <span className="size-1.5 rounded-full bg-success/80" />
        Private by default
      </p>
    </div>
  )
}

SidebarFooter.displayName = 'SidebarFooter'

export default SidebarFooter

import { Tooltip } from '@heroui/react'
import { Settings } from 'lucide-react'

import Button from '@/components/Button'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import { useUIStore } from '@/stores/uiStore'

/** Compact theme and settings controls for the sidebar's top row. */
function SidebarTopActions() {
  const openSettings = useUIStore((state) => state.openSettings)

  return (
    <div className="flex items-center gap-0.5">
      <ThemeSwitcher compact />
      <Tooltip delay={400}>
        <Button
          isIconOnly
          aria-label="Settings"
          className="size-6 min-w-6"
          size="sm"
          variant="ghost"
          onPress={openSettings}
        >
          <Settings className="size-3.5" />
        </Button>
        <Tooltip.Content>Settings</Tooltip.Content>
      </Tooltip>
    </div>
  )
}

SidebarTopActions.displayName = 'SidebarTopActions'

export default SidebarTopActions

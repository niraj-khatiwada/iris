import { Tooltip } from '@heroui/react'
import { Settings } from 'lucide-react'

import Button from '@/components/Button'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import { useUIStore } from '@/stores/uiStore'

function SidebarFooter({ open }: { open: boolean }) {
  const openSettings = useUIStore((state) => state.openSettings)

  if (!open) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-border/50 p-2">
        <ThemeSwitcher />
        <SettingsButton onPress={openSettings} />
      </div>
    )
  }

  return (
    <div className="flex items-center justify-end gap-1 border-t border-border/50 px-3 py-2">
      <ThemeSwitcher />
      <SettingsButton onPress={openSettings} />
    </div>
  )
}

function SettingsButton({ onPress }: { onPress: () => void }) {
  return (
    <Tooltip delay={400}>
      <Button
        isIconOnly
        aria-label="Settings"
        size="sm"
        variant="ghost"
        onPress={onPress}
      >
        <Settings className="size-4" />
      </Button>
      <Tooltip.Content>Settings</Tooltip.Content>
    </Tooltip>
  )
}

SidebarFooter.displayName = 'SidebarFooter'

export default SidebarFooter

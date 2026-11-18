import { Tooltip } from '@heroui/react'
import { ArrowRight, Settings } from 'lucide-react'
import { useEffect } from 'react'

import Button from '@/components/Button'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { hasApiKey } from '@/tauri/commands/voice'
import { isTauri } from '@/utils/tauri'

function SidebarFooter({ open }: { open: boolean }) {
  const openSettings = useUIStore((state) => state.openSettings)
  const openSettingsAt = useUIStore((state) => state.openSettingsAt)
  const apiKeyPresent = useSettingsStore((state) => state.apiKeyPresent)
  const apiKeyHint = useSettingsStore((state) => state.apiKeyHint)
  const setApiKeyState = useSettingsStore((state) => state.setApiKeyState)

  // The cached flag keeps the first paint instant; the database is the source of truth.
  useEffect(() => {
    if (!isTauri()) {
      return
    }

    void hasApiKey()
      .then((present) => {
        const state = useSettingsStore.getState()
        if (state.apiKeyPresent !== present) {
          setApiKeyState({ present, hint: present ? apiKeyHint : null })
        }
      })
      .catch(() => {
        // Keep the cached flag; Settings can re-check when it opens.
      })
  }, [apiKeyHint, setApiKeyState])

  if (!open) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-border/50 p-2">
        <ThemeSwitcher />
        <SettingsButton onPress={openSettings} />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 border-t border-border/50 px-3 py-2">
      {!apiKeyPresent ? (
        <Button
          aria-label="API key is not set. Open API key settings."
          className="mr-auto h-7 min-w-0 justify-start gap-1 px-1.5 text-[11px] font-normal text-danger hover:text-danger"
          variant="ghost"
          onPress={() => openSettingsAt('ai')}
        >
          <span className="truncate">API key is not set</span>
          <ArrowRight className="size-3 shrink-0" />
        </Button>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ThemeSwitcher />
        <SettingsButton onPress={openSettings} />
      </div>
    </div>
  )
}

function SettingsButton({ onPress }: { onPress: () => void }) {
  return (
    <Tooltip delay={400}>
      <Button
        isIconOnly
        aria-label="Settings"
        className="size-8 min-w-8"
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

import { ArrowRight } from 'lucide-react'
import { useEffect } from 'react'

import Button from '@/components/Button'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { hasApiKey } from '@/tauri/commands/voice'
import { isTauri } from '@/utils/tauri'

/**
 * Bottom status for the open sidebar. Theme and Settings live in the top row, so this only
 * surfaces a missing API key.
 */
function SidebarFooter() {
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

  if (apiKeyPresent) {
    return null
  }

  return (
    <div className="flex items-center border-t border-border/50 px-3 py-2">
      <Button
        aria-label="API key is not set. Open API key settings."
        className="h-7 min-w-0 justify-start gap-1 px-1.5 text-[11px] font-normal text-danger hover:text-danger"
        variant="ghost"
        onPress={() => openSettingsAt('api')}
      >
        <span className="truncate">API key is not set</span>
        <ArrowRight className="size-3 shrink-0" />
      </Button>
    </div>
  )
}

SidebarFooter.displayName = 'SidebarFooter'

export default SidebarFooter

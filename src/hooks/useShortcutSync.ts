import { useEffect } from 'react'

import { useSettingsStore } from '@/stores/settingsStore'
import { setOpenShortcut } from '@/tauri/commands/shortcut'
import { isTauri } from '@/utils/tauri'

/**
 * Applies the saved summon shortcut when the main window starts. The backend registers a safe
 * default first, so this only has to replace it when the user picked something else.
 */
export function useShortcutSync() {
  const openShortcut = useSettingsStore((state) => state.openShortcut)

  useEffect(() => {
    if (!isTauri()) {
      return
    }

    void setOpenShortcut(openShortcut).catch(() => {
      // Keep the startup default. Settings reports conflicts when the user changes the shortcut.
    })
  }, [openShortcut])
}

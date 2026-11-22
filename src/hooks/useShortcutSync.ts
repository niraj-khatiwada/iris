import { useEffect } from 'react'

import { useSettingsStore } from '@/stores/settingsStore'
import {
  setOpenShortcut,
  setScreenAskShortcut,
  setSelectionShortcut,
} from '@/tauri/commands/shortcut'
import { isTauri } from '@/utils/tauri'

/**
 * Applies the saved summon shortcut when the main window starts. The backend registers a safe
 * default first, so this only has to replace it when the user picked something else.
 */
export function useShortcutSync() {
  const openShortcut = useSettingsStore((state) => state.openShortcut)
  const selectionShortcut = useSettingsStore((state) => state.selectionShortcut)
  const screenAskShortcut = useSettingsStore((state) => state.screenAskShortcut)

  useEffect(() => {
    if (!isTauri()) {
      return
    }

    void setOpenShortcut(openShortcut).catch(() => {
      // Keep the startup default. Settings reports conflicts when the user changes the shortcut.
    })
    void setSelectionShortcut(selectionShortcut).catch(() => {
      // The selection shortcut is optional; Settings reports conflicts when it is changed.
    })
    void setScreenAskShortcut(screenAskShortcut).catch(() => {
      // The screen-ask shortcut is optional; Settings reports conflicts when it is changed.
    })
  }, [openShortcut, screenAskShortcut, selectionShortcut])
}

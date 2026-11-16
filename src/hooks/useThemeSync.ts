import { useEffect } from 'react'

import { useSettingsStore } from '@/stores/settingsStore'
import { setMainWindowTheme } from '@/tauri/commands/theme'
import { isTauri } from '@/utils/tauri'
import { applyTheme, resolveTheme } from '@/utils/theme'

/**
 * Applies the selected theme to the history window and keeps its native chrome in sync.
 *
 * The native theme is scoped to this window: Tauri's app-wide theme would also force the quick
 * overlay away from the macOS appearance it is meant to follow.
 */
export function useThemeSync() {
  const theme = useSettingsStore((state) => state.theme)

  useEffect(() => {
    applyTheme(theme)

    if (isTauri()) {
      void setMainWindowTheme(
        theme === 'system' ? null : resolveTheme(theme),
      ).catch(() => {
        // The native theme is a nicety; CSS already carries the app.
      })
    }

    if (theme !== 'system') {
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])
}

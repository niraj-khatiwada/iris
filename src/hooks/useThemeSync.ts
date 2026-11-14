import { useEffect } from 'react'

import { useSettingsStore } from '@/stores/settingsStore'
import { isTauri } from '@/utils/tauri'
import { applyTheme, resolveTheme } from '@/utils/theme'

/** Applies the selected theme and keeps the native window chrome in sync. */
export function useThemeSync() {
  const theme = useSettingsStore((state) => state.theme)

  useEffect(() => {
    applyTheme(theme)

    if (isTauri()) {
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().setTheme(
            theme === 'system' ? null : resolveTheme(theme),
          ),
        )
        .catch(() => {
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

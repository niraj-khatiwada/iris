import { useEffect, useState } from 'react'

import { useSettingsStore } from '@/stores/settingsStore'
import { resolveTheme } from '@/utils/theme'

/** The theme actually shown, including the system preference while in `system` mode. */
export function useResolvedTheme() {
  const theme = useSettingsStore((state) => state.theme)
  const [resolved, setResolved] = useState(() => resolveTheme(theme))

  useEffect(() => {
    setResolved(resolveTheme(theme))

    if (theme !== 'system') {
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolved(resolveTheme('system'))
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [theme])

  return resolved
}

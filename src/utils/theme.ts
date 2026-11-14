import { SETTINGS_STORAGE_KEY } from '@/constants'
import type { ThemeMode } from '@/types/settings'

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') {
    return mode
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/** Applies the theme to the document before React renders to avoid a first-frame flash. */
export function applyTheme(mode: ThemeMode) {
  const theme = resolveTheme(mode)
  const root = document.documentElement

  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

/** Reads the persisted theme without hydrating the whole settings store. */
export function getStoredTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) {
      return 'dark'
    }

    const theme = JSON.parse(raw)?.state?.theme
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      return theme
    }
  } catch {
    // A corrupt or old entry falls back to the default theme.
  }

  return 'dark'
}

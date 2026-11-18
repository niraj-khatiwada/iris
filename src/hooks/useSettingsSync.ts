import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'

import { SETTINGS_STORAGE_KEY } from '@/constants'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { isTauri } from '@/utils/tauri'
import { applyAccent } from '@/utils/theme'

/**
 * Keeps every Iris window on the same persisted settings. The quick overlay and the history
 * window are separate webviews, so a key saved in Settings was otherwise invisible to the
 * overlay until it reloaded.
 */
export function useSettingsSync() {
  const avatarColor = useSettingsStore((state) => state.avatar.color)

  useEffect(() => {
    applyAccent(avatarColor)
  }, [avatarColor])

  useEffect(() => {
    let timer: number | null = null

    const apply = () => {
      timer = null
      void useSettingsStore.persist.rehydrate()
    }

    const schedule = () => {
      if (timer !== null) {
        window.clearTimeout(timer)
      }
      timer = window.setTimeout(apply, 120)
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === SETTINGS_STORAGE_KEY) {
        schedule()
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        schedule()
      }
    }

    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', onVisibilityChange)

    // The quick overlay asks this window to open Settings with Cmd+,.
    let unlisten: (() => void) | undefined
    let disposed = false
    if (isTauri()) {
      void listen('settings:open', () => {
        useUIStore.getState().openSettings()
      }).then((off) => {
        if (disposed) {
          off()
        } else {
          unlisten = off
        }
      })
    }

    return () => {
      disposed = true
      if (timer !== null) {
        window.clearTimeout(timer)
      }
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unlisten?.()
    }
  }, [])
}

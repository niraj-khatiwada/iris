import { useEffect } from 'react'

import { useSettingsStore } from '@/stores/settingsStore'
import { useSpeechStore } from '@/stores/speechStore'
import { stopSpeaking } from '@/tauri/commands/voice'
import { isPlainCommandKey, matchesShortcut } from '@/utils/shortcut'
import { isTauri } from '@/utils/tauri'

/**
 * Stops read-aloud with its configured shortcut. The binding only claims the key while speech is
 * preparing or playing, so Cmd+X still cuts text when nothing is being read.
 */
export function useStopSpeakingShortcut() {
  const shortcut = useSettingsStore(
    (state) => state.overlayShortcuts.stopSpeaking,
  )
  const active = useSpeechStore((state) => state.preparing || state.speaking)

  useEffect(() => {
    if (!active) {
      return
    }

    const stop = () => {
      if (isTauri()) {
        void stopSpeaking()
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, shortcut)) {
        return
      }
      event.preventDefault()
      stop()
    }

    // While a text field is focused, macOS routes Cmd+X through the Edit menu before the webview
    // sees the keydown. The resulting cut event still reaches the document, so catch it when the
    // stop binding is plain Command+X.
    const onCut = (event: ClipboardEvent) => {
      if (!isPlainCommandKey(shortcut, 'KeyX')) {
        return
      }
      event.preventDefault()
      stop()
    }

    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('cut', onCut)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('cut', onCut)
    }
  }, [active, shortcut])
}

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef } from 'react'

import { isTauri } from '@/utils/tauri'

/**
 * Owns the quick-chat window's native behaviour: size it to the panel, reveal it only after the
 * webview has painted, focus the input, and hide it on Escape or an explicit action.
 */
export function useOverlayWindow() {
  const panelRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const hide = useCallback(() => {
    if (isTauri()) {
      void invoke('hide_overlay')
    }
  }, [])

  const focusInput = useCallback(() => {
    const input = inputRef.current
    if (!input) {
      return
    }

    const wasFocused = document.activeElement === input
    input.focus({ preventScroll: true })
    if (!wasFocused) {
      const end = input.value.length
      input.setSelectionRange(end, end)
    }
  }, [])

  // Focus immediately, then once more after the panel has actually become key. Re-keying a
  // non-activating panel can land the caret after the first frame.
  const focusSoon = useCallback(() => {
    requestAnimationFrame(focusInput)
    window.setTimeout(focusInput, 120)
  }, [focusInput])

  // Keep the native window exactly the size of the panel. This runs while the window is still
  // hidden, so the first frame is revealed at its final size.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) {
      return
    }

    const apply = () => {
      const height = Math.ceil(panel.getBoundingClientRect().height) + 32
      if (isTauri()) {
        void invoke('resize_overlay', { height })
      }
    }

    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(panel)

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const initialFocus = window.setTimeout(focusSoon, 80)

    if (!isTauri()) {
      return () => window.clearTimeout(initialFocus)
    }

    const appWindow = getCurrentWindow()
    let unlisten: UnlistenFn | undefined
    let disposed = false

    // The window is hidden, so rAF may be throttled. Reveal after fonts settle, with a timeout
    // fallback, so the native surface is never shown before the webview has content.
    let revealed = false
    const reveal = () => {
      if (disposed || revealed) {
        return
      }
      revealed = true
      void invoke('overlay_ready')
        .then(focusSoon)
        .catch(() => undefined)
    }

    const fallback = globalThis.setTimeout(reveal, 280)
    void (document.fonts?.ready ?? Promise.resolve())
      .then(() => {
        if (disposed) {
          return
        }
        globalThis.clearTimeout(fallback)
        globalThis.setTimeout(reveal, 32)
      })
      .catch(() => undefined)

    // Iris does not dismiss itself when another app takes focus. It stays above the desktop
    // until Escape, the close button, the shortcut, or an explicit action hides it.
    void appWindow
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          focusSoon()
        }
      })
      .then((off) => {
        unlisten = off
      })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        hide()
      }
    }

    const onWindowFocus = () => focusSoon()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('focus', onWindowFocus)

    return () => {
      disposed = true
      window.clearTimeout(initialFocus)
      globalThis.clearTimeout(fallback)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('focus', onWindowFocus)
      unlisten?.()
    }
  }, [focusSoon, hide])

  // Rust emits this whenever the overlay is shown or brought forward. Focusing here also covers
  // the case where the panel becomes key without a Tauri focus-change event.
  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let disposed = false
    let unlisten: UnlistenFn | undefined

    void listen('overlay:focused', () => {
      focusSoon()
    }).then((off) => {
      if (disposed) {
        off()
      } else {
        unlisten = off
      }
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [focusSoon])

  return { panelRef, inputRef, hide }
}

import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'

import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'

import './global.css'
import { applyAccent, getStoredAvatarColor } from '@/utils/theme'

// The full-screen canvas is transparent and click-through. It hosts transient snap guides for
// the draggable overlay and, later, screen annotations and agent output.
document.documentElement.dataset.window = 'canvas'
applyAccent(getStoredAvatarColor())

type Guides = {
  left: number
  right: number
  snapped: boolean
  visible: boolean
}

const GUIDE_LIFETIME_MS = 500

function Canvas() {
  const [guides, setGuides] = useState<Guides | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let disposed = false
    let unlisten: UnlistenFn | undefined

    void listen<Guides>('overlay:guides', (event) => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }

      if (!event.payload.visible) {
        setGuides(null)
        return
      }

      setGuides(event.payload)
      timer.current = window.setTimeout(() => {
        setGuides(null)
        timer.current = null
      }, GUIDE_LIFETIME_MS)
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
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
      }
    }
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {guides ? (
        <>
          {[guides.left, guides.right].map((left) => (
            <span
              key={left}
              className={cn(
                'absolute top-0 bottom-0 border-l border-dashed transition-[border-color,box-shadow] duration-150',
                guides.snapped ? 'border-primary' : 'border-white/35',
              )}
              style={{
                left,
                boxShadow: guides.snapped
                  ? '0 0 12px color-mix(in oklch, var(--primary) 50%, transparent)'
                  : 'none',
              }}
            />
          ))}
        </>
      ) : null}
    </div>
  )
}

Canvas.displayName = 'Canvas'

const rootElement = document.getElementById('app')

if (rootElement && !rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(<Canvas />)
}

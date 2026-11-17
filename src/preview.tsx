import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'

import { closeImagePreview } from '@/tauri/commands/preview'
import { isTauri } from '@/utils/tauri'

import './global.css'

// A full-screen, in-app lightbox above the quick overlay. It is a non-activating panel, so
// opening it never activates another app or switches Spaces.
document.documentElement.dataset.window = 'preview'

type PreviewPayload = {
  dataUrl: string
}

function Preview() {
  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let disposed = false
    let unlisten: UnlistenFn | undefined

    void listen<PreviewPayload>('preview:show', (event) => {
      setImage(event.payload.dataUrl)
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
  }, [])

  const close = useCallback(() => {
    if (isTauri()) {
      void closeImagePreview()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  return (
    <div
      className="relative flex h-full w-full items-center justify-center bg-black/55 p-8"
      onPointerDown={close}
    >
      {image ? (
        <>
          <img
            alt="Attachment preview"
            className="max-h-full max-w-full select-none rounded-2xl border border-white/10 object-contain shadow-2xl"
            src={image}
            onPointerDown={(event) => event.stopPropagation()}
          />

          <div className="pointer-events-none absolute inset-x-0 top-5 flex justify-center">
            <p className="rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[11px] text-white/80 backdrop-blur-md">
              Esc to close
            </p>
          </div>

          <button
            type="button"
            aria-label="Close preview"
            className="absolute top-5 right-5 flex size-9 items-center justify-center rounded-full border border-white/10 bg-black/55 text-white/75 shadow-lg backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white"
            onClick={close}
          >
            <X className="size-4" />
          </button>
        </>
      ) : null}
    </div>
  )
}

Preview.displayName = 'Preview'

const rootElement = document.getElementById('app')

if (rootElement && !rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(<Preview />)
}

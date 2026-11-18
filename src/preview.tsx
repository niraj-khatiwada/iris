import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { save } from '@tauri-apps/plugin-dialog'
import { Check, Copy, Download, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'

import {
  closeImagePreview,
  copyPreviewImage,
  savePreviewImage,
} from '@/tauri/commands/preview'
import { isTauri } from '@/utils/tauri'

import './global.css'
import { applyAccent, getStoredAvatarColor } from '@/utils/theme'

// A full-screen, in-app lightbox above the quick overlay. It is a non-activating panel, so
// opening it never activates another app or switches Spaces.
document.documentElement.dataset.window = 'preview'
applyAccent(getStoredAvatarColor())

type PreviewPayload = {
  url: string
  name: string
  conversationId?: string | null
  fileName?: string | null
}

type PreviewImage = {
  url: string
  name: string
  conversationId: string | null
  fileName: string | null
}

const BUTTON_CLASS =
  'flex size-9 items-center justify-center rounded-full border border-white/10 bg-black/55 text-white/75 shadow-lg backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white'

/** Picks the extension the saved file should carry, matching the bytes actually written. */
function saveName(image: PreviewImage) {
  // The original file is only used when its conversation folder is known; otherwise the saved
  // bytes come from the inline data URL, whose own MIME type decides the extension.
  if (image.conversationId && image.fileName) {
    const extension = image.fileName.split('.').pop()
    if (extension && !image.name.includes('.')) {
      return `${image.name}.${extension}`
    }
  }

  const match = /^data:image\/([a-z0-9.+-]+);/i.exec(image.url)
  if (match) {
    const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
    const base = image.name.replace(/\.[^./\\]+$/, '') || 'image'
    return `${base}.${extension}`
  }

  return image.name
}

function Preview() {
  const [image, setImage] = useState<PreviewImage | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let disposed = false
    let unlisten: UnlistenFn | undefined

    void listen<PreviewPayload>('preview:show', (event) => {
      setCopied(false)
      setImage({
        url: event.payload.url,
        name: event.payload.name,
        conversationId: event.payload.conversationId ?? null,
        fileName: event.payload.fileName ?? null,
      })
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

  useEffect(() => {
    if (!copied) {
      return
    }

    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])

  const close = useCallback(() => {
    if (isTauri()) {
      void closeImagePreview()
    }
  }, [])

  const copy = useCallback(() => {
    if (!isTauri() || !image) {
      return
    }
    void copyPreviewImage()
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }, [image])

  const download = useCallback(async () => {
    if (!isTauri() || !image) {
      return
    }

    try {
      const destination = await save({ defaultPath: saveName(image) })
      if (!destination) {
        return
      }
      await savePreviewImage(destination)
    } catch {
      // The save dialog was dismissed or the write failed.
    }
  }, [image])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (!event.metaKey || event.altKey || event.ctrlKey) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'c') {
        event.preventDefault()
        copy()
      } else if (key === 'd') {
        event.preventDefault()
        void download()
      }
    }

    // WKWebView also routes the Edit menu's Copy here, which never produces a keydown.
    const onCopy = (event: ClipboardEvent) => {
      if (!image) {
        return
      }
      event.preventDefault()
      copy()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('copy', onCopy)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('copy', onCopy)
    }
  }, [close, copy, download, image])

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
            src={image.url}
            onPointerDown={(event) => event.stopPropagation()}
          />

          <div className="pointer-events-none absolute inset-x-0 top-5 flex justify-center">
            <p className="rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[11px] text-white/80 backdrop-blur-md">
              Esc to close · ⌘C copy · ⌘D save
            </p>
          </div>

          <div
            className="absolute top-5 right-5 flex items-center gap-2"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Copy image"
              className={BUTTON_CLASS}
              title="Copy image (⌘C)"
              onClick={copy}
            >
              {copied ? (
                <Check className="size-4 text-primary" />
              ) : (
                <Copy className="size-4" />
              )}
            </button>

            <button
              type="button"
              aria-label="Save image"
              className={BUTTON_CLASS}
              title="Save image (⌘D)"
              onClick={() => void download()}
            >
              <Download className="size-4" />
            </button>

            <button
              type="button"
              aria-label="Close preview"
              className={BUTTON_CLASS}
              title="Close preview (Esc)"
              onClick={close}
            >
              <X className="size-4" />
            </button>
          </div>
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

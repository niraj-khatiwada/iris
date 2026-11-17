import { convertFileSrc } from '@tauri-apps/api/core'
import { useEffect, useState } from 'react'

import { attachmentPath } from '@/tauri/commands/attachments'
import { isTauri } from '@/utils/tauri'

const pathCache = new Map<string, Promise<string>>()

/** Resolves a stored attachment to an asset URL the webview can display. */
export function useAttachmentUrl(
  conversationId: string | undefined,
  fileName: string | undefined,
) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!isTauri() || !conversationId || !fileName) {
      setUrl(null)
      return
    }

    const key = `${conversationId}:${fileName}`
    let promise = pathCache.get(key)
    if (!promise) {
      promise = attachmentPath(conversationId, fileName).then((path) =>
        convertFileSrc(path),
      )
      pathCache.set(key, promise)
      promise.catch(() => pathCache.delete(key))
    }

    let cancelled = false
    void promise
      .then((value) => {
        if (!cancelled) {
          setUrl(value)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUrl(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [conversationId, fileName])

  return url
}

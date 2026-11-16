import type { ClipboardEvent, DragEvent } from 'react'
import { useCallback, useRef, useState } from 'react'

import type { ChatAttachment } from '@/types/chat'
import { fileToAttachment } from '@/utils/image'

const MAX_ATTACHMENTS = 4

/**
 * Collects pasted and dropped images. There is deliberately no attach button: the composer
 * accepts images through the clipboard and drag-and-drop only.
 */
export function useImageAttachments() {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const addFiles = useCallback(async (files: Iterable<File>) => {
    const images = Array.from(files).filter((file) =>
      file.type.startsWith('image/'),
    )
    if (images.length === 0) {
      return
    }

    const converted = await Promise.all(images.map(fileToAttachment))
    const valid = converted.filter(
      (attachment): attachment is ChatAttachment => attachment !== null,
    )
    if (valid.length === 0) {
      return
    }

    setAttachments((current) =>
      [...current, ...valid].slice(0, MAX_ATTACHMENTS),
    )
  }, [])

  const addAttachment = useCallback((attachment: ChatAttachment) => {
    setAttachments((current) =>
      [...current, attachment].slice(-MAX_ATTACHMENTS),
    )
  }, [])

  const remove = useCallback((id: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id),
    )
  }, [])

  const clear = useCallback(() => {
    setAttachments([])
  }, [])

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)

    if (files.length > 0) {
      event.preventDefault()
      void addFiles(files)
    }
  }

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) {
      return
    }

    event.preventDefault()
    depth.current += 1
    setDragging(true)
  }

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) {
      setDragging(false)
    }
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) {
      return
    }

    event.preventDefault()
    depth.current = 0
    setDragging(false)
    void addFiles(event.dataTransfer.files)
  }

  return {
    attachments,
    dragging,
    addFiles,
    addAttachment,
    remove,
    clear,
    dragHandlers: {
      onPaste,
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  }
}

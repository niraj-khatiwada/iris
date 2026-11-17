import type { ClipboardEvent, DragEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  deleteAttachmentFiles,
  storeAttachment,
} from '@/tauri/commands/attachments'
import { uploadDocument } from '@/tauri/commands/files'
import type {
  ChatAttachment,
  DocumentPurpose,
  DraftAttachment,
} from '@/types/chat'
import {
  documentMimeType,
  documentPurposeFor,
  documentSizeLimit,
  formatFileSize,
  isDocumentAttachment,
  MAX_DOCUMENTS,
  MAX_IMAGES,
} from '@/utils/files'
import { newId } from '@/utils/id'
import {
  fileToAttachment,
  isImageFile,
  MAX_IMAGE_FILE_BYTES,
} from '@/utils/image'
import { isTauri } from '@/utils/tauri'

const MAX_CONCURRENT_UPLOADS = 3

type UploadJob = () => Promise<void>
const uploadQueue: UploadJob[] = []
let activeUploads = 0

/** Three uploads at a time keeps within the account's in-progress document allowance. */
function pumpUploads() {
  while (activeUploads < MAX_CONCURRENT_UPLOADS) {
    const job = uploadQueue.shift()
    if (!job) {
      return
    }
    activeUploads += 1
    void job().finally(() => {
      activeUploads -= 1
      pumpUploads()
    })
  }
}

function enqueueUpload(job: UploadJob) {
  uploadQueue.push(job)
  pumpUploads()
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      if (comma < 0) {
        reject(new Error('The file could not be read.'))
        return
      }
      resolve(result.slice(comma + 1))
    }
    reader.onerror = () =>
      reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsDataURL(file)
  })
}

function dataUrlBase64(dataUrl: string | undefined): string {
  if (!dataUrl) {
    return ''
  }
  const comma = dataUrl.indexOf(',')
  return comma < 0 ? '' : dataUrl.slice(comma + 1)
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message
  }
  return typeof reason === 'string' ? reason : 'The file could not be uploaded.'
}

type AttachmentContext = {
  conversationId: string
  fileName?: string
  previewName?: string
}

function contextFileNames(context: AttachmentContext): string[] {
  return [context.fileName, context.previewName].filter(
    (name): name is string => Boolean(name),
  )
}

/**
 * Collects pasted and dropped attachments. Originals are stored under
 * `<app data>/attachments/<conversation id>/`; images also get a resized JPEG preview used for
 * display and the model request. Documents are uploaded through Rust and keep their file id.
 */
export function useAttachments({
  conversationId,
  createConversation,
}: {
  conversationId: string | null
  createConversation?: () => string
}) {
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const attachmentsRef = useRef<DraftAttachment[]>([])
  const contextsRef = useRef(new Map<string, AttachmentContext>())
  const pendingConversation = useRef<string | null>(conversationId)

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    pendingConversation.current = conversationId
  }, [conversationId])

  // If the composer unmounts (e.g. the conversation became archived), discard unsent draft files.
  useEffect(
    () => () => {
      for (const context of contextsRef.current.values()) {
        void deleteAttachmentFiles(
          context.conversationId,
          contextFileNames(context),
        ).catch(() => {})
      }
      contextsRef.current.clear()
    },
    [],
  )

  const resolveConversationId = useCallback(() => {
    if (conversationId) {
      return conversationId
    }
    if (pendingConversation.current) {
      return pendingConversation.current
    }
    const created = createConversation?.()
    if (created) {
      pendingConversation.current = created
    }
    return created ?? null
  }, [conversationId, createConversation])

  const deleteContext = useCallback((id: string) => {
    const context = contextsRef.current.get(id)
    contextsRef.current.delete(id)
    if (context) {
      void deleteAttachmentFiles(
        context.conversationId,
        contextFileNames(context),
      ).catch(() => {})
    }
    attachmentsRef.current = attachmentsRef.current.filter(
      (attachment) => attachment.id !== id,
    )
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id),
    )
  }, [])

  const uploadStoredDocument = useCallback(
    (
      id: string,
      targetConversationId: string,
      fileName: string,
      displayName: string,
      mimeType: string,
      purpose: DocumentPurpose,
    ) => {
      enqueueUpload(async () => {
        try {
          const settings = useSettingsStore.getState()
          const uploaded = await uploadDocument({
            baseUrl: settings.baseUrl,
            conversationId: targetConversationId,
            fileName,
            displayName,
            mimeType,
            purpose,
          })
          if (!contextsRef.current.has(id)) {
            void deleteAttachmentFiles(targetConversationId, [fileName]).catch(
              () => {},
            )
            return
          }
          setAttachments((current) =>
            current.map((attachment) =>
              attachment.id === id
                ? {
                    ...attachment,
                    fileId: uploaded.id,
                    uploadStatus: 'ready',
                    error: undefined,
                  }
                : attachment,
            ),
          )
        } catch (reason) {
          if (contextsRef.current.has(id)) {
            setAttachments((current) =>
              current.map((attachment) =>
                attachment.id === id
                  ? {
                      ...attachment,
                      uploadStatus: 'error',
                      error: errorMessage(reason),
                    }
                  : attachment,
              ),
            )
          }
        }
      })
    },
    [],
  )

  const storeDocument = useCallback(
    async (
      id: string,
      targetConversationId: string,
      file: File,
      purpose: DocumentPurpose,
    ) => {
      try {
        const originalData = await readBase64(file)
        const stored = await storeAttachment({
          conversationId: targetConversationId,
          attachmentId: id,
          name: file.name || 'Document',
          kind: 'document',
          originalData,
        })
        const context = contextsRef.current.get(id)
        if (!context) {
          void deleteAttachmentFiles(targetConversationId, [
            stored.fileName,
          ]).catch(() => {})
          return
        }
        context.fileName = stored.fileName
        setAttachments((current) =>
          current.map((attachment) =>
            attachment.id === id
              ? { ...attachment, fileName: stored.fileName }
              : attachment,
          ),
        )
        uploadStoredDocument(
          id,
          targetConversationId,
          stored.fileName,
          file.name || 'Document',
          documentMimeType(file),
          purpose,
        )
      } catch (reason) {
        const context = contextsRef.current.get(id)
        if (!context) {
          return
        }
        if (context.fileName) {
          setAttachments((current) =>
            current.map((attachment) =>
              attachment.id === id
                ? {
                    ...attachment,
                    uploadStatus: 'error',
                    error: errorMessage(reason),
                  }
                : attachment,
            ),
          )
        } else {
          deleteContext(id)
          setError(errorMessage(reason))
        }
      }
    },
    [deleteContext, uploadStoredDocument],
  )

  const storeImage = useCallback(
    async (
      id: string,
      targetConversationId: string,
      file: File,
      preview: ChatAttachment,
    ) => {
      try {
        const originalData = await readBase64(file)
        const previewData = dataUrlBase64(preview.dataUrl)
        const stored = await storeAttachment({
          conversationId: targetConversationId,
          attachmentId: id,
          name: file.name || 'Image',
          kind: 'image',
          originalData,
          previewData,
        })
        const context = contextsRef.current.get(id)
        if (!context) {
          void deleteAttachmentFiles(
            targetConversationId,
            [stored.fileName, stored.previewName].filter(
              (name): name is string => Boolean(name),
            ),
          ).catch(() => {})
          return
        }
        context.fileName = stored.fileName
        context.previewName = stored.previewName ?? undefined
        setAttachments((current) =>
          current.map((attachment) =>
            attachment.id === id
              ? {
                  ...attachment,
                  fileName: stored.fileName,
                  previewName: stored.previewName ?? undefined,
                  uploadStatus: 'ready',
                }
              : attachment,
          ),
        )
      } catch (reason) {
        if (contextsRef.current.has(id)) {
          deleteContext(id)
          setError(errorMessage(reason))
        }
      }
    },
    [deleteContext],
  )

  const addFiles = useCallback(
    async (input: Iterable<File>) => {
      if (!isTauri()) {
        setError('Attachments are stored by the desktop app.')
        return
      }
      if (!useChatStore.getState().hydrated) {
        setError('Iris is still loading. Try attaching again in a moment.')
        return
      }

      const files = Array.from(input)
      if (files.length === 0) {
        return
      }

      setError(null)
      let imageCount = attachmentsRef.current.filter(
        (attachment) => !isDocumentAttachment(attachment),
      ).length
      let documentCount =
        attachmentsRef.current.filter(isDocumentAttachment).length
      const errors: string[] = []

      for (const file of files) {
        if (isImageFile(file)) {
          if (imageCount >= MAX_IMAGES) {
            errors.push(`You can attach at most ${MAX_IMAGES} images.`)
            continue
          }
          if (file.size > MAX_IMAGE_FILE_BYTES) {
            errors.push(
              `${file.name} is larger than the ${formatFileSize(MAX_IMAGE_FILE_BYTES)} image limit.`,
            )
            continue
          }
          const preview = await fileToAttachment(file)
          if (!preview) {
            errors.push(`${file.name} could not be read as an image.`)
            continue
          }
          const targetConversationId = resolveConversationId()
          if (!targetConversationId) {
            errors.push('Could not create a conversation for this attachment.')
            continue
          }
          imageCount += 1
          const id = preview.id
          const draft: DraftAttachment = {
            ...preview,
            kind: 'image',
            size: file.size,
            uploadStatus: 'uploading',
          }
          contextsRef.current.set(id, { conversationId: targetConversationId })
          attachmentsRef.current = [...attachmentsRef.current, draft]
          setAttachments((current) => [...current, draft])
          void storeImage(id, targetConversationId, file, preview)
          continue
        }

        const purpose = documentPurposeFor(file)
        if (!purpose) {
          errors.push(`${file.name} is not a supported file type.`)
          continue
        }
        const limit = documentSizeLimit(purpose)
        if (file.size > limit) {
          errors.push(
            `${file.name} is larger than the ${formatFileSize(limit)} limit for this document type.`,
          )
          continue
        }
        if (documentCount >= MAX_DOCUMENTS) {
          errors.push(`You can attach at most ${MAX_DOCUMENTS} documents.`)
          continue
        }
        const targetConversationId = resolveConversationId()
        if (!targetConversationId) {
          errors.push('Could not create a conversation for this attachment.')
          continue
        }

        documentCount += 1
        const id = newId()
        const draft: DraftAttachment = {
          id,
          name: file.name || 'Document',
          mediaType: documentMimeType(file),
          kind: 'document',
          purpose,
          size: file.size,
          uploadStatus: 'uploading',
        }
        contextsRef.current.set(id, { conversationId: targetConversationId })
        attachmentsRef.current = [...attachmentsRef.current, draft]
        setAttachments((current) => [...current, draft])
        void storeDocument(id, targetConversationId, file, purpose)
      }

      if (errors.length > 0) {
        setError(errors[0])
      }
    },
    [resolveConversationId, storeDocument, storeImage],
  )

  const addAttachment = useCallback(
    (attachment: ChatAttachment) => {
      if (!isTauri()) {
        setError('Attachments are stored by the desktop app.')
        return
      }
      if (!useChatStore.getState().hydrated) {
        setError('Iris is still loading. Try attaching again in a moment.')
        return
      }
      if (
        attachmentsRef.current.filter(
          (current) => !isDocumentAttachment(current),
        ).length >= MAX_IMAGES
      ) {
        setError(`You can attach at most ${MAX_IMAGES} images.`)
        return
      }
      const targetConversationId = resolveConversationId()
      if (!targetConversationId) {
        setError('Could not create a conversation for this attachment.')
        return
      }
      if (!attachment.dataUrl) {
        setError('The captured image is missing.')
        return
      }

      setError(null)
      const draft: DraftAttachment = {
        ...attachment,
        kind: 'image',
        uploadStatus: 'uploading',
      }
      contextsRef.current.set(attachment.id, {
        conversationId: targetConversationId,
      })
      attachmentsRef.current = [...attachmentsRef.current, draft]
      setAttachments((current) => [...current, draft])
      void (async () => {
        try {
          const data = dataUrlBase64(attachment.dataUrl)
          const stored = await storeAttachment({
            conversationId: targetConversationId,
            attachmentId: attachment.id,
            name: attachment.name.includes('.')
              ? attachment.name
              : `${attachment.name}.jpg`,
            kind: 'image',
            originalData: data,
            previewData: data,
          })
          const context = contextsRef.current.get(attachment.id)
          if (!context) {
            void deleteAttachmentFiles(
              targetConversationId,
              [stored.fileName, stored.previewName].filter(
                (name): name is string => Boolean(name),
              ),
            ).catch(() => {})
            return
          }
          context.fileName = stored.fileName
          context.previewName = stored.previewName ?? undefined
          setAttachments((current) =>
            current.map((item) =>
              item.id === attachment.id
                ? {
                    ...item,
                    fileName: stored.fileName,
                    previewName: stored.previewName ?? undefined,
                    uploadStatus: 'ready',
                  }
                : item,
            ),
          )
        } catch (reason) {
          if (contextsRef.current.has(attachment.id)) {
            deleteContext(attachment.id)
            setError(errorMessage(reason))
          }
        }
      })()
    },
    [deleteContext, resolveConversationId],
  )

  const remove = useCallback(
    (id: string) => {
      deleteContext(id)
    },
    [deleteContext],
  )

  const retry = useCallback(
    (id: string) => {
      const context = contextsRef.current.get(id)
      const attachment = attachmentsRef.current.find((item) => item.id === id)
      if (
        !context?.fileName ||
        !attachment ||
        attachment.kind !== 'document' ||
        !attachment.purpose
      ) {
        return
      }
      setAttachments((current) =>
        current.map((item) =>
          item.id === id
            ? { ...item, uploadStatus: 'uploading', error: undefined }
            : item,
        ),
      )
      void uploadStoredDocument(
        id,
        context.conversationId,
        context.fileName,
        attachment.name,
        attachment.mediaType,
        attachment.purpose,
      )
    },
    [uploadStoredDocument],
  )

  const clear = useCallback(() => {
    for (const context of contextsRef.current.values()) {
      void deleteAttachmentFiles(
        context.conversationId,
        contextFileNames(context),
      ).catch(() => {})
    }
    contextsRef.current.clear()
    pendingConversation.current = null
    attachmentsRef.current = []
    setAttachments([])
    setError(null)
  }, [])

  /** Clears the draft after sending without removing the files the message now references. */
  const commit = useCallback(() => {
    contextsRef.current.clear()
    pendingConversation.current = null
    attachmentsRef.current = []
    setAttachments([])
    setError(null)
  }, [])

  const clearError = useCallback(() => setError(null), [])

  const onPaste = (event: ClipboardEvent<HTMLElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file')
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

  const readyAttachments = attachments
    .filter((attachment) => attachment.uploadStatus === 'ready')
    .map(
      ({
        uploadStatus: _uploadStatus,
        error: _error,
        dataUrl: _dataUrl,
        ...attachment
      }) => attachment,
    )

  return {
    attachments,
    readyAttachments,
    pending: attachments.some(
      (attachment) => attachment.uploadStatus === 'uploading',
    ),
    hasError: attachments.some(
      (attachment) => attachment.uploadStatus === 'error',
    ),
    error,
    clearError,
    dragging,
    addFiles,
    addAttachment,
    remove,
    retry,
    clear,
    commit,
    dragHandlers: {
      onPaste,
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  }
}

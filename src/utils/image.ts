import type { ChatAttachment } from '@/types/chat'
import { newId } from '@/utils/id'

/** Keep pasted screenshots comfortable for localStorage and the API request. */
const MAX_DIMENSION = 1280
const JPEG_QUALITY = 0.8
export const MAX_IMAGE_FILE_BYTES = 12 * 1024 * 1024
const IMAGE_NAME = /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i

/** Dropped files do not always carry a MIME type, so fall back to the file name. */
export function isImageFile(file: File) {
  return file.type.startsWith('image/') || IMAGE_NAME.test(file.name)
}

export async function fileToAttachment(
  file: File,
): Promise<ChatAttachment | null> {
  if (!isImageFile(file) || file.size > MAX_IMAGE_FILE_BYTES) {
    return null
  }

  try {
    const dataUrl = await resizeImage(file)
    if (!dataUrl) {
      return null
    }

    return {
      id: newId(),
      name: file.name || 'Image',
      mediaType: 'image/jpeg',
      dataUrl,
      kind: 'image',
      size: file.size,
    }
  } catch {
    return null
  }
}

/** Maps an attachment to the block data the backend sends to the Messages API. */
export function attachmentToAgent(attachment: ChatAttachment) {
  if (attachment.fileId) {
    return {
      mediaType: attachment.mediaType,
      data: '',
      fileId: attachment.fileId,
    }
  }
  if (attachment.previewName) {
    return {
      mediaType: attachment.mediaType,
      data: '',
      localFile: attachment.previewName,
    }
  }
  if (!attachment.dataUrl) {
    return null
  }

  const match = /^data:([^;]+);base64,(.+)$/.exec(attachment.dataUrl)
  if (!match) {
    return null
  }

  return { mediaType: match[1], data: match[2] }
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read the image.'))
    }
    image.src = url
  })
}

async function resizeImage(file: File) {
  const image = await loadImage(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  // JPEG has no alpha channel; flatten transparency onto white instead of black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

import type { ChatAttachment } from '@/types/chat'
import { newId } from '@/utils/id'

/** Keep pasted screenshots comfortable for localStorage and the API request. */
const MAX_DIMENSION = 1280
const JPEG_QUALITY = 0.8
const MAX_FILE_BYTES = 12 * 1024 * 1024

export async function fileToAttachment(
  file: File,
): Promise<ChatAttachment | null> {
  if (!file.type.startsWith('image/') || file.size > MAX_FILE_BYTES) {
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
    }
  } catch {
    return null
  }
}

/** Splits a stored data URL into the base64 payload the Messages API expects. */
export function attachmentToAgent(attachment: ChatAttachment) {
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

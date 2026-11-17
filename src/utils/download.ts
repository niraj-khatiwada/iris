import { save } from '@tauri-apps/plugin-dialog'

import { copyAttachment } from '@/tauri/commands/attachments'
import type { ChatAttachment } from '@/types/chat'
import { isTauri } from '@/utils/tauri'

/** Saves a copy of a locally stored attachment to a user-picked location. */
export async function downloadAttachment(
  conversationId: string,
  attachment: ChatAttachment,
) {
  if (!isTauri() || !attachment.fileName) {
    return
  }

  const dot = attachment.fileName.lastIndexOf('.')
  const extension = dot > 0 ? attachment.fileName.slice(dot + 1) : ''
  const defaultPath =
    extension && !attachment.name.includes('.')
      ? `${attachment.name}.${extension}`
      : attachment.name
  const destination = await save({ defaultPath })
  if (!destination) {
    return
  }

  await copyAttachment({
    conversationId,
    fileName: attachment.fileName,
    destination,
  })
}

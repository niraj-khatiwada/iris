import { getCurrentWindow } from '@tauri-apps/api/window'
import { Download } from 'lucide-react'
import { useState } from 'react'

import { useAttachmentUrl } from '@/hooks/useAttachmentUrl'
import { attachmentDataUrl } from '@/tauri/commands/attachments'
import { showImagePreview } from '@/tauri/commands/preview'
import type { ChatAttachment } from '@/types/chat'
import { downloadAttachment } from '@/utils/download'
import { isTauri } from '@/utils/tauri'

/** Stored images display from their resized preview and preview/download from the original. */
function AttachmentImage({
  attachment,
  conversationId,
}: {
  attachment: ChatAttachment
  conversationId: string
}) {
  const displayFile = attachment.previewName ?? attachment.fileName
  const displayUrl = useAttachmentUrl(conversationId, displayFile)
  const originalUrl = useAttachmentUrl(conversationId, attachment.fileName)
  const [failed, setFailed] = useState(false)
  const [fallback, setFallback] = useState<string | null>(null)
  const source = failed
    ? (attachment.dataUrl ?? fallback)
    : (displayUrl ?? attachment.dataUrl)

  if (!source) {
    return (
      <div className="h-16 w-16 animate-pulse rounded-lg bg-foreground/5" />
    )
  }

  return (
    <div className="group relative">
      <img
        alt={attachment.name}
        className="max-h-64 max-w-[min(100%,24rem)] rounded-lg object-cover"
        src={source}
        title={`${attachment.name} — double-click to preview`}
        onDoubleClick={() => {
          const url = failed ? source : (originalUrl ?? source)
          if (isTauri()) {
            void showImagePreview(getCurrentWindow().label, url)
          }
        }}
        onError={() => {
          if (failed) {
            return
          }
          setFailed(true)
          if (displayFile) {
            void attachmentDataUrl(
              conversationId,
              displayFile,
              attachment.mediaType,
            )
              .then(setFallback)
              .catch(() => {})
          }
        }}
      />

      {attachment.fileName && isTauri() ? (
        <button
          type="button"
          aria-label={`Download ${attachment.name}`}
          className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full border border-border/60 bg-background/80 text-muted opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
          onClick={() => {
            void downloadAttachment(conversationId, attachment).catch(() => {})
          }}
        >
          <Download className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

AttachmentImage.displayName = 'AttachmentImage'

export default AttachmentImage

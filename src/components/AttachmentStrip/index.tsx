import { X } from 'lucide-react'

import type { ChatAttachment } from '@/types/chat'
import { cn } from '@/utils/tailwind'

/** Thumbnails for pasted or dropped images, with a quiet remove control. */
function AttachmentStrip({
  attachments,
  onRemove,
  compact = false,
  className,
}: {
  attachments: ChatAttachment[]
  onRemove: (id: string) => void
  compact?: boolean
  className?: string
}) {
  if (attachments.length === 0) {
    return null
  }

  return (
    <div
      aria-label="Attached images"
      className={cn('flex flex-wrap gap-2.5', className)}
    >
      {attachments.map((attachment) => (
        <div key={attachment.id} className="relative">
          <img
            alt={attachment.name}
            className={cn(
              'rounded-xl border border-border/60 object-cover',
              compact ? 'size-12' : 'size-14',
            )}
            src={attachment.dataUrl}
            title={attachment.name}
          />
          <button
            type="button"
            aria-label={`Remove ${attachment.name}`}
            className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted shadow-sm transition-colors hover:text-foreground"
            onClick={() => onRemove(attachment.id)}
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  )
}

AttachmentStrip.displayName = 'AttachmentStrip'

export default AttachmentStrip

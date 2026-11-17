import { getCurrentWindow } from '@tauri-apps/api/window'
import { FileText, LoaderCircle, X } from 'lucide-react'

import { showImagePreview } from '@/tauri/commands/preview'
import type { DraftAttachment } from '@/types/chat'
import { formatFileSize, isDocumentAttachment } from '@/utils/files'
import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'

/** Thumbnails for images and status cards for uploaded documents. */
function AttachmentStrip({
  attachments,
  onRemove,
  onRetry,
  error,
  onDismissError,
  compact = false,
  className,
}: {
  attachments: DraftAttachment[]
  onRemove: (id: string) => void
  onRetry?: (id: string) => void
  error?: string | null
  onDismissError?: () => void
  compact?: boolean
  className?: string
}) {
  if (attachments.length === 0 && !error) {
    return null
  }

  const preview = (attachment: DraftAttachment) => {
    if (!attachment.dataUrl || !isTauri()) {
      return
    }
    void showImagePreview(getCurrentWindow().label, attachment.dataUrl)
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded-lg border border-danger/20 bg-danger/10 px-2.5 py-1.5 text-[11px] leading-4 text-danger"
        >
          <span className="min-w-0 flex-1">{error}</span>
          {onDismissError ? (
            <button
              type="button"
              aria-label="Dismiss attachment error"
              className="shrink-0 text-danger/70 transition-colors hover:text-danger"
              onClick={onDismissError}
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div aria-label="Attachments" className="flex flex-wrap gap-2.5">
          {attachments.map((attachment) => {
            if (isDocumentAttachment(attachment)) {
              const uploading = attachment.uploadStatus === 'uploading'
              const failed = attachment.uploadStatus === 'error'

              return (
                <div
                  key={attachment.id}
                  className={cn(
                    'relative flex items-center gap-2 rounded-xl border border-border/60 bg-surface/35 py-2 pr-8 pl-2.5',
                    compact
                      ? 'h-11 min-w-36 max-w-52'
                      : 'h-14 min-w-40 max-w-60',
                    failed && 'border-danger/40',
                  )}
                >
                  <div
                    className={cn(
                      'flex shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-muted',
                      compact ? 'size-7' : 'size-9',
                    )}
                  >
                    <FileText className={compact ? 'size-3.5' : 'size-4'} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-foreground">
                      {attachment.name}
                    </p>
                    <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted">
                      {uploading ? (
                        <>
                          <LoaderCircle className="size-3 shrink-0 animate-spin" />
                          <span>Uploading…</span>
                        </>
                      ) : failed ? (
                        <>
                          <span
                            className="min-w-0 truncate text-danger"
                            title={attachment.error}
                          >
                            {attachment.error ?? 'Upload failed.'}
                          </span>
                          {onRetry ? (
                            <button
                              type="button"
                              aria-label={`Retry ${attachment.name}`}
                              className="shrink-0 font-medium text-danger underline-offset-2 hover:underline"
                              onClick={() => onRetry(attachment.id)}
                            >
                              Retry
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <span>{formatFileSize(attachment.size ?? 0)}</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
                    onClick={() => onRemove(attachment.id)}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )
            }

            return (
              <div key={attachment.id} className="relative">
                <button
                  type="button"
                  aria-label={`Preview ${attachment.name}`}
                  className="block rounded-xl focus-visible:outline-none"
                  title={`${attachment.name} — double-click to preview`}
                  onDoubleClick={() => preview(attachment)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      preview(attachment)
                    }
                  }}
                >
                  <img
                    alt={attachment.name}
                    className={cn(
                      'rounded-xl border border-border/60 object-cover',
                      compact ? 'size-12' : 'size-14',
                    )}
                    src={attachment.dataUrl}
                  />
                </button>
                {attachment.uploadStatus === 'uploading' ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-background/50">
                    <LoaderCircle className="size-4 animate-spin text-muted" />
                  </div>
                ) : null}
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border/60 bg-background/90 text-muted shadow-sm transition-colors hover:text-foreground"
                  onClick={() => onRemove(attachment.id)}
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

AttachmentStrip.displayName = 'AttachmentStrip'

export default AttachmentStrip

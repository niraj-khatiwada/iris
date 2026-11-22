import { Button, Tooltip } from '@heroui/react'
import { Check, Download, FileText, Pencil, RotateCcw, X } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'

import CopyButton from '@/components/CopyButton'
import Markdown from '@/components/Markdown'
import AttachmentImage from '@/components/MessageList/AttachmentImage'
import MessageSummaryMenu from '@/components/MessageList/MessageSummaryMenu'
import ReadAloudButton from '@/components/ReadAloudButton'
import { NO_WRITING_ASSIST } from '@/constants'
import { useChatStore } from '@/stores/chatStore'
import type { ChatMessage } from '@/types/chat'
import { downloadAttachment } from '@/utils/download'
import { formatFileSize } from '@/utils/files'
import { formatMessageTime } from '@/utils/format'
import { cn } from '@/utils/tailwind'

type MessageBubbleProps = {
  message: ChatMessage
  conversationId: string
  /** Only the final user turn can be rewritten; editing drops every reply after it. */
  canEdit: boolean
  /** Only the final reply can be regenerated. */
  canRegenerate: boolean
  disabled: boolean
  /** Briefly rings a message that a search result opened. */
  highlighted?: boolean
  /** Stored spoken summary for this message, when automatic read-aloud generated one. */
  summary?: string
  /** Show the summary instead of the original reply for this conversation. */
  showSummary?: boolean
}

const MessageBubble = memo(function MessageBubble({
  message,
  conversationId,
  canEdit,
  canRegenerate,
  disabled,
  highlighted = false,
  summary,
  showSummary = false,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const showingSummary = Boolean(showSummary && summary)
  const displayedText = showSummary && summary ? summary : message.content
  const isEmptyStream = message.status === 'streaming' && !message.content
  const regenerate = useChatStore((state) => state.regenerate)
  const editAndResend = useChatStore((state) => state.editAndResend)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: resizing follows the controlled draft
  useEffect(() => {
    if (!editing) {
      return
    }

    const input = inputRef.current
    if (!input) {
      return
    }

    input.focus({ preventScroll: true })
    input.setSelectionRange(input.value.length, input.value.length)
    input.style.height = '0px'
    input.style.height = `${input.scrollHeight}px`
  }, [editing, draft])

  const startEditing = () => {
    setDraft(message.content)
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setDraft(message.content)
  }

  const save = () => {
    if (disabled) {
      return
    }

    const text = draft.trim()
    if (!text && !message.attachments?.length) {
      return
    }

    setEditing(false)
    void editAndResend(conversationId, message.id, text)
  }

  return (
    <article className={cn('flex', isUser && 'justify-end')}>
      <div
        className={cn(
          'flex min-w-0 max-w-[min(88%,46rem)] flex-col',
          isUser ? 'items-end' : 'items-start',
          editing && 'w-full',
        )}
      >
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-[14px] leading-6',
            isUser
              ? 'bg-accent-soft text-accent-soft-foreground'
              : 'bg-surface/45 ring-1 ring-border/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl',
            editing && 'w-full',
            highlighted && 'ring-2 ring-primary/60',
          )}
        >
          {isUser && message.attachments?.length ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.attachments.map((attachment) =>
                attachment.dataUrl ||
                attachment.previewName ||
                attachment.fileName ? (
                  attachment.dataUrl || attachment.previewName ? (
                    <AttachmentImage
                      key={attachment.id}
                      attachment={attachment}
                      conversationId={conversationId}
                    />
                  ) : (
                    <div
                      key={attachment.id}
                      className="flex max-w-full items-center gap-2 rounded-lg bg-background/25 px-2.5 py-1.5 ring-1 ring-border/30"
                    >
                      <FileText className="size-4 shrink-0 opacity-70" />
                      <div className="flex min-w-0 flex-col">
                        <span className="max-w-56 truncate text-xs font-medium">
                          {attachment.name}
                        </span>
                        {attachment.size ? (
                          <span className="text-[10px] opacity-60">
                            {formatFileSize(attachment.size)}
                          </span>
                        ) : null}
                      </div>
                      {attachment.fileName ? (
                        <button
                          type="button"
                          aria-label={`Download ${attachment.name}`}
                          className="shrink-0 rounded-full p-1 text-muted transition-colors hover:bg-foreground/5 hover:text-foreground"
                          onClick={() => {
                            void downloadAttachment(
                              conversationId,
                              attachment,
                            ).catch(() => {})
                          }}
                        >
                          <Download className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  )
                ) : null,
              )}
            </div>
          ) : null}

          {editing ? (
            <textarea
              {...NO_WRITING_ASSIST}
              ref={inputRef}
              aria-label="Edit message"
              className="block min-h-9 w-full resize-none border-0 bg-transparent p-0 text-[14px] leading-6 text-inherit shadow-none outline-none"
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelEditing()
                  return
                }

                if (event.key === 'Enter' && !event.shiftKey) {
                  if (event.nativeEvent.isComposing) {
                    return
                  }
                  event.preventDefault()
                  save()
                }
              }}
            />
          ) : isUser ? (
            message.content ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : null
          ) : isEmptyStream ? (
            <TypingDots />
          ) : (
            <>
              {showingSummary ? (
                <span className="mb-1.5 flex text-[10px] font-medium tracking-[0.14em] text-muted/60 uppercase">
                  Spoken summary
                </span>
              ) : null}
              <Markdown>{displayedText}</Markdown>
            </>
          )}

          {message.status === 'streaming' && message.content ? (
            <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse rounded-full bg-accent align-text-bottom" />
          ) : null}

          {message.status === 'error' ? (
            <p className="mt-2 text-xs text-danger">{message.error}</p>
          ) : null}
        </div>

        <div
          className={cn(
            'mt-1 flex items-center gap-1 px-1 text-[10px] text-muted/70',
            isUser && 'flex-row-reverse',
          )}
        >
          <span>{formatMessageTime(message.createdAt)}</span>

          {editing ? (
            <>
              <CopyButton text={draft} />
              <Tooltip delay={400}>
                <Button
                  isIconOnly
                  aria-label="Save and resend"
                  className="size-6 min-w-6 text-muted"
                  isDisabled={disabled}
                  size="sm"
                  variant="ghost"
                  onPress={save}
                >
                  <Check className="size-3.5 text-primary" />
                </Button>
                <Tooltip.Content>Save and resend</Tooltip.Content>
              </Tooltip>
              <Tooltip delay={400}>
                <Button
                  isIconOnly
                  aria-label="Cancel editing"
                  className="size-6 min-w-6 text-muted"
                  size="sm"
                  variant="ghost"
                  onPress={cancelEditing}
                >
                  <X className="size-3.5" />
                </Button>
                <Tooltip.Content>Cancel · Esc</Tooltip.Content>
              </Tooltip>
            </>
          ) : null}

          {!editing && isUser && message.content ? (
            <CopyButton text={message.content} />
          ) : null}

          {!editing && canEdit && message.status !== 'streaming' ? (
            <Tooltip delay={400}>
              <Button
                isIconOnly
                aria-label="Edit message"
                className="size-6 min-w-6 text-muted"
                isDisabled={disabled}
                size="sm"
                variant="ghost"
                onPress={startEditing}
              >
                <Pencil className="size-3" />
              </Button>
              <Tooltip.Content>Edit</Tooltip.Content>
            </Tooltip>
          ) : null}

          {!editing &&
          !isUser &&
          message.status === 'complete' &&
          displayedText ? (
            <>
              <CopyButton text={displayedText} />
              <ReadAloudButton
                conversationId={conversationId}
                text={displayedText}
              />
              {summary ? <MessageSummaryMenu messageId={message.id} /> : null}
            </>
          ) : null}

          {!editing && canRegenerate ? (
            <Tooltip delay={400}>
              <Button
                isIconOnly
                aria-label="Regenerate response"
                className="size-6 min-w-6 text-muted"
                isDisabled={disabled}
                size="sm"
                variant="ghost"
                onPress={() => void regenerate(conversationId, message.id)}
              >
                <RotateCcw className="size-3" />
              </Button>
              <Tooltip.Content>Regenerate</Tooltip.Content>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </article>
  )
})

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="size-1.5 animate-bounce rounded-full bg-accent/70"
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </span>
  )
}

MessageBubble.displayName = 'MessageBubble'

export default MessageBubble

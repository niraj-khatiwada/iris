import { Button, Tooltip } from '@heroui/react'
import {
  Brain,
  Check,
  ChevronDown,
  Download,
  FileText,
  Pencil,
  RotateCcw,
  X,
} from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'

import CopyButton from '@/components/CopyButton'
import Markdown from '@/components/Markdown'
import AttachmentImage from '@/components/MessageList/AttachmentImage'
import MessageSummaryMenu from '@/components/MessageList/MessageSummaryMenu'
import SourcesPill from '@/components/MessageList/SourcesPill'
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
  const thinking = (message.thinking ?? message.metadata?.thinking ?? '').trim()
  const sources = message.metadata?.sources ?? []
  const isThinkingLive = message.status === 'streaming' && !message.content
  const showThinking = !isUser && (Boolean(thinking) || isThinkingLive)
  const effort = message.metadata?.thinking_effort
  const effortLabel = effort
    ? `${effort[0].toUpperCase()}${effort.slice(1)}`
    : null
  const regenerate = useChatStore((state) => state.regenerate)
  const editAndResend = useChatStore((state) => state.editAndResend)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [thinkingOpen, setThinkingOpen] = useState(
    message.status === 'streaming' && !message.content,
  )
  const [thinkingTouched, setThinkingTouched] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const thinkingRef = useRef<HTMLDivElement>(null)
  const pastedRef = useRef(false)

  // The thinking panel is open while the model reasons, then tucks away when the answer starts.
  useEffect(() => {
    if (!thinkingTouched && thinkingOpen && message.content) {
      setThinkingOpen(false)
    }
  }, [message.content, thinkingOpen, thinkingTouched])

  // Keep the newest reasoning visible while it streams.
  useEffect(() => {
    if (!thinkingOpen || !isThinkingLive || !thinking) {
      return
    }
    const element = thinkingRef.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
  }, [isThinkingLive, thinking, thinkingOpen])

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
    pastedRef.current = false
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
    void editAndResend(conversationId, message.id, text, pastedRef.current)
    pastedRef.current = false
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
          {showThinking ? (
            <div className="mb-2 overflow-hidden rounded-xl border border-border/40 bg-background/20">
              <button
                type="button"
                aria-expanded={thinkingOpen}
                className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
                onClick={() => {
                  setThinkingTouched(true)
                  setThinkingOpen((open) => !open)
                }}
              >
                <Brain
                  className={cn(
                    'size-3.5 shrink-0',
                    isThinkingLive
                      ? 'animate-pulse text-primary'
                      : 'text-muted',
                  )}
                />
                <span className="text-[11px] font-medium text-muted">
                  Thinking
                </span>
                {effortLabel ? (
                  <span className="text-[10px] text-muted/60">
                    · {effortLabel}
                  </span>
                ) : null}
                <ChevronDown
                  className={cn(
                    'ml-auto size-3 shrink-0 text-muted/60 transition-transform',
                    thinkingOpen && 'rotate-180',
                  )}
                />
              </button>
              {thinkingOpen ? (
                <div
                  ref={thinkingRef}
                  className="max-h-64 overflow-y-auto border-t border-border/30 px-2.5 py-2"
                >
                  <p className="whitespace-pre-wrap text-[11px] leading-5 text-muted">
                    {thinking || 'Waiting for reasoning…'}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

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
              onPaste={(event) => {
                if (event.clipboardData.getData('text/plain').trim()) {
                  pastedRef.current = true
                }
              }}
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
          ) : isEmptyStream && !showThinking ? (
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

          {!isUser && sources.length > 0 ? (
            <SourcesPill sources={sources} />
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

          {!editing &&
          !isUser &&
          message.status === 'complete' &&
          displayedText &&
          summary ? (
            <MessageSummaryMenu messageId={message.id} />
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

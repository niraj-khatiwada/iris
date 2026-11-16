import { Button, Tooltip } from '@heroui/react'
import { Check, LoaderCircle, Pencil, RotateCcw, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import CopyButton from '@/components/CopyButton'
import Markdown from '@/components/Markdown'
import VoiceWave from '@/components/VoiceWave'
import { useChatStore } from '@/stores/chatStore'
import { stopSpeaking } from '@/tauri/commands/voice'
import type { ChatMessage } from '@/types/chat'
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
  /** The TTS audio for this reply is still downloading. */
  preparing?: boolean
  /** This reply is being read aloud right now. */
  speaking?: boolean
}

function MessageBubble({
  message,
  conversationId,
  canEdit,
  canRegenerate,
  disabled,
  preparing = false,
  speaking = false,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
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
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`
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
        )}
      >
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-[14px] leading-6',
            isUser
              ? 'bg-accent-soft text-accent-soft-foreground'
              : 'bg-surface/45 ring-1 ring-border/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl',
            editing && 'w-full',
          )}
        >
          {isUser && message.attachments?.length ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.attachments.map((attachment) => (
                <img
                  key={attachment.id}
                  alt={attachment.name}
                  className="max-h-64 max-w-[min(100%,24rem)] rounded-lg object-cover"
                  src={attachment.dataUrl}
                />
              ))}
            </div>
          ) : null}

          {editing ? (
            <textarea
              ref={inputRef}
              aria-label="Edit message"
              className="max-h-[200px] min-h-9 w-full resize-none border-0 bg-transparent p-0 text-[14px] leading-6 text-inherit shadow-none outline-none"
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
            <Markdown>{message.content}</Markdown>
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

          {!editing && !isUser && (preparing || speaking) ? (
            <span className="flex items-center gap-1">
              {preparing ? (
                <>
                  <LoaderCircle className="size-3 animate-spin text-muted" />
                  <span className="text-muted/70">Preparing audio…</span>
                </>
              ) : (
                <>
                  <VoiceWave active compact className="w-16" tone="speaking" />
                  <span className="sr-only">Reading aloud</span>
                </>
              )}
              <Tooltip delay={400}>
                <Button
                  isIconOnly
                  aria-label="Stop reading aloud"
                  className="size-6 min-w-6 text-muted"
                  size="sm"
                  variant="ghost"
                  onPress={() => void stopSpeaking()}
                >
                  <Square className="size-3 fill-current" />
                </Button>
                <Tooltip.Content>Stop reading aloud</Tooltip.Content>
              </Tooltip>
            </span>
          ) : null}

          {!editing &&
          !isUser &&
          message.status === 'complete' &&
          message.content ? (
            <CopyButton text={message.content} />
          ) : null}
        </div>
      </div>
    </article>
  )
}

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

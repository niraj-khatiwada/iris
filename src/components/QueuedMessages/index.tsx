import { Button, ScrollShadow } from '@heroui/react'
import { ChevronUp, Clock3, Paperclip, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type FocusEvent, useEffect, useRef, useState } from 'react'

import { useChatStore } from '@/stores/chatStore'
import { cn } from '@/utils/tailwind'

/**
 * Messages waiting behind the reply currently streaming in this conversation. The queue stays as
 * a compact stack of cards until the pointer or keyboard focus reaches it. In History the opened
 * rows float above the composer so the conversation behind never moves; the quick overlay grows
 * its own window instead, because it has no conversation behind the queue.
 */
function QueuedMessages({
  conversationId,
  compact = false,
  className,
}: {
  conversationId?: string | null
  compact?: boolean
  className?: string
}) {
  const queue = useChatStore((state) =>
    conversationId ? state.messageQueue[conversationId] : undefined,
  )
  const removeQueuedMessage = useChatStore((state) => state.removeQueuedMessage)
  const clearQueuedMessages = useChatStore((state) => state.clearQueuedMessages)
  const [expanded, setExpanded] = useState(false)
  const [pinned, setPinned] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (queue && queue.length > 0) {
      return
    }
    setExpanded(false)
    setPinned(false)
  }, [queue])

  if (!conversationId || !queue?.length) {
    return null
  }

  const first = queue[0]
  const stacked = queue.length > 1
  const tripleStack = queue.length > 2
  const floating = !compact
  const cardHeight = compact ? 'h-9' : 'h-10'
  const cardRadius = 'rounded-2xl'
  const rowTransition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 520, damping: 42 }
  const floatTransition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 440, damping: 34 }

  const rows = queue.map((item) => (
    <div
      key={item.id}
      className={cn(
        'flex shrink-0 items-center gap-2 border border-border/50 bg-surface/45',
        compact
          ? 'rounded-xl py-1 pr-1 pl-2.5'
          : 'rounded-2xl py-1.5 pr-1.5 pl-3',
      )}
    >
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-foreground/65',
          compact ? 'text-[11px] leading-4' : 'text-[12px] leading-5',
        )}
      >
        {item.content.trim() || item.attachments[0]?.name || 'Attachment'}
      </span>

      {item.attachments.length > 0 ? (
        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted">
          <Paperclip className="size-3" />
          {item.attachments.length}
        </span>
      ) : null}

      <Button
        isIconOnly
        aria-label="Remove queued message"
        className={cn(
          'shrink-0 text-foreground/40',
          compact ? 'size-5 min-w-5' : 'size-6 min-w-6',
        )}
        size="sm"
        variant="ghost"
        onPress={() => removeQueuedMessage(conversationId, item.id)}
      >
        <X className={compact ? 'size-2.5' : 'size-3'} />
      </Button>
    </div>
  ))

  const handleMouseLeave = () => {
    if (pinned || containerRef.current?.contains(document.activeElement)) {
      return
    }
    setExpanded(false)
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && containerRef.current?.contains(next)) {
      return
    }
    if (!pinned) {
      setExpanded(false)
    }
  }

  const togglePinned = () => {
    if (pinned) {
      setPinned(false)
      setExpanded(false)
    } else {
      setPinned(true)
      setExpanded(true)
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex flex-col',
        compact ? 'relative' : 'absolute inset-x-6 bottom-full z-20',
        className,
      )}
      onBlurCapture={handleBlur}
      onFocusCapture={() => setExpanded(true)}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={handleMouseLeave}
    >
      {compact ? (
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              key="queued-rows"
              animate={{ height: 'auto', opacity: 1 }}
              className="overflow-hidden pt-1.5 pb-2"
              exit={{ height: 0, opacity: 0 }}
              initial={{ height: 0, opacity: 0 }}
              transition={rowTransition}
            >
              <ScrollShadow
                hideScrollBar
                className="flex max-h-[6.125rem] flex-col gap-1"
                size={16}
              >
                {rows}
              </ScrollShadow>
            </motion.div>
          ) : null}
        </AnimatePresence>
      ) : null}

      <div className={cn('relative', compact && 'pt-5')}>
        {tripleStack ? (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-8 border border-border/60 bg-surface/60 transition-opacity duration-200',
              compact ? 'top-0' : '-top-5',
              cardHeight,
              cardRadius,
              expanded ? 'opacity-0' : 'opacity-100',
            )}
          />
        ) : null}
        {stacked ? (
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-4 border border-border/80 bg-surface/75 transition-opacity duration-200',
              compact ? 'top-2.5' : '-top-2.5',
              cardHeight,
              cardRadius,
              expanded ? 'opacity-0' : 'opacity-100',
            )}
          />
        ) : null}

        <div
          className={cn(
            'relative z-10 flex w-full items-center border border-border bg-surface/90 shadow-[0_10px_18px_-14px_rgba(0,0,0,0.6)] transition-colors hover:bg-surface',
            cardHeight,
            cardRadius,
            compact ? 'gap-1 pr-1.5 pl-2.5' : 'gap-1.5 pr-2 pl-3.5',
          )}
        >
          <button
            type="button"
            aria-expanded={expanded}
            aria-label="Queued messages"
            className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
            onClick={togglePinned}
          >
            <Clock3
              className={cn(
                'shrink-0 text-muted',
                compact ? 'size-2.5' : 'size-3',
              )}
            />
            <span
              aria-live="polite"
              className={cn(
                'shrink-0 font-medium tracking-[0.12em] text-muted uppercase',
                compact ? 'text-[9px]' : 'text-[10px]',
              )}
            >
              {queue.length} {queue.length === 1 ? 'message' : 'messages'}{' '}
              queued
            </span>

            {expanded ? (
              <span className="flex-1" />
            ) : (
              <>
                <span aria-hidden className="h-3 w-px shrink-0 bg-border/60" />
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-foreground/65',
                    compact ? 'text-[11px] leading-4' : 'text-[12px] leading-5',
                  )}
                >
                  {first.content.trim() ||
                    first.attachments[0]?.name ||
                    'Attachment'}
                </span>
                {first.attachments.length > 0 ? (
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted">
                    <Paperclip className="size-3" />
                    {first.attachments.length}
                  </span>
                ) : null}
              </>
            )}
          </button>

          <Button
            aria-label="Clear all queued messages"
            className={cn(
              'h-6 min-w-0 shrink-0 px-2 text-muted hover:text-foreground',
              compact ? 'text-[10px]' : 'text-[11px]',
            )}
            size="sm"
            variant="ghost"
            onPress={() => clearQueuedMessages(conversationId)}
          >
            Clear All
          </Button>

          <button
            type="button"
            aria-expanded={expanded}
            aria-label={
              expanded ? 'Collapse queued messages' : 'Expand queued messages'
            }
            className="flex size-6 shrink-0 items-center justify-center text-muted transition-colors hover:text-foreground"
            onClick={togglePinned}
          >
            <ChevronUp
              className={cn(
                'transition-transform duration-200',
                compact ? 'size-3' : 'size-3.5',
                expanded && 'rotate-180',
              )}
            />
          </button>
        </div>
      </div>

      {floating ? (
        <AnimatePresence initial={false}>
          {expanded ? (
            <motion.div
              key="queued-rows"
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="absolute inset-x-0 bottom-full z-30 origin-bottom"
              exit={{ opacity: 0, scale: 0.98, y: 6 }}
              initial={{ opacity: 0, scale: 0.98, y: 8 }}
              transition={floatTransition}
            >
              <div className="pb-2">
                <div className="rounded-2xl border border-border/60 bg-background/95 p-1.5 shadow-2xl backdrop-blur-xl">
                  <ScrollShadow
                    hideScrollBar
                    className="flex max-h-[10.625rem] flex-col gap-1.5"
                    size={18}
                  >
                    {rows}
                  </ScrollShadow>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      ) : null}
    </div>
  )
}

QueuedMessages.displayName = 'QueuedMessages'

export default QueuedMessages

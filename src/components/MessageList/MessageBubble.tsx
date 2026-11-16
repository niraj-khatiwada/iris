import CopyButton from '@/components/CopyButton'
import Markdown from '@/components/Markdown'
import type { ChatMessage } from '@/types/chat'
import { formatMessageTime } from '@/utils/format'
import { cn } from '@/utils/tailwind'

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isEmptyStream = message.status === 'streaming' && !message.content

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

          {isUser ? (
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
          {!isUser && message.status === 'complete' && message.content ? (
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

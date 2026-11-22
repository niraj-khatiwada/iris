import { SearchField } from '@heroui/react'
import { CornerDownLeft, MessageSquare } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { NO_WRITING_ASSIST } from '@/constants'
import type { Conversation } from '@/types/chat'
import { formatConversationTime } from '@/utils/format'
import { cn } from '@/utils/tailwind'

type ConversationSwitcherProps = {
  conversations: Conversation[]
  currentId: string | null
  onSelect: (id: string) => void
  onClose: () => void
}

const RECENT_LIMIT = 8
const SEARCH_LIMIT = 20

/**
 * Compact title search for the quick overlay. It only looks at stored conversation titles, so it
 * stays instant even when a chat has thousands of messages.
 */
function ConversationSwitcher({
  conversations,
  currentId,
  onSelect,
  onClose,
}: ConversationSwitcherProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase()
    const matches = conversations
      .filter(
        (conversation) =>
          !conversation.archivedAt && conversation.id !== currentId,
      )
      .filter(
        (conversation) =>
          !term || conversation.title.toLowerCase().includes(term),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)

    return term
      ? matches.slice(0, SEARCH_LIMIT)
      : matches.slice(0, RECENT_LIMIT)
  }, [conversations, currentId, query])

  const active = rows.length === 0 ? 0 : Math.min(activeIndex, rows.length - 1)

  useEffect(() => {
    const rowsInView =
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')
    rowsInView?.[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const move = (direction: 1 | -1) => {
    if (rows.length === 0) {
      return
    }
    setActiveIndex((index) => (index + direction + rows.length) % rows.length)
  }

  return (
    <div className="mb-2 overflow-hidden rounded-2xl border border-border/50 bg-surface/65 shadow-lg backdrop-blur-xl">
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
        <span className="text-[10px] font-medium tracking-[0.12em] text-muted uppercase">
          Recent chats
        </span>
        <span className="text-[10px] text-muted/70">
          {rows.length} {rows.length === 1 ? 'chat' : 'chats'}
        </span>
      </div>

      <div className="px-2 pb-1.5">
        <SearchField
          aria-label="Search conversations"
          className="w-full"
          name="conversation-search"
          value={query}
          variant="secondary"
          onChange={(value) => {
            setQuery(value)
            setActiveIndex(0)
          }}
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input
              {...NO_WRITING_ASSIST}
              autoFocus
              placeholder="Search conversations"
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  move(1)
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  move(-1)
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  const row = rows[active]
                  if (row) {
                    onSelect(row.id)
                  }
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  onClose()
                }
              }}
            />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </div>

      <div
        ref={listRef}
        aria-label="Conversations"
        className="max-h-[220px] overflow-y-auto px-1 pb-1"
        role="listbox"
      >
        {rows.length === 0 ? (
          <p className="px-2.5 py-3 text-[11px] leading-5 text-muted">
            {query.trim()
              ? 'No conversations match that search.'
              : 'No other conversations yet. Start one with New chat.'}
          </p>
        ) : (
          rows.map((conversation, index) => {
            const isActive = index === active

            return (
              <button
                key={conversation.id}
                aria-selected={isActive}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors',
                  isActive ? 'bg-foreground/10' : 'hover:bg-foreground/5',
                )}
                role="option"
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(conversation.id)}
              >
                <MessageSquare className="size-3.5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                  {conversation.title}
                </span>
                <span className="shrink-0 text-[10px] text-muted/70">
                  {formatConversationTime(conversation.updatedAt)}
                </span>
                {isActive ? (
                  <CornerDownLeft className="size-3 shrink-0 text-muted/70" />
                ) : null}
              </button>
            )
          })
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-border/40 px-2.5 py-1.5 text-[10px] text-muted/70">
        <span>↑↓ navigate</span>
        <span>↵ open</span>
        <span>esc close</span>
      </div>
    </div>
  )
}

ConversationSwitcher.displayName = 'ConversationSwitcher'

export default ConversationSwitcher

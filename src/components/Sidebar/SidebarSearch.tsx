import { Button, SearchField, Tooltip } from '@heroui/react'
import {
  Archive,
  LoaderCircle,
  MessageSquare,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { NO_WRITING_ASSIST } from '@/constants'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { searchHistory } from '@/tauri/commands/storage'
import type { SearchMessageHit, SearchResults } from '@/types/chat'
import { isTauri } from '@/utils/tauri'

const EMPTY_RESULTS: SearchResults = { conversations: [], messages: [] }

type MessageGroup = {
  conversationId: string
  title: string
  archived: boolean
  hits: SearchMessageHit[]
}

function groupMessageHits(hits: SearchMessageHit[]): MessageGroup[] {
  const groups = new Map<string, MessageGroup>()
  for (const hit of hits) {
    const group = groups.get(hit.conversationId)
    if (group) {
      group.hits.push(hit)
    } else {
      groups.set(hit.conversationId, {
        conversationId: hit.conversationId,
        title: hit.conversationTitle,
        archived: hit.archived,
        hits: [hit],
      })
    }
  }
  return [...groups.values()]
}

/** The browser preview has no SQLite, so search its in-memory conversation store instead. */
function searchInMemory(value: string): SearchResults {
  const needle = value.toLowerCase()
  const conversations = useChatStore.getState().conversations
  const conversationHits = conversations
    .filter((conversation) => conversation.title.toLowerCase().includes(needle))
    .slice(0, 20)
    .map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      archived: Boolean(conversation.archivedAt),
    }))

  const messageHits: SearchMessageHit[] = []
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (message.content.toLowerCase().includes(needle)) {
        messageHits.push({
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          messageId: message.id,
          role: message.role,
          snippet: message.content.slice(0, 160),
          createdAt: message.createdAt,
          archived: Boolean(conversation.archivedAt),
        })
      }
      if (messageHits.length >= 50) {
        break
      }
    }
    if (messageHits.length >= 50) {
      break
    }
  }

  return { conversations: conversationHits, messages: messageHits }
}

function HighlightedSnippet({ value }: { value: string }) {
  const nodes: ReactNode[] = []
  const pattern = /\u0002([\s\S]*?)\u0003/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index))
    }
    nodes.push(
      <mark
        key={key}
        className="rounded-sm bg-primary/25 px-0.5 text-foreground"
      >
        {match[1]}
      </mark>,
    )
    key += 1
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex))
  }

  return <>{nodes.length > 0 ? nodes : value}</>
}

/**
 * Search sits directly above the conversation list. It searches titles with SQLite FTS5 and
 * message bodies in the same query, showing title hits first and then message snippets grouped by
 * conversation. Selecting a message loads older pages until that hit is in memory and scrolls to it.
 */
function SidebarSearch({ onCreate }: { onCreate: () => void }) {
  const query = useUIStore((state) => state.searchQuery)
  const setQuery = useUIStore((state) => state.setSearchQuery)
  const focusToken = useUIStore((state) => state.searchFocusToken)
  const selectConversation = useChatStore((state) => state.selectConversation)
  const focusMessage = useChatStore((state) => state.focusMessage)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestId = useRef(0)
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS)
  const [loading, setLoading] = useState(false)
  const trimmed = query.trim()
  const searching = trimmed.length > 0
  const groups = useMemo(
    () => groupMessageHits(results.messages),
    [results.messages],
  )

  useEffect(() => {
    if (focusToken === 0) {
      return
    }
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusToken])

  useEffect(() => {
    const id = requestId.current + 1
    requestId.current = id
    const needle = query.trim()

    if (needle.length === 0) {
      setResults(EMPTY_RESULTS)
      setLoading(false)
      return
    }

    setLoading(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        const found = isTauri()
          ? await searchHistory(needle)
          : searchInMemory(needle)
        if (requestId.current === id) {
          setResults(found)
          setLoading(false)
        }
      })().catch(() => {
        if (requestId.current === id) {
          setResults(EMPTY_RESULTS)
          setLoading(false)
        }
      })
    }, 140)

    return () => window.clearTimeout(timer)
  }, [query])

  const openConversation = (id: string) => {
    selectConversation(id)
    setQuery('')
  }

  const openMessage = (hit: SearchMessageHit) => {
    setQuery('')
    void focusMessage(hit.conversationId, hit.messageId)
  }

  const clearSearch = () => {
    setQuery('')
    inputRef.current?.focus()
  }

  const openFirst = () => {
    const conversation = results.conversations[0]
    if (conversation) {
      openConversation(conversation.id)
      return
    }
    const message = results.messages[0]
    if (message) {
      openMessage(message)
    }
  }

  const empty = results.conversations.length === 0 && groups.length === 0

  return (
    <>
      <div className="flex items-center gap-2 px-2 pt-1">
        <SearchField
          aria-label="Search chats and messages"
          className="min-w-0 flex-1"
          name="chat-search"
          value={query}
          variant="secondary"
          onChange={setQuery}
        >
          <SearchField.Group className="glass-control rounded-full">
            <div className="ml-2 flex size-6 shrink-0 items-center justify-center">
              <AnimatePresence initial={false} mode="wait">
                {searching ? (
                  <motion.button
                    key="clear"
                    type="button"
                    aria-label="Clear search"
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    className="flex size-6 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-surface/60 hover:text-foreground"
                    exit={{ opacity: 0, scale: 0.7, rotate: -20 }}
                    initial={{ opacity: 0, scale: 0.7, rotate: 20 }}
                    transition={{ duration: 0.12 }}
                    onClick={clearSearch}
                  >
                    <X className="size-4" />
                  </motion.button>
                ) : (
                  <motion.span
                    key="search"
                    aria-hidden
                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                    className="flex size-6 items-center justify-center text-muted"
                    exit={{ opacity: 0, scale: 0.7, rotate: 20 }}
                    initial={{ opacity: 0, scale: 0.7, rotate: -20 }}
                    transition={{ duration: 0.12 }}
                  >
                    <Search className="size-4" />
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
            <SearchField.Input
              {...NO_WRITING_ASSIST}
              ref={inputRef}
              className="pl-1"
              placeholder="Search anything..."
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  setQuery('')
                  return
                }
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  openFirst()
                }
              }}
            />
          </SearchField.Group>
        </SearchField>
        <Tooltip delay={400}>
          <Button
            isIconOnly
            aria-label="New conversation"
            className="glass-control size-9 min-w-9 shrink-0 rounded-full text-muted"
            variant="ghost"
            onPress={onCreate}
          >
            <Plus className="size-4" />
          </Button>
          <Tooltip.Content>New chat</Tooltip.Content>
        </Tooltip>
      </div>

      {searching ? (
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {loading && empty ? (
            <div className="flex justify-center py-6">
              <LoaderCircle className="size-4 animate-spin text-muted/60" />
            </div>
          ) : null}

          {!loading && empty ? (
            <p className="px-2 py-6 text-xs leading-5 text-muted">
              No matches for “{trimmed}”.
            </p>
          ) : null}

          {results.conversations.length > 0 ? (
            <section className="mb-4">
              <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted/70">
                Chats
              </p>
              <div className="space-y-0.5">
                {results.conversations.map((hit) => (
                  <Button
                    key={hit.id}
                    fullWidth
                    className="h-9 justify-start gap-2 pr-2 pl-3 text-left"
                    variant="ghost"
                    onPress={() => openConversation(hit.id)}
                  >
                    <MessageSquare className="size-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {hit.title}
                    </span>
                    {hit.archived ? (
                      <Archive
                        aria-label="Archived"
                        className="size-3 shrink-0 text-muted/70"
                      />
                    ) : null}
                  </Button>
                ))}
              </div>
            </section>
          ) : null}

          {groups.length > 0 ? (
            <section>
              <p className="px-2 pb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-muted/70">
                Messages
              </p>
              <div className="space-y-3">
                {groups.map((group) => (
                  <div key={group.conversationId}>
                    <div className="flex items-center gap-1.5 px-2 pb-1">
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted">
                        {group.title}
                      </span>
                      {group.archived ? (
                        <Archive
                          aria-label="Archived"
                          className="size-3 shrink-0 text-muted/70"
                        />
                      ) : null}
                    </div>
                    <div className="space-y-0.5">
                      {group.hits.map((hit) => (
                        <Button
                          key={hit.messageId}
                          fullWidth
                          className="h-auto justify-start px-3 py-1.5 text-left"
                          variant="ghost"
                          onPress={() => openMessage(hit)}
                        >
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted/70">
                              {hit.role === 'user' ? 'You' : 'Iris'}
                            </span>
                            <span className="line-clamp-2 text-[12px] leading-5 text-muted">
                              <HighlightedSnippet value={hit.snippet} />
                            </span>
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

SidebarSearch.displayName = 'SidebarSearch'

export default SidebarSearch

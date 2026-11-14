import { Button, TextArea, Tooltip } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { ArrowUp, Check, Clock3, Copy, Eye, Plus, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import IrisEffect from '@/components/IrisEffect'
import Logo from '@/components/Logo'
import Markdown from '@/components/Markdown'
import { QUICK_CONVERSATION_ID } from '@/constants'
import { useOverlayWindow } from '@/hooks/useOverlayWindow'
import { useChatStore } from '@/stores/chatStore'
import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'

const panelSpring = {
  type: 'spring',
  stiffness: 380,
  damping: 34,
  mass: 0.75,
} as const

const contentSpring = {
  type: 'spring',
  stiffness: 520,
  damping: 40,
  mass: 0.6,
} as const

function Overlay() {
  const ensureQuickConversation = useChatStore(
    (state) => state.ensureQuickConversation,
  )
  const resetQuickConversation = useChatStore(
    (state) => state.resetQuickConversation,
  )
  const sendMessage = useChatStore((state) => state.sendMessage)
  const stopStreaming = useChatStore((state) => state.stopStreaming)
  const conversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === QUICK_CONVERSATION_ID),
  )
  const streaming = useChatStore(
    (state) => state.streamingConversationId === QUICK_CONVERSATION_ID,
  )

  const { panelRef, inputRef, hide } = useOverlayWindow()
  const [value, setValue] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [ignoredResponseId, setIgnoredResponseId] = useState<string | null>(
    null,
  )
  const [copied, setCopied] = useState(false)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const copyTimer = useRef<number | null>(null)

  const lastMessage = conversation?.messages[conversation.messages.length - 1]
  const assistant = lastMessage?.role === 'assistant' ? lastMessage : undefined
  const isIgnored = Boolean(assistant && assistant.id === ignoredResponseId)
  const hasResponse = Boolean(
    assistant &&
      !isIgnored &&
      (assistant.content || assistant.status === 'error'),
  )
  const isThinking = streaming && !assistant?.content
  const showResponse = !streaming && hasResponse && revealed
  const responseReady = !streaming && hasResponse && !revealed
  const active = streaming || hasResponse
  const status =
    assistant?.status === 'error'
      ? 'Something went wrong'
      : streaming
        ? 'Thinking'
        : 'Ready'
  const responseLabel =
    assistant?.status === 'error' ? 'Response failed' : 'Response ready'
  const view = streaming
    ? 'processing'
    : showResponse
      ? 'revealed'
      : responseReady
        ? 'ready'
        : 'idle'

  useEffect(() => {
    ensureQuickConversation()
  }, [ensureQuickConversation])

  // Drive the native window from the animated panel height.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the view changes
  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) {
      return
    }

    const measure = () => setContentHeight(element.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)

    return () => observer.disconnect()
  }, [view])

  // biome-ignore lint/correctness/useExhaustiveDependencies: resizing follows the controlled value
  useEffect(() => {
    const element = inputRef.current
    if (!element) {
      return
    }

    element.style.height = '0px'
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`
  }, [value, inputRef])

  useEffect(
    () => () => {
      if (copyTimer.current) {
        window.clearTimeout(copyTimer.current)
      }
    },
    [],
  )

  const submit = () => {
    const text = value.trim()
    if (!text || streaming) {
      return
    }

    setValue('')
    setRevealed(false)
    setIgnoredResponseId(null)
    ensureQuickConversation()
    void sendMessage(text, QUICK_CONVERSATION_ID)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const cancel = () => {
    if (assistant?.id) {
      setIgnoredResponseId(assistant.id)
    }
    setRevealed(false)
    void stopStreaming()
  }

  const newChat = () => {
    resetQuickConversation()
    setValue('')
    setRevealed(false)
    setIgnoredResponseId(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const openHistory = () => {
    if (isTauri()) {
      void invoke('show_main_window')
      return
    }

    window.location.assign('/')
  }

  const copyResponse = () => {
    if (!assistant?.content) {
      return
    }

    navigator.clipboard
      .writeText(assistant.content)
      .then(() => {
        setCopied(true)
        if (copyTimer.current) {
          window.clearTimeout(copyTimer.current)
        }
        copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => setCopied(false))
  }

  return (
    <div className="iris-overlay flex h-screen w-screen items-end justify-center p-4">
      <motion.section
        ref={panelRef}
        animate={{ height: contentHeight ?? 'auto' }}
        className={cn(
          'iris-panel liquid-glass w-[760px] max-w-full overflow-hidden rounded-[28px] text-white',
          active && 'iris-panel--active',
        )}
        initial={false}
        transition={panelSpring}
      >
        <div ref={contentRef} className="relative">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={view}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(6px)' }}
              initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
              transition={contentSpring}
            >
              {streaming ? (
                <div className="flex flex-col items-center px-6 py-5">
                  <IrisEffect />
                  <p
                    aria-live="polite"
                    className="iris-shimmer mt-1 text-[12px] font-medium"
                  >
                    {isThinking ? 'Thinking…' : 'Responding…'}
                  </p>
                  <Button
                    className="mt-3 gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 text-[11px] text-white/60 hover:bg-white/[0.1] hover:text-white/90"
                    size="sm"
                    variant="ghost"
                    onPress={cancel}
                  >
                    <X className="size-3.5" />
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  {hasResponse ? (
                    <header className="flex items-center gap-2 px-4 pt-3">
                      <Logo animated size={20} />
                      <span className="text-[10px] font-semibold tracking-[0.16em] text-white/55">
                        IRIS
                      </span>
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          assistant?.status === 'error'
                            ? 'bg-red-400'
                            : 'bg-emerald-400/80',
                        )}
                      />
                      <span className="truncate text-[11px] text-white/35">
                        {status}
                      </span>

                      <div className="ml-auto flex items-center gap-0.5">
                        {showResponse && assistant?.content ? (
                          <Tooltip delay={500}>
                            <Button
                              isIconOnly
                              aria-label={copied ? 'Copied' : 'Copy response'}
                              className="size-7 min-w-7 text-white/45"
                              size="sm"
                              variant="ghost"
                              onPress={copyResponse}
                            >
                              {copied ? (
                                <Check className="size-3.5 text-emerald-300" />
                              ) : (
                                <Copy className="size-3.5" />
                              )}
                            </Button>
                            <Tooltip.Content>
                              {copied ? 'Copied' : 'Copy'}
                            </Tooltip.Content>
                          </Tooltip>
                        ) : null}

                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label="New quick chat"
                            className="size-7 min-w-7 text-white/45"
                            size="sm"
                            variant="ghost"
                            onPress={newChat}
                          >
                            <Plus className="size-3.5" />
                          </Button>
                          <Tooltip.Content>New chat</Tooltip.Content>
                        </Tooltip>

                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label="Open history"
                            className="size-7 min-w-7 text-white/45"
                            size="sm"
                            variant="ghost"
                            onPress={openHistory}
                          >
                            <Clock3 className="size-3.5" />
                          </Button>
                          <Tooltip.Content>History</Tooltip.Content>
                        </Tooltip>

                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label="Hide Iris"
                            className="size-7 min-w-7 text-white/45"
                            size="sm"
                            variant="ghost"
                            onPress={hide}
                          >
                            <X className="size-3.5" />
                          </Button>
                          <Tooltip.Content>Hide · Esc</Tooltip.Content>
                        </Tooltip>
                      </div>
                    </header>
                  ) : null}

                  {responseReady ? (
                    <div className="flex items-center gap-2 px-5 pb-1 pt-2">
                      <span
                        className={cn(
                          'size-1.5 rounded-full',
                          assistant?.status === 'error'
                            ? 'bg-red-400'
                            : 'bg-emerald-400/80',
                        )}
                      />
                      <span className="text-[11px] text-white/40">
                        {responseLabel}
                      </span>
                      <button
                        type="button"
                        className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-white/65 transition hover:border-white/20 hover:bg-white/[0.1] hover:text-white/90 focus-visible:outline-none"
                        onClick={() => setRevealed(true)}
                      >
                        <Eye className="size-3" />
                        Show response
                      </button>
                    </div>
                  ) : null}

                  {showResponse ? (
                    <div
                      aria-live="polite"
                      className="iris-response max-h-[320px] overflow-y-auto px-5 pb-2 pt-1.5"
                    >
                      {assistant?.status === 'error' ? (
                        <p className="text-[13px] leading-6 text-red-300/90">
                          {assistant.error ??
                            'Iris could not finish that response. Try again in a moment.'}
                        </p>
                      ) : assistant?.content ? (
                        <Markdown>{assistant.content}</Markdown>
                      ) : null}
                    </div>
                  ) : null}

                  <div
                    className={cn(
                      'flex items-end gap-2 px-3',
                      hasResponse
                        ? 'border-t border-white/[0.06] py-2'
                        : 'py-3',
                    )}
                  >
                    {hasResponse ? null : <Logo className="mb-1.5" size={26} />}

                    <TextArea
                      ref={inputRef}
                      aria-label="Ask Iris"
                      className="max-h-[120px] min-h-10 w-full resize-none border-0 bg-transparent px-1 py-2 text-[15px] leading-6 text-white shadow-none placeholder:text-white/35 focus-visible:ring-0"
                      placeholder={
                        hasResponse ? 'Ask a follow-up…' : 'Ask Iris anything…'
                      }
                      rows={1}
                      value={value}
                      variant="secondary"
                      onChange={(event) => setValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          if (event.nativeEvent.isComposing) {
                            return
                          }
                          event.preventDefault()
                          submit()
                        }
                      }}
                    />

                    <div className="mb-0.5 flex shrink-0 items-center gap-0.5">
                      {hasResponse ? null : (
                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label="Open history"
                            className="text-white/45"
                            size="sm"
                            variant="ghost"
                            onPress={openHistory}
                          >
                            <Clock3 className="size-4" />
                          </Button>
                          <Tooltip.Content>History</Tooltip.Content>
                        </Tooltip>
                      )}

                      <Button
                        isIconOnly
                        aria-label="Send message"
                        isDisabled={!value.trim()}
                        size="sm"
                        variant="primary"
                        onPress={submit}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.section>
    </div>
  )
}

Overlay.displayName = 'Overlay'

export default Overlay

import { Button, TextArea, Tooltip } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import {
  ArrowUp,
  Check,
  ChevronUp,
  Copy,
  Eye,
  Mic,
  Plus,
  Square,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import IrisBlob from '@/components/IrisBlob'
import Markdown from '@/components/Markdown'
import VoiceStrip from '@/components/VoiceStrip'
import VoiceWave from '@/components/VoiceWave'
import { QUICK_CONVERSATION_ID } from '@/constants'
import {
  SENDING_EMOTIONS,
  SENDING_SHAPES,
  SENDING_TICK_MS,
} from '@/constants/blob'
import { useChatStorage } from '@/hooks/useChatStorage'
import { useOverlayWindow } from '@/hooks/useOverlayWindow'
import { useSpeechPlayback } from '@/hooks/useSpeechPlayback'
import { useVoiceInput } from '@/hooks/useVoiceInput'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { subscribeToOverlayHidden } from '@/tauri/commands/overlay'
import { stopSpeaking } from '@/tauri/commands/voice'
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

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

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
  const selectConversation = useChatStore((state) => state.selectConversation)
  const streaming = useChatStore(
    (state) => state.streamingConversationId === QUICK_CONVERSATION_ID,
  )

  const { panelRef, inputRef, hide } = useOverlayWindow()
  const autoSendVoice = useSettingsStore((state) => state.autoSendVoice)
  const voice = useVoiceInput()
  useChatStorage()
  const speaking = useSpeechPlayback(QUICK_CONVERSATION_ID)
  const [value, setValue] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [ignoredResponseId, setIgnoredResponseId] = useState<string | null>(
    null,
  )
  const [copied, setCopied] = useState(false)
  const [errorVisible, setErrorVisible] = useState(false)
  const [sendingTick, setSendingTick] = useState(0)
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
  const voiceActive = voice.status !== 'idle'
  const active = streaming || hasResponse || voiceActive || speaking
  const status =
    assistant?.status === 'error'
      ? 'Something went wrong'
      : speaking
        ? 'Speaking'
        : streaming
          ? isThinking
            ? 'Sending request…'
            : 'Responding…'
          : 'Ready'
  const view = voiceActive ? 'voice' : 'main'

  useEffect(() => {
    ensureQuickConversation()
  }, [ensureQuickConversation])

  useEffect(() => {
    if (!streaming) {
      setSendingTick(0)
      return
    }

    const timer = window.setInterval(() => {
      setSendingTick((tick) => tick + 1)
    }, SENDING_TICK_MS)
    return () => window.clearInterval(timer)
  }, [streaming])

  useEffect(() => {
    if (!voice.error) {
      setErrorVisible(false)
      return
    }

    setErrorVisible(true)
    const timer = window.setTimeout(() => setErrorVisible(false), 3000)
    return () => window.clearTimeout(timer)
  }, [voice.error])

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

  // Pressing "/" returns focus to the quick input when it has drifted to a button or the card.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== '/' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isTypingTarget(event.target)
      ) {
        return
      }

      event.preventDefault()
      inputRef.current?.focus()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inputRef])

  // The native window can be hidden by the shortcut, which never reaches the React tree.
  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let disposed = false
    let off: (() => void) | undefined
    void subscribeToOverlayHidden(() => voice.cancel()).then((unlisten) => {
      if (disposed) {
        unlisten()
      } else {
        off = unlisten
      }
    })

    return () => {
      disposed = true
      off?.()
    }
  }, [voice.cancel])

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
    if (isTauri()) {
      void stopSpeaking()
    }
    resetQuickConversation()
    setValue('')
    setRevealed(false)
    setIgnoredResponseId(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const finishVoice = async () => {
    const text = await voice.stop()
    if (!text) {
      return
    }

    if (autoSendVoice) {
      setValue('')
      setRevealed(false)
      setIgnoredResponseId(null)
      ensureQuickConversation()
      void sendMessage(text, QUICK_CONVERSATION_ID)
    } else {
      setValue(text)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const openHistory = () => {
    // Keep the history window on the quick conversation when it has content.
    if (conversation && conversation.messages.length > 0) {
      selectConversation(QUICK_CONVERSATION_ID)
    }

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
          <AnimatePresence>
            {errorVisible && voice.error ? (
              <motion.div
                key="voice-error"
                animate={{ opacity: 1, y: 0 }}
                className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-4 pt-2"
                exit={{ opacity: 0, y: -8 }}
                initial={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <p className="max-w-[90%] rounded-full border border-red-400/20 bg-red-950/85 px-3 py-1.5 text-center text-[11px] leading-4 text-red-200 shadow-lg backdrop-blur-xl">
                  {voice.error}
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={view}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(6px)' }}
              initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
              transition={contentSpring}
            >
              {voiceActive ? (
                <VoiceStrip
                  mode={
                    voice.status === 'recording' ? 'listening' : 'transcribing'
                  }
                  analyser={voice.analyser}
                  onStop={
                    voice.status === 'recording'
                      ? () => void finishVoice()
                      : voice.cancel
                  }
                />
              ) : (
                <>
                  <header className="flex items-center gap-2 px-4 pt-3 pb-2">
                    <Tooltip delay={500}>
                      <button
                        type="button"
                        aria-label="Open history"
                        className="shrink-0 rounded-full focus-visible:outline-none"
                        onDoubleClick={openHistory}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openHistory()
                          }
                        }}
                      >
                        <IrisBlob
                          activity={speaking ? 'speaking' : 'idle'}
                          emotion={
                            streaming
                              ? (SENDING_EMOTIONS[
                                  sendingTick % SENDING_EMOTIONS.length
                                ] ?? 'thinking')
                              : assistant?.status === 'error'
                                ? 'sad'
                                : hasResponse
                                  ? 'happy'
                                  : 'neutral'
                          }
                          shape={
                            streaming
                              ? (SENDING_SHAPES[
                                  sendingTick % SENDING_SHAPES.length
                                ] ?? 'blob')
                              : 'blob'
                          }
                          size={24}
                        />
                      </button>
                      <Tooltip.Content>
                        Double-click for history
                      </Tooltip.Content>
                    </Tooltip>

                    <span className="text-[10px] font-semibold tracking-[0.16em] text-white/55">
                      IRIS
                    </span>
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        assistant?.status === 'error'
                          ? 'bg-red-400'
                          : 'bg-primary',
                        streaming && 'animate-pulse',
                      )}
                    />
                    <span className="truncate text-[11px] text-white/35">
                      {status}
                    </span>

                    {speaking ? (
                      <VoiceWave active compact className="w-24 shrink-0" />
                    ) : null}

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
                              <Check className="size-3.5 text-primary" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                          </Button>
                          <Tooltip.Content>
                            {copied ? 'Copied' : 'Copy'}
                          </Tooltip.Content>
                        </Tooltip>
                      ) : null}

                      {streaming || speaking ? (
                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label={
                              streaming ? 'Stop responding' : 'Stop speaking'
                            }
                            className="size-7 min-w-7 text-white/45"
                            size="sm"
                            variant="ghost"
                            onPress={
                              streaming
                                ? cancel
                                : () => {
                                    void stopSpeaking()
                                  }
                            }
                          >
                            <Square className="size-3.5 fill-current" />
                          </Button>
                          <Tooltip.Content>
                            {streaming ? 'Stop' : 'Stop speaking'}
                          </Tooltip.Content>
                        </Tooltip>
                      ) : null}

                      {responseReady ? (
                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label="Show response"
                            className="size-7 min-w-7 text-white/45"
                            size="sm"
                            variant="ghost"
                            onPress={() => setRevealed(true)}
                          >
                            <Eye className="size-3.5" />
                          </Button>
                          <Tooltip.Content>Show response</Tooltip.Content>
                        </Tooltip>
                      ) : showResponse ? (
                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label="Hide response"
                            className="size-7 min-w-7 text-white/45"
                            size="sm"
                            variant="ghost"
                            onPress={() => setRevealed(false)}
                          >
                            <ChevronUp className="size-3.5" />
                          </Button>
                          <Tooltip.Content>Hide response</Tooltip.Content>
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
                      'flex items-end gap-2 px-3 transition-colors',
                      hasResponse
                        ? 'border-t border-white/[0.06] py-2'
                        : 'py-3',
                      streaming && 'iris-input-sending',
                    )}
                  >
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
                      <Tooltip delay={500}>
                        <Button
                          isIconOnly
                          aria-label="Voice input"
                          className="text-white/45"
                          isDisabled={streaming}
                          size="sm"
                          variant="ghost"
                          onPress={() => void voice.start()}
                        >
                          <Mic className="size-4" />
                        </Button>
                        <Tooltip.Content>Voice input</Tooltip.Content>
                      </Tooltip>

                      <Button
                        isIconOnly
                        aria-label="Send message"
                        isDisabled={streaming || !value.trim()}
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

import { Button, TextArea, Tooltip } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import {
  ArrowUp,
  Check,
  ChevronUp,
  Copy,
  Eye,
  Mic,
  Plus,
  Scan,
  Square,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import AttachmentStrip from '@/components/AttachmentStrip'
import ChatToggles from '@/components/ChatToggles'
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
import { useImageAttachments } from '@/hooks/useImageAttachments'
import { useOverlayWindow } from '@/hooks/useOverlayWindow'
import { useSettingsSync } from '@/hooks/useSettingsSync'
import { useSpeechPlayback } from '@/hooks/useSpeechPlayback'
import { useVoiceInput } from '@/hooks/useVoiceInput'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { subscribeToOverlayHidden } from '@/tauri/commands/overlay'
import {
  getScreenCapturePermission,
  requestScreenCapturePermission,
  startScreenCapture,
} from '@/tauri/commands/screen'
import { stopSpeaking } from '@/tauri/commands/voice'
import { newId } from '@/utils/id'
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
  const images = useImageAttachments()
  useChatStorage()
  useSettingsSync()
  const { speaking, preparing } = useSpeechPlayback(QUICK_CONVERSATION_ID)
  const [value, setValue] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [ignoredResponseId, setIgnoredResponseId] = useState<string | null>(
    null,
  )
  const [copied, setCopied] = useState(false)
  const [errorVisible, setErrorVisible] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
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
  const errorMessage =
    assistant?.status === 'error' ? (assistant.error ?? '') : ''
  const overlayError = voice.error ?? captureError
  const apiKeyMissing = /api key/i.test(errorMessage)
  // The blob keeps morphing while a reply streams and while its audio is being prepared.
  const morphing = streaming || preparing
  const active =
    streaming || preparing || hasResponse || voiceActive || speaking
  const status = apiKeyMissing
    ? 'API key is required'
    : assistant?.status === 'error'
      ? 'Something went wrong'
      : speaking
        ? 'Speaking'
        : preparing
          ? 'Reading aloud…'
          : streaming
            ? isThinking
              ? 'Sending request…'
              : 'Responding…'
            : 'Ready'
  const view = voiceActive ? 'voice' : 'main'

  const openSettings = useCallback(async () => {
    if (!isTauri()) {
      return
    }
    await emit('settings:open')
    await invoke('show_main_window')
  }, [])

  const clearImages = images.clear

  const newChat = useCallback(() => {
    if (isTauri()) {
      void stopSpeaking()
    }
    resetQuickConversation()
    clearImages()
    setValue('')
    setRevealed(false)
    setIgnoredResponseId(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [clearImages, inputRef, resetQuickConversation])

  useEffect(() => {
    ensureQuickConversation()
  }, [ensureQuickConversation])

  useEffect(() => {
    if (!morphing) {
      setSendingTick(0)
      return
    }

    const timer = window.setInterval(() => {
      setSendingTick((tick) => tick + 1)
    }, SENDING_TICK_MS)
    return () => window.clearInterval(timer)
  }, [morphing])

  useEffect(() => {
    if (!overlayError) {
      setErrorVisible(false)
      return
    }

    setErrorVisible(true)
    const timer = window.setTimeout(() => setErrorVisible(false), 3000)
    return () => window.clearTimeout(timer)
  }, [overlayError])

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

  // Pressing "/" returns focus to the quick input, Cmd/Ctrl+N starts a new chat, and Cmd/Ctrl+,
  // opens Settings in the history window.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey

      if (modifier && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        newChat()
        return
      }

      if (modifier && event.key === ',') {
        event.preventDefault()
        void openSettings()
        return
      }

      if (
        event.key !== '/' ||
        modifier ||
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
  }, [inputRef, newChat, openSettings])

  // A finished screen capture arrives as an annotated JPEG for the current draft.
  useEffect(() => {
    if (!isTauri()) {
      return
    }

    const addAttachment = images.addAttachment
    let disposed = false
    let off: (() => void) | undefined

    void listen<{ dataUrl: string }>('capture:attached', (event) => {
      addAttachment({
        id: newId(),
        name: 'Screen capture',
        mediaType: 'image/jpeg',
        dataUrl: event.payload.dataUrl,
      })
      requestAnimationFrame(() => inputRef.current?.focus())
    }).then((unlisten) => {
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
  }, [images.addAttachment, inputRef])

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

  const startCapture = async () => {
    if (!isTauri()) {
      return
    }

    setCaptureError(null)
    try {
      const allowed = await getScreenCapturePermission()
      if (!allowed) {
        const granted = await requestScreenCapturePermission()
        if (!granted) {
          setCaptureError(
            'Enable Screen Recording for Iris in System Settings, then try again.',
          )
          return
        }
      }

      await startScreenCapture()
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error))
    }
  }

  const submit = () => {
    const text = value.trim()
    if ((!text && images.attachments.length === 0) || streaming) {
      return
    }

    const attachments = images.attachments
    setValue('')
    images.clear()
    setRevealed(false)
    setIgnoredResponseId(null)
    ensureQuickConversation()
    void sendMessage(text, QUICK_CONVERSATION_ID, attachments)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const cancel = () => {
    if (assistant?.id) {
      setIgnoredResponseId(assistant.id)
    }
    setRevealed(false)
    void stopStreaming()
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
            {errorVisible && overlayError ? (
              <motion.div
                key="voice-error"
                animate={{ opacity: 1, y: 0 }}
                className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-4 pt-2"
                exit={{ opacity: 0, y: -8 }}
                initial={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <p className="max-w-[90%] rounded-full border border-red-400/20 bg-red-950/85 px-3 py-1.5 text-center text-[11px] leading-4 text-red-200 shadow-lg backdrop-blur-xl">
                  {overlayError}
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
                  <header
                    className="flex items-center gap-2 px-4 pt-2.5 pb-1"
                    data-tauri-drag-region="deep"
                  >
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
                            morphing
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
                            morphing
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

                    {!streaming && (speaking || preparing) ? (
                      <Tooltip delay={500}>
                        <Button
                          isIconOnly
                          aria-label="Stop speaking"
                          className="-ml-1.5 size-6 min-w-6 shrink-0 text-white/45"
                          size="sm"
                          variant="ghost"
                          onPress={() => {
                            void stopSpeaking()
                          }}
                        >
                          <Square className="size-3 fill-current" />
                        </Button>
                        <Tooltip.Content>Stop speaking</Tooltip.Content>
                      </Tooltip>
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

                      {streaming ? (
                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label="Stop responding"
                            className="size-7 min-w-7 text-white/45"
                            size="sm"
                            variant="ghost"
                            onPress={cancel}
                          >
                            <Square className="size-3.5 fill-current" />
                          </Button>
                          <Tooltip.Content>Stop</Tooltip.Content>
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

                      {!streaming && !preparing && !voiceActive ? (
                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label="Capture screen"
                            className="size-7 min-w-7 text-white/45"
                            size="sm"
                            variant="ghost"
                            onPress={() => void startCapture()}
                          >
                            <Scan className="size-3.5" />
                          </Button>
                          <Tooltip.Content>Capture screen</Tooltip.Content>
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
                      'px-3',
                      hasResponse
                        ? 'border-t border-white/[0.06] pt-1.5 pb-2.5'
                        : 'pt-1 pb-2.5',
                      images.dragging && 'bg-white/[0.03]',
                    )}
                    data-tauri-drag-region="deep"
                    {...images.dragHandlers}
                  >
                    <AttachmentStrip
                      attachments={images.attachments}
                      className="pb-2"
                      compact
                      onRemove={images.remove}
                    />

                    <div className="flex items-end gap-2">
                      <div className="pb-1.5">
                        <ChatToggles />
                      </div>

                      <TextArea
                        ref={inputRef}
                        aria-label="Ask Iris"
                        className="max-h-[120px] min-h-10 w-full resize-none border-0 bg-transparent px-1 py-2 text-[15px] leading-6 text-white shadow-none placeholder:text-white/35 focus-visible:ring-0"
                        placeholder={
                          hasResponse
                            ? 'Ask a follow-up…'
                            : 'Ask Iris anything…'
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
                          isDisabled={
                            streaming ||
                            (!value.trim() && images.attachments.length === 0)
                          }
                          size="sm"
                          variant="primary"
                          onPress={submit}
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                      </div>
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

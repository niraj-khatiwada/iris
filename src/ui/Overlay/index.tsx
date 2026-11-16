import { Button, TextArea, Tooltip } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import {
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
import IrisBlob, { type IrisTone } from '@/components/IrisBlob'
import Markdown from '@/components/Markdown'
import SendButton from '@/components/SendButton'
import SpeechControl from '@/components/SpeechControl'
import VoiceStrip from '@/components/VoiceStrip'
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
import { useSpeechStore } from '@/stores/speechStore'
import { subscribeToOverlayHidden } from '@/tauri/commands/overlay'
import {
  closeScreenCapture,
  getScreenCapturePermission,
  requestScreenCapturePermission,
  startScreenCapture,
} from '@/tauri/commands/screen'
import { stopSpeaking } from '@/tauri/commands/voice'
import { newId } from '@/utils/id'
import { matchesShortcut } from '@/utils/shortcut'
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

function isPlainCommandC(shortcut: string) {
  const parts = shortcut
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)

  return (
    parts.length === 2 &&
    ['commandorcontrol', 'command', 'cmd', 'meta', 'super'].includes(
      parts[0],
    ) &&
    parts[1] === 'keyc'
  )
}

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
  const overlayShortcuts = useSettingsStore((state) => state.overlayShortcuts)
  const deepThink = useSettingsStore((state) => state.deepThink)
  const webSearch = useSettingsStore((state) => state.webSearch)
  const setDeepThink = useSettingsStore((state) => state.setDeepThink)
  const setWebSearch = useSettingsStore((state) => state.setWebSearch)
  const voice = useVoiceInput()
  const voiceStart = voice.start
  const images = useImageAttachments()
  useChatStorage()
  useSettingsSync()
  useSpeechPlayback()
  const speaking = useSpeechStore((state) => state.speaking)
  const preparing = useSpeechStore((state) => state.preparing)
  const speechError = useSpeechStore((state) => state.error)
  const [value, setValue] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [ignoredResponseId, setIgnoredResponseId] = useState<string | null>(
    null,
  )
  const [copied, setCopied] = useState(false)
  const [errorVisible, setErrorVisible] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [sendingTick, setSendingTick] = useState(0)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const copyTimer = useRef<number | null>(null)
  const finishVoiceRef = useRef<(forceSend?: boolean) => void>(() => {})
  const startCaptureRef = useRef<() => void>(() => {})
  const captureGuard = useRef(0)
  const captureShortcutIsCopy = isPlainCommandC(overlayShortcuts.capture)
  const triggerCapture = useCallback(() => {
    const now = Date.now()
    if (now - captureGuard.current < 600) {
      return
    }
    captureGuard.current = now
    startCaptureRef.current()
  }, [])
  const voiceStatusRef = useRef(voice.status)
  const cancelVoiceRef = useRef(voice.cancel)
  voiceStatusRef.current = voice.status
  cancelVoiceRef.current = voice.cancel

  const lastMessage = conversation?.messages[conversation.messages.length - 1]
  const assistant = lastMessage?.role === 'assistant' ? lastMessage : undefined
  const isIgnored = Boolean(assistant && assistant.id === ignoredResponseId)
  const hasResponse = Boolean(
    assistant &&
      !isIgnored &&
      (assistant.content || assistant.status === 'error'),
  )
  const showResponse = !streaming && hasResponse && revealed
  const responseReady = !streaming && hasResponse && !revealed
  const voiceActive = voice.status !== 'idle'
  const errorMessage =
    assistant?.status === 'error' ? (assistant.error ?? '') : ''
  const overlayError = voice.error ?? speechError ?? captureError
  const apiKeyMissing = /api key/i.test(errorMessage)
  // The blob keeps morphing while a reply streams and while its audio is being prepared.
  const morphing = streaming || preparing
  const tone: IrisTone =
    assistant?.status === 'error'
      ? 'error'
      : preparing || speaking
        ? 'speaking'
        : streaming
          ? 'pending'
          : 'primary'
  const active =
    streaming || preparing || hasResponse || voiceActive || speaking
  const errorLabel = apiKeyMissing
    ? 'API key is required'
    : assistant?.status === 'error'
      ? 'Something went wrong'
      : null
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

  // Overlay-local shortcuts: "/" focuses the input, Cmd+, opens Settings, and the five
  // configurable bindings drive capture, new chat, thinking mode, web search, and voice input.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey

      // The voice strip owns Enter/Escape and ignores the action shortcuts.
      if (voiceActive) {
        return
      }

      if (matchesShortcut(event, overlayShortcuts.newChat)) {
        event.preventDefault()
        newChat()
        return
      }

      if (matchesShortcut(event, overlayShortcuts.capture)) {
        event.preventDefault()
        triggerCapture()
        return
      }

      if (matchesShortcut(event, overlayShortcuts.deepThink)) {
        event.preventDefault()
        setDeepThink(!deepThink)
        return
      }

      if (matchesShortcut(event, overlayShortcuts.webSearch)) {
        event.preventDefault()
        setWebSearch(!webSearch)
        return
      }

      if (matchesShortcut(event, overlayShortcuts.voiceInput)) {
        event.preventDefault()
        if (!streaming) {
          void voiceStart()
        }
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
  }, [
    deepThink,
    inputRef,
    newChat,
    openSettings,
    overlayShortcuts,
    setDeepThink,
    setWebSearch,
    streaming,
    triggerCapture,
    voiceActive,
    voiceStart,
    webSearch,
  ])

  // Cmd+C is the macOS Copy menu accelerator; catch the resulting copy event so the overlay can
  // still use it for screen capture when that binding is selected.
  useEffect(() => {
    if (!captureShortcutIsCopy) {
      return
    }

    const onCopy = (event: ClipboardEvent) => {
      if (voiceActive) {
        return
      }
      event.preventDefault()
      triggerCapture()
    }

    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [captureShortcutIsCopy, triggerCapture, voiceActive])

  // A finished screen capture arrives as an annotated JPEG for the current draft.
  useEffect(() => {
    if (!isTauri()) {
      return
    }

    const addAttachment = images.addAttachment
    let disposed = false
    const cleanups: Array<() => void> = []

    const track = (
      subscribe: (
        handler: (payload: { dataUrl: string }) => void,
      ) => Promise<() => void>,
    ) => {
      void subscribe((payload) => {
        addAttachment({
          id: newId(),
          name: 'Screen capture',
          mediaType: 'image/jpeg',
          dataUrl: payload.dataUrl,
        })
        setCapturing(false)
        requestAnimationFrame(() => inputRef.current?.focus())
      }).then((off) => {
        if (disposed) {
          off()
        } else {
          cleanups.push(off)
        }
      })
    }

    track((handler) =>
      listen<{ dataUrl: string }>('capture:attached', (event) =>
        handler(event.payload),
      ),
    )

    void listen('capture:closed', () => setCapturing(false)).then((off) => {
      if (disposed) {
        off()
      } else {
        cleanups.push(off)
      }
    })

    return () => {
      disposed = true
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [images.addAttachment, inputRef])

  // While the voice strip is open, Enter sends and Escape cancels it instead of hiding Iris.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && voiceStatusRef.current === 'recording') {
        event.preventDefault()
        event.stopPropagation()
        finishVoiceRef.current(true)
        return
      }

      if (event.key === 'Escape' && voiceStatusRef.current !== 'idle') {
        event.preventDefault()
        event.stopPropagation()
        cancelVoiceRef.current()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

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

    if (capturing) {
      try {
        await closeScreenCapture()
      } finally {
        setCapturing(false)
      }
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
      setCapturing(true)
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

  // Voice is a way to compose, not a separate message: whatever is already typed or attached
  // rides along with the transcript so a dictation never drops the rest of the draft.
  const finishVoice = async (forceSend = false) => {
    const transcript = (await voice.stop())?.trim() ?? ''
    const attachments = images.attachments
    const text = [value.trim(), transcript].filter(Boolean).join(' ')

    if (autoSendVoice || forceSend) {
      // Auto-send waits for a transcript: a failed dictation must not send the draft on its own.
      if (!transcript && !forceSend) {
        return
      }
      if (!text && attachments.length === 0) {
        return
      }

      setValue('')
      images.clear()
      setRevealed(false)
      setIgnoredResponseId(null)
      ensureQuickConversation()
      void sendMessage(text, QUICK_CONVERSATION_ID, attachments)
      return
    }

    if (!transcript) {
      return
    }

    setValue(text)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  finishVoiceRef.current = (forceSend) => {
    void finishVoice(forceSend)
  }

  startCaptureRef.current = () => {
    void startCapture()
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
          'iris-panel liquid-glass w-[760px] max-w-full overflow-hidden rounded-[28px] text-foreground',
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
                <p className="max-w-[90%] rounded-full border border-danger/25 bg-danger/15 px-3 py-1.5 text-center text-[11px] leading-4 text-danger shadow-lg backdrop-blur-xl">
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
                          tone={tone}
                        />
                      </button>
                      <Tooltip.Content>
                        Double-click for history
                      </Tooltip.Content>
                    </Tooltip>

                    <span className="text-[10px] font-semibold tracking-[0.16em] text-foreground/55">
                      IRIS
                    </span>
                    {errorLabel ? (
                      <span className="truncate text-[11px] text-danger/90">
                        {errorLabel}
                      </span>
                    ) : null}

                    <div className="ml-auto flex items-center gap-0.5">
                      {showResponse && assistant?.content ? (
                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label={copied ? 'Copied' : 'Copy response'}
                            className="size-7 min-w-7 text-foreground/45"
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
                            className="size-7 min-w-7 text-foreground/45"
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
                            className="size-7 min-w-7 text-foreground/45"
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
                            className="size-7 min-w-7 text-foreground/45"
                            size="sm"
                            variant="ghost"
                            onPress={() => setRevealed(false)}
                          >
                            <ChevronUp className="size-3.5" />
                          </Button>
                          <Tooltip.Content>Hide response</Tooltip.Content>
                        </Tooltip>
                      ) : null}

                      {capturing ||
                      (!streaming && !preparing && !voiceActive) ? (
                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label={
                              capturing ? 'Stop capture' : 'Capture screen'
                            }
                            className={cn(
                              'size-7 min-w-7',
                              capturing
                                ? 'bg-primary/15 text-primary'
                                : 'text-foreground/45',
                            )}
                            size="sm"
                            variant="ghost"
                            onPress={() => void startCapture()}
                          >
                            <Scan className="size-3.5" />
                          </Button>
                          <Tooltip.Content>
                            {capturing ? 'Stop capture' : 'Capture screen'}
                          </Tooltip.Content>
                        </Tooltip>
                      ) : null}

                      <Tooltip delay={500}>
                        <Button
                          isIconOnly
                          aria-label="New quick chat"
                          className="size-7 min-w-7 text-foreground/45"
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
                          className="size-7 min-w-7 text-foreground/45"
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
                        <p className="text-[13px] leading-6 text-danger">
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
                        ? 'border-t border-foreground/[0.06] pt-1.5 pb-2.5'
                        : 'pt-1 pb-2.5',
                      images.dragging && 'bg-foreground/[0.03]',
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
                        className="max-h-[120px] min-h-10 w-full resize-none border-0 bg-transparent px-1 py-2 text-[15px] leading-6 text-foreground shadow-none placeholder:text-foreground/35 focus-visible:ring-0"
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
                        <SpeechControl />

                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label="Voice input"
                            className="text-foreground/45"
                            isDisabled={streaming}
                            size="sm"
                            variant="ghost"
                            onPress={() => void voice.start()}
                          >
                            <Mic className="size-4" />
                          </Button>
                          <Tooltip.Content>Voice input</Tooltip.Content>
                        </Tooltip>

                        <SendButton
                          isDisabled={
                            streaming ||
                            (!value.trim() && images.attachments.length === 0)
                          }
                          onPress={submit}
                        />
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

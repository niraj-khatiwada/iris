import { Button, TextArea, Tooltip } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Mic,
  Plus,
  Replace,
  RotateCcw,
  Scan,
  Search,
  Sparkles,
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
import ConversationSwitcher from '@/components/ConversationSwitcher'
import CopyButton from '@/components/CopyButton'
import IrisBlob, { type IrisTone } from '@/components/IrisBlob'
import Markdown from '@/components/Markdown'
import PermissionNotice from '@/components/PermissionNotice'
import QuickPromptChip from '@/components/QuickPromptChip'
import QuickPromptMenu from '@/components/QuickPromptMenu'
import ReadAloudButton from '@/components/ReadAloudButton'
import SelectionPanel from '@/components/SelectionPanel'
import SendButton from '@/components/SendButton'
import ShimmerText from '@/components/ShimmerText'
import SpeechControl from '@/components/SpeechControl'
import ThinkingEffort from '@/components/ThinkingEffort'
import VoiceStrip from '@/components/VoiceStrip'
import { NO_WRITING_ASSIST } from '@/constants'
import { useAttachments } from '@/hooks/useAttachments'
import {
  flushChatStorage,
  selectHistoryConversation,
  sharedActiveConversationId,
  useChatStorage,
} from '@/hooks/useChatStorage'
import { useConversationHistory } from '@/hooks/useConversationHistory'
import { useOverlayWindow } from '@/hooks/useOverlayWindow'
import { useSettingsSync } from '@/hooks/useSettingsSync'
import { useSpeechPlayback } from '@/hooks/useSpeechPlayback'
import { useStopSpeakingShortcut } from '@/hooks/useStopSpeakingShortcut'
import { useVoiceInput } from '@/hooks/useVoiceInput'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSpeechStore } from '@/stores/speechStore'
import { showOverlay, subscribeToOverlayHidden } from '@/tauri/commands/overlay'
import {
  captureScreenForAsk,
  closeScreenCapture,
  getScreenCapturePermission,
  openScreenCaptureSettings,
  requestScreenCapturePermission,
  startScreenCapture,
  subscribeToScreenAsk,
} from '@/tauri/commands/screen'
import {
  openSelectionSettings,
  pasteSelection,
  replaceSelection,
  saveSelectionMetadata,
  subscribeToSelectionError,
  subscribeToSelectionOpen,
} from '@/tauri/commands/selection'
import { deleteEmptyConversations } from '@/tauri/commands/storage'
import { stopSpeaking } from '@/tauri/commands/voice'
import type { SelectionOpenPayload, SelectionView } from '@/types/selection'
import type { QuickPrompt, SettingsCategory } from '@/types/settings'
import { newId } from '@/utils/id'
import { filterQuickPrompts } from '@/utils/quickPrompts'
import {
  buildCustomSelectionPrompt,
  buildSelectionPrompt,
} from '@/utils/selection'
import {
  formatShortcut,
  isPlainCommandKey,
  matchesShortcut,
} from '@/utils/shortcut'
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

/**
 * Removes empty quick/history conversations when New chat starts. The backend confirms each
 * candidate has no message rows; keepIds protect the new chat and any conversation with messages
 * still in memory, including the History window's active chat with a pending write.
 */
async function cleanUpEmptyConversations() {
  try {
    await flushChatStorage()
  } catch {
    // Continue; the in-memory keep ids still protect visible messages.
  }

  const state = useChatStore.getState()
  const keepIds = new Set<string>()
  if (state.quickConversationId) {
    keepIds.add(state.quickConversationId)
  }
  const historyActiveId = sharedActiveConversationId()
  if (historyActiveId) {
    keepIds.add(historyActiveId)
  }
  for (const conversation of state.conversations) {
    if (conversation.messages.length > 0) {
      keepIds.add(conversation.id)
    }
  }

  try {
    const deleted = await deleteEmptyConversations([...keepIds])
    // The backend also broadcasts the ids so the History window drops them; this call keeps the
    // overlay immediate even if its event arrives a moment later.
    if (deleted.length > 0) {
      useChatStore.getState().removeConversations(deleted)
    }
  } catch {
    // Cleanup is best effort; New chat must still succeed.
  }
}

function Overlay() {
  const ensureQuickConversation = useChatStore(
    (state) => state.ensureQuickConversation,
  )
  const hydrated = useChatStore((state) => state.hydrated)
  const quickConversationId = useChatStore((state) => state.quickConversationId)
  const hasQuickConversation = useChatStore(
    (state) =>
      Boolean(state.quickConversationId) &&
      state.conversations.some(
        (conversation) =>
          conversation.id === state.quickConversationId &&
          !conversation.archivedAt,
      ),
  )
  const resetQuickConversation = useChatStore(
    (state) => state.resetQuickConversation,
  )
  const restorePreviousQuickConversation = useChatStore(
    (state) => state.restorePreviousQuickConversation,
  )
  const openQuickConversation = useChatStore(
    (state) => state.openQuickConversation,
  )
  const conversations = useChatStore((state) => state.conversations)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const stopStreaming = useChatStore((state) => state.stopStreaming)
  const regenerate = useChatStore((state) => state.regenerate)
  const conversation = useChatStore((state) =>
    state.quickConversationId
      ? state.conversations.find(
          (item) => item.id === state.quickConversationId,
        )
      : undefined,
  )
  useConversationHistory(quickConversationId ?? undefined)
  const quickLoaded = conversation?.messagesLoaded ?? false
  const selectConversation = useChatStore((state) => state.selectConversation)
  const streaming = useChatStore(
    (state) =>
      Boolean(state.quickConversationId) &&
      state.streamingConversationId === state.quickConversationId,
  )

  const { panelRef, inputRef, hide } = useOverlayWindow()
  const autoSendVoice = useSettingsStore((state) => state.autoSendVoice)
  const autoSpeak = useSettingsStore((state) => state.autoSpeak)
  const autoSpeakSelection = useSettingsStore(
    (state) => state.autoSpeakSelection,
  )
  const selectionAutoSpeak = autoSpeak && autoSpeakSelection
  const overlayShortcuts = useSettingsStore((state) => state.overlayShortcuts)
  const voice = useVoiceInput()
  const voiceStart = voice.start
  const files = useAttachments({
    conversationId: quickConversationId,
    createConversation: ensureQuickConversation,
  })
  useChatStorage()
  useSettingsSync()
  useSpeechPlayback()
  useStopSpeakingShortcut()
  const speaking = useSpeechStore((state) => state.speaking)
  const preparing = useSpeechStore((state) => state.preparing)
  const speechError = useSpeechStore((state) => state.error)
  const revealResponse = useSettingsStore((state) => state.revealResponse)
  const quickPrompts = useSettingsStore((state) => state.quickPrompts)
  const [value, setValue] = useState('')
  const [slashPrompt, setSlashPrompt] = useState<QuickPrompt | null>(null)
  const [promptIndex, setPromptIndex] = useState(0)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switcherFocusNonce, setSwitcherFocusNonce] = useState(0)
  // A new reply starts revealed or hidden depending on the setting; Hide/Show still override it
  // for the reply currently on screen.
  const [revealed, setRevealed] = useState(revealResponse)
  const [ignoredResponseId, setIgnoredResponseId] = useState<string | null>(
    null,
  )
  const [errorVisible, setErrorVisible] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [capturePermissionNeeded, setCapturePermissionNeeded] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [selectionView, setSelectionView] = useState<SelectionView | null>(null)
  const [selectionContext, setSelectionContext] =
    useState<SelectionOpenPayload | null>(null)
  const [customSelection, setCustomSelection] =
    useState<SelectionOpenPayload | null>(null)
  const [selectionReplaceError, setSelectionReplaceError] = useState<
    string | null
  >(null)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const selectionPanelRef = useRef<HTMLDivElement>(null)
  const forceRevealOnChatChange = useRef(false)
  const pastedRef = useRef(false)
  const finishVoiceRef = useRef<(forceSend?: boolean) => void>(() => {})
  const startCaptureRef = useRef<() => void>(() => {})
  const captureGuard = useRef(0)
  const captureShortcutIsCopy = isPlainCommandKey(
    overlayShortcuts.capture,
    'KeyC',
  )
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
  const overlayError =
    voice.error ?? speechError ?? captureError ?? selectionReplaceError
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
    streaming ||
    preparing ||
    hasResponse ||
    voiceActive ||
    speaking ||
    Boolean(selectionView)
  const errorLabel = apiKeyMissing
    ? 'API key is required'
    : assistant?.status === 'error'
      ? 'Something went wrong'
      : null
  const view = selectionView ? 'selection' : voiceActive ? 'voice' : 'main'
  // The `/` menu is only for the normal composer: a custom selection and the menu never overlap.
  const slashQuery =
    !selectionView &&
    !customSelection &&
    !slashPrompt &&
    !streaming &&
    value.startsWith('/') &&
    !/\s/.test(value.slice(1))
      ? value.slice(1)
      : null
  const slashMatches =
    slashQuery === null ? [] : filterQuickPrompts(quickPrompts, slashQuery)
  const slashOpen = slashQuery !== null && slashMatches.length > 0
  const activePromptIndex =
    slashMatches.length === 0
      ? 0
      : Math.min(promptIndex, slashMatches.length - 1)

  const openSettings = useCallback(async (category?: SettingsCategory) => {
    if (!isTauri()) {
      return
    }
    await emit('settings:open', category ? { category } : {})
    await invoke('show_main_window')
  }, [])

  const clearAttachments = files.clear

  const saveSelectionProvenance = async (
    messageId: string,
    conversationId: string,
    action: string,
    selection: SelectionOpenPayload,
  ) => {
    try {
      await saveSelectionMetadata({
        messageId,
        conversationId,
        sourceApp: selection.appName,
        sourceBundleId: selection.bundleId,
        sourcePid: selection.pid,
        action,
        characterCount: selection.characterCount,
        truncated: selection.truncated,
        fromClipboard: selection.fromClipboard,
      })
    } catch {
      // Provenance is useful but must never block the reply.
    }
  }

  const newChat = useCallback(() => {
    if (isTauri()) {
      void stopSpeaking()
    }
    resetQuickConversation()
    clearAttachments()
    setValue('')
    setSlashPrompt(null)
    setSwitcherOpen(false)
    pastedRef.current = false
    setRevealed(revealResponse)
    setIgnoredResponseId(null)
    setSelectionView(null)
    setSelectionContext(null)
    setCustomSelection(null)
    setSelectionReplaceError(null)
    requestAnimationFrame(() => inputRef.current?.focus())
    void cleanUpEmptyConversations()
  }, [clearAttachments, inputRef, resetQuickConversation, revealResponse])

  // Drafts belong to one conversation. When Previous conversation or a fresh quick chat
  // changes the id, do not carry files or text into the new chat.
  const previousQuickId = useRef(quickConversationId)
  useEffect(() => {
    if (previousQuickId.current === quickConversationId) {
      return
    }
    const previous = previousQuickId.current
    previousQuickId.current = quickConversationId
    if (!previous) {
      return
    }
    clearAttachments()
    setValue('')
    setSlashPrompt(null)
    setSwitcherOpen(false)
    pastedRef.current = false
    // A selection action always reveals its result; a normal New chat follows the setting.
    setRevealed(forceRevealOnChatChange.current || revealResponse)
    forceRevealOnChatChange.current = false
    setIgnoredResponseId(null)
  }, [clearAttachments, quickConversationId, revealResponse])

  useEffect(() => {
    // Wait for SQLite before creating the quick chat, otherwise the empty local one could win
    // the hydration merge and replace a stored conversation. The conversation check also
    // recreates it after Clear History.
    if (hydrated && !hasQuickConversation) {
      ensureQuickConversation()
    }
  }, [ensureQuickConversation, hasQuickConversation, hydrated])

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

  // Overlay-local shortcuts: "/" focuses the input, Cmd+, opens Settings, and the configurable
  // bindings drive capture, new chat, show/hide response, thinking mode, web search, voice input,
  // and stopping read-aloud.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey

      // The voice strip and the selection strip own their keys and ignore action shortcuts.
      if (voiceActive || selectionView) {
        return
      }

      // The configured search shortcut opens the conversation switcher, or returns focus to its
      // field when it is already open.
      if (matchesShortcut(event, overlayShortcuts.searchConversations)) {
        event.preventDefault()
        setSwitcherOpen(true)
        setSwitcherFocusNonce((value) => value + 1)
        return
      }

      if (switcherOpen) {
        return
      }

      if (matchesShortcut(event, overlayShortcuts.newChat)) {
        event.preventDefault()
        newChat()
        return
      }

      if (matchesShortcut(event, overlayShortcuts.restorePrevious)) {
        event.preventDefault()
        if (isTauri()) {
          void stopSpeaking()
        }
        restorePreviousQuickConversation()
        setRevealed(revealResponse)
        setIgnoredResponseId(null)
        setSelectionView(null)
        setSelectionContext(null)
        setCustomSelection(null)
        setSelectionReplaceError(null)
        requestAnimationFrame(() => inputRef.current?.focus())
        return
      }

      if (matchesShortcut(event, overlayShortcuts.toggleResponse)) {
        if (!streaming && hasResponse) {
          event.preventDefault()
          setRevealed((current) => !current)
        }
        return
      }

      if (matchesShortcut(event, overlayShortcuts.capture)) {
        event.preventDefault()
        triggerCapture()
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
    hasResponse,
    inputRef,
    newChat,
    openSettings,
    overlayShortcuts,
    restorePreviousQuickConversation,
    revealResponse,
    selectionView,
    streaming,
    switcherOpen,
    triggerCapture,
    voiceActive,
    voiceStart,
  ])

  // Cmd+C is the macOS Copy menu accelerator; catch the resulting copy event so the overlay can
  // still use it for screen capture when that binding is selected.
  useEffect(() => {
    if (!captureShortcutIsCopy) {
      return
    }

    const onCopy = (event: ClipboardEvent) => {
      if (voiceActive || selectionView) {
        return
      }
      event.preventDefault()
      triggerCapture()
    }

    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [captureShortcutIsCopy, selectionView, triggerCapture, voiceActive])

  // A finished screen capture arrives as an annotated JPEG for the current draft.
  useEffect(() => {
    if (!isTauri()) {
      return
    }

    const addAttachment = files.addAttachment
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
  }, [files.addAttachment, inputRef])

  // `⌘⇧A` captures the whole display and attaches it to the current draft. Permission and errors
  // use the same notice the region-capture flow already shows.
  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let disposed = false
    let unlisten: (() => void) | undefined

    const run = async () => {
      setCapturePermissionNeeded(false)
      setCaptureError(null)
      try {
        const allowed = await getScreenCapturePermission()
        if (!allowed) {
          await requestScreenCapturePermission()
          if (!(await getScreenCapturePermission())) {
            await showOverlay()
            setCapturePermissionNeeded(true)
            return
          }
        }
        await captureScreenForAsk()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (/screen recording|permission/i.test(message)) {
          await showOverlay().catch(() => undefined)
          setCapturePermissionNeeded(true)
        } else {
          setCaptureError(message)
        }
      }
    }

    void subscribeToScreenAsk(() => {
      void run()
    }).then((off) => {
      if (disposed) {
        off()
      } else {
        unlisten = off
      }
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

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
    void subscribeToOverlayHidden(() => {
      voice.cancel()
      setSwitcherOpen(false)
      setSelectionView(null)
      setSelectionContext(null)
      setCustomSelection(null)
      setSelectionReplaceError(null)
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
  }, [voice.cancel])

  // The Rust shortcut reads the selection before showing Iris, then announces it here.
  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let disposed = false
    let offOpen: (() => void) | undefined
    let offError: (() => void) | undefined

    void subscribeToSelectionOpen((payload) => {
      if (disposed) {
        return
      }
      voice.cancel()
      void stopSpeaking()
      setSelectionView({ kind: 'actions', ...payload })
      setSelectionContext(null)
      setCustomSelection(null)
      setSelectionReplaceError(null)
      setRevealed(false)
    }).then((off) => {
      if (disposed) {
        off()
      } else {
        offOpen = off
      }
    })

    void subscribeToSelectionError((payload) => {
      if (disposed) {
        return
      }
      setSelectionView({ kind: 'error', ...payload })
      setSelectionContext(null)
      setCustomSelection(null)
      setSelectionReplaceError(null)
      setRevealed(false)
    }).then((off) => {
      if (disposed) {
        off()
      } else {
        offError = off
      }
    })

    return () => {
      disposed = true
      offOpen?.()
      offError?.()
    }
  }, [voice.cancel])

  // Escape cancels the selection strip and returns to the normal composer. It should not
  // bubble to the window's normal hide handler.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the input ref is stable
  useEffect(() => {
    if (!selectionView) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      setSelectionView(null)
      setSelectionContext(null)
      setCustomSelection(null)
      setSelectionReplaceError(null)
      setSlashPrompt(null)
      requestAnimationFrame(() => inputRef.current?.focus())
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [selectionView])

  // Escape closes the conversation switcher without hiding Iris.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the input ref is stable
  useEffect(() => {
    if (!switcherOpen) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      setSwitcherOpen(false)
      requestAnimationFrame(() => inputRef.current?.focus())
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [switcherOpen])

  // A voice session or selection strip replaces the normal overlay view; do not bring the
  // switcher back when that view closes.
  useEffect(() => {
    if (switcherOpen && (voiceActive || selectionView)) {
      setSwitcherOpen(false)
    }
  }, [selectionView, switcherOpen, voiceActive])

  const startCapture = async () => {
    setSwitcherOpen(false)
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
    setCapturePermissionNeeded(false)
    try {
      const allowed = await getScreenCapturePermission()
      if (!allowed) {
        // macOS only presents the TCC prompt once. If it was denied before, this returns false
        // without showing anything, so the overlay must explain what to do next.
        await requestScreenCapturePermission()
        const granted = await getScreenCapturePermission()
        if (!granted) {
          setCapturePermissionNeeded(true)
          return
        }
      }

      await startScreenCapture()
      setCapturing(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/screen recording|permission/i.test(message)) {
        setCapturePermissionNeeded(true)
      } else {
        setCaptureError(message)
      }
    }
  }

  const openScreenSettings = async () => {
    try {
      await openScreenCaptureSettings()
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error))
    }
  }

  const chooseSlashPrompt = (prompt: QuickPrompt) => {
    setSlashPrompt(prompt)
    setValue('')
    setPromptIndex(0)
    pastedRef.current = false
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const submit = async () => {
    const text = value.trim()
    if (
      (!text && files.attachments.length === 0) ||
      files.pending ||
      files.hasError ||
      streaming ||
      !hydrated ||
      !quickLoaded
    ) {
      return
    }

    const selection = customSelection
    const quickPrompt = slashPrompt
    // A custom selection still needs an instruction. A quick prompt is itself the instruction,
    // so an attached image can be sent with an empty composer.
    if (selection && !text) {
      return
    }

    const prompt = selection
      ? buildCustomSelectionPrompt(text, selection.text)
      : text
    const requestPrompt = quickPrompt
      ? buildSelectionPrompt(quickPrompt.instruction, text)
      : undefined
    const attachments = files.readyAttachments
    setValue('')
    files.commit()
    setRevealed(selection ? true : revealResponse)
    setIgnoredResponseId(null)
    if (!selection) {
      setSelectionContext(null)
      setSelectionReplaceError(null)
    }

    const conversationId = ensureQuickConversation()
    const messageId = await sendMessage(
      prompt,
      conversationId,
      attachments,
      selection?.text ?? (quickPrompt ? text : undefined),
      selection ? selectionAutoSpeak : undefined,
      requestPrompt,
      pastedRef.current,
    )
    pastedRef.current = false
    if (quickPrompt) {
      setSlashPrompt(null)
    }
    if (selection) {
      setCustomSelection(null)
      if (messageId) {
        await saveSelectionProvenance(
          messageId,
          conversationId,
          'custom',
          selection,
        )
      }
    }
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
    const attachments = files.readyAttachments
    const text = [value.trim(), transcript].filter(Boolean).join(' ')

    if (autoSendVoice || forceSend) {
      // Auto-send waits for a transcript: a failed dictation must not send the draft on its own.
      if (!transcript && !forceSend) {
        return
      }
      if (!text && attachments.length === 0) {
        return
      }
      if (files.pending || files.hasError) {
        setValue(text)
        requestAnimationFrame(() => inputRef.current?.focus())
        return
      }

      const selection = customSelection
      const quickPrompt = slashPrompt
      if (selection && !text) {
        return
      }
      const prompt = selection
        ? buildCustomSelectionPrompt(text, selection.text)
        : text
      const requestPrompt = quickPrompt
        ? buildSelectionPrompt(quickPrompt.instruction, text)
        : undefined

      setValue('')
      files.commit()
      setRevealed(selection ? true : revealResponse)
      setIgnoredResponseId(null)
      if (!selection) {
        setSelectionContext(null)
        setSelectionReplaceError(null)
      }

      const conversationId = ensureQuickConversation()
      const messageId = await sendMessage(
        prompt,
        conversationId,
        attachments,
        selection?.text ?? (quickPrompt ? text : undefined),
        selection ? selectionAutoSpeak : undefined,
        requestPrompt,
        pastedRef.current,
      )
      pastedRef.current = false
      if (quickPrompt) {
        setSlashPrompt(null)
      }
      if (selection) {
        setCustomSelection(null)
        if (messageId) {
          await saveSelectionProvenance(
            messageId,
            conversationId,
            'custom',
            selection,
          )
        }
      }
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

  const switchConversation = async (id: string) => {
    setSwitcherOpen(false)
    if (id === quickConversationId) {
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }

    if (isTauri()) {
      void stopSpeaking()
    }
    try {
      // Save the current chat's pending messages before the overlay leaves it.
      await flushChatStorage()
    } catch {
      // Switching still works; the mirror retries on the next change or focus.
    }

    openQuickConversation(id)
    setRevealed(revealResponse)
    setIgnoredResponseId(null)
    setSelectionView(null)
    setSelectionContext(null)
    setCustomSelection(null)
    setSelectionReplaceError(null)
    setSlashPrompt(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const openHistory = () => {
    setSwitcherOpen(false)
    // Keep the history window on the quick conversation when it has content. The overlay and the
    // history window are separate webviews, so the selection is shared through localStorage and
    // an event; changing this window's store alone would not move the other one.
    const target =
      quickConversationId &&
      conversation &&
      !conversation.archivedAt &&
      conversation.messages.length > 0
        ? quickConversationId
        : null

    if (target) {
      selectHistoryConversation(target)
      selectConversation(target)
      if (isTauri()) {
        void emit('history:open-conversation', { conversationId: target })
        // Make sure the new reply and its conversation metadata are in SQLite before the other
        // window hydrates. Without this a very fast double-click can land on an empty page.
        void flushChatStorage().finally(() => {
          void invoke('show_main_window')
        })
        return
      }
    }

    if (isTauri()) {
      void invoke('show_main_window')
      return
    }

    window.location.assign('/')
  }

  const closeSelection = useCallback(() => {
    setSelectionView(null)
    setSelectionContext(null)
    setCustomSelection(null)
    setSelectionReplaceError(null)
    setSlashPrompt(null)
    hide()
  }, [hide])

  const openAccessibilitySettings = useCallback(async () => {
    try {
      await openSelectionSettings()
      hide()
    } catch (error) {
      setSelectionReplaceError(
        error instanceof Error ? error.message : String(error),
      )
    }
  }, [hide])

  const runSelectionAction = async (prompt: QuickPrompt) => {
    if (!selectionView || selectionView.kind !== 'actions') {
      return
    }

    const selection = selectionView
    const selectionPrompt = buildSelectionPrompt(
      prompt.instruction,
      selection.text,
    )
    const attachments = files.readyAttachments
    const hasDraftAttachments = files.attachments.length > 0

    setSelectionView(null)
    setSelectionContext(selection)
    setSelectionReplaceError(null)
    setSlashPrompt(null)

    if (isTauri()) {
      void stopSpeaking()
    }
    forceRevealOnChatChange.current = !hasDraftAttachments
    if (!hasDraftAttachments) {
      resetQuickConversation()
    }
    setValue('')
    setRevealed(true)
    setIgnoredResponseId(null)

    const conversationId = ensureQuickConversation()
    if (hasDraftAttachments) {
      // Commit after the message is created; clear() would delete the attached files.
      files.commit()
    }
    const messageId = await sendMessage(
      selectionPrompt,
      conversationId,
      attachments,
      selection.text,
      selectionAutoSpeak,
    )
    if (messageId) {
      await saveSelectionProvenance(
        messageId,
        conversationId,
        prompt.id,
        selection,
      )
    }
  }

  const startCustomSelection = () => {
    if (!selectionView || selectionView.kind !== 'actions') {
      return
    }

    const selection = selectionView
    const hasDraftAttachments = files.attachments.length > 0
    setSelectionView(null)
    setSelectionContext(selection)
    setCustomSelection(selection)
    setSelectionReplaceError(null)
    setSlashPrompt(null)

    if (isTauri()) {
      void stopSpeaking()
    }
    forceRevealOnChatChange.current = !hasDraftAttachments
    if (!hasDraftAttachments) {
      resetQuickConversation()
    }
    setValue('')
    setRevealed(true)
    setIgnoredResponseId(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const clearCustomSelection = useCallback(() => {
    setCustomSelection(null)
    setSelectionContext(null)
    setSelectionReplaceError(null)
  }, [])

  const pasteWithSelection = async () => {
    if (!selectionContext || !assistant?.content) {
      return
    }

    try {
      if (isTauri()) {
        void stopSpeaking()
      }
      await pasteSelection(assistant.content)
      hide()
    } catch (error) {
      setSelectionReplaceError(
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  const replaceWithSelection = async () => {
    if (!selectionContext || !assistant?.content) {
      return
    }

    try {
      if (isTauri()) {
        void stopSpeaking()
      }
      await replaceSelection(assistant.content)
      setSelectionContext(null)
      hide()
    } catch (error) {
      setSelectionReplaceError(
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  const canRegenerate = Boolean(assistant && !streaming && !isIgnored)

  const regenerateResponse = () => {
    if (!assistant || streaming || isIgnored || !quickConversationId) {
      return
    }

    if (isTauri()) {
      void stopSpeaking()
    }
    void regenerate(
      quickConversationId,
      assistant.id,
      selectionContext ? selectionAutoSpeak : undefined,
    )
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
        {...files.dragHandlers}
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
              {selectionView ? (
                <SelectionPanel
                  panelRef={selectionPanelRef}
                  view={selectionView}
                  onAction={(action) => void runSelectionAction(action)}
                  onCustom={startCustomSelection}
                  onClose={closeSelection}
                  onOpenSettings={() => void openAccessibilitySettings()}
                />
              ) : voiceActive ? (
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
                    <span className="shrink-0" aria-hidden>
                      <IrisBlob
                        activity={speaking ? 'speaking' : 'idle'}
                        emotion={
                          morphing
                            ? 'thinking'
                            : assistant?.status === 'error'
                              ? 'sad'
                              : hasResponse
                                ? 'happy'
                                : 'neutral'
                        }
                        size={24}
                        tone={tone}
                      />
                    </span>

                    <span className="text-[10px] font-semibold tracking-[0.16em] text-foreground/55">
                      IRIS
                    </span>
                    {conversation &&
                    (conversation.messages.length > 0 ||
                      !conversation.messagesLoaded) ? (
                      <>
                        <span
                          aria-hidden
                          className="h-3 w-px shrink-0 bg-foreground/15"
                        />
                        <span
                          className="min-w-0 max-w-[300px] truncate text-[11px] text-foreground/50 transition-colors select-none hover:text-foreground/70"
                          title="Double-click to open in History"
                          onDoubleClick={openHistory}
                        >
                          {conversation.title}
                        </span>
                      </>
                    ) : null}
                    {errorLabel ? (
                      <span className="truncate text-[11px] text-danger/90">
                        {errorLabel}
                      </span>
                    ) : null}

                    <div className="ml-auto flex items-center gap-0.5">
                      {streaming && assistant && !assistant.content ? (
                        <span className="mr-1.5 flex items-center text-[10px] text-foreground/50">
                          <ShimmerText className="font-medium">
                            Thinking
                          </ShimmerText>
                        </span>
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

                      {responseReady && !switcherOpen ? (
                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label="Show response"
                            className="size-7 min-w-7 text-foreground/45"
                            size="sm"
                            variant="ghost"
                            onPress={() => setRevealed(true)}
                          >
                            <ChevronUp className="size-3.5" />
                          </Button>
                          <Tooltip.Content>
                            Show response ·{' '}
                            {formatShortcut(overlayShortcuts.toggleResponse)}
                          </Tooltip.Content>
                        </Tooltip>
                      ) : showResponse && !switcherOpen ? (
                        <Tooltip delay={500}>
                          <Button
                            isIconOnly
                            aria-label="Hide response"
                            className="size-7 min-w-7 text-foreground/45"
                            size="sm"
                            variant="ghost"
                            onPress={() => setRevealed(false)}
                          >
                            <ChevronDown className="size-3.5" />
                          </Button>
                          <Tooltip.Content>
                            Hide response ·{' '}
                            {formatShortcut(overlayShortcuts.toggleResponse)}
                          </Tooltip.Content>
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
                            {capturing ? 'Stop capture' : 'Capture screen'} ·{' '}
                            {formatShortcut(overlayShortcuts.capture)}
                          </Tooltip.Content>
                        </Tooltip>
                      ) : null}

                      <Tooltip delay={500}>
                        <Button
                          isIconOnly
                          aria-label={
                            switcherOpen
                              ? 'Close conversation search'
                              : 'Search conversations'
                          }
                          className={cn(
                            'size-7 min-w-7',
                            switcherOpen
                              ? 'bg-primary/15 text-primary'
                              : 'text-foreground/45',
                          )}
                          size="sm"
                          variant="ghost"
                          onPress={() => {
                            if (switcherOpen) {
                              setSwitcherOpen(false)
                              requestAnimationFrame(() =>
                                inputRef.current?.focus(),
                              )
                            } else {
                              setSwitcherOpen(true)
                            }
                          }}
                        >
                          <Search className="size-3.5" />
                        </Button>
                        <Tooltip.Content>
                          Search conversations ·{' '}
                          {formatShortcut(overlayShortcuts.searchConversations)}
                        </Tooltip.Content>
                      </Tooltip>

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
                        <Tooltip.Content>
                          New chat · {formatShortcut(overlayShortcuts.newChat)}
                        </Tooltip.Content>
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

                  <AnimatePresence initial={false}>
                    {capturePermissionNeeded ? (
                      <motion.div
                        key="capture-permission"
                        animate={{ opacity: 1, height: 'auto' }}
                        className="overflow-hidden"
                        exit={{ opacity: 0, height: 0 }}
                        initial={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                      >
                        <PermissionNotice
                          className="mx-3 mb-1"
                          message="Screen Recording is off. Enable Iris in System Settings → Privacy & Security → Screen Recording, then restart Iris."
                          onDismiss={() => setCapturePermissionNeeded(false)}
                          onOpenSettings={() => void openScreenSettings()}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  <AnimatePresence initial={false}>
                    {switcherOpen ? (
                      <motion.div
                        key="conversation-switcher"
                        animate={{ opacity: 1, y: 0 }}
                        className="px-3 pb-1"
                        exit={{ opacity: 0, y: -6 }}
                        initial={{ opacity: 0, y: 8 }}
                        transition={contentSpring}
                      >
                        <ConversationSwitcher
                          conversations={conversations}
                          currentId={quickConversationId}
                          focusNonce={switcherFocusNonce}
                          onClose={() => {
                            setSwitcherOpen(false)
                            requestAnimationFrame(() =>
                              inputRef.current?.focus(),
                            )
                          }}
                          onSelect={(id) => void switchConversation(id)}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  {showResponse && !switcherOpen ? (
                    <div className="iris-response px-5 pb-2 pt-1.5">
                      <div
                        aria-live="polite"
                        className="max-h-[320px] overflow-y-auto"
                      >
                        {assistant?.status === 'error' ? (
                          apiKeyMissing ? (
                            <button
                              type="button"
                              className="group inline-flex max-w-full items-center gap-1 text-left text-[13px] leading-6 text-danger transition-colors hover:text-danger/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
                              onClick={() => void openSettings('api')}
                            >
                              <span className="min-w-0 underline decoration-danger/35 underline-offset-2 transition-colors group-hover:decoration-danger/70">
                                {assistant.error ??
                                  'Add your API key in Settings.'}
                              </span>
                              <ArrowUpRight className="size-3.5 shrink-0" />
                            </button>
                          ) : (
                            <p className="text-[13px] leading-6 text-danger">
                              {assistant.error ??
                                'Iris could not finish that response. Try again in a moment.'}
                            </p>
                          )
                        ) : assistant?.content ? (
                          <Markdown>{assistant.content}</Markdown>
                        ) : null}
                      </div>

                      <div className="mt-1 flex items-center gap-0.5">
                        {assistant?.metadata?.stopped ? (
                          <span className="pr-1 text-[10px] text-muted/60">
                            Stopped
                          </span>
                        ) : null}
                        {assistant?.content ? (
                          <CopyButton
                            className="size-7 min-w-7 text-foreground/45"
                            text={assistant.content}
                          />
                        ) : null}
                        {assistant?.content && quickConversationId ? (
                          <ReadAloudButton
                            className="size-7 min-w-7 text-foreground/45"
                            conversationId={quickConversationId}
                            text={assistant.content}
                          />
                        ) : null}
                        {canRegenerate ? (
                          <Tooltip delay={500}>
                            <Button
                              isIconOnly
                              aria-label="Regenerate response"
                              className="size-7 min-w-7 text-foreground/45"
                              size="sm"
                              variant="ghost"
                              onPress={regenerateResponse}
                            >
                              <RotateCcw className="size-3.5" />
                            </Button>
                            <Tooltip.Content>Regenerate</Tooltip.Content>
                          </Tooltip>
                        ) : null}
                        {selectionContext &&
                        assistant?.content &&
                        assistant.status === 'complete' ? (
                          <>
                            <Tooltip delay={500}>
                              <Button
                                isIconOnly
                                aria-label={`Paste into ${selectionContext.appName}`}
                                className="size-7 min-w-7 text-foreground/45"
                                size="sm"
                                variant="ghost"
                                onPress={() => void pasteWithSelection()}
                              >
                                <ClipboardPaste className="size-3.5" />
                              </Button>
                              <Tooltip.Content>
                                Paste into {selectionContext.appName}
                              </Tooltip.Content>
                            </Tooltip>
                            <Tooltip delay={500}>
                              <Button
                                isIconOnly
                                aria-label={`Replace selection in ${selectionContext.appName}`}
                                className="size-7 min-w-7 text-foreground/45"
                                size="sm"
                                variant="ghost"
                                onPress={() => void replaceWithSelection()}
                              >
                                <Replace className="size-3.5" />
                              </Button>
                              <Tooltip.Content>
                                Replace selection in {selectionContext.appName}
                              </Tooltip.Content>
                            </Tooltip>
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div
                    className={cn(
                      'px-3',
                      hasResponse
                        ? 'border-t border-foreground/[0.06] pt-1.5 pb-2.5'
                        : 'pt-1 pb-2.5',
                      files.dragging && 'bg-foreground/[0.03]',
                    )}
                    data-tauri-drag-region="deep"
                  >
                    {customSelection ? (
                      <div className="mb-2 flex items-center gap-2 rounded-xl border border-border/50 bg-surface/45 px-2.5 py-1.5 text-[11px] leading-4">
                        <Sparkles className="size-3.5 shrink-0 text-primary" />
                        <span className="shrink-0 text-muted">
                          Selected from {customSelection.appName}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-foreground/55">
                          “{customSelection.text}”
                        </span>
                        <Button
                          isIconOnly
                          aria-label="Clear selected text"
                          className="size-6 min-w-6 shrink-0 text-foreground/45"
                          size="sm"
                          variant="ghost"
                          onPress={clearCustomSelection}
                        >
                          <X className="size-3" />
                        </Button>
                      </div>
                    ) : null}
                    {slashOpen ? (
                      <QuickPromptMenu
                        activeIndex={activePromptIndex}
                        prompts={slashMatches}
                        onSelect={chooseSlashPrompt}
                      />
                    ) : null}
                    {slashPrompt ? (
                      <QuickPromptChip
                        prompt={slashPrompt}
                        onClear={() => setSlashPrompt(null)}
                      />
                    ) : null}
                    <AttachmentStrip
                      attachments={files.attachments}
                      className="pb-2"
                      compact
                      conversationId={quickConversationId}
                      error={files.error}
                      onDismissError={files.clearError}
                      onRemove={files.remove}
                      onRetry={files.retry}
                    />

                    <div className="flex items-end gap-1.5">
                      <div className="pb-1.5">
                        <ThinkingEffort />
                      </div>

                      <TextArea
                        {...NO_WRITING_ASSIST}
                        ref={inputRef}
                        aria-label="Ask Iris"
                        className="max-h-[120px] min-h-10 w-full resize-none border-0 bg-transparent pr-1 pl-0.5 py-2 text-[15px] leading-6 text-foreground shadow-none placeholder:text-foreground/35 focus-visible:ring-0"
                        placeholder={
                          customSelection
                            ? 'Tell Iris what to do with the selection…'
                            : slashPrompt
                              ? files.readyAttachments.length > 0
                                ? `Press Enter to run ${slashPrompt.name} on the attachment…`
                                : `Type or paste text to ${slashPrompt.name.toLowerCase()}…`
                              : hasResponse
                                ? 'Ask a follow-up…'
                                : 'Ask Iris anything…'
                        }
                        rows={1}
                        value={value}
                        variant="secondary"
                        onChange={(event) => {
                          setValue(event.target.value)
                          setPromptIndex(0)
                          if (!event.target.value) {
                            pastedRef.current = false
                          }
                        }}
                        onFocus={() => setSwitcherOpen(false)}
                        onPaste={(event) => {
                          if (
                            event.clipboardData.getData('text/plain').trim()
                          ) {
                            pastedRef.current = true
                          }
                        }}
                        onKeyDown={(event) => {
                          if (slashOpen) {
                            if (event.key === 'ArrowDown') {
                              event.preventDefault()
                              setPromptIndex((index) =>
                                slashMatches.length === 0
                                  ? 0
                                  : (index + 1) % slashMatches.length,
                              )
                              return
                            }
                            if (event.key === 'ArrowUp') {
                              event.preventDefault()
                              setPromptIndex((index) =>
                                slashMatches.length === 0
                                  ? 0
                                  : (index - 1 + slashMatches.length) %
                                    slashMatches.length,
                              )
                              return
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              event.stopPropagation()
                              setValue('')
                              setPromptIndex(0)
                              return
                            }
                            if (
                              event.key === 'Enter' &&
                              !event.shiftKey &&
                              !event.nativeEvent.isComposing
                            ) {
                              event.preventDefault()
                              const prompt = slashMatches[activePromptIndex]
                              if (prompt) {
                                chooseSlashPrompt(prompt)
                              }
                              return
                            }
                          }

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
                          <Tooltip.Content>
                            Voice input ·{' '}
                            {formatShortcut(overlayShortcuts.voiceInput)}
                          </Tooltip.Content>
                        </Tooltip>

                        <SendButton
                          isDisabled={
                            streaming ||
                            slashOpen ||
                            !hydrated ||
                            !quickLoaded ||
                            files.pending ||
                            files.hasError ||
                            (Boolean(customSelection) && !value.trim()) ||
                            (Boolean(slashPrompt) &&
                              !value.trim() &&
                              files.attachments.length === 0) ||
                            (!value.trim() && files.attachments.length === 0)
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

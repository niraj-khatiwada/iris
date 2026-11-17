import { Button, TextArea, Tooltip } from '@heroui/react'
import { Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import AttachmentStrip from '@/components/AttachmentStrip'
import ChatToggles from '@/components/ChatToggles'
import SendButton from '@/components/SendButton'
import SpeechControl from '@/components/SpeechControl'
import { NO_WRITING_ASSIST } from '@/constants'
import { useAttachments } from '@/hooks/useAttachments'
import { useSpeechPlayback } from '@/hooks/useSpeechPlayback'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { cn } from '@/utils/tailwind'

function Composer() {
  const [value, setValue] = useState('')
  useSpeechPlayback()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const hydrated = useChatStore((state) => state.hydrated)
  const activeConversation = useChatStore((state) =>
    state.conversations.find((item) => item.id === state.activeConversationId),
  )
  const conversationReady = activeConversation?.messagesLoaded ?? true
  const stopStreaming = useChatStore((state) => state.stopStreaming)
  const streaming = useChatStore((state) => Boolean(state.streamingRequestId))
  const focusToken = useUIStore((state) => state.composerFocusToken)
  const activeConversationId = useChatStore(
    (state) => state.activeConversationId,
  )
  const createConversation = useChatStore((state) => state.createConversation)
  const files = useAttachments({
    conversationId: activeConversationId,
    createConversation,
  })

  useEffect(() => {
    if (focusToken > 0) {
      textareaRef.current?.focus()
    }
  }, [focusToken])

  // Attachments are a draft for the conversation they were pasted into. Keep the draft when the
  // hook creates the first conversation for an attachment; only a switch between existing
  // conversations discards it.
  const previousConversationId = useRef(activeConversationId)
  useEffect(() => {
    const previous = previousConversationId.current
    if (previous === activeConversationId) {
      return
    }
    previousConversationId.current = activeConversationId
    if (previous !== null) {
      files.clear()
    }
  }, [activeConversationId, files.clear])

  // biome-ignore lint/correctness/useExhaustiveDependencies: resizing follows the controlled value
  useEffect(() => {
    const element = textareaRef.current
    if (!element) {
      return
    }

    element.style.height = '0px'
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`
  }, [value])

  const submit = () => {
    const text = value.trim()
    if (
      (!text && files.attachments.length === 0) ||
      files.pending ||
      files.hasError ||
      streaming ||
      !hydrated ||
      !conversationReady
    ) {
      return
    }

    const attachments = files.readyAttachments
    setValue('')
    files.commit()
    void sendMessage(text, undefined, attachments)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-6 pt-2">
      <div
        className={cn(
          'glass-control rounded-3xl p-2 transition-colors focus-within:border-accent/40',
          files.dragging && 'border-accent/50',
        )}
        {...files.dragHandlers}
      >
        <AttachmentStrip
          attachments={files.attachments}
          className="px-2 pt-1.5"
          error={files.error}
          onDismissError={files.clearError}
          onRemove={files.remove}
          onRetry={files.retry}
        />

        <div className="flex items-end gap-2 px-1.5">
          <div className="pb-2">
            <ChatToggles />
          </div>

          <TextArea
            {...NO_WRITING_ASSIST}
            ref={textareaRef}
            aria-label="Message Iris"
            className="max-h-44 min-h-11 w-full resize-none border-0 bg-transparent px-1 py-2.5 text-[15px] leading-6 shadow-none focus-visible:ring-0"
            placeholder="Message Iris…"
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

          <div className="flex shrink-0 items-center gap-1 pb-1">
            <SpeechControl />

            <Tooltip delay={400}>
              <Button
                isIconOnly
                isDisabled
                aria-label="Voice input is available in Quick chat"
                size="sm"
                variant="ghost"
              >
                <Mic className="size-4" />
              </Button>
              <Tooltip.Content>
                Voice input is available in Quick chat
              </Tooltip.Content>
            </Tooltip>

            {streaming ? (
              <Tooltip delay={400}>
                <Button
                  isIconOnly
                  aria-label="Stop responding"
                  size="sm"
                  variant="danger-soft"
                  onPress={() => void stopStreaming()}
                >
                  <Square className="size-3.5 fill-current" />
                </Button>
                <Tooltip.Content>Stop</Tooltip.Content>
              </Tooltip>
            ) : (
              <SendButton
                isDisabled={
                  !hydrated ||
                  !conversationReady ||
                  files.pending ||
                  files.hasError ||
                  (!value.trim() && files.attachments.length === 0)
                }
                onPress={submit}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

Composer.displayName = 'Composer'

export default Composer

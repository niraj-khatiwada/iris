import { Button, TextArea, Tooltip } from '@heroui/react'
import { ArrowUp, Mic, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import ChatToggles from '@/components/ChatToggles'
import { useChatStore } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'

function Composer() {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const stopStreaming = useChatStore((state) => state.stopStreaming)
  const streaming = useChatStore((state) => Boolean(state.streamingRequestId))
  const focusToken = useUIStore((state) => state.composerFocusToken)

  useEffect(() => {
    if (focusToken > 0) {
      textareaRef.current?.focus()
    }
  }, [focusToken])

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
    if (!text || streaming) {
      return
    }

    setValue('')
    void sendMessage(text)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-6 pt-2">
      <div className="glass-control rounded-3xl p-2 transition-colors focus-within:border-accent/40">
        <div className="flex items-end gap-2 px-1.5">
          <div className="pb-1.5">
            <ChatToggles />
          </div>

          <TextArea
            ref={textareaRef}
            aria-label="Message Iris"
            className="max-h-44 min-h-11 w-full resize-none border-0 bg-transparent px-1 py-2 text-[15px] leading-6 shadow-none focus-visible:ring-0"
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
              <Button
                isIconOnly
                aria-label="Send message"
                isDisabled={!value.trim()}
                size="sm"
                onPress={submit}
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

Composer.displayName = 'Composer'

export default Composer

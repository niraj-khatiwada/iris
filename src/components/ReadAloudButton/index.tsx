import { Button, Tooltip } from '@heroui/react'
import { Square, Volume2 } from 'lucide-react'

import { useSettingsStore } from '@/stores/settingsStore'
import { useSpeechStore } from '@/stores/speechStore'
import { speakText, stopSpeaking } from '@/tauri/commands/voice'
import { formatShortcut } from '@/utils/shortcut'
import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'

type ReadAloudButtonProps = {
  conversationId: string
  text: string
  className?: string
}

/**
 * Manual read-aloud. Automatic playback stays backend-owned; this button asks Rust to speak one
 * specific reply, so any completed message can be heard without regenerating it.
 */
function ReadAloudButton({
  conversationId,
  text,
  className,
}: ReadAloudButtonProps) {
  const activeConversationId = useSpeechStore((state) => state.conversationId)
  const stopShortcut = useSettingsStore(
    (state) => state.overlayShortcuts.stopSpeaking,
  )
  const playing = useSpeechStore((state) => state.preparing || state.speaking)
  // Read-aloud is conversation-scoped in the backend. While this conversation is being prepared
  // or played, the button is a Stop control; clicking again must not restart the same audio.
  const active = playing && activeConversationId === conversationId

  const read = async () => {
    if (!isTauri() || !text.trim()) {
      return
    }

    const { baseUrl, ttsVoice } = useSettingsStore.getState()

    try {
      await speakText({
        conversationId,
        text,
        baseUrl,
        voice: ttsVoice,
      })
    } catch (error) {
      // The overlay shows speech errors in its banner; keep the reason in the shared store.
      useSpeechStore.setState({
        conversationId: null,
        preparing: false,
        speaking: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const stop = async () => {
    if (!isTauri()) {
      return
    }

    await stopSpeaking()
  }

  return (
    <Tooltip delay={400}>
      <Button
        isIconOnly
        aria-label={active ? 'Stop reading aloud' : 'Read aloud'}
        className={cn('size-6 min-w-6 text-muted', className)}
        size="sm"
        variant="ghost"
        onPress={() => void (active ? stop() : read())}
      >
        {active ? (
          <Square className="size-3 fill-current" />
        ) : (
          <Volume2 className="size-3.5" />
        )}
      </Button>
      <Tooltip.Content>
        {active
          ? `Stop reading aloud · ${formatShortcut(stopShortcut)}`
          : 'Read aloud'}
      </Tooltip.Content>
    </Tooltip>
  )
}

ReadAloudButton.displayName = 'ReadAloudButton'

export default ReadAloudButton

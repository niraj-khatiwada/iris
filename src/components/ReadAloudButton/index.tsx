import { Button, Tooltip } from '@heroui/react'
import { Volume2 } from 'lucide-react'

import { useSettingsStore } from '@/stores/settingsStore'
import { useSpeechStore } from '@/stores/speechStore'
import { speakText } from '@/tauri/commands/voice'
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

  return (
    <Tooltip delay={400}>
      <Button
        isIconOnly
        aria-label="Read aloud"
        className={cn('size-6 min-w-6 text-muted', className)}
        size="sm"
        variant="ghost"
        onPress={() => void read()}
      >
        <Volume2 className="size-3.5" />
      </Button>
      <Tooltip.Content>Read aloud</Tooltip.Content>
    </Tooltip>
  )
}

ReadAloudButton.displayName = 'ReadAloudButton'

export default ReadAloudButton

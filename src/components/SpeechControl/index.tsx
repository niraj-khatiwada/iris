import { Button, Tooltip } from '@heroui/react'
import { LoaderCircle, Square } from 'lucide-react'

import VoiceWave from '@/components/VoiceWave'
import { useSettingsStore } from '@/stores/settingsStore'
import { useSpeechStore } from '@/stores/speechStore'
import { stopSpeaking } from '@/tauri/commands/voice'
import { formatShortcut } from '@/utils/shortcut'
import { cn } from '@/utils/tailwind'

/**
 * Read-aloud indicator for the composer. It sits beside the mic so Stop is always in the same
 * place, whichever conversation is on screen: only one reply is ever spoken at a time.
 */
function SpeechControl({ className }: { className?: string }) {
  const preparing = useSpeechStore((state) => state.preparing)
  const speaking = useSpeechStore((state) => state.speaking)
  const stopShortcut = useSettingsStore(
    (state) => state.overlayShortcuts.stopSpeaking,
  )

  if (!preparing && !speaking) {
    return null
  }

  return (
    <span className={cn('flex items-center gap-1', className)}>
      {preparing ? (
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <LoaderCircle className="size-3 animate-spin" />
          Preparing audio…
        </span>
      ) : (
        <>
          <VoiceWave active compact className="w-16" tone="speaking" />
          <span className="sr-only">Reading aloud</span>
        </>
      )}

      <Tooltip delay={400}>
        <Button
          isIconOnly
          aria-label="Stop reading aloud"
          className="size-7 min-w-7 text-muted"
          size="sm"
          variant="ghost"
          onPress={() => void stopSpeaking()}
        >
          <Square className="size-3 fill-current" />
        </Button>
        <Tooltip.Content>
          Stop reading aloud · {formatShortcut(stopShortcut)}
        </Tooltip.Content>
      </Tooltip>
    </span>
  )
}

SpeechControl.displayName = 'SpeechControl'

export default SpeechControl

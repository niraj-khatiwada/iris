import { Button } from '@heroui/react'
import { LoaderCircle, Square, X } from 'lucide-react'

import IrisBlob from '@/components/IrisBlob'
import VoiceWave from '@/components/VoiceWave'
import { cn } from '@/utils/tailwind'

type VoiceStripProps = {
  mode: 'listening' | 'transcribing' | 'speaking'
  analyser?: AnalyserNode | null
  onStop: () => void
  className?: string
}

/** The compact voice row: Iris on the left, live waves, and a stop control on the right. */
function VoiceStrip({
  mode,
  analyser = null,
  onStop,
  className,
}: VoiceStripProps) {
  const listening = mode === 'listening'
  const speaking = mode === 'speaking'
  const label =
    mode === 'listening'
      ? 'Listening'
      : mode === 'speaking'
        ? 'Speaking'
        : 'Transcribing'

  return (
    <div className={cn('flex items-center gap-3 px-4 py-3', className)}>
      <IrisBlob
        activity={listening ? 'listening' : speaking ? 'speaking' : 'idle'}
        emotion={mode === 'transcribing' ? 'thinking' : 'happy'}
        size={speaking ? 32 : 38}
      />

      <div className="min-w-0 flex-1">
        {mode === 'transcribing' ? (
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <LoaderCircle className="size-3 animate-spin" />
            Transcribing…
          </div>
        ) : (
          <VoiceWave analyser={analyser} active />
        )}
      </div>

      <span aria-live="polite" className="sr-only">
        {label}
      </span>

      {speaking ? (
        <span className="text-[10px] tracking-[0.12em] text-muted uppercase">
          Speaking
        </span>
      ) : null}

      <Button
        isIconOnly
        aria-label={
          mode === 'transcribing'
            ? 'Cancel transcription'
            : listening
              ? 'Stop listening'
              : 'Stop speaking'
        }
        className="size-8 min-w-8 rounded-full border border-foreground/10 bg-foreground/[0.06] text-foreground/65 hover:bg-foreground/[0.12] hover:text-foreground"
        size="sm"
        variant="ghost"
        onPress={onStop}
      >
        {mode === 'transcribing' ? (
          <X className="size-3.5" />
        ) : (
          <Square className="size-3 fill-current" />
        )}
      </Button>
    </div>
  )
}

VoiceStrip.displayName = 'VoiceStrip'

export default VoiceStrip

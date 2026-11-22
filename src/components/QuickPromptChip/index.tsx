import { Button } from '@heroui/react'
import { X } from 'lucide-react'

import type { QuickPrompt } from '@/types/settings'
import { getQuickPromptIcon } from '@/utils/quickPrompts'

type QuickPromptChipProps = {
  prompt: QuickPrompt
  onClear: () => void
}

/** The pending quick prompt shown above the composer until the message is sent. */
function QuickPromptChip({ prompt, onClear }: QuickPromptChipProps) {
  const Icon = getQuickPromptIcon(prompt.icon)

  return (
    <div className="mb-2 flex items-center gap-2 rounded-xl border border-border/50 bg-surface/45 px-2.5 py-1.5 text-[11px] leading-4">
      <Icon className="size-3.5 shrink-0 text-primary" />
      <span className="shrink-0 font-medium">{prompt.name}</span>
      <span className="shrink-0 text-muted">Quick prompt</span>
      <span className="min-w-0 flex-1 truncate text-foreground/55">
        {prompt.instruction}
      </span>
      <Button
        isIconOnly
        aria-label="Clear quick prompt"
        className="size-6 min-w-6 shrink-0 text-foreground/45"
        size="sm"
        variant="ghost"
        onPress={onClear}
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}

QuickPromptChip.displayName = 'QuickPromptChip'

export default QuickPromptChip

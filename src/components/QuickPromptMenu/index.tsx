import { CornerDownLeft } from 'lucide-react'

import type { QuickPrompt } from '@/types/settings'
import { getQuickPromptIcon } from '@/utils/quickPrompts'
import { cn } from '@/utils/tailwind'

type QuickPromptMenuProps = {
  prompts: QuickPrompt[]
  activeIndex: number
  onSelect: (prompt: QuickPrompt) => void
}

/** The `/` menu shared by the quick overlay and the history composer. */
function QuickPromptMenu({
  prompts,
  activeIndex,
  onSelect,
}: QuickPromptMenuProps) {
  return (
    <div className="mb-2 overflow-hidden rounded-2xl border border-border/50 bg-surface/65 shadow-lg backdrop-blur-xl">
      <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
        <span className="text-[10px] font-medium tracking-[0.12em] text-muted uppercase">
          Quick prompts
        </span>
        <span className="text-[10px] text-muted/70">
          {prompts.length} available
        </span>
      </div>

      <div className="max-h-[220px] overflow-y-auto px-1 pb-1" role="listbox">
        {prompts.map((prompt, index) => {
          const Icon = getQuickPromptIcon(prompt.icon)
          const active = index === activeIndex

          return (
            <button
              key={prompt.id}
              type="button"
              role="option"
              aria-selected={active}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors',
                active ? 'bg-foreground/10' : 'hover:bg-foreground/5',
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(prompt)}
            >
              <Icon className="size-3.5 shrink-0 text-muted" />
              <span className="shrink-0 text-[12px] font-medium">
                {prompt.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                {prompt.instruction}
              </span>
              {active ? (
                <CornerDownLeft className="size-3 shrink-0 text-muted/70" />
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-3 border-t border-border/40 px-2.5 py-1.5 text-[10px] text-muted/70">
        <span>↑↓ navigate</span>
        <span>↵ apply</span>
        <span>esc dismiss</span>
      </div>
    </div>
  )
}

QuickPromptMenu.displayName = 'QuickPromptMenu'

export default QuickPromptMenu

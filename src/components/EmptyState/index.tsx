import { Brain, CalendarClock, PenLine, Timer } from 'lucide-react'

import IrisBlob from '@/components/IrisBlob'
import { SUGGESTIONS } from '@/constants'
import { useChatStore } from '@/stores/chatStore'
import { greeting } from '@/utils/format'

const suggestionIcons = {
  plan: CalendarClock,
  write: PenLine,
  think: Brain,
  focus: Timer,
} as const

function EmptyState() {
  const sendMessage = useChatStore((state) => state.sendMessage)

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 pb-6">
      <IrisBlob emotion="happy" size={76} />
      <h2 className="mt-8 text-center text-3xl font-semibold tracking-tight text-balance">
        {greeting()}
      </h2>
      <p className="mt-2 max-w-md text-center text-sm leading-6 text-muted text-pretty">
        I&apos;m here on your desktop, ready when you are. What should we work
        on?
      </p>

      <div className="mt-8 grid w-full max-w-2xl grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => {
          const Icon = suggestionIcons[suggestion.id]

          return (
            <button
              key={suggestion.id}
              type="button"
              className="group flex flex-col gap-2 rounded-2xl border border-border/50 bg-surface/20 p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl transition duration-200 hover:border-accent/40 hover:bg-surface/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              onClick={() => void sendMessage(suggestion.prompt)}
            >
              <span className="flex size-7 items-center justify-center rounded-lg bg-accent-soft text-accent-soft-foreground">
                <Icon className="size-3.5" />
              </span>
              <span className="text-[13px] font-medium">
                {suggestion.title}
              </span>
              <span className="text-xs leading-5 text-muted">
                {suggestion.description}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-8 flex items-center gap-3 text-[10px] text-muted/70">
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-border/60 bg-surface/50 px-1.5 py-0.5">
            /
          </kbd>
          focus
        </span>
        <span className="size-0.5 rounded-full bg-muted/40" />
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-border/60 bg-surface/50 px-1.5 py-0.5">
            ⌘
          </kbd>
          <kbd className="rounded border border-border/60 bg-surface/50 px-1.5 py-0.5">
            N
          </kbd>
          new chat
        </span>
      </div>
    </div>
  )
}

EmptyState.displayName = 'EmptyState'

export default EmptyState

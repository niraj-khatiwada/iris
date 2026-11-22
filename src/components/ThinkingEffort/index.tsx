import { Button, Tooltip } from '@heroui/react'
import { Brain, RotateCw } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { useSettingsStore } from '@/stores/settingsStore'
import type { ThinkingEffort as Effort } from '@/types/settings'

const OPTIONS: Array<{
  id: Effort
  label: string
}> = [
  { id: 'low', label: 'Low' },
  { id: 'high', label: 'High' },
  { id: 'max', label: 'Max' },
]

/**
 * Thinking is always enabled; this chip cycles through how much effort the model spends before
 * answering. Shared by the quick overlay and the history composer.
 */
function ThinkingEffort() {
  const thinkingEffort = useSettingsStore((state) => state.thinkingEffort)
  const setThinkingEffort = useSettingsStore((state) => state.setThinkingEffort)
  const reduceMotion = useReducedMotion()
  const current =
    OPTIONS.find((option) => option.id === thinkingEffort) ?? OPTIONS[0]

  const cycle = () => {
    const index = OPTIONS.findIndex((option) => option.id === thinkingEffort)
    setThinkingEffort(OPTIONS[(index + 1) % OPTIONS.length].id)
  }

  return (
    <Tooltip delay={500}>
      <Button
        aria-label={`Thinking effort: ${current.label}. Click to cycle Low, High, Max.`}
        className="h-6 gap-1 rounded-full px-1.5 text-[10px] text-foreground/55"
        size="sm"
        variant="ghost"
        onPress={cycle}
      >
        <Brain className="size-3 text-primary/80" />
        <span
          aria-live="polite"
          className="relative block h-4 w-8 overflow-hidden text-center"
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={current.id}
              animate={{ y: 0, opacity: 1 }}
              className="absolute inset-0 flex items-center justify-center font-medium"
              exit={reduceMotion ? { opacity: 0 } : { y: -7, opacity: 0 }}
              initial={reduceMotion ? { opacity: 1 } : { y: 7, opacity: 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : {
                      type: 'spring',
                      stiffness: 520,
                      damping: 32,
                      mass: 0.5,
                    }
              }
            >
              {current.label}
            </motion.span>
          </AnimatePresence>
        </span>
        <RotateCw className="size-2.5 text-muted/60" />
      </Button>
      <Tooltip.Content>
        Thinking effort: {current.label}
        <span className="mt-0.5 block text-[11px] text-muted">
          Click to cycle Low → High → Max
        </span>
      </Tooltip.Content>
    </Tooltip>
  )
}

ThinkingEffort.displayName = 'ThinkingEffort'

export default ThinkingEffort

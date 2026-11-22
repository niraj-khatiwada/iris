import { Button, Dropdown, Label } from '@heroui/react'
import { Brain, ChevronDown } from 'lucide-react'

import { useSettingsStore } from '@/stores/settingsStore'
import type { ThinkingEffort as Effort } from '@/types/settings'

const OPTIONS: Array<{
  id: Effort
  label: string
  description: string
}> = [
  {
    id: 'low',
    label: 'Low',
    description: 'Fast, light reasoning',
  },
  {
    id: 'high',
    label: 'High',
    description: 'More reasoning for complex work',
  },
  {
    id: 'max',
    label: 'Max',
    description: 'Deepest reasoning',
  },
]

/**
 * Thinking is always enabled; this picks how much effort the model spends before answering.
 * Shared by the quick overlay and the history composer.
 */
function ThinkingEffort() {
  const thinkingEffort = useSettingsStore((state) => state.thinkingEffort)
  const setThinkingEffort = useSettingsStore((state) => state.setThinkingEffort)
  const current =
    OPTIONS.find((option) => option.id === thinkingEffort) ?? OPTIONS[0]

  return (
    <Dropdown>
      <Button
        aria-label={`Thinking effort: ${current.label}`}
        className="h-7 gap-1.5 rounded-full px-2 text-[11px] text-foreground/55"
        size="sm"
        variant="ghost"
      >
        <Brain className="size-3.5 text-primary/80" />
        <span className="font-medium">{current.label}</span>
        <ChevronDown className="size-3 text-muted/70" />
      </Button>
      <Dropdown.Popover className="min-w-48 rounded-lg" placement="top start">
        <Dropdown.Menu
          aria-label="Thinking effort"
          selectedKeys={[thinkingEffort]}
          selectionMode="single"
          onAction={(key) => {
            if (key === 'low' || key === 'high' || key === 'max') {
              setThinkingEffort(key)
            }
          }}
        >
          {OPTIONS.map((option) => (
            <Dropdown.Item
              key={option.id}
              className="rounded-md"
              id={option.id}
              textValue={option.label}
            >
              <span className="flex min-w-0 flex-col">
                <Label>{option.label}</Label>
                <span className="text-[11px] leading-4 text-muted">
                  {option.description}
                </span>
              </span>
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

ThinkingEffort.displayName = 'ThinkingEffort'

export default ThinkingEffort

import { Button, Dropdown } from '@heroui/react'
import { Brain, ChevronDown } from 'lucide-react'

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
        className="h-6 gap-1 rounded-full px-1.5 text-[10px] text-foreground/55"
        size="sm"
        variant="ghost"
      >
        <Brain className="size-3 text-primary/80" />
        <span className="font-medium">{current.label}</span>
        <ChevronDown className="size-2.5 text-muted/70" />
      </Button>
      <Dropdown.Popover className="min-w-28 rounded-lg" placement="top start">
        <Dropdown.Menu
          aria-label="Thinking effort"
          className="p-1"
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
              className="h-6 min-h-6 rounded-md px-1.5 text-[10px]"
              id={option.id}
              textValue={option.label}
            >
              <span className="flex-1">{option.label}</span>
              <Dropdown.ItemIndicator className="size-3" />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  )
}

ThinkingEffort.displayName = 'ThinkingEffort'

export default ThinkingEffort

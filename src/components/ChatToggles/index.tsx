import { Button, Tooltip } from '@heroui/react'
import { Brain, Globe } from 'lucide-react'

import { useSettingsStore } from '@/stores/settingsStore'
import { cn } from '@/utils/tailwind'

/**
 * Thinking mode and Search toggles shared by the quick overlay and the history composer.
 * Both settings apply to the next request; they never rewrite the conversation.
 */
function ChatToggles({
  shortcutHints,
}: {
  /** Formatted overlay-only shortcut labels; the history composer has no local shortcuts. */
  shortcutHints?: { webSearch: string; deepThink: string }
}) {
  const deepThink = useSettingsStore((state) => state.deepThink)
  const webSearch = useSettingsStore((state) => state.webSearch)
  const setDeepThink = useSettingsStore((state) => state.setDeepThink)
  const setWebSearch = useSettingsStore((state) => state.setWebSearch)

  const searchHint = shortcutHints ? ` · ${shortcutHints.webSearch}` : ''
  const thinkHint = shortcutHints ? ` · ${shortcutHints.deepThink}` : ''

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Tooltip delay={500}>
        <Button
          isIconOnly
          aria-label="Search the web"
          aria-pressed={webSearch}
          className={cn(
            'size-7 min-w-7 rounded-full',
            webSearch ? 'bg-primary/15 text-primary' : 'text-muted',
          )}
          size="sm"
          variant="ghost"
          onPress={() => setWebSearch(!webSearch)}
        >
          <Globe className="size-3.5" />
        </Button>
        <Tooltip.Content>
          {webSearch
            ? 'Search on · looks things up when needed'
            : 'Search off · answers from its own knowledge'}
          {searchHint}
        </Tooltip.Content>
      </Tooltip>

      <Tooltip delay={500}>
        <Button
          isIconOnly
          aria-label="Thinking mode"
          aria-pressed={deepThink}
          className={cn(
            'size-7 min-w-7 rounded-full',
            deepThink ? 'bg-primary/15 text-primary' : 'text-muted',
          )}
          size="sm"
          variant="ghost"
          onPress={() => setDeepThink(!deepThink)}
        >
          <Brain className="size-3.5" />
        </Button>
        <Tooltip.Content>
          {deepThink
            ? 'Thinking on · thinks before answering'
            : 'Thinking off · answers directly'}
          {thinkHint}
        </Tooltip.Content>
      </Tooltip>
    </div>
  )
}

ChatToggles.displayName = 'ChatToggles'

export default ChatToggles

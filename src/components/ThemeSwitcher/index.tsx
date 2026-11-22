import { Tooltip } from '@heroui/react'
import { Moon, Sun } from 'lucide-react'

import Button from '@/components/Button'
import { useSettingsStore } from '@/stores/settingsStore'
import { resolveTheme } from '@/utils/theme'

function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const theme = useSettingsStore((state) => state.theme)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const isDark = resolveTheme(theme) === 'dark'

  return (
    <Tooltip delay={400}>
      <Button
        isIconOnly
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        className={compact ? 'size-6 min-w-6' : 'size-8 min-w-8'}
        size="sm"
        variant="ghost"
        onPress={() => setTheme(isDark ? 'light' : 'dark')}
      >
        {isDark ? (
          <Sun className={compact ? 'size-3.5' : 'size-4'} />
        ) : (
          <Moon className={compact ? 'size-3.5' : 'size-4'} />
        )}
      </Button>
      <Tooltip.Content>{isDark ? 'Light mode' : 'Dark mode'}</Tooltip.Content>
    </Tooltip>
  )
}

ThemeSwitcher.displayName = 'ThemeSwitcher'

export default ThemeSwitcher

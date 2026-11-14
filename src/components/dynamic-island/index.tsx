import type { ReactNode } from 'react'

import AgentActivity from '@/components/dynamic-island/agent-activity'
import { useResolvedTheme } from '@/hooks/useResolvedTheme'
import { Island, IslandProvider } from '@/lib/island'

type DynamicIslandProps = {
  children: ReactNode
}

/**
 * The app's Dynamic Island: one provider, one pill, and the activities the app owns.
 *
 * HeroUI remains the app's design system. islandcn is a self-contained system layer with its
 * own black hardware look, so the two never need to share components or tokens.
 */
export function DynamicIsland({ children }: DynamicIslandProps) {
  const theme = useResolvedTheme()

  return (
    <IslandProvider>
      <Island
        backdrop={theme === 'dark' ? '#09090b' : '#f7f7f7'}
        label="Iris live activity"
        placement="viewport"
        style={{ zIndex: 60 }}
      />
      <AgentActivity />
      {children}
    </IslandProvider>
  )
}

export type {
  DynamicIslandNotice,
  NoticeTone,
} from '@/components/dynamic-island/notifications'

DynamicIsland.displayName = 'DynamicIsland'

export default DynamicIsland

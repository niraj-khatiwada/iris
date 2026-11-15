import type { ReactNode } from 'react'

import { IslandProvider } from '@/lib/island'

type DynamicIslandProps = {
  children: ReactNode
}

/**
 * Keeps the island's activity store available to the app. The visible pill is intentionally
 * hidden until the new top-bar layout gives it a home again.
 */
export function DynamicIsland({ children }: DynamicIslandProps) {
  return <IslandProvider>{children}</IslandProvider>
}

export type {
  DynamicIslandNotice,
  NoticeTone,
} from '@/components/dynamic-island/notifications'

DynamicIsland.displayName = 'DynamicIsland'

export default DynamicIsland

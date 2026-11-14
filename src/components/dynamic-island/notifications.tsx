import { useCallback, useEffect, useRef } from 'react'

import { Glyph } from '@/components/islandcn/glyph'
import {
  CheckCircleGlyph,
  SparkleGlyph,
  WarningGlyph,
} from '@/components/islandcn/glyphs'
import { ExpandedBottom, SensorRow } from '@/components/islandcn/island-layout'
import {
  CompactText,
  ContextLabel,
  ExpandedSubtitle,
  ExpandedTitle,
  MinimalPair,
} from '@/components/islandcn/island-text'
import { islandAccent } from '@/components/islandcn/theme'
import { useIslandActions } from '@/lib/island'

export type NoticeTone = 'success' | 'warning' | 'error'

export type DynamicIslandNotice = {
  /** Stable id: starting the same notice again updates it instead of stacking duplicates. */
  id: string
  title: string
  subtitle?: string
  tone?: NoticeTone
  /** How long the notice stays before it folds away. Defaults to 2600 ms. */
  durationMs?: number
}

const tones = {
  success: {
    accent: islandAccent.green,
    glyph: CheckCircleGlyph,
    short: 'Done',
  },
  warning: { accent: islandAccent.orange, glyph: SparkleGlyph, short: 'Note' },
  error: { accent: islandAccent.red, glyph: WarningGlyph, short: '!' },
} as const

const GROUP = 'iris:notices'

/**
 * One-off notices on the dynamic island. This is the app's toast: no separate toast library,
 * no stack of cards in a corner.
 */
export function useDynamicIslandNotice() {
  const island = useIslandActions()
  const timers = useRef<number[]>([])
  const active = useRef(new Set<string>())

  useEffect(
    () => () => {
      for (const timer of timers.current) {
        window.clearTimeout(timer)
      }
      for (const id of active.current) {
        island.end(id)
      }
      active.current.clear()
    },
    [island],
  )

  return useCallback(
    (notice: DynamicIslandNotice) => {
      const tone = tones[notice.tone ?? 'success']
      const activityId = `iris:notice:${notice.id}`
      active.current.add(activityId)

      island.start({
        id: activityId,
        group: GROUP,
        label: `${notice.title}${notice.subtitle ? `. ${notice.subtitle}` : ''}`,
        compact: {
          leading: <Glyph color={tone.accent} icon={tone.glyph} />,
          trailing: <CompactText>{tone.short}</CompactText>,
        },
        minimal: (
          <MinimalPair
            leading={<Glyph color={tone.accent} icon={tone.glyph} size={20} />}
            trailing={<CompactText>{tone.short}</CompactText>}
          />
        ),
        expanded: {
          leading: (
            <SensorRow
              glyph={<Glyph color={tone.accent} icon={tone.glyph} size={18} />}
            >
              <ContextLabel>Iris</ContextLabel>
            </SensorRow>
          ),
          bottom: (
            <ExpandedBottom gap={4}>
              <ExpandedTitle>{notice.title}</ExpandedTitle>
              {notice.subtitle ? (
                <ExpandedSubtitle>{notice.subtitle}</ExpandedSubtitle>
              ) : null}
            </ExpandedBottom>
          ),
        },
      })

      const timer = window.setTimeout(() => {
        island.end(activityId)
        active.current.delete(activityId)
        timers.current = timers.current.filter((item) => item !== timer)
      }, notice.durationMs ?? 2600)
      timers.current.push(timer)
    },
    [island],
  )
}

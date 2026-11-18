import type { CSSProperties } from 'react'

import {
  AiBotAvatar,
  type AiBotAvatarProps,
  type AiBotShape,
} from '@/components/legacy/AiBotAvatar'

export type IrisTone = 'primary' | 'pending' | 'speaking' | 'error'

type IrisBlobProps = Omit<AiBotAvatarProps, 'colors' | 'label'> & {
  label?: string
  shape?: AiBotShape
  tone?: IrisTone
}

const PRIMARY_COLORS = [
  'color-mix(in oklch, var(--primary) 78%, white 22%)',
  'color-mix(in oklch, var(--primary) 58%, black 42%)',
] as const

/** Semantic body colours: ready, request in flight, read-aloud, and failure. */
const TONES: Record<
  IrisTone,
  { colors: readonly [string, string]; glow: string }
> = {
  primary: { colors: PRIMARY_COLORS, glow: 'var(--primary)' },
  pending: {
    colors: ['oklch(0.9 0.12 88)', 'oklch(0.68 0.16 62)'],
    glow: 'oklch(0.84 0.14 78)',
  },
  speaking: {
    colors: ['oklch(0.88 0.08 235)', 'oklch(0.62 0.16 258)'],
    glow: 'oklch(0.78 0.11 245)',
  },
  error: {
    colors: ['oklch(0.85 0.1 25)', 'oklch(0.6 0.18 25)'],
    glow: 'oklch(0.72 0.15 25)',
  },
}

/**
 * Legacy engine-based Iris blob. Kept for reference while the app uses the `bot-avatars`
 * implementation in `src/components/IrisBlob`.
 */
function LegacyIrisBlob({
  size = 32,
  label = 'Iris',
  shape = 'blob',
  style,
  tone = 'primary',
  ...options
}: IrisBlobProps) {
  const palette = TONES[tone]
  const primaryStyle = {
    '--bot-face': 'oklch(0.16 0.004 250)',
    '--bot-ground': `color-mix(in oklch, ${palette.glow} 18%, transparent)`,
    '--bot-ground-core': `color-mix(in oklch, ${palette.glow} 30%, transparent)`,
    ...style,
  } as CSSProperties

  return (
    <AiBotAvatar
      {...options}
      colors={palette.colors}
      label={label}
      shape={shape}
      size={size}
      style={primaryStyle}
    />
  )
}

LegacyIrisBlob.displayName = 'LegacyIrisBlob'

export default LegacyIrisBlob

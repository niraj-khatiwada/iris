import type { CSSProperties } from 'react'

import {
  AiBotAvatar,
  type AiBotAvatarProps,
  type AiBotShape,
} from '@/components/AiBotAvatar'

type IrisBlobProps = Omit<AiBotAvatarProps, 'colors' | 'label'> & {
  label?: string
  shape?: AiBotShape
}

const PRIMARY_COLORS = [
  'color-mix(in oklch, var(--primary) 78%, white 22%)',
  'color-mix(in oklch, var(--primary) 58%, black 42%)',
] as const

/** Iris's presence: the shared AI blob painted with the project primary. */
function IrisBlob({
  size = 32,
  label = 'Iris',
  shape = 'blob',
  style,
  ...options
}: IrisBlobProps) {
  const primaryStyle = {
    '--bot-face': 'oklch(0.16 0.004 250)',
    '--bot-ground': 'color-mix(in oklch, var(--primary) 18%, transparent)',
    '--bot-ground-core': 'color-mix(in oklch, var(--primary) 30%, transparent)',
    ...style,
  } as CSSProperties

  return (
    <AiBotAvatar
      {...options}
      colors={PRIMARY_COLORS}
      label={label}
      shape={shape}
      size={size}
      style={primaryStyle}
    />
  )
}

IrisBlob.displayName = 'IrisBlob'

export default IrisBlob

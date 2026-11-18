import {
  BotAvatar,
  type BotAvatarProps,
  type BotAvatarState,
  type BotAvatarType,
} from 'bot-avatars'

import { useSettingsStore } from '@/stores/settingsStore'

export type IrisTone = 'primary' | 'pending' | 'speaking' | 'error'

export type IrisEmotion =
  | 'neutral'
  | 'happy'
  | 'love'
  | 'laugh'
  | 'surprised'
  | 'sad'
  | 'thinking'
  | 'sleepy'
  | 'wink'

export type IrisActivity = 'idle' | 'speaking' | 'listening'

type IrisBlobProps = Omit<
  BotAvatarProps,
  'color' | 'size' | 'state' | 'type'
> & {
  /** Body diameter in px. */
  size?: number
  label?: string
  shape?: BotAvatarType
  tone?: IrisTone
  emotion?: IrisEmotion
  activity?: IrisActivity
}

/** sRGB equivalent of `--primary`, used until the token can be resolved at runtime. */
const PRIMARY_FALLBACK = '#7adaa5'

let resolvedPrimary: string | null = null

/**
 * `bot-avatars` parses hex/rgb/hsl colours, so the theme token cannot be passed straight
 * through. Resolve it once through a canvas, which handles the oklch value in `global.css`.
 */
export function irisPrimaryColor() {
  if (resolvedPrimary) {
    return resolvedPrimary
  }
  if (typeof document === 'undefined') {
    return PRIMARY_FALLBACK
  }

  const token = getComputedStyle(document.documentElement)
    .getPropertyValue('--primary')
    .trim()
  if (!token) {
    resolvedPrimary = PRIMARY_FALLBACK
    return resolvedPrimary
  }

  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    resolvedPrimary = PRIMARY_FALLBACK
    return resolvedPrimary
  }

  context.fillStyle = token
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  resolvedPrimary = `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
  return resolvedPrimary
}

/** Semantic body colours: ready, request in flight, read-aloud, and failure. */
const TONE_COLORS: Record<IrisTone, string> = {
  primary: PRIMARY_FALLBACK,
  pending: '#f2b94b',
  speaking: '#6fb2ee',
  error: '#e56f6a',
}

/** The old emotion/activity vocabulary mapped onto the library's three animation states. */
function avatarState(
  emotion: IrisEmotion,
  activity: IrisActivity,
): BotAvatarState {
  if (emotion === 'sleepy') {
    return 'sleeping'
  }
  if (activity !== 'idle') {
    return 'working'
  }

  switch (emotion) {
    case 'laugh':
    case 'surprised':
    case 'thinking':
    case 'wink':
      return 'working'
    default:
      return 'default'
  }
}

/** Iris's presence: the saved bot look, with tone and state driven by the app. */
function IrisBlob({
  accessoryColor,
  activity = 'idle',
  bowTie,
  emotion = 'neutral',
  face,
  glasses,
  hat,
  headphones,
  label = 'Iris',
  shading,
  shape,
  size = 32,
  tone = 'primary',
  ...options
}: IrisBlobProps) {
  const avatar = useSettingsStore((state) => state.avatar)

  return (
    <BotAvatar
      {...options}
      accessoryColor={accessoryColor ?? avatar.accessoryColor}
      aria-label={label}
      bowTie={bowTie ?? avatar.bowTie}
      color={
        tone === 'primary'
          ? avatar.color || irisPrimaryColor()
          : TONE_COLORS[tone]
      }
      face={face ?? avatar.face}
      glasses={glasses ?? avatar.glasses}
      hat={hat ?? avatar.hat}
      headphones={headphones ?? avatar.headphones}
      shading={shading ?? avatar.shading}
      size={size}
      state={avatarState(emotion, activity)}
      type={shape ?? avatar.type}
    />
  )
}

IrisBlob.displayName = 'IrisBlob'

export default IrisBlob

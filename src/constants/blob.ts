import type { AiBotEmotion, AiBotShape } from '@/components/AiBotAvatar'

/** Shapes the header blob cycles through while a request is in flight. */
export const SENDING_SHAPES: AiBotShape[] = [
  'blob',
  'pebble',
  'squircle',
  'flower',
  'circle',
]

/** Expressions paired with the sending shapes. */
export const SENDING_EMOTIONS: AiBotEmotion[] = [
  'thinking',
  'surprised',
  'happy',
  'wink',
]

/** How long each shape/expression stays before the next one. */
export const SENDING_TICK_MS = 500

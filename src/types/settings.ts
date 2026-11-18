import type {
  BotAvatarFace,
  BotAvatarGlasses,
  BotAvatarHat,
  BotAvatarShading,
  BotAvatarType,
} from 'bot-avatars'

export type ThemeMode = 'light' | 'dark' | 'system'

/** DeepSeek TTS voices exposed by the demo API. */
export type TtsVoice = 'stella' | 'tide'

/** The avatar's saved look. Emotion and tone stay driven by the app's state. */
export type IrisAvatar = {
  type: BotAvatarType
  /** Empty means "follow `--primary`"; otherwise a hex colour. */
  color: string
  face: BotAvatarFace
  shading: BotAvatarShading
  hat: BotAvatarHat
  glasses: BotAvatarGlasses
  headphones: boolean
  bowTie: boolean
  accessoryColor: string
}

/** Settings sidebar categories; used to target a panel from elsewhere in the app. */
export type SettingsCategory =
  | 'general'
  | 'shortcuts'
  | 'ai'
  | 'voice'
  | 'storage'
  | 'about'

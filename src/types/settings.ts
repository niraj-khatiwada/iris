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

/** One saved selection prompt, editable in Settings → AI Prompts. */
export type QuickPromptIcon =
  | 'lightbulb'
  | 'align-left'
  | 'pen-line'
  | 'languages'
  | 'check-check'
  | 'list-todo'
  | 'reply'
  | 'sparkles'
  | 'search'
  | 'code'
  | 'message-square'
  | 'file-text'
  | 'globe'
  | 'wand'

export type QuickPrompt = {
  /** Stable id; built-in prompts keep their original action id. */
  id: string
  name: string
  /** The instruction sent to the model together with the selected or typed text. */
  instruction: string
  icon: QuickPromptIcon
}

/** Settings sidebar categories; used to target a panel from elsewhere in the app. */
export type SettingsCategory =
  | 'general'
  | 'shortcuts'
  | 'api'
  | 'prompts'
  | 'memory'
  | 'voice'
  | 'storage'
  | 'about'

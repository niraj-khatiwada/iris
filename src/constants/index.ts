import type { ThemeMode, TtsVoice } from '@/types/settings'

/** Suggested prompts shown on the welcome screen. */
export const SUGGESTIONS = [
  {
    id: 'plan',
    title: 'Plan my day',
    description: 'Turn a messy list into a focused plan.',
    prompt:
      'Help me plan a focused day around my most important work. Ask me what matters most first.',
  },
  {
    id: 'write',
    title: 'Draft something',
    description: 'A message, a note, or a first draft.',
    prompt:
      'Help me draft a concise, friendly message. Ask me who it is for and what I want to say.',
  },
  {
    id: 'think',
    title: 'Think it through',
    description: 'Untangle a decision or a problem.',
    prompt:
      'I have a decision to make. Help me think it through by asking one useful question at a time.',
  },
  {
    id: 'focus',
    title: 'Set a focus',
    description: 'Start a short, deliberate work session.',
    prompt:
      'Help me choose one meaningful thing to focus on for the next 45 minutes.',
  },
] as const

export const APP_NAME = 'Iris'
/** DeepSeek's official API. A proxy can be set in Settings when it still speaks DeepSeek. */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_MODEL = 'deepseek-flash'
/** DeepSeek-owned tool endpoints, always derived from the configured base URL. */
export const TTS_PATH = '/v1/tools/tts'
export const ASR_PATH = '/v1/tools/asr'
export const DEFAULT_TTS_VOICE: TtsVoice = 'stella'
export const DEFAULT_OPEN_SHORTCUT = 'commandorcontrol+space'
export const TTS_VOICES: ReadonlyArray<{ id: TtsVoice; label: string }> = [
  { id: 'stella', label: 'Stella' },
  { id: 'tide', label: 'Tide' },
]
export const DEFAULT_USER_NAME = 'You'
export const QUICK_CONVERSATION_ID = 'iris:quick'
export const QUICK_CONVERSATION_TITLE = 'Quick chat'
export const CHAT_STORAGE_KEY = 'iris.chat'
export const SETTINGS_STORAGE_KEY = 'iris.settings'
/** Overlay-local shortcuts, recorded and matched in the quick chat only. */
export const DEFAULT_OVERLAY_SHORTCUTS = {
  capture: 'CommandOrControl+KeyC',
  newChat: 'CommandOrControl+KeyN',
  restorePrevious: 'CommandOrControl+Shift+KeyN',
  toggleResponse: 'CommandOrControl+KeyB',
  deepThink: 'CommandOrControl+KeyD',
  webSearch: 'CommandOrControl+KeyS',
  voiceInput: 'CommandOrControl+KeyI',
} as const
export const THEME_LABELS: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

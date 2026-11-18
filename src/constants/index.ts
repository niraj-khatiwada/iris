import type { IrisAvatar, ThemeMode, TtsVoice } from '@/types/settings'

/** The look Iris ships with; Settings → About edits and persists it. */
export const DEFAULT_IRIS_AVATAR: IrisAvatar = {
  type: 'clover',
  color: '',
  face: 'mouth',
  shading: 'fabric',
  hat: 'none',
  glasses: 'none',
  headphones: false,
  bowTie: false,
  accessoryColor: '#27272b',
}

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
export const DEFAULT_SIDEBAR_WIDTH = 280
export const MIN_SIDEBAR_WIDTH = 220
export const MAX_SIDEBAR_WIDTH = 420
/** Keeps macOS autocorrection and spelling suggestions out of Iris text fields. */
export const NO_WRITING_ASSIST = {
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: false,
} as const
/** DeepSeek's official API. A proxy can be set in Settings when it still speaks DeepSeek. */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_MODEL = 'deepseek-flash'
/** Default instructions for every reply; editable in Settings → AI → Prompt. */
export const DEFAULT_SYSTEM_PROMPT =
  'You are Iris, a personal desktop assistant. Be direct, warm, and concise. The user wants the reply to be like how a human have conversation, so write naturally in summarized form and avoid unnecessary formatting.'
/** DeepSeek-owned tool endpoints, always derived from the configured base URL. */
export const TTS_PATH = '/v1/tools/tts'
export const ASR_PATH = '/v1/tools/asr'
export const DEFAULT_TTS_VOICE: TtsVoice = 'stella'
export const DEFAULT_OPEN_SHORTCUT = 'commandorcontrol+space'
/** Focuses the sidebar search in the history window; configurable in Settings → Shortcuts. */
export const DEFAULT_SEARCH_SHORTCUT = 'CommandOrControl+Shift+KeyF'
export const TTS_VOICES: ReadonlyArray<{ id: TtsVoice; label: string }> = [
  { id: 'stella', label: 'Stella' },
  { id: 'tide', label: 'Tide' },
]
export const DEFAULT_USER_NAME = 'You'
/** Fallback title for a fresh quick chat until the first message names it. */
export const QUICK_CONVERSATION_TITLE = 'Quick chat'
export const CHAT_STORAGE_KEY = 'iris.chat'
/** Only the selected conversation ids; conversations themselves live in SQLite. */
export const CHAT_UI_STORAGE_KEY = 'iris.chat.ui'
/** Newest page loaded first; scrolling up keeps fetching this many messages at a time. */
export const MESSAGE_PAGE_SIZE = 100
export const SETTINGS_STORAGE_KEY = 'iris.settings'
/** In-app shortcuts recorded in Settings; stopping read-aloud also works in the history window. */
export const DEFAULT_OVERLAY_SHORTCUTS = {
  capture: 'CommandOrControl+Shift+KeyS',
  newChat: 'CommandOrControl+KeyN',
  restorePrevious: 'CommandOrControl+Shift+KeyN',
  toggleResponse: 'CommandOrControl+KeyB',
  deepThink: 'CommandOrControl+KeyD',
  webSearch: 'CommandOrControl+KeyS',
  voiceInput: 'CommandOrControl+KeyI',
  stopSpeaking: 'CommandOrControl+KeyX',
} as const
export const THEME_LABELS: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
}

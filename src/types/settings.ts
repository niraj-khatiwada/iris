export type ThemeMode = 'light' | 'dark' | 'system'

/** DeepSeek TTS voices exposed by the demo API. */
export type TtsVoice = 'stella' | 'tide'

/** Settings sidebar categories; used to target a panel from elsewhere in the app. */
export type SettingsCategory =
  | 'general'
  | 'shortcuts'
  | 'ai'
  | 'voice'
  | 'storage'
  | 'about'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_OPEN_SHORTCUT,
  DEFAULT_TTS_VOICE,
  SETTINGS_STORAGE_KEY,
} from '@/constants'
import type { ThemeMode, TtsVoice } from '@/types/settings'

type SettingsState = {
  theme: ThemeMode
  /** Temporary: stored locally until the settings revamp moves secrets to the Keychain. */
  apiKey: string
  baseUrl: string
  model: string
  autoSpeak: boolean
  autoSendVoice: boolean
  ttsVoice: TtsVoice
  /** Tauri shortcut syntax, chosen with the recorder in Settings → Shortcuts. */
  openShortcut: string
  setTheme: (theme: ThemeMode) => void
  setApiKey: (apiKey: string) => void
  setBaseUrl: (baseUrl: string) => void
  setModel: (model: string) => void
  setAutoSpeak: (autoSpeak: boolean) => void
  setAutoSendVoice: (autoSendVoice: boolean) => void
  setTtsVoice: (ttsVoice: TtsVoice) => void
  setOpenShortcut: (openShortcut: string) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      apiKey: '',
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      autoSpeak: true,
      autoSendVoice: true,
      ttsVoice: DEFAULT_TTS_VOICE,
      openShortcut: DEFAULT_OPEN_SHORTCUT,
      setTheme: (theme) => set({ theme }),
      setApiKey: (apiKey) => set({ apiKey }),
      setBaseUrl: (baseUrl) => set({ baseUrl }),
      setModel: (model) => set({ model }),
      setAutoSpeak: (autoSpeak) => set({ autoSpeak }),
      setAutoSendVoice: (autoSendVoice) => set({ autoSendVoice }),
      setTtsVoice: (ttsVoice) => set({ ttsVoice }),
      setOpenShortcut: (openShortcut) => set({ openShortcut }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 3,
      migrate: (persisted) => {
        const saved = persisted as Partial<SettingsState>
        const openShortcut =
          typeof saved.openShortcut === 'string' &&
          saved.openShortcut.trim().length > 0
            ? saved.openShortcut
            : DEFAULT_OPEN_SHORTCUT

        return {
          ...saved,
          apiKey: saved.apiKey ?? '',
          baseUrl: saved.baseUrl ?? DEFAULT_BASE_URL,
          model:
            saved.model === 'local-preview'
              ? DEFAULT_MODEL
              : (saved.model ?? DEFAULT_MODEL),
          autoSpeak: saved.autoSpeak ?? true,
          autoSendVoice: saved.autoSendVoice ?? true,
          ttsVoice: saved.ttsVoice === 'tide' ? 'tide' : DEFAULT_TTS_VOICE,
          openShortcut,
        } as SettingsState
      },
    },
  ),
)

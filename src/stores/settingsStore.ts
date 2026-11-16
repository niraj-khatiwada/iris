import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_OPEN_SHORTCUT,
  DEFAULT_OVERLAY_SHORTCUTS,
  DEFAULT_TTS_VOICE,
  SETTINGS_STORAGE_KEY,
} from '@/constants'
import type { ThemeMode, TtsVoice } from '@/types/settings'

export type OverlayShortcutAction = keyof typeof DEFAULT_OVERLAY_SHORTCUTS
export type OverlayShortcuts = Record<OverlayShortcutAction, string>

type SettingsState = {
  theme: ThemeMode
  /** Temporary: stored locally until the settings revamp moves secrets to the Keychain. */
  apiKey: string
  baseUrl: string
  model: string
  autoSpeak: boolean
  autoSendVoice: boolean
  /** Toggle in the composer: enable DeepSeek's DeepThink before answering. */
  deepThink: boolean
  /** Toggle in the composer: let DeepSeek search the web when it needs to. */
  webSearch: boolean
  ttsVoice: TtsVoice
  /** Tauri shortcut syntax, chosen with the recorder in Settings → Shortcuts. */
  openShortcut: string
  /** In-app shortcuts while the quick overlay is key; never registered with the OS. */
  overlayShortcuts: OverlayShortcuts
  setTheme: (theme: ThemeMode) => void
  setApiKey: (apiKey: string) => void
  setBaseUrl: (baseUrl: string) => void
  setModel: (model: string) => void
  setAutoSpeak: (autoSpeak: boolean) => void
  setAutoSendVoice: (autoSendVoice: boolean) => void
  setDeepThink: (deepThink: boolean) => void
  setWebSearch: (webSearch: boolean) => void
  setTtsVoice: (ttsVoice: TtsVoice) => void
  setOpenShortcut: (openShortcut: string) => void
  setOverlayShortcut: (action: OverlayShortcutAction, shortcut: string) => void
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
      deepThink: false,
      webSearch: false,
      ttsVoice: DEFAULT_TTS_VOICE,
      openShortcut: DEFAULT_OPEN_SHORTCUT,
      overlayShortcuts: { ...DEFAULT_OVERLAY_SHORTCUTS },
      setTheme: (theme) => set({ theme }),
      setApiKey: (apiKey) => set({ apiKey }),
      setBaseUrl: (baseUrl) => set({ baseUrl }),
      setModel: (model) => set({ model }),
      setAutoSpeak: (autoSpeak) => set({ autoSpeak }),
      setAutoSendVoice: (autoSendVoice) => set({ autoSendVoice }),
      setDeepThink: (deepThink) => set({ deepThink }),
      setWebSearch: (webSearch) => set({ webSearch }),
      setTtsVoice: (ttsVoice) => set({ ttsVoice }),
      setOpenShortcut: (openShortcut) => set({ openShortcut }),
      setOverlayShortcut: (action, shortcut) =>
        set((state) => ({
          overlayShortcuts: { ...state.overlayShortcuts, [action]: shortcut },
        })),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 5,
      migrate: (persisted) => {
        const saved = persisted as Partial<SettingsState>
        const openShortcut =
          typeof saved.openShortcut === 'string' &&
          saved.openShortcut.trim().length > 0
            ? saved.openShortcut
            : DEFAULT_OPEN_SHORTCUT
        const savedShortcuts = saved.overlayShortcuts as
          | Partial<OverlayShortcuts>
          | undefined
        const overlayShortcuts = {
          ...DEFAULT_OVERLAY_SHORTCUTS,
        } as OverlayShortcuts
        for (const action of Object.keys(
          DEFAULT_OVERLAY_SHORTCUTS,
        ) as OverlayShortcutAction[]) {
          const value = savedShortcuts?.[action]
          if (typeof value === 'string' && value.includes('+')) {
            overlayShortcuts[action] = value
          }
        }

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
          deepThink: saved.deepThink ?? false,
          webSearch: saved.webSearch ?? false,
          ttsVoice: saved.ttsVoice === 'tide' ? 'tide' : DEFAULT_TTS_VOICE,
          openShortcut,
          overlayShortcuts,
        } as SettingsState
      },
    },
  ),
)

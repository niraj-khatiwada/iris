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

/**
 * Rebuilds the shortcut map from whatever was persisted. Older builds stored a different set of
 * actions, so a missing key must fall back to its default instead of reaching `formatShortcut`.
 */
function normalizeOverlayShortcuts(saved: unknown): OverlayShortcuts {
  const value = (saved ?? {}) as Partial<Record<string, unknown>>
  const shortcuts = { ...DEFAULT_OVERLAY_SHORTCUTS } as OverlayShortcuts

  for (const action of Object.keys(
    DEFAULT_OVERLAY_SHORTCUTS,
  ) as OverlayShortcutAction[]) {
    const shortcut = value[action]
    if (typeof shortcut === 'string' && shortcut.includes('+')) {
      shortcuts[action] = shortcut
    }
  }

  // Web search moved from ⌘W to ⌘S; carry the untouched old default over.
  if (shortcuts.webSearch === 'CommandOrControl+KeyW') {
    shortcuts.webSearch = DEFAULT_OVERLAY_SHORTCUTS.webSearch
  }

  // Voice input moved from ⌘M to ⌘I; carry the untouched old default over.
  if (shortcuts.voiceInput === 'CommandOrControl+KeyM') {
    shortcuts.voiceInput = DEFAULT_OVERLAY_SHORTCUTS.voiceInput
  }

  return shortcuts
}

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
      version: 8,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SettingsState>
        return {
          ...current,
          ...saved,
          overlayShortcuts: normalizeOverlayShortcuts(saved.overlayShortcuts),
        }
      },
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
          deepThink: saved.deepThink ?? false,
          webSearch: saved.webSearch ?? false,
          ttsVoice: saved.ttsVoice === 'tide' ? 'tide' : DEFAULT_TTS_VOICE,
          openShortcut,
          overlayShortcuts: normalizeOverlayShortcuts(saved.overlayShortcuts),
        } as SettingsState
      },
    },
  ),
)

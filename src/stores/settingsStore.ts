import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { ApiFormat } from '@/constants'
import {
  DEFAULT_API_FORMAT,
  DEFAULT_ASR_URL,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_OPEN_SHORTCUT,
  DEFAULT_OVERLAY_SHORTCUTS,
  DEFAULT_TTS_URL,
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
  baseUrl: string
  /** Wire format of the chat API: providers offer Anthropic-style or OpenAI-style requests. */
  apiFormat: ApiFormat
  model: string
  /**
   * A key is stored. The source of truth is `has_api_key` (an attributes-only Keychain query that
   * never prompts); this cached flag keeps the saved state instant on the first paint.
   */
  apiKeyPresent: boolean
  /**
   * Last four characters of the saved key, when known. Cached so Settings can show which key is
   * stored without reading the Keychain.
   */
  apiKeyHint: string | null
  autoSpeak: boolean
  autoSendVoice: boolean
  /** Toggle in the composer: enable thinking mode before answering. */
  deepThink: boolean
  /** Toggle in the composer: let Iris search the web when it needs to. */
  webSearch: boolean
  ttsVoice: TtsVoice
  /** Full endpoint that synthesizes read-aloud audio. */
  ttsUrl: string
  /** Full endpoint that transcribes microphone recordings. */
  asrUrl: string
  /** Tauri shortcut syntax, chosen with the recorder in Settings → Shortcuts. */
  openShortcut: string
  /** In-app shortcuts while the quick overlay is key; never registered with the OS. */
  overlayShortcuts: OverlayShortcuts
  setTheme: (theme: ThemeMode) => void
  setApiKeyState: (state: { present: boolean; hint: string | null }) => void
  setBaseUrl: (baseUrl: string) => void
  setApiFormat: (apiFormat: ApiFormat) => void
  setModel: (model: string) => void
  setAutoSpeak: (autoSpeak: boolean) => void
  setAutoSendVoice: (autoSendVoice: boolean) => void
  setDeepThink: (deepThink: boolean) => void
  setWebSearch: (webSearch: boolean) => void
  setTtsVoice: (ttsVoice: TtsVoice) => void
  setTtsUrl: (ttsUrl: string) => void
  setAsrUrl: (asrUrl: string) => void
  setOpenShortcut: (openShortcut: string) => void
  setOverlayShortcut: (action: OverlayShortcutAction, shortcut: string) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      baseUrl: DEFAULT_BASE_URL,
      apiFormat: DEFAULT_API_FORMAT,
      model: DEFAULT_MODEL,
      apiKeyPresent: false,
      apiKeyHint: null,
      autoSpeak: true,
      autoSendVoice: true,
      deepThink: false,
      webSearch: false,
      ttsVoice: DEFAULT_TTS_VOICE,
      ttsUrl: DEFAULT_TTS_URL,
      asrUrl: DEFAULT_ASR_URL,
      openShortcut: DEFAULT_OPEN_SHORTCUT,
      overlayShortcuts: { ...DEFAULT_OVERLAY_SHORTCUTS },
      setTheme: (theme) => set({ theme }),
      setApiKeyState: ({ present, hint }) =>
        set({ apiKeyPresent: present, apiKeyHint: hint }),
      setBaseUrl: (baseUrl) => set({ baseUrl }),
      setApiFormat: (apiFormat) => set({ apiFormat }),
      setModel: (model) => set({ model }),
      setAutoSpeak: (autoSpeak) => set({ autoSpeak }),
      setAutoSendVoice: (autoSendVoice) => set({ autoSendVoice }),
      setDeepThink: (deepThink) => set({ deepThink }),
      setWebSearch: (webSearch) => set({ webSearch }),
      setTtsVoice: (ttsVoice) => set({ ttsVoice }),
      setTtsUrl: (ttsUrl) => set({ ttsUrl }),
      setAsrUrl: (asrUrl) => set({ asrUrl }),
      setOpenShortcut: (openShortcut) => set({ openShortcut }),
      setOverlayShortcut: (action, shortcut) =>
        set((state) => ({
          overlayShortcuts: { ...state.overlayShortcuts, [action]: shortcut },
        })),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 10,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SettingsState> & {
          apiKey?: unknown
        }
        const { apiKey: _legacyKey, ...rest } = saved
        return {
          ...current,
          ...rest,
          overlayShortcuts: normalizeOverlayShortcuts(saved.overlayShortcuts),
        }
      },
      migrate: (persisted) => {
        const saved = persisted as Partial<SettingsState> & {
          apiKey?: unknown
        }
        // Drop any key saved by an older build; it now belongs in the Keychain.
        const { apiKey: _legacyKey, ...rest } = saved
        const openShortcut =
          typeof rest.openShortcut === 'string' &&
          rest.openShortcut.trim().length > 0
            ? rest.openShortcut
            : DEFAULT_OPEN_SHORTCUT

        return {
          ...rest,
          baseUrl: rest.baseUrl ?? DEFAULT_BASE_URL,
          apiFormat:
            rest.apiFormat === 'openai' || rest.apiFormat === 'anthropic'
              ? rest.apiFormat
              : DEFAULT_API_FORMAT,
          model:
            rest.model === 'local-preview'
              ? DEFAULT_MODEL
              : (rest.model ?? DEFAULT_MODEL),
          apiKeyPresent: rest.apiKeyPresent === true,
          apiKeyHint:
            typeof rest.apiKeyHint === 'string' ? rest.apiKeyHint : null,
          autoSpeak: rest.autoSpeak ?? true,
          autoSendVoice: rest.autoSendVoice ?? true,
          deepThink: rest.deepThink ?? false,
          webSearch: rest.webSearch ?? false,
          ttsVoice: rest.ttsVoice === 'tide' ? 'tide' : DEFAULT_TTS_VOICE,
          ttsUrl:
            typeof rest.ttsUrl === 'string' && rest.ttsUrl.trim().length > 0
              ? rest.ttsUrl
              : DEFAULT_TTS_URL,
          asrUrl:
            typeof rest.asrUrl === 'string' && rest.asrUrl.trim().length > 0
              ? rest.asrUrl
              : DEFAULT_ASR_URL,
          openShortcut,
          overlayShortcuts: normalizeOverlayShortcuts(rest.overlayShortcuts),
        } as SettingsState
      },
    },
  ),
)

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_OPEN_SHORTCUT,
  DEFAULT_OVERLAY_SHORTCUTS,
  DEFAULT_SEARCH_SHORTCUT,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TTS_VOICE,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  SETTINGS_STORAGE_KEY,
} from '@/constants'
import type { ThemeMode, TtsVoice } from '@/types/settings'

export type OverlayShortcutAction = keyof typeof DEFAULT_OVERLAY_SHORTCUTS
export type OverlayShortcuts = Record<OverlayShortcutAction, string>

/** Fields from older builds that are no longer settings: only DeepSeek is supported. */
type LegacySettings = {
  apiKey?: unknown
  apiFormat?: unknown
  ttsUrl?: unknown
  asrUrl?: unknown
  /** The single prompt from before island and main chat had separate instructions. */
  systemPrompt?: unknown
}

/**
 * Rebuilds the shortcut map from whatever was persisted. Older builds stored a different set of
 * actions, so a missing key must fall back to its default instead of reaching `formatShortcut`.
 */
function normalizePrompt(saved: unknown): string {
  return typeof saved === 'string' && saved.trim().length > 0
    ? saved
    : DEFAULT_SYSTEM_PROMPT
}

function normalizeShortcut(saved: unknown, fallback: string): string {
  return typeof saved === 'string' && saved.includes('+') ? saved : fallback
}

function normalizeSidebarWidth(saved: unknown): number {
  const width =
    typeof saved === 'number' && Number.isFinite(saved)
      ? saved
      : DEFAULT_SIDEBAR_WIDTH
  return Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)),
  )
}

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

  // Screen capture moved from ⌘C to ⌘⇧S to leave Copy alone; carry the untouched old default
  // over so existing installs follow the new binding.
  if (shortcuts.capture === 'CommandOrControl+KeyC') {
    shortcuts.capture = DEFAULT_OVERLAY_SHORTCUTS.capture
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
  /** DeepSeek API origin. Defaults to the official API; set a proxy if one is required. */
  baseUrl: string
  model: string
  /** Prompt used by the Iris Island (quick overlay) chat. */
  islandSystemPrompt: string
  /** Prompt used by the main history chat. */
  mainSystemPrompt: string
  /** Reuse the island prompt in the main chat; on by default. */
  mainUsesIslandPrompt: boolean
  /**
   * A key is stored. The source of truth is `has_api_key`; this cached flag keeps the saved state
   * instant on the first paint.
   */
  apiKeyPresent: boolean
  /**
   * Last four characters of the saved key, when known. Cached so Settings can show which key is
   * stored without reading the key itself.
   */
  apiKeyHint: string | null
  /**
   * Bumped whenever the key is saved or removed. The model catalogue watches this so a new key is
   * re-checked immediately instead of leaving the previous catalogue on screen.
   */
  apiKeyRevision: number
  autoSpeak: boolean
  autoSendVoice: boolean
  /** Show the reply in the quick overlay as soon as it arrives, without pressing Show response. */
  revealResponse: boolean
  /** Toggle in the composer: enable thinking mode before answering. */
  deepThink: boolean
  /** Toggle in the composer: let Iris search the web when it needs to. */
  webSearch: boolean
  ttsVoice: TtsVoice
  /** Tauri shortcut syntax, chosen with the recorder in Settings → Shortcuts. */
  openShortcut: string
  /** Focuses the history window's sidebar search; configured in Settings → Shortcuts. */
  searchShortcut: string
  /** Width of the open history sidebar in CSS pixels; dragging the border persists it. */
  sidebarWidth: number
  /** In-app shortcuts while the quick overlay is key; never registered with the OS. */
  overlayShortcuts: OverlayShortcuts
  setTheme: (theme: ThemeMode) => void
  setApiKeyState: (state: { present: boolean; hint: string | null }) => void
  /** Signals that the credential changed, so key-derived results must be refetched. */
  markApiKeyChanged: () => void
  setBaseUrl: (baseUrl: string) => void
  setModel: (model: string) => void
  setIslandSystemPrompt: (islandSystemPrompt: string) => void
  setMainSystemPrompt: (mainSystemPrompt: string) => void
  setMainUsesIslandPrompt: (mainUsesIslandPrompt: boolean) => void
  setAutoSpeak: (autoSpeak: boolean) => void
  setRevealResponse: (revealResponse: boolean) => void
  setAutoSendVoice: (autoSendVoice: boolean) => void
  setDeepThink: (deepThink: boolean) => void
  setWebSearch: (webSearch: boolean) => void
  setTtsVoice: (ttsVoice: TtsVoice) => void
  setOpenShortcut: (openShortcut: string) => void
  setSearchShortcut: (searchShortcut: string) => void
  setSidebarWidth: (sidebarWidth: number) => void
  setOverlayShortcut: (action: OverlayShortcutAction, shortcut: string) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      islandSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      mainSystemPrompt: DEFAULT_SYSTEM_PROMPT,
      mainUsesIslandPrompt: true,
      apiKeyPresent: false,
      apiKeyHint: null,
      apiKeyRevision: 0,
      autoSpeak: true,
      revealResponse: true,
      autoSendVoice: true,
      deepThink: false,
      webSearch: false,
      ttsVoice: DEFAULT_TTS_VOICE,
      openShortcut: DEFAULT_OPEN_SHORTCUT,
      searchShortcut: DEFAULT_SEARCH_SHORTCUT,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      overlayShortcuts: { ...DEFAULT_OVERLAY_SHORTCUTS },
      setTheme: (theme) => set({ theme }),
      setApiKeyState: ({ present, hint }) =>
        set({ apiKeyPresent: present, apiKeyHint: hint }),
      // Called only after an actual save or removal, so opening the panel does not invalidate.
      markApiKeyChanged: () =>
        set((state) => ({ apiKeyRevision: state.apiKeyRevision + 1 })),
      setBaseUrl: (baseUrl) => set({ baseUrl }),
      setModel: (model) => set({ model }),
      setIslandSystemPrompt: (islandSystemPrompt) =>
        set({ islandSystemPrompt }),
      setMainSystemPrompt: (mainSystemPrompt) => set({ mainSystemPrompt }),
      setMainUsesIslandPrompt: (mainUsesIslandPrompt) =>
        set({ mainUsesIslandPrompt }),
      setAutoSpeak: (autoSpeak) => set({ autoSpeak }),
      setRevealResponse: (revealResponse) => set({ revealResponse }),
      setAutoSendVoice: (autoSendVoice) => set({ autoSendVoice }),
      setDeepThink: (deepThink) => set({ deepThink }),
      setWebSearch: (webSearch) => set({ webSearch }),
      setTtsVoice: (ttsVoice) => set({ ttsVoice }),
      setOpenShortcut: (openShortcut) => set({ openShortcut }),
      setSearchShortcut: (searchShortcut) => set({ searchShortcut }),
      setSidebarWidth: (sidebarWidth) =>
        set({ sidebarWidth: normalizeSidebarWidth(sidebarWidth) }),
      setOverlayShortcut: (action, shortcut) =>
        set((state) => ({
          overlayShortcuts: { ...state.overlayShortcuts, [action]: shortcut },
        })),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 14,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SettingsState> &
          LegacySettings
        const {
          apiKey: _legacyKey,
          apiFormat: _legacyFormat,
          ttsUrl: _legacyTtsUrl,
          asrUrl: _legacyAsrUrl,
          systemPrompt: legacySystemPrompt,
          ...rest
        } = saved
        return {
          ...current,
          ...rest,
          islandSystemPrompt: normalizePrompt(
            saved.islandSystemPrompt ?? legacySystemPrompt,
          ),
          mainSystemPrompt: normalizePrompt(saved.mainSystemPrompt),
          mainUsesIslandPrompt: saved.mainUsesIslandPrompt !== false,
          searchShortcut: normalizeShortcut(
            saved.searchShortcut,
            DEFAULT_SEARCH_SHORTCUT,
          ),
          sidebarWidth: normalizeSidebarWidth(saved.sidebarWidth),
          overlayShortcuts: normalizeOverlayShortcuts(saved.overlayShortcuts),
        }
      },
      migrate: (persisted) => {
        const saved = persisted as Partial<SettingsState> & LegacySettings
        // Drop the settings a provider-neutral build stored; only DeepSeek is supported now.
        const {
          apiKey: _legacyKey,
          apiFormat: _legacyFormat,
          ttsUrl: _legacyTtsUrl,
          asrUrl: _legacyAsrUrl,
          systemPrompt: legacySystemPrompt,
          ...rest
        } = saved
        const openShortcut =
          typeof rest.openShortcut === 'string' &&
          rest.openShortcut.trim().length > 0
            ? rest.openShortcut
            : DEFAULT_OPEN_SHORTCUT

        return {
          ...rest,
          baseUrl:
            typeof rest.baseUrl === 'string' && rest.baseUrl.trim().length > 0
              ? rest.baseUrl
              : DEFAULT_BASE_URL,
          model:
            rest.model === 'local-preview'
              ? DEFAULT_MODEL
              : (rest.model ?? DEFAULT_MODEL),
          apiKeyPresent: rest.apiKeyPresent === true,
          apiKeyHint:
            typeof rest.apiKeyHint === 'string' ? rest.apiKeyHint : null,
          autoSpeak: rest.autoSpeak ?? true,
          // New behaviour defaults on, so an older stored shape gains it without user action.
          revealResponse: rest.revealResponse ?? true,
          autoSendVoice: rest.autoSendVoice ?? true,
          deepThink: rest.deepThink ?? false,
          webSearch: rest.webSearch ?? false,
          ttsVoice: rest.ttsVoice === 'tide' ? 'tide' : DEFAULT_TTS_VOICE,
          openShortcut,
          searchShortcut: normalizeShortcut(
            rest.searchShortcut,
            DEFAULT_SEARCH_SHORTCUT,
          ),
          sidebarWidth: normalizeSidebarWidth(rest.sidebarWidth),
          islandSystemPrompt: normalizePrompt(
            rest.islandSystemPrompt ?? legacySystemPrompt,
          ),
          mainSystemPrompt: normalizePrompt(rest.mainSystemPrompt),
          mainUsesIslandPrompt: rest.mainUsesIslandPrompt !== false,
          overlayShortcuts: normalizeOverlayShortcuts(rest.overlayShortcuts),
        } as SettingsState
      },
    },
  ),
)

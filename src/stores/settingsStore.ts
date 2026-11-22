import { botAvatarTypes } from 'bot-avatars'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  DEFAULT_BASE_URL,
  DEFAULT_IRIS_AVATAR,
  DEFAULT_MODEL,
  DEFAULT_OPEN_SHORTCUT,
  DEFAULT_OVERLAY_SHORTCUTS,
  DEFAULT_QUICK_PROMPTS,
  DEFAULT_SCREEN_ASK_SHORTCUT,
  DEFAULT_SEARCH_SHORTCUT,
  DEFAULT_SELECTION_SHORTCUT,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TTS_VOICE,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  NO_EM_DASH_INSTRUCTION,
  SETTINGS_STORAGE_KEY,
} from '@/constants'
import type {
  IrisAvatar,
  QuickPrompt,
  ThemeMode,
  TtsVoice,
} from '@/types/settings'
import { isQuickPromptIcon } from '@/utils/quickPrompts'

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

const MAX_QUICK_PROMPTS = 24

/** The default Rewrite instruction shipped before the prompt was renamed to Improve. */
const LEGACY_REWRITE_INSTRUCTION =
  'Rewrite the selected text to be clearer, tighter, and more natural while preserving its meaning and tone. Return only the replacement text, with no preamble or surrounding quotes.'

/**
 * Renames the untouched default Rewrite prompt to Improve and inserts Simplify next to it,
 * while preserving the user's order and any custom name or instruction.
 */
function migrateQuickPromptDefaults(prompts: QuickPrompt[]): QuickPrompt[] {
  // An empty list is an explicit user choice; do not add the new default back.
  if (prompts.length === 0) {
    return prompts
  }

  const improve = DEFAULT_QUICK_PROMPTS.find(
    (prompt) => prompt.id === 'rewrite',
  )
  const simplify = DEFAULT_QUICK_PROMPTS.find(
    (prompt) => prompt.id === 'simplify',
  )

  let next = prompts.map((prompt) => {
    if (prompt.id !== 'rewrite') {
      return prompt
    }
    return {
      ...prompt,
      name: prompt.name === 'Rewrite' ? 'Improve' : prompt.name,
      instruction:
        improve && prompt.instruction === LEGACY_REWRITE_INSTRUCTION
          ? improve.instruction
          : prompt.instruction,
    }
  })

  if (
    simplify &&
    !next.some(
      (prompt) =>
        prompt.id === 'simplify' || prompt.name.toLowerCase() === 'simplify',
    )
  ) {
    const index = next.findIndex((prompt) => prompt.id === 'rewrite')
    const entry = { ...simplify }
    next =
      index >= 0
        ? [...next.slice(0, index + 1), entry, ...next.slice(index + 1)]
        : [...next, entry]
  }

  return next
}

/** Appends the house style rule to built-in prompts, never to user-created ones. */
function addNoEmDashToBuiltIns(prompts: QuickPrompt[]): QuickPrompt[] {
  const builtInIds = new Set(DEFAULT_QUICK_PROMPTS.map((prompt) => prompt.id))

  return prompts.map((prompt) => {
    if (
      !builtInIds.has(prompt.id) ||
      prompt.instruction.includes(NO_EM_DASH_INSTRUCTION)
    ) {
      return prompt
    }
    return {
      ...prompt,
      instruction: `${prompt.instruction.trimEnd()} ${NO_EM_DASH_INSTRUCTION}`,
    }
  })
}

/**
 * Keeps a stale or hand-edited quick-prompt list out of the composer. An empty array is kept as
 * empty so a user can intentionally remove every prompt.
 */
function normalizeQuickPrompts(saved: unknown): QuickPrompt[] {
  if (!Array.isArray(saved)) {
    return DEFAULT_QUICK_PROMPTS.map((prompt) => ({ ...prompt }))
  }

  const seen = new Set<string>()
  const prompts: QuickPrompt[] = []

  for (const entry of saved) {
    if (prompts.length >= MAX_QUICK_PROMPTS) {
      break
    }
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const value = entry as Partial<Record<keyof QuickPrompt, unknown>>
    const id = typeof value.id === 'string' ? value.id.trim() : ''
    const name = typeof value.name === 'string' ? value.name.trim() : ''
    const instruction =
      typeof value.instruction === 'string' ? value.instruction.trim() : ''
    if (!id || !name || !instruction || seen.has(id)) {
      continue
    }

    seen.add(id)
    prompts.push({
      id,
      name,
      instruction,
      icon: isQuickPromptIcon(value.icon) ? value.icon : 'sparkles',
    })
  }

  return prompts
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const AVATAR_FACES = ['eyes', 'mouth'] as const
const AVATAR_SHADINGS = [
  'fabric',
  'plastic',
  'crisp',
  'smooth',
  'flat',
] as const
const AVATAR_HATS = ['none', 'beret', 'beanie', 'party', 'crown'] as const
const AVATAR_GLASSES = ['none', 'round', 'square', 'shades'] as const

/** Keeps a stale or hand-edited persisted look from reaching the canvas library. */
function normalizeAvatar(saved: unknown): IrisAvatar {
  const value = (saved ?? {}) as Partial<Record<keyof IrisAvatar, unknown>>
  const color =
    value.color === ''
      ? ''
      : typeof value.color === 'string' && HEX_COLOR.test(value.color)
        ? value.color
        : DEFAULT_IRIS_AVATAR.color
  const accessoryColor =
    typeof value.accessoryColor === 'string' &&
    HEX_COLOR.test(value.accessoryColor)
      ? value.accessoryColor
      : DEFAULT_IRIS_AVATAR.accessoryColor

  return {
    type: botAvatarTypes.includes(value.type as IrisAvatar['type'])
      ? (value.type as IrisAvatar['type'])
      : DEFAULT_IRIS_AVATAR.type,
    color,
    face: AVATAR_FACES.includes(value.face as (typeof AVATAR_FACES)[number])
      ? (value.face as IrisAvatar['face'])
      : DEFAULT_IRIS_AVATAR.face,
    shading: AVATAR_SHADINGS.includes(
      value.shading as (typeof AVATAR_SHADINGS)[number],
    )
      ? (value.shading as IrisAvatar['shading'])
      : DEFAULT_IRIS_AVATAR.shading,
    hat: AVATAR_HATS.includes(value.hat as (typeof AVATAR_HATS)[number])
      ? (value.hat as IrisAvatar['hat'])
      : DEFAULT_IRIS_AVATAR.hat,
    glasses: AVATAR_GLASSES.includes(
      value.glasses as (typeof AVATAR_GLASSES)[number],
    )
      ? (value.glasses as IrisAvatar['glasses'])
      : DEFAULT_IRIS_AVATAR.glasses,
    headphones:
      typeof value.headphones === 'boolean'
        ? value.headphones
        : DEFAULT_IRIS_AVATAR.headphones,
    bowTie:
      typeof value.bowTie === 'boolean'
        ? value.bowTie
        : DEFAULT_IRIS_AVATAR.bowTie,
    accessoryColor,
  }
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
  /** Editable selection prompts, also shown by the `/` menu in both composers. */
  quickPrompts: QuickPrompt[]
  /** Internal marker for built-in quick-prompt migrations. */
  quickPromptSchema: number
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
  /** Automatically speak the result of a selection action. Off by default. */
  autoSpeakSelection: boolean
  /** Read a short spoken summary for automatic playback when a reply is long. */
  summarizeSpeech: boolean
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
  /** Captures selected text in any app; configured in Settings → Shortcuts. */
  selectionShortcut: string
  /** Captures the whole current display and focuses the prompt; configured in Settings. */
  screenAskShortcut: string
  /** Focuses the history window's sidebar search; configured in Settings → Shortcuts. */
  searchShortcut: string
  /** Width of the open history sidebar in CSS pixels; dragging the border persists it. */
  sidebarWidth: number
  /** In-app shortcuts while the quick overlay is key; never registered with the OS. */
  overlayShortcuts: OverlayShortcuts
  /** Saved avatar look; tone and emotion still come from the running app state. */
  avatar: IrisAvatar
  setTheme: (theme: ThemeMode) => void
  setApiKeyState: (state: { present: boolean; hint: string | null }) => void
  /** Signals that the credential changed, so key-derived results must be refetched. */
  markApiKeyChanged: () => void
  setBaseUrl: (baseUrl: string) => void
  setModel: (model: string) => void
  setIslandSystemPrompt: (islandSystemPrompt: string) => void
  setMainSystemPrompt: (mainSystemPrompt: string) => void
  setMainUsesIslandPrompt: (mainUsesIslandPrompt: boolean) => void
  setQuickPrompts: (quickPrompts: QuickPrompt[]) => void
  addQuickPrompt: (prompt: QuickPrompt) => void
  updateQuickPrompt: (id: string, prompt: QuickPrompt) => void
  removeQuickPrompt: (id: string) => void
  resetQuickPrompts: () => void
  setAutoSpeak: (autoSpeak: boolean) => void
  setAutoSpeakSelection: (autoSpeakSelection: boolean) => void
  setSummarizeSpeech: (summarizeSpeech: boolean) => void
  setRevealResponse: (revealResponse: boolean) => void
  setAutoSendVoice: (autoSendVoice: boolean) => void
  setDeepThink: (deepThink: boolean) => void
  setWebSearch: (webSearch: boolean) => void
  setTtsVoice: (ttsVoice: TtsVoice) => void
  setOpenShortcut: (openShortcut: string) => void
  setSelectionShortcut: (selectionShortcut: string) => void
  setScreenAskShortcut: (screenAskShortcut: string) => void
  setSearchShortcut: (searchShortcut: string) => void
  setSidebarWidth: (sidebarWidth: number) => void
  setOverlayShortcut: (action: OverlayShortcutAction, shortcut: string) => void
  setAvatar: (patch: Partial<IrisAvatar>) => void
  resetAvatar: () => void
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
      quickPrompts: DEFAULT_QUICK_PROMPTS.map((prompt) => ({ ...prompt })),
      quickPromptSchema: 3,
      apiKeyPresent: false,
      apiKeyHint: null,
      apiKeyRevision: 0,
      autoSpeak: true,
      autoSpeakSelection: false,
      summarizeSpeech: true,
      revealResponse: true,
      autoSendVoice: true,
      deepThink: false,
      webSearch: false,
      ttsVoice: DEFAULT_TTS_VOICE,
      openShortcut: DEFAULT_OPEN_SHORTCUT,
      selectionShortcut: DEFAULT_SELECTION_SHORTCUT,
      screenAskShortcut: DEFAULT_SCREEN_ASK_SHORTCUT,
      searchShortcut: DEFAULT_SEARCH_SHORTCUT,
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      overlayShortcuts: { ...DEFAULT_OVERLAY_SHORTCUTS },
      avatar: { ...DEFAULT_IRIS_AVATAR },
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
      setQuickPrompts: (quickPrompts) =>
        set({ quickPrompts: normalizeQuickPrompts(quickPrompts) }),
      addQuickPrompt: (prompt) =>
        set((state) => ({
          quickPrompts: normalizeQuickPrompts([...state.quickPrompts, prompt]),
        })),
      updateQuickPrompt: (id, prompt) =>
        set((state) => ({
          quickPrompts: normalizeQuickPrompts(
            state.quickPrompts.map((item) =>
              item.id === id ? { ...prompt, id } : item,
            ),
          ),
        })),
      removeQuickPrompt: (id) =>
        set((state) => ({
          quickPrompts: state.quickPrompts.filter((item) => item.id !== id),
        })),
      resetQuickPrompts: () =>
        set({
          quickPrompts: DEFAULT_QUICK_PROMPTS.map((prompt) => ({ ...prompt })),
        }),
      setAutoSpeak: (autoSpeak) => set({ autoSpeak }),
      setAutoSpeakSelection: (autoSpeakSelection) =>
        set({ autoSpeakSelection }),
      setSummarizeSpeech: (summarizeSpeech) => set({ summarizeSpeech }),
      setRevealResponse: (revealResponse) => set({ revealResponse }),
      setAutoSendVoice: (autoSendVoice) => set({ autoSendVoice }),
      setDeepThink: (deepThink) => set({ deepThink }),
      setWebSearch: (webSearch) => set({ webSearch }),
      setTtsVoice: (ttsVoice) => set({ ttsVoice }),
      setOpenShortcut: (openShortcut) => set({ openShortcut }),
      setSelectionShortcut: (selectionShortcut) => set({ selectionShortcut }),
      setScreenAskShortcut: (screenAskShortcut) => set({ screenAskShortcut }),
      setSearchShortcut: (searchShortcut) => set({ searchShortcut }),
      setSidebarWidth: (sidebarWidth) =>
        set({ sidebarWidth: normalizeSidebarWidth(sidebarWidth) }),
      setOverlayShortcut: (action, shortcut) =>
        set((state) => ({
          overlayShortcuts: { ...state.overlayShortcuts, [action]: shortcut },
        })),
      setAvatar: (patch) =>
        set((state) => ({
          avatar: normalizeAvatar({ ...state.avatar, ...patch }),
        })),
      resetAvatar: () => set({ avatar: { ...DEFAULT_IRIS_AVATAR } }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 20,
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
        const quickPromptSchema =
          typeof saved.quickPromptSchema === 'number'
            ? saved.quickPromptSchema
            : 0
        let quickPrompts = normalizeQuickPrompts(saved.quickPrompts)
        if (quickPromptSchema < 2) {
          quickPrompts = migrateQuickPromptDefaults(quickPrompts)
        }
        if (quickPromptSchema < 3) {
          quickPrompts = addNoEmDashToBuiltIns(quickPrompts)
        }
        return {
          ...current,
          ...rest,
          autoSpeakSelection: saved.autoSpeakSelection === true,
          summarizeSpeech: saved.summarizeSpeech !== false,
          islandSystemPrompt: normalizePrompt(
            saved.islandSystemPrompt ?? legacySystemPrompt,
          ),
          mainSystemPrompt: normalizePrompt(saved.mainSystemPrompt),
          mainUsesIslandPrompt: saved.mainUsesIslandPrompt !== false,
          quickPrompts,
          quickPromptSchema: 3,
          selectionShortcut: normalizeShortcut(
            saved.selectionShortcut,
            DEFAULT_SELECTION_SHORTCUT,
          ),
          screenAskShortcut: normalizeShortcut(
            saved.screenAskShortcut,
            DEFAULT_SCREEN_ASK_SHORTCUT,
          ),
          searchShortcut: normalizeShortcut(
            saved.searchShortcut,
            DEFAULT_SEARCH_SHORTCUT,
          ),
          sidebarWidth: normalizeSidebarWidth(saved.sidebarWidth),
          overlayShortcuts: normalizeOverlayShortcuts(saved.overlayShortcuts),
          avatar: normalizeAvatar(saved.avatar),
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
          autoSpeakSelection: rest.autoSpeakSelection === true,
          summarizeSpeech: rest.summarizeSpeech !== false,
          // New behaviour defaults on, so an older stored shape gains it without user action.
          revealResponse: rest.revealResponse ?? true,
          autoSendVoice: rest.autoSendVoice ?? true,
          deepThink: rest.deepThink ?? false,
          webSearch: rest.webSearch ?? false,
          ttsVoice: rest.ttsVoice === 'tide' ? 'tide' : DEFAULT_TTS_VOICE,
          openShortcut,
          selectionShortcut: normalizeShortcut(
            rest.selectionShortcut,
            DEFAULT_SELECTION_SHORTCUT,
          ),
          screenAskShortcut: normalizeShortcut(
            rest.screenAskShortcut,
            DEFAULT_SCREEN_ASK_SHORTCUT,
          ),
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
          quickPrompts: normalizeQuickPrompts(rest.quickPrompts),
          overlayShortcuts: normalizeOverlayShortcuts(rest.overlayShortcuts),
          avatar: normalizeAvatar(rest.avatar),
        } as SettingsState
      },
    },
  ),
)

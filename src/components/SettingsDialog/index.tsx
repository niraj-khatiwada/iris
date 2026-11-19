import {
  Button,
  Description,
  Input,
  Label,
  ListBox,
  Modal,
  SearchField,
  Select,
  Switch,
  Tabs,
  TextArea,
  TextField,
} from '@heroui/react'
import { ask } from '@tauri-apps/plugin-dialog'
import {
  Database,
  Info,
  Keyboard,
  LoaderCircle,
  Lock as LockIcon,
  type LucideIcon,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  SearchX,
  Settings2,
  Sparkles,
  Sun,
  Volume2,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'

import AvatarEditor from '@/components/AvatarEditor'
import { useDynamicIslandNotice } from '@/components/dynamic-island/notifications'
import IrisBlob from '@/components/IrisBlob'
import ShortcutRecorder from '@/components/ShortcutRecorder'
import {
  CHAT_STORAGE_KEY,
  CHAT_UI_STORAGE_KEY,
  DEFAULT_BASE_URL,
  DEFAULT_IRIS_AVATAR,
  DEFAULT_MODEL,
  DEFAULT_OPEN_SHORTCUT,
  DEFAULT_OVERLAY_SHORTCUTS,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TTS_VOICE,
  NO_WRITING_ASSIST,
  SETTINGS_STORAGE_KEY,
  THEME_LABELS,
  TTS_VOICES,
} from '@/constants'
import { useAppInfo } from '@/hooks/useAppInfo'
import {
  clearStoredConversations,
  suspendChatStorage,
} from '@/hooks/useChatStorage'
import { useChatStore } from '@/stores/chatStore'
import {
  type OverlayShortcutAction,
  useSettingsStore,
} from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { reloadAppWindows, resetAppData } from '@/tauri/commands/app'
import {
  disableLaunchAtLogin,
  enableLaunchAtLogin,
  isLaunchAtLoginEnabled,
} from '@/tauri/commands/autostart'
import { setOpenShortcut as applyOpenShortcut } from '@/tauri/commands/shortcut'
import {
  hasApiKey,
  listModels,
  type ModelEntry,
  removeApiKey,
  saveApiKey,
} from '@/tauri/commands/voice'
import type { SettingsCategory, ThemeMode } from '@/types/settings'
import { formatShortcut } from '@/utils/shortcut'
import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'

type CategoryId = SettingsCategory

type Category = {
  id: CategoryId
  label: string
  group: 'Settings' | 'Iris'
  icon: LucideIcon
  terms: string[]
}

const CATEGORIES: Category[] = [
  {
    id: 'general',
    label: 'General',
    group: 'Settings',
    icon: Settings2,
    terms: [
      'appearance',
      'theme',
      'light',
      'dark',
      'system',
      'startup',
      'start',
      'login',
      'launch',
      'sign in',
      'open at login',
      'boot',
    ],
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    group: 'Settings',
    icon: Keyboard,
    terms: [
      'shortcut',
      'keyboard',
      'hotkey',
      'summon',
      'open',
      'option',
      'command',
      'control',
      'space',
      'search',
      'find',
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    group: 'Settings',
    icon: Sparkles,
    terms: [
      'ai',
      'api key',
      'api',
      'base url',
      'endpoint',
      'model',
      'connection',
    ],
  },
  {
    id: 'voice',
    label: 'Voice',
    group: 'Settings',
    icon: Volume2,
    terms: ['voice', 'speak', 'read aloud', 'tts', 'stella', 'tide'],
  },
  {
    id: 'storage',
    label: 'Storage',
    group: 'Settings',
    icon: Database,
    terms: ['storage', 'history', 'conversation', 'clear', 'delete'],
  },
  {
    id: 'about',
    label: 'About',
    group: 'Iris',
    icon: Info,
    terms: [
      'about',
      'version',
      'platform',
      'identifier',
      'avatar',
      'bot',
      'appearance',
      'customize',
      'colour',
      'color',
      'body',
      'face',
      'material',
      'hat',
      'glasses',
      'headphones',
      'bow tie',
      'accessory',
    ],
  },
]

const THEME_ICONS: Record<ThemeMode, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

const themeModes: ThemeMode[] = ['light', 'dark', 'system']
const groups: Category['group'][] = ['Settings', 'Iris']

function matchesQuery(query: string, ...values: string[]) {
  const term = query.trim().toLowerCase()
  if (!term) {
    return true
  }
  return values.some((value) => value.toLowerCase().includes(term))
}

function SettingsDialog() {
  const open = useUIStore((state) => state.settingsOpen)
  const closeSettings = useUIStore((state) => state.closeSettings)
  const requestedCategory = useUIStore((state) => state.settingsCategory)
  const clearSettingsCategory = useUIStore(
    (state) => state.clearSettingsCategory,
  )
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<CategoryId>('general')

  useEffect(() => {
    if (!requestedCategory) {
      return
    }
    setQuery('')
    setSelected(requestedCategory)
    clearSettingsCategory()
  }, [clearSettingsCategory, requestedCategory])

  const visibleCategories = CATEGORIES.filter((category) =>
    matchesQuery(query, category.label, category.group, ...category.terms),
  )
  const activeCategory = visibleCategories.some(
    (category) => category.id === selected,
  )
    ? selected
    : visibleCategories[0]?.id

  useEffect(() => {
    if (activeCategory && activeCategory !== selected) {
      setSelected(activeCategory)
    }
  }, [activeCategory, selected])

  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          closeSettings()
        }
      }}
    >
      <Modal.Container>
        <Modal.Dialog
          aria-label="Settings"
          className="glass-dialog relative h-[min(82vh,720px)] w-[min(92vw,960px)] max-w-none overflow-hidden rounded-[28px] p-0"
        >
          <Modal.CloseTrigger />
          <div className="flex h-full min-h-0 flex-col sm:flex-row">
            <aside className="flex shrink-0 flex-col gap-6 border-b border-border/40 bg-foreground/5 p-4 sm:w-60 sm:border-b-0 sm:border-r sm:p-5">
              <SearchField
                aria-label="Search settings"
                className="w-full"
                name="settings-search"
                value={query}
                variant="secondary"
                onChange={setQuery}
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    {...NO_WRITING_ASSIST}
                    placeholder="Search settings"
                  />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>

              <nav className="flex flex-col gap-4">
                {groups.map((group) => {
                  const items = visibleCategories.filter(
                    (category) => category.group === group,
                  )
                  if (items.length === 0) {
                    return null
                  }

                  return (
                    <div key={group} className="space-y-0.5">
                      <p className="px-2.5 pb-1 text-[11px] font-medium text-muted">
                        {group}
                      </p>
                      {items.map((category) => {
                        const Icon = category.icon
                        const active = category.id === activeCategory

                        return (
                          <Button
                            key={category.id}
                            className={cn(
                              'h-8 w-full justify-start gap-2 rounded-lg px-2.5 text-[13px] font-medium transition-colors',
                              active
                                ? 'border border-foreground/10 bg-foreground/10 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                                : 'border border-transparent text-muted hover:bg-foreground/5 hover:text-foreground',
                            )}
                            variant="ghost"
                            aria-current={active ? 'page' : undefined}
                            onPress={() => setSelected(category.id)}
                          >
                            <Icon className="size-3.5 shrink-0" />
                            {category.label}
                          </Button>
                        )
                      })}
                    </div>
                  )
                })}
              </nav>
            </aside>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 pt-10">
                {activeCategory ? (
                  <SettingsPanel category={activeCategory} query={query} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <SearchX className="mb-3 size-6 text-muted" />
                    <p className="text-sm font-medium">No settings found</p>
                    <p className="mt-1 max-w-56 text-xs leading-5 text-muted">
                      Try a different word, like “theme” or “API key”.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function SettingsPanel({
  category,
  query,
}: {
  category: CategoryId
  query: string
}) {
  switch (category) {
    case 'general':
      return <GeneralPanel query={query} />
    case 'shortcuts':
      return <ShortcutsPanel query={query} />
    case 'ai':
      return <AiPanel query={query} />
    case 'voice':
      return <VoicePanel query={query} />
    case 'storage':
      return <StoragePanel query={query} />
    case 'about':
      return <AboutPanel query={query} />
  }
}

function GeneralPanel({ query }: { query: string }) {
  const theme = useSettingsStore((state) => state.theme)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const revealResponse = useSettingsStore((state) => state.revealResponse)
  const setRevealResponse = useSettingsStore((state) => state.setRevealResponse)
  const [launchAtLogin, setLaunchAtLogin] = useState(false)
  // The LaunchAgent is owned by macOS, so the switch stays disabled until the real state is known.
  const [launchAtLoginReady, setLaunchAtLoginReady] = useState(!isTauri())
  const [launchAtLoginBusy, setLaunchAtLoginBusy] = useState(false)
  const [launchAtLoginError, setLaunchAtLoginError] = useState<string | null>(
    null,
  )

  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let cancelled = false
    void isLaunchAtLoginEnabled()
      .then((enabled) => {
        if (!cancelled) {
          setLaunchAtLogin(enabled)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLaunchAtLoginError(
            error instanceof Error ? error.message : String(error),
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLaunchAtLoginReady(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const recordLaunchAtLogin = async (enabled: boolean) => {
    const previous = launchAtLogin
    setLaunchAtLogin(enabled)
    setLaunchAtLoginError(null)

    if (!isTauri()) {
      return
    }

    setLaunchAtLoginBusy(true)
    try {
      if (enabled) {
        await enableLaunchAtLogin()
      } else {
        await disableLaunchAtLogin()
      }
    } catch (error) {
      setLaunchAtLogin(previous)
      setLaunchAtLoginError(
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      setLaunchAtLoginBusy(false)
    }
  }

  return (
    <>
      <SettingsSection title="Appearance">
        <SettingRow
          title="Theme"
          description="Follow the system, or always use light or dark."
          query={query}
          search={['appearance', 'theme', 'light', 'dark', 'system']}
        >
          <Tabs
            className="w-fit"
            selectedKey={theme}
            onSelectionChange={(key) => {
              if (key === 'light' || key === 'dark' || key === 'system') {
                setTheme(key)
              }
            }}
          >
            <Tabs.ListContainer className="w-fit rounded-none bg-transparent p-0">
              <Tabs.List
                aria-label="Theme"
                className="w-fit gap-0.5 rounded-full border border-border/50 bg-surface/40 p-0.5"
              >
                {themeModes.map((mode) => {
                  const Icon = THEME_ICONS[mode]

                  return (
                    <Tabs.Tab
                      key={mode}
                      aria-label={THEME_LABELS[mode]}
                      className="h-7 w-9 rounded-full px-0 text-muted data-[selected=true]:text-foreground"
                      id={mode}
                    >
                      <Icon className="size-3.5" />
                      <Tabs.Indicator className="rounded-full bg-foreground/10 shadow-none" />
                    </Tabs.Tab>
                  )
                })}
              </Tabs.List>
            </Tabs.ListContainer>
            {themeModes.map((mode) => (
              <Tabs.Panel key={mode} className="sr-only" id={mode}>
                {THEME_LABELS[mode]} theme
              </Tabs.Panel>
            ))}
          </Tabs>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Startup">
        <SwitchRow
          error={launchAtLoginError}
          isDisabled={!launchAtLoginReady || launchAtLoginBusy}
          isSelected={launchAtLogin}
          title="Start at login"
          description="Launch Iris in the menu bar automatically when you sign in to this Mac."
          query={query}
          search={[
            'startup',
            'start',
            'login',
            'launch',
            'sign in',
            'open at login',
            'boot',
          ]}
          onChange={(enabled) => void recordLaunchAtLogin(enabled)}
        />
      </SettingsSection>

      <SettingsSection title="Iris Island">
        <SwitchRow
          isSelected={revealResponse}
          title="Reveal response by default"
          description="Show the reply as soon as it arrives. Turn this off to keep it hidden until you press Show response, for example when you only want to hear it read aloud."
          query={query}
          search={['overlay', 'response', 'reveal', 'show', 'hidden', 'voice']}
          onChange={setRevealResponse}
        />
      </SettingsSection>
    </>
  )
}

const OVERLAY_SHORTCUT_ROWS: Array<{
  id: OverlayShortcutAction
  title: string
  description: string
  search: string[]
}> = [
  {
    id: 'capture',
    title: 'Capture screen',
    description: 'Freeze the screen and select a region.',
    search: ['capture', 'screen', 'screenshot', 'region', 'shortcut'],
  },
  {
    id: 'newChat',
    title: 'New chat',
    description: 'Start a fresh quick conversation.',
    search: ['new', 'chat', 'conversation', 'shortcut'],
  },
  {
    id: 'restorePrevious',
    title: 'Previous conversation',
    description: 'Switch back to the previous quick conversation.',
    search: [
      'previous',
      'restore',
      'back',
      'undo',
      'new chat',
      'conversation',
      'shortcut',
    ],
  },
  {
    id: 'toggleResponse',
    title: 'Show / hide response',
    description: 'Reveal the reply below Iris Island, or hide it again.',
    search: ['show', 'hide', 'response', 'reply', 'reveal', 'shortcut'],
  },
  {
    id: 'deepThink',
    title: 'Thinking mode',
    description: 'Toggle thinking mode for the next message.',
    search: ['thinking', 'reasoning', 'think', 'shortcut'],
  },
  {
    id: 'webSearch',
    title: 'Web search',
    description: 'Toggle web search for the next message.',
    search: ['web', 'search', 'shortcut'],
  },
  {
    id: 'voiceInput',
    title: 'Voice input',
    description: 'Start voice input; Enter sends and Escape cancels.',
    search: ['voice', 'input', 'microphone', 'dictate', 'speech', 'shortcut'],
  },
  {
    id: 'stopSpeaking',
    title: 'Stop read-aloud',
    description: 'Stop a reply that is being prepared or read aloud.',
    search: [
      'stop',
      'read aloud',
      'speech',
      'audio',
      'voice',
      'tts',
      'shortcut',
    ],
  },
]

function ShortcutsPanel({ query }: { query: string }) {
  const openShortcut = useSettingsStore((state) => state.openShortcut)
  const setOpenShortcut = useSettingsStore((state) => state.setOpenShortcut)
  const searchShortcut = useSettingsStore((state) => state.searchShortcut)
  const setSearchShortcut = useSettingsStore((state) => state.setSearchShortcut)
  const overlayShortcuts = useSettingsStore((state) => state.overlayShortcuts)
  const setOverlayShortcut = useSettingsStore(
    (state) => state.setOverlayShortcut,
  )
  const [recording, setRecording] = useState(false)
  const [recordingSearch, setRecordingSearch] = useState(false)
  const [recordingAction, setRecordingAction] =
    useState<OverlayShortcutAction | null>(null)

  const recordShortcut = async (shortcut: string) => {
    const conflict = [searchShortcut, ...Object.values(overlayShortcuts)].find(
      (value) => value.toLowerCase() === shortcut.toLowerCase(),
    )
    if (conflict) {
      throw new Error('That shortcut is already in use.')
    }

    if (isTauri()) {
      await applyOpenShortcut(shortcut)
    }
    setOpenShortcut(shortcut)
  }

  const recordSearchShortcut = async (shortcut: string) => {
    const conflict = [openShortcut, ...Object.values(overlayShortcuts)].find(
      (value) => value.toLowerCase() === shortcut.toLowerCase(),
    )
    if (conflict) {
      throw new Error('That shortcut is already in use.')
    }

    setSearchShortcut(shortcut)
  }

  const recordOverlayShortcut = async (shortcut: string) => {
    if (!recordingAction) {
      return
    }

    const conflict = [
      openShortcut,
      searchShortcut,
      ...Object.entries(overlayShortcuts)
        .filter(([action]) => action !== recordingAction)
        .map(([, value]) => value),
    ].find((value) => value.toLowerCase() === shortcut.toLowerCase())
    if (conflict) {
      throw new Error('That shortcut is already in use.')
    }

    setOverlayShortcut(recordingAction, shortcut)
  }

  return (
    <>
      <SettingsSection title="Keyboard">
        <SettingRow
          title="Open Iris"
          description="Click to record a new shortcut for Iris Island."
          query={query}
          search={[
            'shortcut',
            'keyboard',
            'hotkey',
            'open',
            'summon',
            'option',
            'command',
            'control',
            'space',
          ]}
        >
          <Button
            className="min-w-40 justify-between gap-3"
            variant="secondary"
            onPress={() => setRecording(true)}
          >
            <span className="font-medium">{formatShortcut(openShortcut)}</span>
            <Keyboard className="size-3.5 shrink-0 text-muted" />
          </Button>
        </SettingRow>

        <SettingRow
          title="Search chats"
          description="Focus the search field in the history window."
          query={query}
          search={[
            'search',
            'find',
            'chats',
            'messages',
            'shortcut',
            'keyboard',
          ]}
        >
          <Button
            className="min-w-40 justify-between gap-3"
            variant="secondary"
            onPress={() => setRecordingSearch(true)}
          >
            <span className="font-medium">
              {formatShortcut(searchShortcut)}
            </span>
            <Keyboard className="size-3.5 shrink-0 text-muted" />
          </Button>
        </SettingRow>

        {OVERLAY_SHORTCUT_ROWS.map((action) => (
          <SettingRow
            key={action.id}
            title={action.title}
            description={action.description}
            query={query}
            search={action.search}
          >
            <Button
              className="min-w-40 justify-between gap-3"
              variant="secondary"
              onPress={() => setRecordingAction(action.id)}
            >
              <span className="font-medium">
                {formatShortcut(overlayShortcuts[action.id])}
              </span>
              <Keyboard className="size-3.5 shrink-0 text-muted" />
            </Button>
          </SettingRow>
        ))}
      </SettingsSection>

      <ShortcutRecorder
        open={recording}
        onOpenChange={setRecording}
        onRecord={recordShortcut}
      />

      <ShortcutRecorder
        open={recordingSearch}
        onOpenChange={setRecordingSearch}
        onRecord={recordSearchShortcut}
      />

      <ShortcutRecorder
        open={recordingAction !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRecordingAction(null)
          }
        }}
        onRecord={recordOverlayShortcut}
      />
    </>
  )
}

/**
 * The API key is stored in the Iris database, so it is write-only from the app's point of view:
 * once saved, Settings shows that a key is stored and offers Replace or Remove, never the key itself.
 *
 * The saved hint is cached in localStorage rather than read back from the database, so the panel
 * renders instantly without a round trip.
 */
function ApiKeyField({ query }: { query: string }) {
  const apiKeyPresent = useSettingsStore((state) => state.apiKeyPresent)
  const apiKeyHint = useSettingsStore((state) => state.apiKeyHint)
  const setApiKeyState = useSettingsStore((state) => state.setApiKeyState)
  const markApiKeyChanged = useSettingsStore((state) => state.markApiKeyChanged)
  const setModel = useSettingsStore((state) => state.setModel)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Presence comes from the credential table, so opening this panel never reads the key itself.
  useEffect(() => {
    if (!isTauri()) {
      return
    }

    void hasApiKey()
      .then((present) => {
        setApiKeyState({ present, hint: present ? apiKeyHint : null })
      })
      .catch(() => {
        // Keep the cached flag; saving or removing reports its own errors.
      })
  }, [apiKeyHint, setApiKeyState])

  const save = async () => {
    if (!draft.trim() || busy) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      const { hint, present } = await saveApiKey(draft)
      setApiKeyState({ present, hint })
      // A different key usually means a different provider: drop the old model so the catalogue
      // refetches and an id from the previous provider is never sent to the new one.
      setModel('')
      markApiKeyChanged()
      setDraft('')
      setEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy) {
      return
    }

    setBusy(true)
    setError(null)
    try {
      const { hint, present } = await removeApiKey()
      setApiKeyState({ present, hint })
      setModel('')
      markApiKeyChanged()
      setDraft('')
      setEditing(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const saved = apiKeyPresent
  const showField = !saved || editing

  return (
    <SettingField
      title="API key"
      description="Stored in the Iris database. Used for chat, read-aloud, and voice input."
      query={query}
      search={['ai', 'api', 'api key', 'key', 'credential', 'database']}
    >
      <div className="flex w-full flex-col gap-2">
        {showField ? (
          <div className="flex items-center gap-2">
            <TextField
              className="w-full"
              name="apiKey"
              value={draft}
              variant="secondary"
              onChange={setDraft}
            >
              <Input
                {...NO_WRITING_ASSIST}
                aria-label="API key"
                autoComplete="off"
                placeholder="sk-..."
                type="password"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void save()
                  }
                }}
              />
            </TextField>
            <Button
              isDisabled={!draft.trim() || busy}
              size="sm"
              variant="secondary"
              onPress={() => void save()}
            >
              Save
            </Button>
            {saved ? (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => {
                  setDraft('')
                  setEditing(false)
                  setError(null)
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-full border border-border/60 bg-surface/40 px-2.5 py-1 text-[11px] text-muted">
              <LockIcon className="size-3" />
              Key saved{apiKeyHint ? ` · ${apiKeyHint}` : ''}
            </span>
            <Button
              isDisabled={busy}
              className="h-8 rounded-full px-3 text-[13px]"
              size="sm"
              variant="ghost"
              onPress={() => setEditing(true)}
            >
              Replace
            </Button>
            <Button
              isDisabled={busy}
              className="h-8 rounded-full px-3 text-[13px]"
              size="sm"
              variant="ghost"
              onPress={() => void remove()}
            >
              Remove
            </Button>
          </div>
        )}

        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    </SettingField>
  )
}

function AiPanel({ query }: { query: string }) {
  const baseUrl = useSettingsStore((state) => state.baseUrl)
  const setBaseUrl = useSettingsStore((state) => state.setBaseUrl)

  return (
    <>
      <SettingsSection title="DeepSeek">
        <ApiKeyField query={query} />

        <SettingField
          title="Base URL"
          description="The official DeepSeek API by default. Change it only for a proxy that still speaks DeepSeek's API."
          query={query}
          search={['ai', 'base url', 'url', 'endpoint', 'proxy', 'connection']}
        >
          <TextField
            className="w-full"
            name="baseUrl"
            value={baseUrl}
            variant="secondary"
            onChange={setBaseUrl}
          >
            <Input
              {...NO_WRITING_ASSIST}
              aria-label="Base URL"
              placeholder={DEFAULT_BASE_URL}
            />
          </TextField>
        </SettingField>

        <ModelField query={query} />
      </SettingsSection>

      <SettingsSection title="Prompt">
        <SystemPromptFields query={query} />
      </SettingsSection>
    </>
  )
}

/**
 * The island and main chat have separate prompts. The main chat follows the island prompt by
 * default; turning that off reveals an independent field.
 */
function SystemPromptFields({ query }: { query: string }) {
  const islandSystemPrompt = useSettingsStore(
    (state) => state.islandSystemPrompt,
  )
  const mainSystemPrompt = useSettingsStore((state) => state.mainSystemPrompt)
  const mainUsesIslandPrompt = useSettingsStore(
    (state) => state.mainUsesIslandPrompt,
  )
  const setIslandSystemPrompt = useSettingsStore(
    (state) => state.setIslandSystemPrompt,
  )
  const setMainSystemPrompt = useSettingsStore(
    (state) => state.setMainSystemPrompt,
  )
  const setMainUsesIslandPrompt = useSettingsStore(
    (state) => state.setMainUsesIslandPrompt,
  )

  return (
    <>
      <SettingField
        title="Iris Island system prompt"
        description="Instructions for replies in the Iris Island overlay: how to address you, the tone you want, and any standing rules."
        query={query}
        search={[
          'ai',
          'island',
          'overlay',
          'system',
          'prompt',
          'instructions',
          'personality',
          'tone',
          'custom',
        ]}
      >
        <div className="flex w-full flex-col gap-2">
          <TextArea
            {...NO_WRITING_ASSIST}
            aria-label="Iris Island system prompt"
            className="min-h-32 w-full resize-y text-[13px] leading-5"
            placeholder={DEFAULT_SYSTEM_PROMPT}
            rows={6}
            value={islandSystemPrompt}
            variant="secondary"
            onChange={(event) => setIslandSystemPrompt(event.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] leading-4 text-muted">
              Reset restores Iris&apos;s built-in instructions.
            </p>
            <Button
              isDisabled={islandSystemPrompt === DEFAULT_SYSTEM_PROMPT}
              size="sm"
              variant="ghost"
              onPress={() => setIslandSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
            >
              Reset
            </Button>
          </div>
        </div>
      </SettingField>

      <SettingField
        title="Main chat system prompt"
        description="Instructions for the history window's main chat. Keep Same as Iris Island on to share one prompt."
        query={query}
        search={[
          'ai',
          'main',
          'chat',
          'system',
          'prompt',
          'instructions',
          'same',
          'island',
          'overlay',
        ]}
      >
        <div className="flex w-full flex-col gap-2">
          <Switch
            className="w-full"
            isSelected={mainUsesIslandPrompt}
            onChange={setMainUsesIslandPrompt}
          >
            <Switch.Content className="flex w-full items-center justify-between gap-3">
              <Label className="text-xs text-muted">Same as Iris Island</Label>
              <Switch.Control className="shrink-0">
                <Switch.Thumb />
              </Switch.Control>
            </Switch.Content>
          </Switch>

          <TextArea
            {...NO_WRITING_ASSIST}
            aria-label="Main chat system prompt"
            className="min-h-32 w-full resize-y text-[13px] leading-5"
            disabled={mainUsesIslandPrompt}
            placeholder={DEFAULT_SYSTEM_PROMPT}
            rows={6}
            value={mainUsesIslandPrompt ? islandSystemPrompt : mainSystemPrompt}
            variant="secondary"
            onChange={(event) => setMainSystemPrompt(event.target.value)}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] leading-4 text-muted">
              {mainUsesIslandPrompt
                ? 'Main chat follows the Iris Island prompt.'
                : "Reset restores Iris's built-in instructions."}
            </p>
            <Button
              isDisabled={
                mainUsesIslandPrompt ||
                mainSystemPrompt === DEFAULT_SYSTEM_PROMPT
              }
              size="sm"
              variant="ghost"
              onPress={() => setMainSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
            >
              Reset
            </Button>
          </div>
        </div>
      </SettingField>
    </>
  )
}

/**
 * Model selection: DeepSeek's catalogue becomes a dropdown, so nobody has to type a model id.
 * The list loads when the panel opens, and Refresh re-fetches it after a key or URL change.
 */
function ModelField({ query }: { query: string }) {
  const model = useSettingsStore((state) => state.model)
  const setModel = useSettingsStore((state) => state.setModel)
  const baseUrl = useSettingsStore((state) => state.baseUrl)
  const apiKeyPresent = useSettingsStore((state) => state.apiKeyPresent)
  // A new key means a new account: refetch rather than trust the previous catalogue.
  const apiKeyRevision = useSettingsStore((state) => state.apiKeyRevision)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: apiKeyRevision forces a refetch on a new key
  const load = useCallback(async () => {
    // Without a key the catalogue cannot be fetched.
    if (!isTauri() || !apiKeyPresent) {
      setModels([])
      return
    }

    setBusy(true)
    setError(null)
    try {
      const available = await listModels(baseUrl)
      setModels(available)

      // Never overwrite a model the user already chose: Refresh exists to update the list, not to
      // reset the preference. Only pick one when nothing is selected yet, or when the saved model
      // is no longer offered.
      const chosen = useSettingsStore.getState().model
      const offered = available.some((entry) => entry.id === chosen)
      const selected = offered ? chosen : available[0]?.id
      if (selected && !offered) {
        setModel(selected)
      }
    } catch (reason) {
      // A failed fetch must not leave the previous catalogue on screen.
      setModels([])
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [apiKeyPresent, apiKeyRevision, baseUrl, setModel])

  // Load as soon as the panel opens; Refresh only re-runs it.
  useEffect(() => {
    void load()
  }, [load])

  const options: ModelEntry[] =
    models.length > 0
      ? models
      : // Before the catalogue loads, keep the stored model selectable — but only once a key can
        // actually use it. Without a key, showing a model would imply one is configured.
        apiKeyPresent && model
        ? [{ id: model }]
        : []

  const modelIds = options.map((entry) => entry.id)

  if (!apiKeyPresent) {
    return (
      <SettingField
        title="Model"
        description="Chosen from the models your key can use."
        query={query}
        search={['ai', 'api', 'model', 'connection']}
      >
        <p className="text-xs text-muted">Set an API key to choose a model.</p>
      </SettingField>
    )
  }

  return (
    <SettingField
      title="Model"
      description="DeepSeek model used for replies, chosen from the models your key can use."
      query={query}
      search={['ai', 'api', 'model', 'refresh', 'connection']}
    >
      <div className="flex w-full flex-col gap-2">
        <div className="flex items-center gap-2">
          <Select
            aria-label="Model"
            className="w-full"
            isDisabled={busy && options.length === 0}
            placeholder={busy ? 'Loading models…' : 'Select a model'}
            value={options.length > 0 ? model || null : null}
            variant="secondary"
            onChange={(key) => {
              if (typeof key === 'string') {
                setModel(key)
              }
            }}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {modelIds.map((id) => (
                  <ListBox.Item key={id} id={id} textValue={id}>
                    {id}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <Button
            aria-label="Refresh models"
            isDisabled={busy || !isTauri()}
            size="sm"
            variant="secondary"
            onPress={() => void load()}
          >
            {busy ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Refresh
          </Button>
        </div>

        {!error && models.length > 0 ? (
          <p className="text-[11px] text-muted">
            {models.length} model{models.length === 1 ? '' : 's'} available
          </p>
        ) : null}

        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    </SettingField>
  )
}

function VoicePanel({ query }: { query: string }) {
  const autoSpeak = useSettingsStore((state) => state.autoSpeak)
  const setAutoSpeak = useSettingsStore((state) => state.setAutoSpeak)
  const autoSendVoice = useSettingsStore((state) => state.autoSendVoice)
  const setAutoSendVoice = useSettingsStore((state) => state.setAutoSendVoice)
  const ttsVoice = useSettingsStore((state) => state.ttsVoice)
  const setTtsVoice = useSettingsStore((state) => state.setTtsVoice)

  return (
    <>
      <SettingsSection title="Playback">
        <SwitchRow
          isSelected={autoSpeak}
          title="Read responses aloud"
          description="Speak every reply automatically with AI voice."
          query={query}
          search={['voice', 'speak', 'read aloud', 'tts']}
          onChange={setAutoSpeak}
        />

        <SettingRow
          title="Voice"
          description="The voice used when Iris reads a reply aloud."
          query={query}
          search={['voice', 'stella', 'tide', 'tts', 'speak']}
        >
          <Tabs
            className="w-fit"
            selectedKey={ttsVoice}
            onSelectionChange={(key) => {
              if (key === 'stella' || key === 'tide') {
                setTtsVoice(key)
              }
            }}
          >
            <Tabs.ListContainer className="w-fit rounded-none bg-transparent p-0">
              <Tabs.List
                aria-label="Voice"
                className="w-fit gap-0.5 rounded-full border border-border/50 bg-surface/40 p-0.5"
              >
                {TTS_VOICES.map((voice) => (
                  <Tabs.Tab
                    key={voice.id}
                    className="h-7 w-16 rounded-full px-0 text-[11px] font-medium text-muted data-[selected=true]:text-foreground"
                    id={voice.id}
                  >
                    {voice.label}
                    <Tabs.Indicator className="rounded-full bg-foreground/10 shadow-none" />
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs.ListContainer>
            {TTS_VOICES.map((voice) => (
              <Tabs.Panel key={voice.id} className="sr-only" id={voice.id}>
                {voice.label} voice
              </Tabs.Panel>
            ))}
          </Tabs>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Voice input">
        <SwitchRow
          isSelected={autoSendVoice}
          title="Send after listening"
          description="Send the transcript automatically. When off, it is placed in the input."
          query={query}
          search={['voice input', 'microphone', 'listen', 'transcribe', 'send']}
          onChange={setAutoSendVoice}
        />
      </SettingsSection>
    </>
  )
}

function StoragePanel({ query }: { query: string }) {
  const clearAll = useChatStore((state) => state.clearAll)
  const notify = useDynamicIslandNotice()

  return (
    <SettingsSection title="Local data">
      <SettingRow
        title="Conversation history"
        description="Stored locally on this Mac and shared with the history window."
        query={query}
        search={['history', 'conversation', 'clear', 'delete', 'storage']}
      >
        <Button
          size="sm"
          variant="danger-soft"
          onPress={async () => {
            const message = 'Delete all conversations? This cannot be undone.'
            const confirmed = isTauri()
              ? await ask(message, {
                  title: 'Clear conversation history',
                  kind: 'warning',
                  okLabel: 'Delete',
                  cancelLabel: 'Cancel',
                })
              : window.confirm(message)

            if (confirmed) {
              // Delete through the storage hook: it pauses the mirror first, so a pending save or
              // a focus hydrate cannot put the conversations straight back.
              if (isTauri()) {
                try {
                  await clearStoredConversations()
                } catch (error) {
                  notify({
                    id: 'clear-failed',
                    title: 'Could not clear history',
                    subtitle:
                      error instanceof Error ? error.message : String(error),
                    tone: 'error',
                  })
                  return
                }
              }
              clearAll()
              notify({
                id: 'history-cleared',
                title: 'History cleared',
                subtitle: 'All local conversations were removed.',
                tone: 'success',
              })
            }
          }}
        >
          Clear
        </Button>
      </SettingRow>

      <SettingRow
        title="Reset Iris"
        description="Delete every conversation, setting, and the API key, then start fresh."
        query={query}
        search={['reset', 'erase', 'purge', 'all data', 'factory', 'api key']}
      >
        <Button
          size="sm"
          variant="danger-soft"
          onPress={async () => {
            const message =
              'Reset Iris? This deletes every conversation, all settings, and your API key. Iris will start fresh.'
            const confirmed = isTauri()
              ? await ask(message, {
                  title: 'Reset Iris',
                  kind: 'warning',
                  okLabel: 'Reset',
                  cancelLabel: 'Cancel',
                })
              : window.confirm(message)

            if (!confirmed) {
              return
            }

            // Stop the SQLite mirror first: a focus hydrate could otherwise reload the
            // conversations that are about to be erased.
            suspendChatStorage()
            useChatStore.getState().clearAll()
            // Reset removes the stored API key too, so no request can be authenticated afterwards.
            useSettingsStore.setState({
              theme: 'dark',
              baseUrl: DEFAULT_BASE_URL,
              model: DEFAULT_MODEL,
              islandSystemPrompt: DEFAULT_SYSTEM_PROMPT,
              mainSystemPrompt: DEFAULT_SYSTEM_PROMPT,
              mainUsesIslandPrompt: true,
              apiKeyPresent: false,
              apiKeyHint: null,
              autoSpeak: true,
              autoSendVoice: true,
              revealResponse: true,
              deepThink: false,
              webSearch: false,
              ttsVoice: DEFAULT_TTS_VOICE,
              openShortcut: DEFAULT_OPEN_SHORTCUT,
              overlayShortcuts: { ...DEFAULT_OVERLAY_SHORTCUTS },
              avatar: { ...DEFAULT_IRIS_AVATAR },
            })
            localStorage.removeItem(CHAT_STORAGE_KEY)
            localStorage.removeItem(CHAT_UI_STORAGE_KEY)
            localStorage.removeItem(SETTINGS_STORAGE_KEY)

            try {
              if (isTauri()) {
                await resetAppData()
                // Reload every webview instead of restarting the process: app.restart() races the
                // single-instance plugin and can leave Iris running with no window. A reload gives
                // the same fresh state without losing the menu bar process.
                await reloadAppWindows()
              } else {
                window.location.reload()
              }
            } catch (error) {
              notify({
                id: 'reset-failed',
                title: 'Could not reset Iris',
                subtitle:
                  error instanceof Error ? error.message : String(error),
                tone: 'error',
              })
            }
          }}
        >
          Reset
        </Button>
      </SettingRow>
    </SettingsSection>
  )
}

function AboutPanel({ query }: { query: string }) {
  const info = useAppInfo()
  const platform = info ? `${info.platform} · ${info.arch}` : '—'
  const [editing, setEditing] = useState(false)

  return (
    <>
      {editing ? (
        <div className="avatar-preview sticky top-4 z-20 mx-auto mb-5 w-fit rounded-full p-1.5">
          <IrisBlob emotion="happy" size={76} />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 pb-7">
          <IrisBlob emotion="happy" size={100} />
          <Button
            aria-expanded={editing}
            className="h-8 min-w-0 gap-2 rounded-full px-3.5 text-xs"
            size="sm"
            variant="secondary"
            onPress={() => setEditing(true)}
          >
            <Palette className="size-3.5" />
            Edit avatar
          </Button>
        </div>
      )}

      {editing ? <AvatarEditor onDone={() => setEditing(false)} /> : null}

      <SettingsSection title="Iris">
        <SettingRow title="Version" query={query} search={['about', 'version']}>
          <Value>{info?.version ?? '—'}</Value>
        </SettingRow>
        <SettingRow
          title="Platform"
          query={query}
          search={['about', 'platform', 'macos', 'architecture']}
        >
          <Value>{platform}</Value>
        </SettingRow>
      </SettingsSection>
    </>
  )
}

function SettingsSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="mb-9 last:mb-0">
      <h3 className="mb-2 text-[17px] font-semibold tracking-tight">{title}</h3>
      <div className="divide-y divide-border/40">{children}</div>
    </section>
  )
}

function SettingRow({
  title,
  description,
  query,
  search,
  children,
}: {
  title: string
  description?: string
  query: string
  search: string[]
  children: ReactNode
}) {
  if (!matchesQuery(query, title, description ?? '', ...search)) {
    return null
  }

  return (
    <div className="flex items-center justify-between gap-8 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SettingField({
  title,
  description,
  query,
  search,
  children,
}: {
  title: string
  description?: string
  query: string
  search: string[]
  children: ReactNode
}) {
  if (!matchesQuery(query, title, description ?? '', ...search)) {
    return null
  }

  return (
    <div className="space-y-2.5 py-4">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function SwitchRow({
  title,
  description,
  error,
  isSelected,
  isDisabled = false,
  onChange,
  query,
  search,
}: {
  title: string
  description: string
  error?: string | null
  isSelected: boolean
  isDisabled?: boolean
  onChange: (isSelected: boolean) => void
  query: string
  search: string[]
}) {
  if (!matchesQuery(query, title, description, ...search)) {
    return null
  }

  return (
    <Switch
      className="w-full"
      isDisabled={isDisabled}
      isSelected={isSelected}
      onChange={onChange}
    >
      <Switch.Content className="flex w-full items-center justify-between gap-8 py-4">
        <span className="min-w-0">
          <Label className="text-sm font-medium">{title}</Label>
          <Description className="mt-0.5 block text-xs leading-5 text-muted">
            {description}
          </Description>
          {error ? (
            <span className="mt-1 block text-xs leading-5 text-danger">
              {error}
            </span>
          ) : null}
        </span>
        <Switch.Control className="shrink-0">
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  )
}

function Value({ children }: { children: ReactNode }) {
  return <span className="text-sm text-muted">{children}</span>
}

SettingsDialog.displayName = 'SettingsDialog'

export default SettingsDialog

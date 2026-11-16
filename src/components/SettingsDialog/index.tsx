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
  PlugZap,
  RefreshCw,
  SearchX,
  Settings2,
  Sparkles,
  Sun,
  Volume2,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useState } from 'react'

import { useDynamicIslandNotice } from '@/components/dynamic-island/notifications'
import IrisBlob from '@/components/IrisBlob'
import ShortcutRecorder from '@/components/ShortcutRecorder'
import type { ApiFormat } from '@/constants'
import {
  CHAT_STORAGE_KEY,
  DEFAULT_ASR_URL,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_OPEN_SHORTCUT,
  DEFAULT_TTS_URL,
  DEFAULT_TTS_VOICE,
  SETTINGS_STORAGE_KEY,
  THEME_LABELS,
  TTS_VOICES,
} from '@/constants'
import { useAppInfo } from '@/hooks/useAppInfo'
import { suspendChatStorage } from '@/hooks/useChatStorage'
import { useChatStore } from '@/stores/chatStore'
import {
  type OverlayShortcutAction,
  useSettingsStore,
} from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { resetAppData, restartApp } from '@/tauri/commands/app'
import { setOpenShortcut as applyOpenShortcut } from '@/tauri/commands/shortcut'
import {
  type CapabilityReport,
  type EndpointTest,
  hasApiKey,
  listModels,
  type ModelEntry,
  removeApiKey,
  saveApiKey,
  testAsrUrl,
  testCapabilities,
  testTtsUrl,
} from '@/tauri/commands/voice'
import type { ThemeMode } from '@/types/settings'
import { resolveEndpoint } from '@/utils/endpoint'
import { formatShortcut } from '@/utils/shortcut'
import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'

type CategoryId = 'general' | 'shortcuts' | 'ai' | 'voice' | 'storage' | 'about'

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
    terms: ['appearance', 'theme', 'light', 'dark', 'system'],
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
    terms: ['about', 'version', 'platform', 'identifier'],
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
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<CategoryId>('general')

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
                  <SearchField.Input placeholder="Search settings" />
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

      <SettingsSection title="Iris Overlay">
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
    description: 'Archive the current quick chat and start fresh.',
    search: ['new', 'chat', 'conversation', 'shortcut'],
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
]

function ShortcutsPanel({ query }: { query: string }) {
  const openShortcut = useSettingsStore((state) => state.openShortcut)
  const setOpenShortcut = useSettingsStore((state) => state.setOpenShortcut)
  const overlayShortcuts = useSettingsStore((state) => state.overlayShortcuts)
  const setOverlayShortcut = useSettingsStore(
    (state) => state.setOverlayShortcut,
  )
  const [recording, setRecording] = useState(false)
  const [recordingAction, setRecordingAction] =
    useState<OverlayShortcutAction | null>(null)

  const recordShortcut = async (shortcut: string) => {
    if (isTauri()) {
      await applyOpenShortcut(shortcut)
    }
    setOpenShortcut(shortcut)
  }

  const recordOverlayShortcut = async (shortcut: string) => {
    if (!recordingAction) {
      return
    }

    const conflict = [
      openShortcut,
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
          description="Click to record a new shortcut for the quick overlay."
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
 * The API key lives in the macOS Keychain, so it is write-only from the app's point of view: once
 * saved, Settings shows that a key is stored and offers Replace or Remove, never the key itself.
 *
 * The saved hint is cached in localStorage rather than read back from the Keychain, because a read
 * prompts for Keychain access; opening this panel should never do that.
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

  // Presence comes from an attributes-only query: it never decrypts the key, so no prompt.
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
      description="Kept in your macOS Keychain. Used for chat, read-aloud, and voice input."
      query={query}
      search={['ai', 'api', 'api key', 'key', 'keychain', 'connection']}
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
                aria-label="API key"
                autoComplete="off"
                placeholder="sk-..."
                spellCheck={false}
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
  const apiFormat = useSettingsStore((state) => state.apiFormat)
  const setApiFormat = useSettingsStore((state) => state.setApiFormat)

  return (
    <SettingsSection title="Connection">
      <ApiKeyField query={query} />

      <SettingField
        title="Base URL"
        description="API origin. Speech and transcription URLs can inherit it with {{base_url}}."
        query={query}
        search={['ai', 'base url', 'url', 'endpoint', 'connection']}
      >
        <TextField
          className="w-full"
          name="baseUrl"
          value={baseUrl}
          variant="secondary"
          onChange={setBaseUrl}
        >
          <Input aria-label="Base URL" placeholder="https://api.example.com" />
        </TextField>
      </SettingField>

      <SettingField
        title="API format"
        description="How Iris talks to this provider. Anthropic uses /v1/messages; OpenAI uses /v1/chat/completions."
        query={query}
        search={[
          'ai',
          'api',
          'format',
          'anthropic',
          'openai',
          'wire',
          'connection',
        ]}
      >
        <Tabs
          className="w-fit"
          selectedKey={apiFormat}
          onSelectionChange={(key) => {
            if (key === 'anthropic' || key === 'openai') {
              setApiFormat(key)
            }
          }}
        >
          <Tabs.ListContainer className="w-fit rounded-none bg-transparent p-0">
            <Tabs.List
              aria-label="API format"
              className="w-fit gap-0.5 rounded-full border border-border/50 bg-surface/40 p-0.5"
            >
              {API_FORMATS.map((format) => (
                <Tabs.Tab
                  key={format.id}
                  className="h-7 w-24 rounded-full px-0 text-[11px] font-medium text-muted data-[selected=true]:text-foreground"
                  id={format.id}
                >
                  {format.label}
                  <Tabs.Indicator className="rounded-full bg-foreground/10 shadow-none" />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
          {API_FORMATS.map((format) => (
            <Tabs.Panel key={format.id} className="sr-only" id={format.id}>
              {format.label} format
            </Tabs.Panel>
          ))}
        </Tabs>
      </SettingField>

      <ModelField query={query} />
      <CapabilitiesField query={query} />
    </SettingsSection>
  )
}

const API_FORMATS: ReadonlyArray<{ id: ApiFormat; label: string }> = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
]

/** The capability rows, in display order. */
const CAPABILITY_ROWS: ReadonlyArray<{
  key: 'text' | 'image' | 'thinking' | 'webSearch'
  label: string
}> = [
  { key: 'text', label: 'Text' },
  { key: 'image', label: 'Images' },
  { key: 'thinking', label: 'Thinking' },
  { key: 'webSearch', label: 'Web search' },
]

/**
 * Probes the provider with real requests, because most do not advertise what they accept in their
 * model catalogue. Knowing whether images and search work avoids sending requests that cannot
 * succeed.
 */
function CapabilitiesField({ query }: { query: string }) {
  const baseUrl = useSettingsStore((state) => state.baseUrl)
  const apiFormat = useSettingsStore((state) => state.apiFormat)
  const model = useSettingsStore((state) => state.model)
  const apiKeyPresent = useSettingsStore((state) => state.apiKeyPresent)
  const apiKeyRevision = useSettingsStore((state) => state.apiKeyRevision)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<CapabilityReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A report describes one provider, model, and format; any of those changing invalidates it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the target changes
  useEffect(() => {
    setReport(null)
    setError(null)
  }, [apiKeyRevision, baseUrl, apiFormat, model])

  const run = async () => {
    if (busy) {
      return
    }

    setBusy(true)
    setError(null)
    setReport(null)
    try {
      setReport(await testCapabilities({ baseUrl, apiFormat, model }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingField
      title="Capabilities"
      description="Checks what this provider accepts for the selected model: text, images, thinking, and web search. Iris sends a few tiny test requests."
      query={query}
      search={[
        'capabilities',
        'image',
        'vision',
        'thinking',
        'web search',
        'support',
        'test',
        'connection',
      ]}
    >
      <div className="flex w-full flex-col gap-2">
        <Button
          aria-label="Test capabilities"
          isDisabled={busy || !isTauri() || !apiKeyPresent}
          size="sm"
          variant="secondary"
          onPress={() => void run()}
        >
          {busy ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <PlugZap className="size-3.5" />
          )}
          Test
        </Button>

        {report ? (
          <div className="flex flex-col gap-1 text-[11px]">
            {CAPABILITY_ROWS.map(({ key, label }) => (
              <p className="text-muted" key={key}>
                <span className="text-foreground">{label}</span> ·{' '}
                {report[key] ? 'supported' : 'not supported'}
              </p>
            ))}
            <p
              className={
                CAPABILITY_ROWS.every(({ key }) => report[key])
                  ? 'text-muted'
                  : 'text-danger'
              }
            >
              {report.message}
            </p>
          </div>
        ) : null}

        {error ? <p className="text-[11px] text-danger">{error}</p> : null}
      </div>
    </SettingField>
  )
}

/**
 * Model selection: the API's catalogue becomes a dropdown, so nobody has to type a model id.
 * The list loads when the panel opens, and Refresh re-fetches it after a key or URL change.
 */
function ModelField({ query }: { query: string }) {
  const model = useSettingsStore((state) => state.model)
  const setModel = useSettingsStore((state) => state.setModel)
  const baseUrl = useSettingsStore((state) => state.baseUrl)
  const apiKeyPresent = useSettingsStore((state) => state.apiKeyPresent)
  const apiFormat = useSettingsStore((state) => state.apiFormat)
  // A new key means a new provider: refetch rather than trust the previous catalogue.
  const apiKeyRevision = useSettingsStore((state) => state.apiKeyRevision)
  const setApiFormat = useSettingsStore((state) => state.setApiFormat)
  const [models, setModels] = useState<ModelEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Picks the wire format a model declares. Providers that report `supported_endpoints` are
   * authoritative: an OSS model answers on `/chat/completions`, Claude only on `/messages`.
   */
  const applyFormat = useCallback(
    (id: string, available: ModelEntry[]) => {
      const entry = available.find((candidate) => candidate.id === id)
      if (!entry || entry.endpoints.length === 0) {
        return
      }

      if (entry.endpoints.includes('/messages')) {
        setApiFormat('anthropic')
      } else if (
        entry.endpoints.includes('/chat/completions') ||
        entry.endpoints.includes('/responses')
      ) {
        setApiFormat('openai')
      }
    },
    [setApiFormat],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: apiKeyRevision forces a refetch on a new key
  const load = useCallback(async () => {
    // Without a key the catalogue cannot be fetched, and a read would prompt for Keychain access.
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
      // is no longer offered by this provider.
      const chosen = useSettingsStore.getState().model
      const offered = available.some((entry) => entry.id === chosen)
      const selected = offered ? chosen : available[0]?.id
      if (selected && !offered) {
        setModel(selected)
      }
      // The API format is the user's setting and is deliberately left alone here: deriving it
      // from the model on every load silently reverted a manual choice whenever the panel
      // remounted (for example after switching settings tabs).
    } catch (reason) {
      // A failed fetch must not leave the previous provider's list on screen, which would look
      // like the new key returned those models.
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
        ? [{ id: model, endpoints: [] }]
        : []

  const modelIds = options.map((entry) => entry.id)

  // Warn, without changing the setting, when the provider says this model does not speak the
  // chosen format. The user keeps control; the mismatch is just visible before sending.
  const chosenEntry = models.find((entry) => entry.id === model)
  const mismatch =
    chosenEntry && chosenEntry.endpoints.length > 0
      ? apiFormat === 'anthropic' &&
        !chosenEntry.endpoints.includes('/messages')
        ? 'This model does not offer /v1/messages. Pick OpenAI, or choose a model that does.'
        : apiFormat === 'openai' &&
            !chosenEntry.endpoints.includes('/chat/completions')
          ? 'This model does not offer /v1/chat/completions. Pick Anthropic, or choose a model that does.'
          : null
      : null

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
      description="AI model used for replies, chosen from the models your key can use."
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
                // Keep the wire format in step with the chosen model.
                applyFormat(key, models)
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

        {mismatch ? (
          <p className="text-[11px] text-danger">{mismatch}</p>
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
  const ttsUrl = useSettingsStore((state) => state.ttsUrl)
  const setTtsUrl = useSettingsStore((state) => state.setTtsUrl)
  const asrUrl = useSettingsStore((state) => state.asrUrl)
  const setAsrUrl = useSettingsStore((state) => state.setAsrUrl)
  const baseUrl = useSettingsStore((state) => state.baseUrl)
  const apiKeyRevision = useSettingsStore((state) => state.apiKeyRevision)
  const [ttsResult, setTtsResult] = useState<EndpointTest | null>(null)
  const [asrResult, setAsrResult] = useState<EndpointTest | null>(null)

  // Test results describe one key and base URL, so a credential change invalidates them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the target changes
  useEffect(() => {
    setTtsResult(null)
    setAsrResult(null)
  }, [apiKeyRevision, baseUrl])

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

        <SettingField
          title="Speech URL"
          description="Endpoint that turns a reply into audio. Use {{base_url}} to inherit the Base URL."
          query={query}
          search={['tts', 'speech', 'url', 'endpoint', 'playback', 'audio']}
        >
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center gap-2">
              <TextField
                className="w-full"
                name="ttsUrl"
                value={ttsUrl}
                variant="secondary"
                onChange={setTtsUrl}
              >
                <Input aria-label="Speech URL" placeholder={DEFAULT_TTS_URL} />
              </TextField>
              <TestButton
                onResult={setTtsResult}
                run={() =>
                  testTtsUrl(resolveEndpoint(ttsUrl, baseUrl), ttsVoice)
                }
              />
            </div>
            <EndpointHint
              resolved={resolveEndpoint(ttsUrl, baseUrl)}
              result={ttsResult}
            />
          </div>
        </SettingField>

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

        <SettingField
          title="Transcription URL"
          description="Endpoint that turns a recording into text. Use {{base_url}} to inherit the Base URL."
          query={query}
          search={[
            'asr',
            'transcribe',
            'url',
            'endpoint',
            'microphone',
            'voice input',
          ]}
        >
          <div className="flex w-full flex-col gap-2">
            <div className="flex items-center gap-2">
              <TextField
                className="w-full"
                name="asrUrl"
                value={asrUrl}
                variant="secondary"
                onChange={setAsrUrl}
              >
                <Input
                  aria-label="Transcription URL"
                  placeholder={DEFAULT_ASR_URL}
                />
              </TextField>
              <TestButton
                onResult={setAsrResult}
                run={() => testAsrUrl(resolveEndpoint(asrUrl, baseUrl))}
              />
            </div>
            <EndpointHint
              resolved={resolveEndpoint(asrUrl, baseUrl)}
              result={asrResult}
            />
          </div>
        </SettingField>
      </SettingsSection>
    </>
  )
}

/** Runs an endpoint probe and renders the button; the result is reported through `onResult`. */
function TestButton({
  run,
  onResult,
}: {
  run: () => Promise<EndpointTest>
  onResult: (result: EndpointTest | null) => void
}) {
  const [busy, setBusy] = useState(false)

  const test = async () => {
    if (busy) {
      return
    }

    setBusy(true)
    onResult(null)
    try {
      onResult(await run())
    } catch (reason) {
      onResult({
        ok: false,
        message: reason instanceof Error ? reason.message : String(reason),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      aria-label="Test endpoint"
      isDisabled={busy || !isTauri()}
      size="sm"
      variant="secondary"
      onPress={() => void test()}
    >
      {busy ? (
        <LoaderCircle className="size-3.5 animate-spin" />
      ) : (
        <PlugZap className="size-3.5" />
      )}
      Test
    </Button>
  )
}

/** One line under an endpoint row: the resolved URL, plus a test result when there is one. */
function EndpointHint({
  resolved,
  result,
}: {
  resolved: string
  result: EndpointTest | null
}) {
  return (
    <div className="flex w-full flex-col gap-0.5 text-[11px]">
      <p className="truncate text-muted">Currently {resolved}</p>
      {result ? (
        <p className={result.ok ? 'text-primary' : 'text-danger'}>
          {result.message}
        </p>
      ) : null}
    </div>
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
              'Reset Iris? This deletes every conversation, all settings, and your API key. Iris will restart.'
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
            // Reset removes the Keychain key too, so no request can be authenticated afterwards.
            useSettingsStore.setState({
              theme: 'dark',
              baseUrl: DEFAULT_BASE_URL,
              model: DEFAULT_MODEL,
              apiKeyPresent: false,
              apiKeyHint: null,
              autoSpeak: true,
              autoSendVoice: true,
              deepThink: false,
              webSearch: false,
              ttsVoice: DEFAULT_TTS_VOICE,
              openShortcut: DEFAULT_OPEN_SHORTCUT,
            })
            localStorage.removeItem(CHAT_STORAGE_KEY)
            localStorage.removeItem(SETTINGS_STORAGE_KEY)

            try {
              if (isTauri()) {
                await resetAppData()
                await restartApp()
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

  return (
    <>
      <div className="flex justify-center pb-7">
        <IrisBlob emotion="happy" size={100} />
      </div>

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
  isSelected,
  onChange,
  query,
  search,
}: {
  title: string
  description: string
  isSelected: boolean
  onChange: (isSelected: boolean) => void
  query: string
  search: string[]
}) {
  if (!matchesQuery(query, title, description, ...search)) {
    return null
  }

  return (
    <Switch className="w-full" isSelected={isSelected} onChange={onChange}>
      <Switch.Content className="flex w-full items-center justify-between gap-8 py-4">
        <span className="min-w-0">
          <Label className="text-sm font-medium">{title}</Label>
          <Description className="mt-0.5 block text-xs leading-5 text-muted">
            {description}
          </Description>
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

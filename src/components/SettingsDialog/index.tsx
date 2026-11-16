import {
  Button,
  Description,
  Input,
  Label,
  Modal,
  SearchField,
  Switch,
  Tabs,
  TextField,
} from '@heroui/react'
import { ask } from '@tauri-apps/plugin-dialog'
import {
  Database,
  Info,
  Keyboard,
  type LucideIcon,
  Monitor,
  Moon,
  SearchX,
  Settings2,
  Sparkles,
  Sun,
  Volume2,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'

import { useDynamicIslandNotice } from '@/components/dynamic-island/notifications'
import IrisBlob from '@/components/IrisBlob'
import ShortcutRecorder from '@/components/ShortcutRecorder'
import {
  CHAT_STORAGE_KEY,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_OPEN_SHORTCUT,
  DEFAULT_TTS_VOICE,
  SETTINGS_STORAGE_KEY,
  THEME_LABELS,
  TTS_VOICES,
} from '@/constants'
import { useAppInfo } from '@/hooks/useAppInfo'
import { suspendChatStorage } from '@/hooks/useChatStorage'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { resetAppData, restartApp } from '@/tauri/commands/app'
import { setOpenShortcut as applyOpenShortcut } from '@/tauri/commands/shortcut'
import type { ThemeMode } from '@/types/settings'
import { formatShortcut } from '@/utils/shortcut'
import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'

type CategoryId =
  | 'general'
  | 'shortcuts'
  | 'deepseek'
  | 'voice'
  | 'storage'
  | 'about'

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
    id: 'deepseek',
    label: 'AI',
    group: 'Settings',
    icon: Sparkles,
    terms: [
      'ai',
      'deepseek',
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

              <nav className="flex flex-col gap-6">
                {groups.map((group) => {
                  const items = visibleCategories.filter(
                    (category) => category.group === group,
                  )
                  if (items.length === 0) {
                    return null
                  }

                  return (
                    <div key={group} className="space-y-1">
                      <p className="px-3 pb-1 text-xs font-medium text-muted">
                        {group}
                      </p>
                      {items.map((category) => {
                        const Icon = category.icon
                        const active = category.id === activeCategory

                        return (
                          <Button
                            key={category.id}
                            className={cn(
                              'h-10 w-full justify-start gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                              active
                                ? 'border border-foreground/10 bg-foreground/10 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                                : 'border border-transparent text-muted hover:bg-foreground/5 hover:text-foreground',
                            )}
                            variant="ghost"
                            aria-current={active ? 'page' : undefined}
                            onPress={() => setSelected(category.id)}
                          >
                            <Icon className="size-4 shrink-0" />
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
    case 'deepseek':
      return <DeepSeekPanel query={query} />
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

  return (
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
  )
}

function ShortcutsPanel({ query }: { query: string }) {
  const openShortcut = useSettingsStore((state) => state.openShortcut)
  const setOpenShortcut = useSettingsStore((state) => state.setOpenShortcut)
  const [recording, setRecording] = useState(false)

  const recordShortcut = async (shortcut: string) => {
    if (isTauri()) {
      await applyOpenShortcut(shortcut)
    }
    setOpenShortcut(shortcut)
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
      </SettingsSection>

      <ShortcutRecorder
        open={recording}
        onOpenChange={setRecording}
        onRecord={recordShortcut}
      />
    </>
  )
}

function DeepSeekPanel({ query }: { query: string }) {
  const apiKey = useSettingsStore((state) => state.apiKey)
  const setApiKey = useSettingsStore((state) => state.setApiKey)
  const baseUrl = useSettingsStore((state) => state.baseUrl)
  const setBaseUrl = useSettingsStore((state) => state.setBaseUrl)
  const model = useSettingsStore((state) => state.model)
  const setModel = useSettingsStore((state) => state.setModel)

  return (
    <SettingsSection title="Connection">
      <SettingField
        title="API key"
        description="Stored locally on this Mac. Used for chat and automatic read-aloud."
        query={query}
        search={['deepseek', 'api', 'api key', 'key', 'connection']}
      >
        <TextField
          className="w-full"
          name="apiKey"
          value={apiKey}
          variant="secondary"
          onChange={setApiKey}
        >
          <Input
            aria-label="API key"
            autoComplete="off"
            placeholder="sk-..."
            spellCheck={false}
            type="password"
          />
        </TextField>
      </SettingField>

      <SettingField
        title="Base URL"
        description="API origin. The Messages and TTS endpoints are added automatically."
        query={query}
        search={['deepseek', 'base url', 'url', 'endpoint', 'connection']}
      >
        <TextField
          className="w-full"
          name="baseUrl"
          value={baseUrl}
          variant="secondary"
          onChange={setBaseUrl}
        >
          <Input aria-label="Base URL" placeholder="https://api.deepseek.com" />
        </TextField>
      </SettingField>

      <SettingField
        title="Model"
        description="AI model used for replies."
        query={query}
        search={[
          'ai',
          'deepseek',
          'api',
          'model',
          'deepseek-flash',
          'connection',
        ]}
      >
        <TextField
          className="w-full"
          name="model"
          value={model}
          variant="secondary"
          onChange={setModel}
        >
          <Input aria-label="Model" placeholder="deepseek-flash" />
        </TextField>
      </SettingField>
    </SettingsSection>
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
            // Keep the API key out of any write that lands between this reset and the restart.
            useSettingsStore.setState({
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

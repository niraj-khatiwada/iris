import {
  Button,
  Description,
  Input,
  Label,
  Modal,
  Switch,
  TextField,
} from '@heroui/react'
import { ask } from '@tauri-apps/plugin-dialog'
import { Settings2 } from 'lucide-react'

import { useDynamicIslandNotice } from '@/components/dynamic-island/notifications'
import { THEME_LABELS } from '@/constants'
import { useAppInfo } from '@/hooks/useAppInfo'
import { useChatStore } from '@/stores/chatStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import type { ThemeMode } from '@/types/settings'
import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'

const themeModes: ThemeMode[] = ['light', 'dark', 'system']

function SettingsDialog() {
  const open = useUIStore((state) => state.settingsOpen)
  const closeSettings = useUIStore((state) => state.closeSettings)
  const theme = useSettingsStore((state) => state.theme)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const model = useSettingsStore((state) => state.model)
  const setModel = useSettingsStore((state) => state.setModel)
  const streaming = useSettingsStore((state) => state.streaming)
  const setStreaming = useSettingsStore((state) => state.setStreaming)
  const clearAll = useChatStore((state) => state.clearAll)
  const info = useAppInfo()
  const notify = useDynamicIslandNotice()

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
        <Modal.Dialog className="glass-dialog sm:max-w-md">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
              <Settings2 className="size-5" />
            </Modal.Icon>
            <Modal.Heading>Settings</Modal.Heading>
          </Modal.Header>

          <Modal.Body className="space-y-6">
            <section className="space-y-2.5">
              <p className="text-xs font-medium">Appearance</p>
              <div className="grid grid-cols-3 gap-2">
                {themeModes.map((mode) => (
                  <Button
                    key={mode}
                    className={cn(
                      'justify-center',
                      theme === mode && 'ring-1 ring-accent/40',
                    )}
                    size="sm"
                    variant={theme === mode ? 'secondary' : 'ghost'}
                    onPress={() => setTheme(mode)}
                  >
                    {THEME_LABELS[mode]}
                  </Button>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-xs font-medium">Agent</p>
              <TextField
                name="model"
                value={model}
                variant="secondary"
                onChange={setModel}
              >
                <Label>Model</Label>
                <Input placeholder="local-preview" />
                <Description>
                  Provider integration lives in{' '}
                  <code className="text-[10px]">
                    src-tauri/src/core/agent.rs
                  </code>
                  .
                </Description>
              </TextField>

              <Switch isSelected={streaming} onChange={setStreaming}>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Switch.Content>
                  <Label>Stream responses</Label>
                  <Description>Show tokens as they arrive.</Description>
                </Switch.Content>
              </Switch>
            </section>

            <section className="space-y-2">
              <p className="text-xs font-medium">Storage</p>
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/50 bg-surface/40 p-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium">Conversation history</p>
                  <p className="text-[10px] leading-4 text-muted">
                    Stored locally on this Mac.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger-soft"
                  onPress={async () => {
                    const message =
                      'Delete all conversations? This cannot be undone.'
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
              </div>
            </section>

            <section className="space-y-2">
              <p className="text-xs font-medium">About</p>
              <div className="space-y-1.5 rounded-2xl border border-border/50 bg-surface/40 p-3 text-[11px]">
                <Row label="Version" value={info?.version ?? '—'} />
                <Row
                  label="Platform"
                  value={info ? `${info.platform} · ${info.arch}` : '—'}
                />
                <Row label="Identifier" value={info?.identifier ?? '—'} />
              </div>
            </section>
          </Modal.Body>

          <Modal.Footer>
            <Button slot="close" variant="secondary">
              Done
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  )
}

SettingsDialog.displayName = 'SettingsDialog'

export default SettingsDialog

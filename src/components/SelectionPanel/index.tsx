import { Button } from '@heroui/react'
import { Sparkles, X } from 'lucide-react'
import type { Ref } from 'react'

import IrisBlob from '@/components/IrisBlob'
import { useSettingsStore } from '@/stores/settingsStore'
import type { SelectionView } from '@/types/selection'
import type { QuickPrompt } from '@/types/settings'
import { getQuickPromptIcon } from '@/utils/quickPrompts'

type SelectionPanelProps = {
  panelRef?: Ref<HTMLDivElement>
  view: SelectionView
  onAction: (prompt: QuickPrompt) => void
  onCustom: () => void
  onClose: () => void
  onOpenSettings: () => void
}

/** The compact action strip shown in the overlay after the selection shortcut fires. */
function SelectionPanel({
  panelRef,
  view,
  onAction,
  onCustom,
  onClose,
  onOpenSettings,
}: SelectionPanelProps) {
  const quickPrompts = useSettingsStore((state) => state.quickPrompts)

  return (
    <div ref={panelRef} className="outline-none" tabIndex={-1}>
      <header
        className="flex items-center gap-2 px-4 pt-2.5 pb-2"
        data-tauri-drag-region="deep"
      >
        <IrisBlob emotion="neutral" size={24} />
        <span className="text-[10px] font-semibold tracking-[0.16em] text-foreground/55">
          IRIS
        </span>
        <span className="text-[11px] text-foreground/45">Selection</span>
        <Button
          isIconOnly
          aria-label="Close selection actions"
          className="ml-auto size-7 min-w-7 text-foreground/45"
          size="sm"
          variant="ghost"
          onPress={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </header>

      {view.kind === 'actions' ? (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-muted">
            From {view.appName}
            {view.fromClipboard ? ' · copied selection' : ''}
          </p>
          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[12px] leading-5 text-foreground/75">
            “{view.text}”
          </p>
          {view.truncated ? (
            <p className="mt-1 text-[10px] text-muted/70">
              Long selection — using the first 24,000 characters.
            </p>
          ) : null}

          <div className="mt-3 flex flex-nowrap items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {quickPrompts.map((prompt, index) => {
              const Icon = getQuickPromptIcon(prompt.icon)
              return (
                <Button
                  // The first action is the quickest keyboard path after the shortcut fires.
                  autoFocus={index === 0}
                  className="h-7 shrink-0 gap-1 whitespace-nowrap rounded-full px-1.5 text-[10.5px] font-medium"
                  key={prompt.id}
                  size="sm"
                  variant="secondary"
                  onPress={() => onAction(prompt)}
                >
                  <Icon className="size-3 text-muted" />
                  {prompt.name}
                </Button>
              )
            })}
            <Button
              className="h-7 shrink-0 gap-1 whitespace-nowrap rounded-full px-1.5 text-[10.5px] font-medium"
              size="sm"
              variant="secondary"
              onPress={onCustom}
            >
              <Sparkles className="size-3 text-muted" />
              Custom
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-4 pb-3">
          <p className="max-w-[620px] text-[13px] leading-5 text-danger">
            {view.message}
          </p>
          <div className="mt-3 flex items-center gap-2">
            {view.permissionRequired ? (
              <Button
                className="h-8 rounded-full px-3 text-[11px]"
                size="sm"
                variant="secondary"
                onPress={onOpenSettings}
              >
                Open Settings
              </Button>
            ) : null}
            <Button
              className="h-8 rounded-full px-3 text-[11px]"
              size="sm"
              variant="ghost"
              onPress={onClose}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

SelectionPanel.displayName = 'SelectionPanel'

export default SelectionPanel

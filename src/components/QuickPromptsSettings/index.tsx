import { Button, Input, TextArea, TextField } from '@heroui/react'
import { GripVertical, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import { useState } from 'react'

import { NO_WRITING_ASSIST } from '@/constants'
import { useSettingsStore } from '@/stores/settingsStore'
import type { QuickPrompt, QuickPromptIcon } from '@/types/settings'
import { newId } from '@/utils/id'
import { getQuickPromptIcon, QUICK_PROMPT_ICONS } from '@/utils/quickPrompts'
import { cn } from '@/utils/tailwind'

type Draft = {
  id: string
  name: string
  instruction: string
  icon: QuickPromptIcon
  isNew: boolean
}

type QuickPromptsSettingsProps = {
  query: string
}

function matchesQuery(query: string, ...values: string[]) {
  const term = query.trim().toLowerCase()
  if (!term) {
    return true
  }
  return values.some((value) => value.toLowerCase().includes(term))
}

/** Editable, reorderable selection prompts, also used by the `/` menu. */
function QuickPromptsSettings({ query }: QuickPromptsSettingsProps) {
  const quickPrompts = useSettingsStore((state) => state.quickPrompts)
  const setQuickPrompts = useSettingsStore((state) => state.setQuickPrompts)
  const addQuickPrompt = useSettingsStore((state) => state.addQuickPrompt)
  const updateQuickPrompt = useSettingsStore((state) => state.updateQuickPrompt)
  const removeQuickPrompt = useSettingsStore((state) => state.removeQuickPrompt)
  const resetQuickPrompts = useSettingsStore((state) => state.resetQuickPrompts)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visible = matchesQuery(
    query,
    'quick prompts',
    'quick prompt',
    'selection',
    'selected text',
    'slash',
    '/',
    'prompt',
    'prompts',
    ...quickPrompts.map((prompt) => prompt.name),
  )
  if (!visible) {
    return null
  }

  const startAdding = () => {
    setError(null)
    setDraft({
      id: newId(),
      name: '',
      instruction: '',
      icon: 'sparkles',
      isNew: true,
    })
  }

  const startEditing = (prompt: QuickPrompt) => {
    setError(null)
    setDraft({ ...prompt, isNew: false })
  }

  const resetDraft = () => {
    setDraft(null)
    setError(null)
  }

  const save = () => {
    if (!draft) {
      return
    }

    const name = draft.name.trim()
    const instruction = draft.instruction.trim()
    if (!name) {
      setError('Give the quick prompt a name.')
      return
    }
    if (!instruction) {
      setError('Add the instruction Iris should follow.')
      return
    }

    const prompt = {
      id: draft.id,
      name,
      instruction,
      icon: draft.icon,
    }
    if (draft.isNew) {
      addQuickPrompt(prompt)
    } else {
      updateQuickPrompt(draft.id, prompt)
    }
    resetDraft()
  }

  const remove = (prompt: QuickPrompt) => {
    removeQuickPrompt(prompt.id)
    if (draft?.id === prompt.id) {
      resetDraft()
    }
  }

  return (
    <section className="mb-9 last:mb-0">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[17px] font-semibold tracking-tight">
            Quick prompts
          </h3>
          <p className="mt-0.5 text-xs leading-5 text-muted">
            These appear in the selection strip and the <kbd>/</kbd> menu, in
            this order. Drag to rearrange.
          </p>
        </div>
        <Button
          className="shrink-0"
          size="sm"
          variant="secondary"
          onPress={startAdding}
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>

      {draft ? (
        <div className="mb-3 space-y-3 rounded-2xl border border-border/60 bg-foreground/[0.04] p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium">
              {draft.isNew ? 'New quick prompt' : 'Edit quick prompt'}
            </p>
            <Button
              isIconOnly
              aria-label="Close quick prompt editor"
              className="size-7 min-w-7 text-foreground/45"
              size="sm"
              variant="ghost"
              onPress={resetDraft}
            >
              <X className="size-3.5" />
            </Button>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted">Name</p>
            <TextField
              className="w-full"
              name="quickPromptName"
              value={draft.name}
              variant="secondary"
              onChange={(name) => setDraft({ ...draft, name })}
            >
              <Input
                {...NO_WRITING_ASSIST}
                aria-label="Quick prompt name"
                placeholder="Translate to French"
              />
            </TextField>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted">Icon</p>
            <div className="flex flex-wrap gap-1">
              {QUICK_PROMPT_ICONS.map((option) => {
                const Icon = option.icon
                const selected = draft.icon === option.id
                return (
                  <Button
                    key={option.id}
                    isIconOnly
                    aria-label={option.label}
                    aria-pressed={selected}
                    className={cn(
                      'size-8 min-w-8 rounded-lg',
                      selected ? 'text-primary' : 'text-muted',
                    )}
                    size="sm"
                    variant={selected ? 'secondary' : 'ghost'}
                    onPress={() => setDraft({ ...draft, icon: option.id })}
                  >
                    <Icon className="size-4" />
                  </Button>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted">Instruction</p>
            <TextArea
              {...NO_WRITING_ASSIST}
              aria-label="Quick prompt instruction"
              className="min-h-24 w-full resize-y text-[13px] leading-5"
              placeholder="Translate the selected text into French. Return only the translation."
              rows={4}
              value={draft.instruction}
              variant="secondary"
              onChange={(event) =>
                setDraft({ ...draft, instruction: event.target.value })
              }
            />
          </div>

          {error ? <p className="text-xs text-danger">{error}</p> : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] leading-4 text-muted">
              The selected text is passed separately as data.
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant="ghost" onPress={resetDraft}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onPress={save}>
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <Reorder.Group
        as="div"
        axis="y"
        className="flex flex-col gap-1"
        data-quick-prompt-list
        values={quickPrompts}
        onReorder={setQuickPrompts}
      >
        {quickPrompts.map((prompt) => (
          <QuickPromptRow
            key={prompt.id}
            prompt={prompt}
            onEdit={() => startEditing(prompt)}
            onRemove={() => remove(prompt)}
          />
        ))}
      </Reorder.Group>

      {quickPrompts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted">
          No quick prompts yet. Add one to show it in the selection strip.
        </p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11px] leading-4 text-muted">
          Drag the handle to change the order shown in Iris.
        </p>
        <Button
          className="shrink-0"
          size="sm"
          variant="ghost"
          onPress={() => {
            resetDraft()
            resetQuickPrompts()
          }}
        >
          <RotateCcw className="size-3.5" />
          Restore defaults
        </Button>
      </div>
    </section>
  )
}

function QuickPromptRow({
  prompt,
  onEdit,
  onRemove,
}: {
  prompt: QuickPrompt
  onEdit: () => void
  onRemove: () => void
}) {
  const dragControls = useDragControls()
  const Icon = getQuickPromptIcon(prompt.icon)

  return (
    <Reorder.Item
      as="div"
      data-quick-prompt-id={prompt.id}
      dragControls={dragControls}
      dragListener={false}
      value={prompt}
      className="flex items-center gap-2 rounded-xl border border-border/50 bg-surface/30 px-2 py-2"
    >
      <button
        type="button"
        aria-label={`Reorder ${prompt.name}`}
        className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-muted/70 active:cursor-grabbing"
        onPointerDown={(event) => dragControls.start(event)}
      >
        <GripVertical className="size-3.5" />
      </button>

      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-foreground/5 text-muted">
        <Icon className="size-4" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{prompt.name}</p>
        <p className="truncate text-[11px] text-muted">{prompt.instruction}</p>
      </div>

      <Button
        isIconOnly
        aria-label={`Edit ${prompt.name}`}
        className="size-7 min-w-7 text-foreground/45"
        size="sm"
        variant="ghost"
        onPress={onEdit}
      >
        <Pencil className="size-3.5" />
      </Button>
      <Button
        isIconOnly
        aria-label={`Remove ${prompt.name}`}
        className="size-7 min-w-7 text-foreground/45"
        size="sm"
        variant="ghost"
        onPress={onRemove}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </Reorder.Item>
  )
}

QuickPromptsSettings.displayName = 'QuickPromptsSettings'

export default QuickPromptsSettings

import {
  AlignLeft,
  CheckCheck,
  Code,
  FileText,
  Globe,
  Languages,
  Lightbulb,
  ListTodo,
  type LucideIcon,
  MessageSquare,
  PenLine,
  Reply,
  Search,
  Sparkles,
  Wand2,
} from 'lucide-react'

import type { QuickPrompt, QuickPromptIcon } from '@/types/settings'

/** The icon choices offered by the quick-prompt editor. */
export const QUICK_PROMPT_ICONS: ReadonlyArray<{
  id: QuickPromptIcon
  label: string
  icon: LucideIcon
}> = [
  { id: 'lightbulb', label: 'Lightbulb', icon: Lightbulb },
  { id: 'align-left', label: 'Summary', icon: AlignLeft },
  { id: 'pen-line', label: 'Improve', icon: PenLine },
  { id: 'languages', label: 'Translate', icon: Languages },
  { id: 'check-check', label: 'Check', icon: CheckCheck },
  { id: 'list-todo', label: 'Tasks', icon: ListTodo },
  { id: 'reply', label: 'Reply', icon: Reply },
  { id: 'sparkles', label: 'Sparkles', icon: Sparkles },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'code', label: 'Code', icon: Code },
  { id: 'message-square', label: 'Message', icon: MessageSquare },
  { id: 'file-text', label: 'Document', icon: FileText },
  { id: 'globe', label: 'Language', icon: Globe },
  { id: 'wand', label: 'Magic', icon: Wand2 },
]

const ICONS = new Map(QUICK_PROMPT_ICONS.map((entry) => [entry.id, entry.icon]))
const ICON_IDS = new Set(QUICK_PROMPT_ICONS.map((entry) => entry.id))

export function getQuickPromptIcon(icon: QuickPromptIcon): LucideIcon {
  return ICONS.get(icon) ?? Sparkles
}

export function isQuickPromptIcon(value: unknown): value is QuickPromptIcon {
  return typeof value === 'string' && ICON_IDS.has(value as QuickPromptIcon)
}

/** Filters the slash menu by prompt name only, preserving the saved order. */
export function filterQuickPrompts(
  prompts: QuickPrompt[],
  query: string,
): QuickPrompt[] {
  const term = query.trim().toLowerCase()
  if (!term) {
    return prompts
  }

  return prompts.filter((prompt) => prompt.name.toLowerCase().includes(term))
}

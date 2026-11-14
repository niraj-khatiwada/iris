import type { Conversation } from '@/types/chat'

const dayInMs = 24 * 60 * 60 * 1000

export function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

export function formatConversationTime(timestamp: number) {
  const now = Date.now()
  const elapsed = now - timestamp

  if (elapsed < 60 * 1000) {
    return 'Just now'
  }
  if (elapsed < 60 * 60 * 1000) {
    return `${Math.floor(elapsed / 60000)}m ago`
  }
  if (elapsed < dayInMs) {
    return `${Math.floor(elapsed / 3600000)}h ago`
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(timestamp)
}

export function groupConversations(conversations: Conversation[]) {
  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()
  const startOfYesterday = startOfToday - dayInMs

  const groups = new Map<string, Conversation[]>([
    ['Today', []],
    ['Yesterday', []],
    ['Previous', []],
  ])

  for (const conversation of conversations) {
    if (conversation.updatedAt >= startOfToday) {
      groups.get('Today')?.push(conversation)
    } else if (conversation.updatedAt >= startOfYesterday) {
      groups.get('Yesterday')?.push(conversation)
    } else {
      groups.get('Previous')?.push(conversation)
    }
  }

  return Array.from(groups, ([label, items]) => ({ label, items })).filter(
    (group) => group.items.length > 0,
  )
}

export function greeting() {
  const hour = new Date().getHours()
  if (hour < 5) {
    return 'Still up?'
  }
  if (hour < 12) {
    return 'Good morning.'
  }
  if (hour < 18) {
    return 'Good afternoon.'
  }
  return 'Good evening.'
}

export function truncate(text: string, maxLength: number) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxLength) {
    return clean
  }

  return `${clean.slice(0, maxLength).trimEnd()}…`
}

export function titleFromMessage(message: string) {
  return truncate(message, 48) || 'New conversation'
}

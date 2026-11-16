import { BASE_URL_TOKEN } from '@/constants'

/**
 * Expands `{{base_url}}` in an endpoint template so speech and transcription follow whichever
 * provider is configured. A plain URL passes through untouched.
 */
export function resolveEndpoint(template: string, baseUrl: string) {
  const trimmed = template.trim()
  if (!trimmed) {
    return ''
  }

  const base = baseUrl.trim().replace(/\/+$/, '')
  return trimmed.split(BASE_URL_TOKEN).join(base)
}

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { ApiFormat } from '@/constants'

/** Stops the automatic read-aloud currently playing. */
export function stopSpeaking() {
  return invoke<void>('stop_speaking')
}

/** Transcribes a WAV recording through the Rust backend at the configured endpoint. */
export function transcribeAudio(request: {
  asrUrl: string
  audioBase64: string
}) {
  return invoke<string>('transcribe_audio', request)
}

/** What the UI may know after saving a key: a short hint, never the key itself. */
export type ApiKeyHint = {
  hint: string | null
  present: boolean
}

/** Saves a key to the macOS Keychain, replacing any key already stored. */
export function saveApiKey(apiKey: string) {
  return invoke<ApiKeyHint>('save_api_key', { apiKey })
}

/** Deletes the stored key. */
export function removeApiKey() {
  return invoke<ApiKeyHint>('remove_api_key')
}

/**
 * Whether a key is set. This is an attributes-only Keychain query, so it never decrypts the
 * secret and never prompts — safe to call when Settings opens.
 */
export function hasApiKey() {
  return invoke<boolean>('has_api_key')
}

/** One catalogue entry: the id, plus the endpoints the provider declares for it. */
export type ModelEntry = {
  id: string
  endpoints: string[]
}

/** Lists the models the stored key can use. The key is read in Rust, never sent from here. */
export function listModels(baseUrl: string) {
  return invoke<ModelEntry[]>('list_models', { baseUrl })
}

/** What the configured provider accepts, probed with real requests. */
export type CapabilityReport = {
  text: boolean
  image: boolean
  message: string
}

/** Checks whether the provider accepts text and images for the selected model. */
export function testCapabilities(request: {
  baseUrl: string
  apiFormat: ApiFormat
  model: string
}) {
  return invoke<CapabilityReport>('test_capabilities', request)
}

export type EndpointTest = {
  ok: boolean
  message: string
}

/** Sends a short line to the speech endpoint to confirm it returns audio. */
export function testTtsUrl(ttsUrl: string, voice: string) {
  return invoke<EndpointTest>('test_tts_url', { ttsUrl, voice })
}

/** Sends a generated sample recording to the transcription endpoint. */
export function testAsrUrl(asrUrl: string) {
  return invoke<EndpointTest>('test_asr_url', { asrUrl })
}

export type SpeechEventPayload = {
  conversationId: string
}

export function subscribeToSpeechPreparing(
  handler: (payload: SpeechEventPayload) => void,
): Promise<UnlistenFn> {
  return listen<SpeechEventPayload>('speech:preparing', (event) =>
    handler(event.payload),
  )
}

export function subscribeToSpeechStart(
  handler: (payload: SpeechEventPayload) => void,
): Promise<UnlistenFn> {
  return listen<SpeechEventPayload>('speech:start', (event) =>
    handler(event.payload),
  )
}

export function subscribeToSpeechEnd(
  handler: (payload: SpeechEventPayload) => void,
): Promise<UnlistenFn> {
  return listen<SpeechEventPayload>('speech:end', (event) =>
    handler(event.payload),
  )
}

export type SpeechErrorPayload = {
  conversationId: string
  message: string
}

/** Read-aloud failed before playing; carries the reason so the UI can show it. */
export function subscribeToSpeechError(
  handler: (payload: SpeechErrorPayload) => void,
): Promise<UnlistenFn> {
  return listen<SpeechErrorPayload>('speech:error', (event) =>
    handler(event.payload),
  )
}

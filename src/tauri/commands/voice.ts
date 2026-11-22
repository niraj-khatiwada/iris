import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/** Stops the automatic read-aloud currently playing. */
export function stopSpeaking() {
  return invoke<void>('stop_speaking')
}

/** Reads one message aloud through DeepSeek's TTS tool under the configured base URL. */
export function speakText(request: {
  conversationId: string
  text: string
  baseUrl: string
  voice: string
}) {
  return invoke<void>('speak_text', { request })
}

/** Transcribes a WAV recording through DeepSeek's ASR tool under the configured base URL. */
export function transcribeAudio(request: {
  baseUrl: string
  audioBase64: string
}) {
  return invoke<string>('transcribe_audio', request)
}

/** What the UI may know after saving a key: a short hint, never the key itself. */
export type ApiKeyHint = {
  hint: string | null
  present: boolean
}

/** Saves a key to the Iris database, replacing any key already stored. */
export function saveApiKey(apiKey: string) {
  return invoke<ApiKeyHint>('save_api_key', { apiKey })
}

/** Deletes the stored key. */
export function removeApiKey() {
  return invoke<ApiKeyHint>('remove_api_key')
}

/**
 * Whether a key is set. This reads the credential table, so it is safe to call when Settings opens.
 */
export function hasApiKey() {
  return invoke<boolean>('has_api_key')
}

/** One catalogue entry: the model id DeepSeek reports. */
export type ModelEntry = {
  id: string
}

/** Lists the models the stored key can use. The key is read in Rust, never sent from here. */
export function listModels(baseUrl: string) {
  return invoke<ModelEntry[]>('list_models', { baseUrl })
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

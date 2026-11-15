import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/** Stops the automatic read-aloud currently playing. */
export function stopSpeaking() {
  return invoke<void>('stop_speaking')
}

/** Transcribes a WAV recording through the Rust backend. */
export function transcribeAudio(request: {
  apiKey: string
  baseUrl: string
  audioBase64: string
}) {
  return invoke<string>('transcribe_audio', request)
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

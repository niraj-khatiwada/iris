import { useCallback, useEffect, useRef, useState } from 'react'

import { startVoiceRecording, type VoiceRecording } from '@/services/recorder'
import { useSettingsStore } from '@/stores/settingsStore'
import { transcribeAudio } from '@/tauri/commands/voice'
import { isTauri } from '@/utils/tauri'

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing'

/** One-shot voice input: click to record, click stop to transcribe. */
export function useVoiceInput() {
  const [status, setStatus] = useState<VoiceInputStatus>('idle')
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [error, setError] = useState('')
  const recordingRef = useRef<VoiceRecording | null>(null)
  const operationRef = useRef(0)
  const stopRef = useRef<() => Promise<string | null>>(async () => null)

  const cancel = useCallback(() => {
    operationRef.current += 1
    recordingRef.current?.cancel()
    recordingRef.current = null
    setAnalyser(null)
    setStatus('idle')
    setError('')
  }, [])

  const stop = useCallback(async () => {
    const recording = recordingRef.current
    if (!recording) {
      cancel()
      return null
    }

    const operation = operationRef.current
    recordingRef.current = null
    setAnalyser(null)
    setStatus('transcribing')
    setError('')

    try {
      let audio: Blob | null = null
      try {
        audio = await recording.stop()
      } finally {
        recording.cancel()
      }

      if (operationRef.current !== operation) {
        return null
      }
      if (!audio) {
        setStatus('idle')
        setError("Iris didn't catch that. Try again.")
        return null
      }

      const text = (await transcribe(audio)).trim()
      if (operationRef.current !== operation) {
        return null
      }

      setStatus('idle')
      if (!text) {
        setError("Iris didn't catch that. Try again.")
        return null
      }
      return text
    } catch (reason) {
      if (operationRef.current === operation) {
        setStatus('idle')
        setError(reason instanceof Error ? reason.message : String(reason))
      }
      return null
    }
  }, [cancel])

  stopRef.current = stop

  const start = useCallback(async () => {
    if (status !== 'idle') {
      return
    }
    if (!isVoiceAvailable()) {
      setError('Voice input is not available in this window.')
      return
    }

    const operation = ++operationRef.current
    setError('')
    setStatus('recording')

    try {
      const recording = await startVoiceRecording(() => {
        if (operationRef.current === operation) {
          void stopRef.current()
        }
      })

      if (operationRef.current !== operation) {
        recording.cancel()
        return
      }

      recordingRef.current = recording
      setAnalyser(recording.analyser)
    } catch (reason) {
      if (operationRef.current === operation) {
        setStatus('idle')
        setError(describeRecordingError(reason))
      }
    }
  }, [status])

  useEffect(
    () => () => {
      operationRef.current += 1
      recordingRef.current?.cancel()
      recordingRef.current = null
    },
    [],
  )

  return {
    status,
    error,
    analyser,
    start,
    stop,
    cancel,
    available: isVoiceAvailable(),
  }
}

async function transcribe(audio: Blob) {
  const { apiKey, baseUrl } = useSettingsStore.getState()
  if (!apiKey.trim()) {
    throw new Error('Add your DeepSeek API key in Settings.')
  }

  if (isTauri()) {
    return transcribeAudio({
      apiKey,
      baseUrl,
      audioBase64: await blobToBase64(audio),
    })
  }

  // Browser preview: talk to the demo's ASR endpoint directly.
  const form = new FormData()
  form.append('file', audio, 'recording.wav')
  const response = await fetch(
    `${baseUrl.trim().replace(/\/+$/, '')}/v1/tools/asr`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    },
  )
  const body = await response.text()
  if (!response.ok) {
    throw new Error(body || 'Voice transcription failed.')
  }
  const value = JSON.parse(body) as { text?: unknown }
  return typeof value.text === 'string' ? value.text : ''
}

function isVoiceAvailable() {
  return (
    typeof navigator !== 'undefined' &&
    typeof window !== 'undefined' &&
    (isTauri() || window.isSecureContext) &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  )
}

function describeRecordingError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Microphone access is blocked. Allow Iris in System Settings → Privacy & Security → Microphone.'
    }
    if (error.name === 'NotFoundError') {
      return 'No microphone was found on this Mac.'
    }
  }
  return 'Voice input could not start. Try again.'
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

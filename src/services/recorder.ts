/**
 * Records mono 16-bit PCM at 16 kHz and encodes it as the WAV format the DeepSeek ASR endpoint
 * accepts. The browser resamples; capture happens in the page.
 */
export const VOICE_SAMPLE_RATE = 16_000
export const VOICE_MAX_SECONDS = 120

const BUFFER_SIZE = 4096

export type VoiceRecording = {
  /** Stops capture and returns a WAV, or null when no samples were captured. */
  stop: () => Promise<Blob | null>
  /** Releases the microphone without producing audio. */
  cancel: () => void
  /** Spectrum source for the listening UI. */
  analyser: AnalyserNode
}

export async function startVoiceRecording(
  onLimit: () => void,
): Promise<VoiceRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  })

  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let processor: ScriptProcessorNode | undefined
  let analyser: AnalyserNode | undefined
  let released = false

  const release = () => {
    if (released) {
      return
    }
    released = true
    if (processor) {
      processor.onaudioprocess = null
    }
    for (const node of [processor, analyser, source]) {
      try {
        node?.disconnect()
      } catch {
        // Keep releasing the other nodes.
      }
    }
    for (const track of stream.getTracks()) {
      track.stop()
    }
    void context?.close().catch(() => undefined)
  }

  try {
    context = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE })
    source = context.createMediaStreamSource(stream)
    processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1)
    analyser = context.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.2

    const chunks: Float32Array[] = []
    let length = 0
    let limited = false

    processor.onaudioprocess = (event) => {
      if (limited) {
        return
      }
      chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      length += BUFFER_SIZE
      if (length >= VOICE_MAX_SECONDS * VOICE_SAMPLE_RATE) {
        limited = true
        onLimit()
      }
    }

    source.connect(analyser)
    analyser.connect(processor)
    // ScriptProcessorNode only runs while connected to an output. Keep that output silent.
    processor.connect(context.destination)

    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined)
    }

    return {
      stop: async () => {
        release()
        return length === 0 ? null : encodeWav(chunks, length)
      },
      cancel: release,
      analyser,
    }
  } catch (error) {
    release()
    throw error
  }
}

function encodeWav(chunks: Float32Array[], length: number) {
  const samples = Math.min(length, VOICE_MAX_SECONDS * VOICE_SAMPLE_RATE)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const writeString = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, VOICE_SAMPLE_RATE, true)
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, samples * 2, true)

  let offset = 44
  let written = 0
  for (const chunk of chunks) {
    for (let index = 0; index < chunk.length && written < samples; index++) {
      const sample = Math.max(-1, Math.min(1, chunk[index]))
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true,
      )
      offset += 2
      written += 1
    }
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

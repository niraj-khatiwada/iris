import { useEffect, useRef, useState } from 'react'

import { cn } from '@/utils/tailwind'

const BAR_WIDTH = 2
const BAR_GAP = 3
const BAR_MIN = 4
const BAR_MAX = 28
const MAX_BARS = 160
const FREQ_LOW = 100
const FREQ_HIGH = 4000
const DB_FLOOR = -80
const DB_CEIL = -25
const TILT_DB_PER_OCTAVE = 4

type VoiceWaveProps = {
  analyser?: AnalyserNode | null
  active?: boolean
  compact?: boolean
  className?: string
  /** Blue while Iris is reading aloud; primary for the microphone. */
  tone?: 'primary' | 'speaking'
}

/**
 * A live voice spectrum when an analyser is available, or a smooth synthetic wave for speaking
 * and microphone-permission waits. Bars are animated by mutating transforms, not React state.
 */
function VoiceWave({
  analyser = null,
  active = true,
  compact = false,
  className,
  tone = 'primary',
}: VoiceWaveProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(0)
  const barMin = compact ? 3 : BAR_MIN
  const barMax = compact ? 16 : BAR_MAX

  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return
    }

    const observer = new ResizeObserver(([entry]) => {
      const fit = Math.floor(
        (entry.contentRect.width + BAR_GAP) / (BAR_WIDTH + BAR_GAP),
      )
      setCount(Math.min(MAX_BARS, Math.max(0, fit)))
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root || count < 1) {
      return
    }

    const bars = Array.from(root.children) as HTMLElement[]
    const levels = new Float32Array(count)
    const targets = new Float32Array(count)
    const tilts = new Float32Array(count)
    for (let index = 0; index < count; index += 1) {
      tilts[index] =
        TILT_DB_PER_OCTAVE * Math.log2(FREQ_HIGH / FREQ_LOW) * (index / count)
    }

    let data = new Float32Array(0)
    let ranges: Range[] = []
    let rangeKey = ''
    let frame = 0
    const startedAt = performance.now()

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      if (!active) {
        targets.fill(0)
      } else if (analyser) {
        if (data.length !== analyser.frequencyBinCount) {
          data = new Float32Array(analyser.frequencyBinCount)
        }
        const key = `${analyser.context.sampleRate}:${analyser.fftSize}`
        if (key !== rangeKey) {
          rangeKey = key
          ranges = buildRanges(
            count,
            analyser.context.sampleRate / analyser.fftSize,
            data.length,
          )
        }
        analyser.getFloatFrequencyData(data)
        for (let index = 0; index < count; index += 1) {
          const { from, to, center } = ranges[index]
          let peak = -Infinity
          if (to - from <= 1) {
            const base = Math.min(data.length - 2, Math.floor(center))
            const weight = center - base
            peak = data[base] * (1 - weight) + data[base + 1] * weight
          } else {
            for (let bin = from; bin < to; bin += 1) {
              peak = Math.max(peak, data[bin])
            }
          }
          const db = peak + tilts[index]
          targets[index] = Math.min(
            1,
            Math.max(0, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)),
          )
        }
      } else {
        const time = (now - startedAt) / 1000
        for (let index = 0; index < count; index += 1) {
          const envelope = 0.55 + 0.45 * Math.sin(time * 1.6)
          targets[index] =
            0.12 +
            0.62 *
              Math.abs(Math.sin(time * 3.1 + index * 0.42)) *
              (0.55 + 0.45 * Math.sin(time * 0.9 + index * 0.23)) *
              envelope
        }
      }

      for (let index = 0; index < count; index += 1) {
        const prev = targets[Math.max(0, index - 1)]
        const next = targets[Math.min(count - 1, index + 1)]
        const target = (prev + targets[index] * 2 + next) / 4
        levels[index] +=
          (target - levels[index]) * (target > levels[index] ? 0.7 : 0.28)
        const height = barMin + (barMax - barMin) * levels[index]
        bars[index].style.transform = `scaleY(${(height / barMin).toFixed(3)})`
      }
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [active, analyser, barMax, barMin, count])

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={cn(
        'flex items-center gap-[3px] overflow-hidden',
        compact ? 'h-6' : 'h-9',
        className,
      )}
    >
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={cn(
            'w-0.5 shrink-0 origin-center rounded-full',
            tone === 'speaking' ? 'bg-sky-400/85' : 'bg-primary/85',
            compact ? 'h-[3px]' : 'h-1',
          )}
        />
      ))}
    </div>
  )
}

type Range = { from: number; to: number; center: number }

function buildRanges(n: number, binWidth: number, binCount: number) {
  const ranges: Range[] = []
  const ratio = FREQ_HIGH / FREQ_LOW
  for (let index = 0; index < n; index += 1) {
    const low = FREQ_LOW * ratio ** (index / n)
    const high = FREQ_LOW * ratio ** ((index + 1) / n)
    const from = Math.min(binCount - 1, Math.floor(low / binWidth))
    const to = Math.min(
      binCount,
      Math.max(from + 1, Math.ceil(high / binWidth)),
    )
    ranges.push({ from, to, center: Math.sqrt(low * high) / binWidth })
  }
  return ranges
}

VoiceWave.displayName = 'VoiceWave'

export default VoiceWave

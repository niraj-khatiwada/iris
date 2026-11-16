import { Button, Tooltip } from '@heroui/react'
import { emit, listen } from '@tauri-apps/api/event'
import Konva from 'konva'
import {
  ArrowUpRight,
  Check,
  type LucideIcon,
  Move,
  Pencil,
  Square,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'

import { closeScreenCapture } from '@/tauri/commands/screen'
import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'
import { applyTheme } from '@/utils/theme'

import './global.css'

applyTheme('dark')

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }
type Tool = 'pen' | 'rect' | 'arrow'
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const COLORS = [
  { label: 'White', value: '#ffffff' },
  { label: 'Green', value: '#7ce2a3' },
  { label: 'Red', value: '#ff8a8a' },
  { label: 'Blue', value: '#7cc4fa' },
] as const

const STROKE_WIDTH = 3
const MIN_SELECTION = 16

const HANDLES: Array<{ id: Handle; x: number; y: number; cursor: string }> = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
]

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function Capture() {
  const [image, setImage] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'select' | 'annotate'>('idle')
  const [draft, setDraft] = useState<Rect | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<string>(COLORS[1].value)
  const [ready, setReady] = useState(false)

  const stageContainerRef = useRef<HTMLDivElement>(null)
  const annotationsRef = useRef<Konva.Shape[]>([])
  const undoRef = useRef<(() => void) | null>(null)
  const exportRef = useRef<(() => string) | null>(null)
  const attachRef = useRef<(() => void) | null>(null)
  const toolRef = useRef<Tool>('pen')
  const colorRef = useRef<string>(COLORS[1].value)
  const selectionRef = useRef<Rect | null>(null)
  const dragStart = useRef<Point | null>(null)
  const draftRef = useRef<Rect | null>(null)
  const resize = useRef<{
    handle: Handle
    pointer: Point
    start: Rect
  } | null>(null)
  const moveHandle = useRef<{ pointer: Point; start: Rect } | null>(null)

  toolRef.current = tool
  colorRef.current = color
  selectionRef.current = selection

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false

    if (!isTauri()) {
      // Browser preview: a synthetic screen so the capture flow can be designed without
      // Screen Recording permissions.
      const canvas = document.createElement('canvas')
      canvas.width = 1440
      canvas.height = 900
      const context = canvas.getContext('2d')
      if (context) {
        const gradient = context.createLinearGradient(0, 0, 1440, 900)
        gradient.addColorStop(0, '#0b1220')
        gradient.addColorStop(0.55, '#16233a')
        gradient.addColorStop(1, '#251a2e')
        context.fillStyle = gradient
        context.fillRect(0, 0, 1440, 900)
        context.fillStyle = 'rgba(255,255,255,0.06)'
        for (let row = 0; row < 3; row += 1) {
          for (let column = 0; column < 3; column += 1) {
            context.fillRect(120 + column * 420, 150 + row * 240, 340, 180)
          }
        }
        context.fillStyle = '#7ce2a3'
        context.fillRect(120, 72, 120, 10)
        context.fillStyle = 'rgba(255,255,255,0.35)'
        context.fillRect(120, 96, 280, 6)
      }
      setImage(canvas.toDataURL('image/png'))
      setPhase('select')
      return
    }

    void listen<{ image: string }>('capture:start', (event) => {
      setImage(event.payload.image)
      setPhase('select')
      setDraft(null)
      setSelection(null)
      setReady(false)
      dragStart.current = null
      draftRef.current = null
      resize.current = null
      moveHandle.current = null
    }).then((off) => {
      if (disposed) {
        off()
      } else {
        unlisten = off
      }
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void closeScreenCapture()
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undoRef.current?.()
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        attachRef.current?.()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // One full-screen stage: the frozen screenshot plus annotations in screen coordinates. The
  // selection is only a crop frame, so resizing or moving it never rewrites the annotations.
  useEffect(() => {
    if (!image) {
      return
    }
    const container = stageContainerRef.current
    if (!container) {
      return
    }

    const width = window.innerWidth
    const height = window.innerHeight
    const stage = new Konva.Stage({ container, width, height })
    const layer = new Konva.Layer()
    stage.add(layer)
    annotationsRef.current = []
    setReady(false)

    let drawing: Konva.Shape | null = null
    let drawingTool: Tool | null = null
    let start: Point | null = null
    const pointer = () => stage.getPointerPosition()

    const withinSelection = (point: Point) => {
      const current = selectionRef.current
      return (
        current !== null &&
        point.x >= current.x &&
        point.x <= current.x + current.width &&
        point.y >= current.y &&
        point.y <= current.y + current.height
      )
    }

    stage.on('mousedown touchstart', () => {
      const position = pointer()
      if (!position || !withinSelection(position)) {
        return
      }

      start = position
      drawingTool = toolRef.current
      const stroke = colorRef.current

      if (drawingTool === 'pen') {
        drawing = new Konva.Line({
          points: [position.x, position.y],
          stroke,
          strokeWidth: STROKE_WIDTH,
          lineCap: 'round',
          lineJoin: 'round',
          tension: 0.4,
        })
      } else if (drawingTool === 'rect') {
        drawing = new Konva.Rect({
          x: position.x,
          y: position.y,
          width: 0,
          height: 0,
          stroke,
          strokeWidth: STROKE_WIDTH,
          cornerRadius: 3,
        })
      } else {
        drawing = new Konva.Arrow({
          points: [position.x, position.y, position.x, position.y],
          stroke,
          fill: stroke,
          strokeWidth: STROKE_WIDTH,
          pointerLength: 8,
          pointerWidth: 8,
        })
      }

      layer.add(drawing)
      annotationsRef.current.push(drawing)
    })

    stage.on('mousemove touchmove', () => {
      if (!drawing || !start) {
        return
      }
      const position = pointer()
      if (!position) {
        return
      }

      if (drawingTool === 'pen') {
        const line = drawing as Konva.Line
        line.points([...line.points(), position.x, position.y])
      } else if (drawingTool === 'rect') {
        drawing.setAttrs({
          x: Math.min(start.x, position.x),
          y: Math.min(start.y, position.y),
          width: Math.abs(position.x - start.x),
          height: Math.abs(position.y - start.y),
        })
      } else {
        const arrow = drawing as Konva.Arrow
        arrow.points([start.x, start.y, position.x, position.y])
      }
      layer.batchDraw()
    })

    const finish = () => {
      drawing = null
      drawingTool = null
      start = null
    }
    stage.on('mouseup touchend', finish)

    const backgroundImage = new window.Image()
    backgroundImage.onload = () => {
      const scale = backgroundImage.naturalWidth / window.innerWidth
      const background = new Konva.Image({
        image: backgroundImage,
        width,
        height,
        listening: false,
      })
      layer.add(background)
      background.moveToBottom()
      layer.batchDraw()
      setReady(true)

      exportRef.current = () => {
        const current = selectionRef.current
        if (!current) {
          return ''
        }
        return stage.toDataURL({
          x: current.x,
          y: current.y,
          width: current.width,
          height: current.height,
          pixelRatio: scale,
          mimeType: 'image/jpeg',
          quality: 0.92,
        })
      }
    }
    backgroundImage.src = image

    undoRef.current = () => {
      annotationsRef.current.pop()?.destroy()
      layer.batchDraw()
    }

    return () => {
      stage.destroy()
      undoRef.current = null
      exportRef.current = null
    }
  }, [image])

  useEffect(() => {
    if (phase !== 'annotate') {
      return
    }
    const container = stageContainerRef.current
    if (container) {
      container.style.cursor = 'crosshair'
    }
  }, [phase])

  const position = (event: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!image) {
      return
    }

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic preview events have no active pointer.
    }
    const point = position(event)
    dragStart.current = point
    const rect = { x: point.x, y: point.y, width: 0, height: 0 }
    draftRef.current = rect
    setDraft(rect)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current
    if (!start) {
      return
    }

    const point = position(event)
    const rect = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    }
    draftRef.current = rect
    setDraft(rect)
  }

  const onPointerUp = () => {
    const rect = draftRef.current
    dragStart.current = null
    draftRef.current = null
    setDraft(null)

    if (!rect || rect.width < MIN_SELECTION || rect.height < MIN_SELECTION) {
      return
    }

    setSelection(rect)
    setPhase('annotate')
  }

  const startResize =
    (handle: Handle) => (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!selection) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // ignore
      }
      resize.current = {
        handle,
        pointer: { x: event.clientX, y: event.clientY },
        start: selection,
      }
    }

  const moveResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = resize.current
    if (!state) {
      return
    }

    const dx = event.clientX - state.pointer.x
    const dy = event.clientY - state.pointer.y
    const { start, handle } = state
    let left = start.x
    let top = start.y
    let right = start.x + start.width
    let bottom = start.y + start.height

    if (handle.includes('w')) {
      left = clamp(start.x + dx, 0, right - MIN_SELECTION)
    }
    if (handle.includes('e')) {
      right = clamp(right + dx, left + MIN_SELECTION, window.innerWidth)
    }
    if (handle.includes('n')) {
      top = clamp(start.y + dy, 0, bottom - MIN_SELECTION)
    }
    if (handle.includes('s')) {
      bottom = clamp(bottom + dy, top + MIN_SELECTION, window.innerHeight)
    }

    setSelection({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    })
  }

  const endResize = () => {
    resize.current = null
  }

  // The toolbar's move icon is itself the drag handle: grab it and the selection follows.
  const startMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!selection) {
      return
    }
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // ignore
    }
    moveHandle.current = {
      pointer: { x: event.clientX, y: event.clientY },
      start: selection,
    }
  }

  const moveSelection = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = moveHandle.current
    if (!state) {
      return
    }

    const dx = event.clientX - state.pointer.x
    const dy = event.clientY - state.pointer.y
    setSelection({
      x: clamp(state.start.x + dx, 0, window.innerWidth - state.start.width),
      y: clamp(state.start.y + dy, 0, window.innerHeight - state.start.height),
      width: state.start.width,
      height: state.start.height,
    })
  }

  const endMove = () => {
    moveHandle.current = null
  }

  const attach = async () => {
    const dataUrl = exportRef.current?.()
    if (!dataUrl) {
      return
    }

    if (!isTauri()) {
      return
    }

    await emit('capture:attached', { dataUrl })
    await closeScreenCapture()
  }

  attachRef.current = () => void attach()

  const toolbarTop = selection
    ? selection.y > 52
      ? selection.y - 44
      : Math.min(selection.y + selection.height + 12, window.innerHeight - 52)
    : 0
  const toolbarLeft = selection
    ? clamp(selection.x + selection.width / 2, 180, window.innerWidth - 180)
    : 0

  return (
    <div className="relative h-full w-full overflow-hidden bg-black/40 text-white">
      <div
        ref={stageContainerRef}
        className="absolute inset-0"
        style={{
          pointerEvents: phase === 'annotate' ? 'auto' : 'none',
        }}
      />

      {phase === 'select' ? (
        <>
          <div
            className="absolute inset-0 cursor-crosshair"
            onPointerCancel={onPointerUp}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />

          {draft ? (
            <div
              className="pointer-events-none absolute border border-white/50 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"
              style={{
                left: draft.x,
                top: draft.y,
                width: draft.width,
                height: draft.height,
              }}
            >
              {draft.width > 0 ? (
                <span className="absolute -top-6 left-0 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
                  {Math.round(draft.width)} × {Math.round(draft.height)}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="pointer-events-none absolute inset-x-0 top-5 flex justify-center">
            <p className="rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[11px] text-white/80 backdrop-blur-md">
              Drag to capture · Esc to cancel
            </p>
          </div>
        </>
      ) : null}

      {phase === 'annotate' && selection ? (
        <>
          <div
            className="pointer-events-none absolute border border-white/35 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height,
            }}
          />

          {HANDLES.map((handle) => (
            <button
              key={handle.id}
              type="button"
              aria-label={`Resize ${handle.id}`}
              className="absolute z-30 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
              style={{
                left: selection.x + selection.width * handle.x,
                top: selection.y + selection.height * handle.y,
                cursor: handle.cursor,
              }}
              onPointerCancel={endResize}
              onPointerDown={startResize(handle.id)}
              onPointerMove={moveResize}
              onPointerUp={endResize}
            >
              <span className="size-2 rounded-full border border-black/40 bg-white shadow-sm" />
            </button>
          ))}

          <div
            className="fixed z-40 flex items-center gap-0.5 rounded-2xl border border-white/10 bg-[#1b1b1f]/95 px-1.5 py-1 shadow-2xl backdrop-blur-xl"
            style={{
              left: toolbarLeft,
              top: toolbarTop,
              transform: 'translateX(-50%)',
            }}
          >
            <Tooltip delay={400}>
              <button
                type="button"
                aria-label="Drag selection"
                className="flex size-7 cursor-grab items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 active:cursor-grabbing"
                onPointerCancel={endMove}
                onPointerDown={startMove}
                onPointerMove={moveSelection}
                onPointerUp={endMove}
              >
                <Move className="size-3.5" />
              </button>
              <Tooltip.Content>Drag to move the selection</Tooltip.Content>
            </Tooltip>

            <span className="mx-0.5 h-4 w-px bg-white/10" />

            <ToolButton
              active={tool === 'pen'}
              icon={Pencil}
              label="Pen"
              onPress={() => setTool('pen')}
            />
            <ToolButton
              active={tool === 'rect'}
              icon={Square}
              label="Rectangle"
              onPress={() => setTool('rect')}
            />
            <ToolButton
              active={tool === 'arrow'}
              icon={ArrowUpRight}
              label="Arrow"
              onPress={() => setTool('arrow')}
            />

            <span className="mx-0.5 h-4 w-px bg-white/10" />

            {COLORS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-label={`${option.label} ink`}
                className={cn(
                  'size-4 rounded-full ring-1 ring-white/30 transition-transform hover:scale-110',
                  color === option.value && 'ring-2 ring-white',
                )}
                style={{ backgroundColor: option.value }}
                onClick={() => setColor(option.value)}
              />
            ))}

            <span className="mx-0.5 h-4 w-px bg-white/10" />

            <Button
              isIconOnly
              aria-label="Cancel capture"
              className="size-7 min-w-7 text-white/65"
              size="sm"
              variant="ghost"
              onPress={() => void closeScreenCapture()}
            >
              <X className="size-3.5" />
            </Button>

            <Tooltip delay={400}>
              <Button
                className="h-7 min-h-7 rounded-full border border-white/15 bg-white/[0.08] px-2.5 text-[12px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md hover:bg-white/[0.14] disabled:opacity-40"
                isDisabled={!ready}
                size="sm"
                variant="ghost"
                onPress={() => void attach()}
              >
                <Check className="size-3" />
                Attach
              </Button>
              <Tooltip.Content>Attach · Enter</Tooltip.Content>
            </Tooltip>
          </div>
        </>
      ) : null}
    </div>
  )
}

function ToolButton({
  active,
  icon: Icon,
  label,
  onPress,
}: {
  active: boolean
  icon: LucideIcon
  label: string
  onPress: () => void
}) {
  return (
    <Tooltip delay={400}>
      <Button
        isIconOnly
        aria-label={label}
        className={cn(
          'size-7 min-w-7',
          active ? 'bg-white/15 text-white' : 'text-white/65',
        )}
        size="sm"
        variant="ghost"
        onPress={onPress}
      >
        <Icon className="size-3.5" />
      </Button>
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  )
}

Capture.displayName = 'Capture'

const rootElement = document.getElementById('app')

if (rootElement && !rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(<Capture />)
}

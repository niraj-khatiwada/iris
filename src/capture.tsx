import { Button, Tooltip } from '@heroui/react'
import { emit, listen } from '@tauri-apps/api/event'
import Konva from 'konva'
import {
  ArrowUpRight,
  Check,
  type LucideIcon,
  Pencil,
  Square,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'

import {
  captureAnnotatedScreen,
  closeScreenCapture,
} from '@/tauri/commands/screen'
import { cn } from '@/utils/tailwind'
import { isTauri } from '@/utils/tauri'
import { applyAccent, applyTheme, getStoredAvatarColor } from '@/utils/theme'

import './global.css'

document.documentElement.dataset.window = 'capture'
applyTheme('dark')
applyAccent(getStoredAvatarColor())

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

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(new Error('Could not read the captured screen.'))
    image.src = source
  })
}

/** Crops the annotated display capture to the selection at native resolution. */
async function cropToSelection(
  source: string,
  selection: Rect,
): Promise<string> {
  const image = await loadImage(source)
  const scale = image.naturalWidth / window.innerWidth
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(selection.width * scale))
  canvas.height = Math.max(1, Math.round(selection.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not crop the captured screen.')
  }
  context.drawImage(
    image,
    Math.round(selection.x * scale),
    Math.round(selection.y * scale),
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return canvas.toDataURL('image/jpeg', 0.92)
}

function Capture() {
  const [session, setSession] = useState(isTauri() ? 0 : 1)
  const [phase, setPhase] = useState<'idle' | 'select' | 'annotate'>(
    isTauri() ? 'idle' : 'select',
  )
  const [draft, setDraft] = useState<Rect | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState<string>(COLORS[1].value)
  const [ready, setReady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))

  const stageContainerRef = useRef<HTMLDivElement>(null)
  const annotationsRef = useRef<Konva.Shape[]>([])
  const undoRef = useRef<(() => void) | null>(null)
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
  const toolbarRef = useRef<HTMLDivElement>(null)
  const toolbarDrag = useRef<{
    pointer: Point
    origin: Point
    width: number
    height: number
  } | null>(null)
  const [toolbarPosition, setToolbarPosition] = useState<Point | null>(null)
  const [toolbarDragging, setToolbarDragging] = useState(false)

  toolRef.current = tool
  colorRef.current = color
  selectionRef.current = selection

  // The capture panel is resized from its hidden 100x100 frame when it opens. Rebuild the stage
  // for the final size so the annotation coordinates match the live display.
  useEffect(() => {
    const onResize = () =>
      setSize((current) =>
        current.width === window.innerWidth &&
        current.height === window.innerHeight
          ? current
          : { width: window.innerWidth, height: window.innerHeight },
      )
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!isTauri()) {
      return
    }

    let disposed = false

    const cleanups: Array<() => void> = []
    const track = (subscribe: Promise<() => void>) => {
      void subscribe.then((off) => {
        if (disposed) {
          off()
        } else {
          cleanups.push(off)
        }
      })
    }

    track(
      listen('capture:start', () => {
        setPhase('select')
        setDraft(null)
        setSelection(null)
        setReady(false)
        setCapturing(false)
        setError(null)
        dragStart.current = null
        draftRef.current = null
        resize.current = null
        moveHandle.current = null
        toolbarDrag.current = null
        setToolbarPosition(null)
        setToolbarDragging(false)
        setSession((current) => current + 1)
      }),
    )

    // The window is hidden before this arrives, so the next show never flashes the old selection.
    track(
      listen('capture:closed', () => {
        setPhase('idle')
        setDraft(null)
        setSelection(null)
        setReady(false)
        setCapturing(false)
        setError(null)
        setSession(0)
        toolbarDrag.current = null
        setToolbarPosition(null)
        setToolbarDragging(false)
      }),
    )

    return () => {
      disposed = true
      for (const cleanup of cleanups) {
        cleanup()
      }
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void closeScreenCapture()
        return
      }

      if (event.metaKey || event.ctrlKey) {
        const key = event.key.toLowerCase()
        if (key === 'z') {
          event.preventDefault()
          undoRef.current?.()
          return
        }
        if (key === 'a') {
          event.preventDefault()
          setTool('arrow')
          return
        }
        if (key === 'r') {
          event.preventDefault()
          setTool('rect')
          return
        }
        if (key === 'd' || key === 'p') {
          event.preventDefault()
          setTool('pen')
          return
        }
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        attachRef.current?.()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // One full-screen annotation layer in screen coordinates. The selection is only a crop frame,
  // so resizing or moving it never rewrites what has been drawn. The live screen shows through
  // the transparent window behind it.
  useEffect(() => {
    if (session === 0) {
      return
    }
    const container = stageContainerRef.current
    if (!container) {
      return
    }

    const width = size.width
    const height = size.height
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

    setReady(true)

    undoRef.current = () => {
      annotationsRef.current.pop()?.destroy()
      layer.batchDraw()
    }

    return () => {
      stage.destroy()
      undoRef.current = null
    }
  }, [session, size.height, size.width])

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
    if (phase !== 'select') {
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

  // The selection's outer edge is the drag handle: grab the frame just outside the crop and the
  // whole selection follows. The interior stays free for drawing annotations.
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

  // The toolbar itself can be dragged by its empty space, so it can be moved away from the area
  // being annotated. Buttons keep their own actions.
  const startToolbarDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selection || (event.target as HTMLElement).closest('button')) {
      return
    }
    const element = toolbarRef.current
    if (!element) {
      return
    }
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic preview events have no active pointer.
    }
    const rect = element.getBoundingClientRect()
    toolbarDrag.current = {
      pointer: { x: event.clientX, y: event.clientY },
      origin: { x: rect.left + rect.width / 2, y: rect.top },
      width: rect.width,
      height: rect.height,
    }
    setToolbarDragging(true)
  }

  const moveToolbar = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = toolbarDrag.current
    if (!state) {
      return
    }

    const dx = event.clientX - state.pointer.x
    const dy = event.clientY - state.pointer.y
    setToolbarPosition({
      x: clamp(
        state.origin.x + dx,
        state.width / 2 + 8,
        window.innerWidth - state.width / 2 - 8,
      ),
      y: clamp(state.origin.y + dy, 8, window.innerHeight - state.height - 8),
    })
  }

  const endToolbarDrag = () => {
    if (!toolbarDrag.current) {
      return
    }
    toolbarDrag.current = null
    setToolbarDragging(false)
  }

  const attach = async () => {
    const current = selectionRef.current
    if (!current || capturing || !isTauri()) {
      return
    }

    setCapturing(true)
    setError(null)

    try {
      // Let the browser paint the chrome-free frame before the native screenshot runs.
      await nextFrame()
      await nextFrame()
      const display = await captureAnnotatedScreen()
      const dataUrl = await cropToSelection(display, current)
      await emit('capture:attached', { dataUrl })
      await closeScreenCapture()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setCapturing(false)
    }
  }

  attachRef.current = () => void attach()

  const toolbarTop =
    toolbarPosition?.y ??
    (selection
      ? selection.y > 52
        ? selection.y - 44
        : Math.min(selection.y + selection.height + 12, window.innerHeight - 52)
      : 0)
  const toolbarLeft =
    toolbarPosition?.x ??
    (selection
      ? clamp(selection.x + selection.width / 2, 180, window.innerWidth - 180)
      : 0)

  return (
    <div
      className="relative h-full w-full overflow-hidden text-white"
      style={
        isTauri()
          ? undefined
          : {
              background:
                'radial-gradient(circle at 30% 18%, #22304a 0%, #0b1220 60%, #1a1122 100%)',
            }
      }
    >
      <div
        ref={stageContainerRef}
        className="absolute inset-0"
        style={{
          pointerEvents: capturing || phase !== 'annotate' ? 'none' : 'auto',
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

          {/* 48px clears the menu bar and the MacBook notch. */}
          <div className="pointer-events-none absolute inset-x-0 top-12 flex justify-center">
            <p className="rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[11px] text-white/80 backdrop-blur-md">
              Drag to capture · Esc to cancel
            </p>
          </div>
        </>
      ) : null}

      {phase === 'annotate' && selection ? (
        <>
          <div
            className={cn(
              'pointer-events-none absolute border shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]',
              capturing ? 'border-transparent' : 'border-white/35',
            )}
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height,
            }}
          />

          {!capturing ? (
            <>
              <button
                type="button"
                aria-label="Move selection"
                className="absolute z-20 cursor-move border-0 bg-transparent p-0 transition-colors hover:bg-white/[0.04]"
                style={{
                  left: selection.x,
                  top: selection.y - 10,
                  width: selection.width,
                  height: 12,
                }}
                tabIndex={-1}
                onPointerCancel={endMove}
                onPointerDown={startMove}
                onPointerMove={moveSelection}
                onPointerUp={endMove}
              />
              <button
                type="button"
                aria-label="Move selection"
                className="absolute z-20 cursor-move border-0 bg-transparent p-0 transition-colors hover:bg-white/[0.04]"
                style={{
                  left: selection.x,
                  top: selection.y + selection.height - 2,
                  width: selection.width,
                  height: 12,
                }}
                tabIndex={-1}
                onPointerCancel={endMove}
                onPointerDown={startMove}
                onPointerMove={moveSelection}
                onPointerUp={endMove}
              />
              <button
                type="button"
                aria-label="Move selection"
                className="absolute z-20 cursor-move border-0 bg-transparent p-0 transition-colors hover:bg-white/[0.04]"
                style={{
                  left: selection.x - 10,
                  top: selection.y,
                  width: 12,
                  height: selection.height,
                }}
                tabIndex={-1}
                onPointerCancel={endMove}
                onPointerDown={startMove}
                onPointerMove={moveSelection}
                onPointerUp={endMove}
              />
              <button
                type="button"
                aria-label="Move selection"
                className="absolute z-20 cursor-move border-0 bg-transparent p-0 transition-colors hover:bg-white/[0.04]"
                style={{
                  left: selection.x + selection.width - 2,
                  top: selection.y,
                  width: 12,
                  height: selection.height,
                }}
                tabIndex={-1}
                onPointerCancel={endMove}
                onPointerDown={startMove}
                onPointerMove={moveSelection}
                onPointerUp={endMove}
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
            </>
          ) : null}

          {!capturing ? (
            <div
              ref={toolbarRef}
              className={cn(
                'fixed z-40 flex items-center gap-0.5 rounded-2xl border border-white/10 bg-[#1b1b1f]/95 px-1.5 py-1 shadow-2xl backdrop-blur-xl',
                toolbarDragging ? 'cursor-grabbing' : 'cursor-grab',
                '[&_button]:cursor-default',
              )}
              style={{
                left: toolbarLeft,
                top: toolbarTop,
                transform: 'translateX(-50%)',
              }}
              onPointerCancel={endToolbarDrag}
              onPointerDown={startToolbarDrag}
              onPointerMove={moveToolbar}
              onPointerUp={endToolbarDrag}
            >
              <ToolButton
                active={tool === 'pen'}
                icon={Pencil}
                label="Pen"
                shortcut="⌘D / ⌘P"
                onPress={() => setTool('pen')}
              />
              <ToolButton
                active={tool === 'rect'}
                icon={Square}
                label="Rectangle"
                shortcut="⌘R"
                onPress={() => setTool('rect')}
              />
              <ToolButton
                active={tool === 'arrow'}
                icon={ArrowUpRight}
                label="Arrow"
                shortcut="⌘A"
                onPress={() => setTool('arrow')}
              />

              <span
                aria-hidden
                className="mx-0.5 flex h-6 w-2 items-center justify-center"
              >
                <span className="h-4 w-px bg-white/10" />
              </span>

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

              <span
                aria-hidden
                className="mx-0.5 flex h-6 w-2 items-center justify-center"
              >
                <span className="h-4 w-px bg-white/10" />
              </span>

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
                  isDisabled={!ready || capturing}
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
          ) : null}
        </>
      ) : null}

      {error && !capturing ? (
        <div className="pointer-events-none absolute right-5 bottom-5 flex justify-end">
          <p className="max-w-[80vw] truncate rounded-full border border-red-300/20 bg-red-950/70 px-2.5 py-1 text-[11px] text-red-200 backdrop-blur-md">
            {error}
          </p>
        </div>
      ) : null}
    </div>
  )
}

function ToolButton({
  active,
  icon: Icon,
  label,
  shortcut,
  onPress,
}: {
  active: boolean
  icon: LucideIcon
  label: string
  shortcut?: string
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
      <Tooltip.Content>
        {shortcut ? `${label} · ${shortcut}` : label}
      </Tooltip.Content>
    </Tooltip>
  )
}

Capture.displayName = 'Capture'

const rootElement = document.getElementById('app')

if (rootElement && !rootElement.innerHTML) {
  ReactDOM.createRoot(rootElement).render(<Capture />)
}

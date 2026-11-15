import { Button, Modal } from '@heroui/react'
import { useEffect, useRef, useState } from 'react'

import {
  formatKeyFromCode,
  formatShortcut,
  shortcutFromEvent,
} from '@/utils/shortcut'
import { cn } from '@/utils/tailwind'

const MODIFIER_LABELS: Record<string, string> = {
  Meta: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧',
}

type ShortcutRecorderProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Applies the binding. Reject to keep the recorder open and show the error. */
  onRecord: (shortcut: string) => Promise<void>
}

function ShortcutRecorder({
  open,
  onOpenChange,
  onRecord,
}: ShortcutRecorderProps) {
  const [held, setHeld] = useState<string[]>([])
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const [selected, setSelected] = useState(false)
  const heldRef = useRef<string[]>([])
  const applyingRef = useRef(false)
  const selectedRef = useRef(false)
  const closeTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!open) {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
      heldRef.current = []
      setHeld([])
      setSelectedKeys([])
      setSelected(false)
      selectedRef.current = false
      setError('')
      setApplying(false)
      applyingRef.current = false
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (selectedRef.current || applyingRef.current) {
        return
      }

      if (event.key === 'Escape') {
        onOpenChange(false)
        return
      }

      const modifier = MODIFIER_LABELS[event.key]
      if (modifier) {
        if (!heldRef.current.includes(modifier)) {
          heldRef.current = [...heldRef.current, modifier]
          setHeld(heldRef.current)
        }
        return
      }

      const shortcut = shortcutFromEvent(event)
      if (!shortcut) {
        return
      }

      const keyLabel = formatKeyFromCode(event.code)
      const keys =
        heldRef.current.length > 0
          ? [...heldRef.current, keyLabel]
          : formatShortcut(shortcut).split(' ')

      heldRef.current = []
      setHeld([])
      setSelectedKeys(keys)
      setSelected(true)
      selectedRef.current = true
      setError('')
      applyingRef.current = true
      setApplying(true)

      void onRecord(shortcut)
        .then(() => {
          if (closeTimer.current !== null) {
            window.clearTimeout(closeTimer.current)
          }
          closeTimer.current = window.setTimeout(() => {
            closeTimer.current = null
            onOpenChange(false)
          }, 2000)
        })
        .catch((reason) => {
          selectedRef.current = false
          setSelected(false)
          setSelectedKeys([])
          setError(reason instanceof Error ? reason.message : String(reason))
        })
        .finally(() => {
          applyingRef.current = false
          setApplying(false)
        })
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (selectedRef.current || applyingRef.current) {
        return
      }

      const modifier = MODIFIER_LABELS[event.key]
      if (!modifier) {
        return
      }

      heldRef.current = heldRef.current.filter((key) => key !== modifier)
      setHeld(heldRef.current)
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [onOpenChange, onRecord, open])

  useEffect(
    () => () => {
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current)
      }
    },
    [],
  )

  const displayKeys = selected ? selectedKeys : held
  const status = selected
    ? 'Shortcut selected'
    : applying
      ? 'Checking shortcut…'
      : 'Recording hotkey'

  return (
    <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog
          aria-label="Record a shortcut"
          className="glass-dialog w-[min(92vw,540px)] max-w-none overflow-hidden rounded-2xl p-0"
        >
          <Modal.Body className="flex min-h-44 flex-col items-center justify-center px-6 py-10 text-center">
            <p className="text-xl font-medium text-foreground/75">
              Press a shortcut
            </p>

            <div className="mt-5 flex min-h-9 items-center justify-center gap-2">
              {displayKeys.map((key, index) => (
                <span
                  key={`${key}-${index}`}
                  className="flex items-center gap-2"
                >
                  {index > 0 ? (
                    <span className="text-xs text-muted">+</span>
                  ) : null}
                  <span
                    className="flex h-9 min-w-9 items-center justify-center rounded-lg border px-2.5 text-sm font-medium"
                    style={
                      selected
                        ? {
                            color: 'var(--primary)',
                            borderColor:
                              'color-mix(in oklch, var(--primary) 42%, transparent)',
                            background:
                              'color-mix(in oklch, var(--primary) 12%, transparent)',
                          }
                        : {
                            color:
                              'color-mix(in oklch, var(--foreground) 86%, transparent)',
                            borderColor:
                              'color-mix(in oklch, var(--foreground) 12%, transparent)',
                            background:
                              'color-mix(in oklch, var(--foreground) 5%, transparent)',
                          }
                    }
                  >
                    {key}
                  </span>
                </span>
              ))}
            </div>

            {error ? (
              <p className="mt-3 max-w-80 text-xs leading-5 text-danger">
                {error}
              </p>
            ) : selected ? (
              <p className="mt-3 text-[11px] text-primary">Shortcut saved.</p>
            ) : (
              <p className="mt-3 text-[11px] text-muted">
                {held.length > 0
                  ? 'Now press a key.'
                  : 'Use ⌘, ⌃, or ⌥ with any key.'}
              </p>
            )}
          </Modal.Body>

          <div className="flex items-center justify-between gap-4 border-t border-border/40 px-5 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  'size-2 rounded-full',
                  selected ? 'bg-primary' : 'animate-pulse bg-foreground/40',
                )}
              />
              <span className={selected ? 'text-primary' : 'text-muted'}>
                {status}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                isDisabled={applying}
                size="sm"
                variant="ghost"
                onPress={() => onOpenChange(false)}
              >
                Close
              </Button>
              <Button
                isDisabled={applying}
                className="min-w-10 font-mono text-[11px]"
                size="sm"
                variant="secondary"
                onPress={() => onOpenChange(false)}
              >
                Esc
              </Button>
            </div>
          </div>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

ShortcutRecorder.displayName = 'ShortcutRecorder'

export default ShortcutRecorder

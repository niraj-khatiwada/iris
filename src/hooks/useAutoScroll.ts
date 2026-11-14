import { useEffect, useRef } from 'react'

/**
 * Keeps the conversation pinned to the bottom while new tokens arrive, unless the user
 * has scrolled up to read something.
 */
export function useAutoScroll<T extends HTMLElement>(dependency: unknown) {
  const ref = useRef<T>(null)
  const pinned = useRef(true)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `dependency` is the caller's scroll trigger
  useEffect(() => {
    const element = ref.current
    if (!element || !pinned.current) {
      return
    }

    element.scrollTop = element.scrollHeight
  }, [dependency])

  const onScroll = () => {
    const element = ref.current
    if (!element) {
      return
    }

    const distanceFromBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight
    pinned.current = distanceFromBottom < 96
  }

  return { ref, onScroll }
}

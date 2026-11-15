import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/** Fires when the native overlay is hidden by the shortcut, Escape, or an explicit action. */
export function subscribeToOverlayHidden(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen('overlay:hidden', () => handler())
}

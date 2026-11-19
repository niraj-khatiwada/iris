import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'

/**
 * Lets macOS launch Iris when the user signs in. The LaunchAgent is owned by the OS, so the
 * plugin is the source of truth: read it on mount and write only when the switch changes.
 */
export function isLaunchAtLoginEnabled() {
  return isEnabled()
}

export function enableLaunchAtLogin() {
  return enable()
}

export function disableLaunchAtLogin() {
  return disable()
}

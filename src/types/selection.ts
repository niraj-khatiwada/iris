/** A captured selection waiting for an action in the overlay. */
export type SelectionOpenPayload = {
  text: string
  appName: string
  bundleId: string | null
  pid: number
  characterCount: number
  fromClipboard: boolean
  truncated: boolean
}

/** A selection could not be read, or Iris needs Accessibility permission. */
export type SelectionErrorPayload = {
  message: string
  permissionRequired: boolean
}

export type SelectionView =
  | ({ kind: 'actions' } & SelectionOpenPayload)
  | ({ kind: 'error' } & SelectionErrorPayload)

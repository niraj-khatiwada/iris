/// <reference types="vite/client" />

declare const __appVersion: string
declare const __envMode: string

interface Window {
  __TAURI_INTERNALS__?: unknown
  __appVersion: string
  __envMode: string
}

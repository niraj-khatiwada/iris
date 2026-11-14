import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { DEFAULT_MODEL, SETTINGS_STORAGE_KEY } from '@/constants'
import type { ThemeMode } from '@/types/settings'

type SettingsState = {
  theme: ThemeMode
  model: string
  streaming: boolean
  setTheme: (theme: ThemeMode) => void
  setModel: (model: string) => void
  setStreaming: (streaming: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      model: DEFAULT_MODEL,
      streaming: true,
      setTheme: (theme) => set({ theme }),
      setModel: (model) => set({ model }),
      setStreaming: (streaming) => set({ streaming }),
    }),
    { name: SETTINGS_STORAGE_KEY },
  ),
)

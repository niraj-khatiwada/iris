import { create } from 'zustand'

import type { SettingsCategory } from '@/types/settings'

type UIState = {
  sidebarOpen: boolean
  settingsOpen: boolean
  /** A panel requested by another part of the UI; consumed when Settings opens. */
  settingsCategory: SettingsCategory | null
  composerFocusToken: number
  /** The sidebar search text; empty means the normal conversation list is showing. */
  searchQuery: string
  /** Bumped by the search shortcut so the field can take focus even when it was already open. */
  searchFocusToken: number
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  openSettings: () => void
  openSettingsAt: (category: SettingsCategory) => void
  clearSettingsCategory: () => void
  closeSettings: () => void
  focusComposer: () => void
  setSearchQuery: (query: string) => void
  focusSearch: () => void
}

export const useUIStore = create<UIState>()((set) => ({
  sidebarOpen: true,
  settingsOpen: false,
  settingsCategory: null,
  composerFocusToken: 0,
  searchQuery: '',
  searchFocusToken: 0,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  openSettings: () => set({ settingsOpen: true }),
  openSettingsAt: (settingsCategory) =>
    set({ settingsOpen: true, settingsCategory }),
  clearSettingsCategory: () => set({ settingsCategory: null }),
  closeSettings: () => set({ settingsOpen: false, settingsCategory: null }),
  focusComposer: () =>
    set((state) => ({ composerFocusToken: state.composerFocusToken + 1 })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  focusSearch: () =>
    set((state) => ({
      sidebarOpen: true,
      searchFocusToken: state.searchFocusToken + 1,
    })),
}))

import { create } from 'zustand'

type UIState = {
  sidebarOpen: boolean
  settingsOpen: boolean
  composerFocusToken: number
  /** The sidebar search text; empty means the normal conversation list is showing. */
  searchQuery: string
  /** Bumped by the search shortcut so the field can take focus even when it was already open. */
  searchFocusToken: number
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  openSettings: () => void
  closeSettings: () => void
  focusComposer: () => void
  setSearchQuery: (query: string) => void
  focusSearch: () => void
}

export const useUIStore = create<UIState>()((set) => ({
  sidebarOpen: true,
  settingsOpen: false,
  composerFocusToken: 0,
  searchQuery: '',
  searchFocusToken: 0,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  focusComposer: () =>
    set((state) => ({ composerFocusToken: state.composerFocusToken + 1 })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  focusSearch: () =>
    set((state) => ({
      sidebarOpen: true,
      searchFocusToken: state.searchFocusToken + 1,
    })),
}))

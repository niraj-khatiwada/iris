import { create } from 'zustand'

type UIState = {
  sidebarOpen: boolean
  settingsOpen: boolean
  composerFocusToken: number
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  openSettings: () => void
  closeSettings: () => void
  focusComposer: () => void
}

export const useUIStore = create<UIState>()((set) => ({
  sidebarOpen: true,
  settingsOpen: false,
  composerFocusToken: 0,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  focusComposer: () =>
    set((state) => ({ composerFocusToken: state.composerFocusToken + 1 })),
}))

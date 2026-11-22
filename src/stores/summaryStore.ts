import { create } from 'zustand'

import { loadSpokenSummaries } from '@/tauri/commands/storage'
import { isTauri } from '@/utils/tauri'

type SummaryState = {
  /** conversationId -> messageId -> spoken summary. */
  summaries: Record<string, Record<string, string>>
  /** Messages currently showing their stored spoken summary instead of the reply text. */
  viewing: Record<string, boolean>
  /** Conversations whose summaries have been fetched at least once. */
  loaded: Record<string, boolean>
  /**
   * Fetches the summaries for one conversation. `force` refreshes the cache, which the
   * message menu and speech playback do so a newly generated summary still appears.
   */
  load: (conversationId: string, force?: boolean) => Promise<void>
  setViewing: (messageId: string, viewing: boolean) => void
  clear: () => void
}

/**
 * Read-aloud summaries belong to the history window's transcript view. The toggle is deliberately
 * separate from the chat store: it changes what is displayed and copied, never the stored history.
 */
export const useSummaryStore = create<SummaryState>()((set, get) => ({
  summaries: {},
  viewing: {},
  loaded: {},
  load: async (conversationId, force = false) => {
    if (!isTauri()) {
      set((state) => ({ loaded: { ...state.loaded, [conversationId]: true } }))
      return
    }

    if (!force && get().loaded[conversationId]) {
      return
    }

    try {
      const summaries = await loadSpokenSummaries(conversationId)
      set((state) => ({
        loaded: { ...state.loaded, [conversationId]: true },
        summaries: {
          ...state.summaries,
          [conversationId]: Object.fromEntries(
            summaries.map((item) => [item.messageId, item.summary]),
          ),
        },
      }))
    } catch {
      // Summaries are optional; the original transcript stays usable when SQLite is unavailable.
    }
  },
  setViewing: (messageId, viewing) =>
    set((state) => ({
      viewing: { ...state.viewing, [messageId]: viewing },
    })),
  clear: () => set({ summaries: {}, viewing: {}, loaded: {} }),
}))

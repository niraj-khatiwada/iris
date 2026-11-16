import { create } from 'zustand'

type SpeechState = {
  /** The conversation whose reply is being spoken, if any. */
  conversationId: string | null
  /** The TTS audio is still downloading. */
  preparing: boolean
  /** A reply is being read aloud right now. */
  speaking: boolean
}

/**
 * Read-aloud is a single app-wide activity: only one reply is ever spoken, so the state lives
 * outside any one conversation. Switching chats therefore cannot leave a stale indicator behind,
 * and the composer can always offer Stop no matter which conversation is on screen.
 */
export const useSpeechStore = create<SpeechState>()(() => ({
  conversationId: null,
  preparing: false,
  speaking: false,
}))

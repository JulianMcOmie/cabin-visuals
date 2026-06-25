import { create } from 'zustand'

/**
 * Lightweight, serializable descriptor for the loaded audio. The actual bytes
 * live behind audioSource.ts (in-memory for now), referenced by `ref` — so this
 * store stays JSON-friendly and survives the eventual IndexedDB/Supabase swap
 * untouched.
 */
export interface AudioClip {
  ref: string
  fileName: string
  duration: number // seconds
}

interface AudioState {
  clip: AudioClip | null
  setClip: (clip: AudioClip | null) => void
}

export const useAudioStore = create<AudioState>((set) => ({
  clip: null,
  setClip: (clip) => set({ clip }),
}))

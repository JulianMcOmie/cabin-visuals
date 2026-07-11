import { create } from 'zustand'
import { useProjectStore } from './ProjectStore'
import type { LoopRegion } from '../core/loopRegion'

interface TimeState {
  currentBeat: number
  isPlaying: boolean
  // Transport loop region - ephemeral like currentBeat, never persisted
  // (autosave subscribes to ProjectStore; this must stay out of it).
  loopRegion: LoopRegion | null
  setIsPlaying: (playing: boolean) => void
  setCurrentBeat: (beat: number) => void
  setLoopRegion: (region: LoopRegion | null) => void
}

export const useTimeStore = create<TimeState>((set) => ({
  currentBeat: 0,
  isPlaying: false,
  loopRegion: null,
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentBeat: (beat) => {
    // Clamp to the project length (bpm/beatsPerBar/totalBars live in ProjectStore).
    const { totalBars, beatsPerBar } = useProjectStore.getState()
    set({ currentBeat: Math.max(0, Math.min(beat, totalBars * beatsPerBar)) })
  },
  setLoopRegion: (region) => set({ loopRegion: region }),
}))

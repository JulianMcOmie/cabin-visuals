import { create } from 'zustand'
import { useProjectStore } from './ProjectStore'

interface TimeState {
  currentBeat: number
  isPlaying: boolean
  setIsPlaying: (playing: boolean) => void
  setCurrentBeat: (beat: number) => void
}

export const useTimeStore = create<TimeState>((set) => ({
  currentBeat: 0,
  isPlaying: false,
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentBeat: (beat) => {
    // Clamp to the project length (bpm/beatsPerBar/totalBars live in ProjectStore).
    const { totalBars, beatsPerBar } = useProjectStore.getState()
    set({ currentBeat: Math.max(0, Math.min(beat, totalBars * beatsPerBar)) })
  },
}))

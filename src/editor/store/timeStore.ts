import { create } from 'zustand'

interface TimeState {
  currentBeat: number
  bpm: number
  beatsPerBar: number
  totalBars: number
  setCurrentBeat: (beat: number) => void
}

export const useTimeStore = create<TimeState>((set, get) => ({
  currentBeat: 0,
  bpm: 120,
  beatsPerBar: 4,
  totalBars: 32,
  setCurrentBeat: (beat) => {
    const { totalBars, beatsPerBar } = get()
    set({ currentBeat: Math.max(0, Math.min(beat, totalBars * beatsPerBar)) })
  },
}))

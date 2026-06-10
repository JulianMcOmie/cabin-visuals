import { create } from 'zustand'

interface TimeState {
  currentBeat: number
  isPlaying: boolean;
  bpm: number
  beatsPerBar: number
  totalBars: number
  setIsPlaying: (playing: boolean) => void;
  setCurrentBeat: (beat: number) => void
}

export const useTimeStore = create<TimeState>((set, get) => ({
  currentBeat: 0,
  isPlaying: false,
  bpm: 120,
  beatsPerBar: 4,
  totalBars: 32,
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setCurrentBeat: (beat) => {
    const { totalBars, beatsPerBar } = get()
    set({ currentBeat: Math.max(0, Math.min(beat, totalBars * beatsPerBar)) })
  },
}))

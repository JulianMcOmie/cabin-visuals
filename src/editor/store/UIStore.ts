import { create } from 'zustand'
import { useTimeStore } from './timeStore'

interface UIState {
  isPlaying: boolean
  selectedTrackId: string | null
  play: () => void
  pause: () => void
  stop: () => void
  setSelectedTrackId: (id: string | null) => void
}

export const useUIStore = create<UIState>((set) => ({
  isPlaying: false,
  selectedTrackId: null,
  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  stop: () => {
    set({ isPlaying: false })
    useTimeStore.getState().setCurrentBeat(0)
  },
  setSelectedTrackId: (id) => set({ selectedTrackId: id }),
}))

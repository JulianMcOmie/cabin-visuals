import { create } from 'zustand'
import { useTimeStore } from './timeStore'
import { getPlaybackEngine } from '../core/playback'

interface UIState {
  isPlaying: boolean
  selectedTrackId: string | null
  play: () => void
  pause: () => void
  stop: () => void
  setSelectedTrackId: (id: string | null) => void
}

export const useUIStore = create<UIState>((set) => {
  const engine = getPlaybackEngine()
  engine.init({
    onBeatChange: (beat) => useTimeStore.getState().setCurrentBeat(beat),
    getBpm: () => useTimeStore.getState().bpm,
    getMaxBeat: () => {
      const { totalBars, beatsPerBar } = useTimeStore.getState()
      return totalBars * beatsPerBar
    },
    onEnd: () => set({ isPlaying: false }),
  })

  return {
    isPlaying: false,
    selectedTrackId: null,
    play: () => {
      const { currentBeat } = useTimeStore.getState()
      set({ isPlaying: true })
      engine.play(currentBeat)
    },
    pause: () => {
      engine.pause()
      set({ isPlaying: false })
    },
    stop: () => {
      engine.stop()
      set({ isPlaying: false })
    },
    setSelectedTrackId: (id) => set({ selectedTrackId: id }),
  }
})

import { create } from 'zustand'
import { useProjectStore } from './ProjectStore'
import { audioPickupBars } from '../utils/audioPickup'
import type { LoopRegion } from '../core/loopRegion'

interface TimeState {
  currentBeat: number
  isPlaying: boolean
  // Transport loop region is project-scoped and persisted; currentBeat and
  // isPlaying remain ephemeral session state.
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
    // The lower bound is the pickup: audio dragged before bar 0 extends the
    // playable timeline left, so the playhead may go that far negative.
    const { totalBars, beatsPerBar, tracks } = useProjectStore.getState()
    const minBeat = -audioPickupBars(tracks) * beatsPerBar
    set({ currentBeat: Math.max(minBeat, Math.min(beat, totalBars * beatsPerBar)) })
  },
  setLoopRegion: (region) => set({ loopRegion: region }),
}))

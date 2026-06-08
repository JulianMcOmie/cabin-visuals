import { create } from 'zustand'

interface UIState {
  isPlaying: boolean;
  selectedTrackId: string | null;
  setIsPlaying: (playing: boolean) => void;
  setSelectedTrackId: (id: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isPlaying: false,
  selectedTrackId: null,

  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setSelectedTrackId: (id) => set({ selectedTrackId: id }),
}));

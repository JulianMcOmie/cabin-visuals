import { create } from 'zustand'

interface UIState {
  selectedTrackId: string | null;
  setSelectedTrackId: (id: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedTrackId: null,

  setSelectedTrackId: (id) => set({ selectedTrackId: id }),
}));

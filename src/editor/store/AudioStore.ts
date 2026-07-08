import { create } from 'zustand'

/**
 * Lightweight, serializable descriptor for a loaded audio clip. The actual bytes
 * live behind core/audio (the project-audio bucket + a session cache), referenced
 * by `ref` - so this store stays JSON-friendly.
 */
export interface AudioClip {
  ref: string
  fileName: string
  duration: number // seconds
}

/**
 * The audioClips catalog: every clip the project owns, keyed by ref. An internal
 * registry (persisted into the document; the AudioBar writes it), NOT a
 * user-facing library - placement lives on audio tracks in ProjectStore.
 * Deliberately not undoable: loading a file isn't an edit.
 */
interface AudioState {
  audioClips: Record<string, AudioClip>
  addClip: (clip: AudioClip) => void
  removeClip: (ref: string) => void
}

export const useAudioStore = create<AudioState>((set) => ({
  audioClips: {},
  addClip: (clip) => set((s) => ({ audioClips: { ...s.audioClips, [clip.ref]: clip } })),
  removeClip: (ref) =>
    set((s) => {
      const { [ref]: _gone, ...rest } = s.audioClips
      return { audioClips: rest }
    }),
}))

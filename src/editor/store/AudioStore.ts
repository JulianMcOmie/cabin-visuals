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

/** One background upload's live state. Absent from the map = durable (or
 *  session-only). Ephemeral - persistence only ever reads audioClips. */
export interface AudioUpload {
  progress: number
  status: 'saving' | 'failed'
  error: string | null
}

/**
 * The audioClips catalog: every clip the project owns, keyed by ref. An internal
 * registry (persisted into the document; the load pipeline writes it), NOT a
 * user-facing library - placement lives on audio tracks in ProjectStore.
 * Deliberately not undoable: loading a file isn't an edit.
 */
interface AudioState {
  audioClips: Record<string, AudioClip>
  addClip: (clip: AudioClip) => void
  removeClip: (ref: string) => void
  /** Uploads still in flight (or failed), keyed by ref - the block's indicator. */
  uploads: Record<string, AudioUpload>
  patchUpload: (ref: string, patch: Partial<AudioUpload> | null) => void
}

export const useAudioStore = create<AudioState>((set) => ({
  audioClips: {},
  addClip: (clip) => set((s) => ({ audioClips: { ...s.audioClips, [clip.ref]: clip } })),
  removeClip: (ref) =>
    set((s) => {
      const { [ref]: _gone, ...rest } = s.audioClips
      return { audioClips: rest }
    }),
  uploads: {},
  patchUpload: (ref, patch) =>
    set((s) => {
      if (patch === null) {
        const { [ref]: _gone, ...rest } = s.uploads
        return { uploads: rest }
      }
      const prev = s.uploads[ref] ?? { progress: 0, status: 'saving' as const, error: null }
      return { uploads: { ...s.uploads, [ref]: { ...prev, ...patch } } }
    }),
}))

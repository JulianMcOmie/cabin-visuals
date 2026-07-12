import { create } from 'zustand'

/**
 * Lightweight, serializable descriptor for a loaded photo. The actual bytes
 * live behind core/photo (the project-photos bucket + a session cache),
 * referenced by `ref` - so this store stays JSON-friendly. The sibling of
 * VideoStore's VideoClip, minus duration (a still image has no timeline).
 */
export interface PhotoClip {
  ref: string
  fileName: string
  width: number
  height: number
}

/** One background upload's live state. Absent from the map = durable (or
 *  session-only). Ephemeral - persistence only ever reads photoClips. */
export interface PhotoUpload {
  progress: number
  status: 'saving' | 'failed'
  error: string | null
}

/**
 * The photoClips catalog: every photo the project owns, keyed by ref - the
 * same shape and role as VideoStore's videoClips. Placement (which track shows
 * which photos, in what order) lives on tracks in ProjectStore (photoPads).
 * Deliberately not undoable: loading a file isn't an edit.
 */
interface PhotoState {
  photoClips: Record<string, PhotoClip>
  addClip: (clip: PhotoClip) => void
  removeClip: (ref: string) => void
  /** Uploads still in flight (or failed), keyed by ref - written by
   *  core/photo/photoUploads, read wherever upload state is displayed. */
  uploads: Record<string, PhotoUpload>
  patchUpload: (ref: string, patch: Partial<PhotoUpload> | null) => void
}

export const usePhotoStore = create<PhotoState>((set) => ({
  photoClips: {},
  addClip: (clip) => set((s) => ({ photoClips: { ...s.photoClips, [clip.ref]: clip } })),
  removeClip: (ref) =>
    set((s) => {
      const { [ref]: _gone, ...rest } = s.photoClips
      return { photoClips: rest }
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

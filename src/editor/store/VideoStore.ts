import { create } from 'zustand'

/**
 * Lightweight, serializable descriptor for a loaded video clip. The actual
 * bytes live behind core/video (the project-videos bucket + a session cache),
 * referenced by `ref` - so this store stays JSON-friendly.
 */
export interface VideoClip {
  ref: string
  fileName: string
  duration: number // seconds
  width: number
  height: number
}

/** One background upload's live state. Absent from the map = durable (or
 *  session-only). Ephemeral - persistence only ever reads videoClips. */
export interface VideoUpload {
  progress: number
  status: 'saving' | 'failed'
  error: string | null
}

/**
 * The videoClips catalog: every clip the project owns, keyed by ref - the
 * same shape and role as AudioStore's audioClips. Placement (which track uses
 * which moments of which sources, in what order) lives on tracks in
 * ProjectStore (videoPads).
 * Deliberately not undoable: loading a file isn't an edit.
 */
interface VideoState {
  videoClips: Record<string, VideoClip>
  addClip: (clip: VideoClip) => void
  removeClip: (ref: string) => void
  /** Uploads still in flight (or failed), keyed by ref - written by
   *  core/video/videoUploads, read wherever upload state is displayed. */
  uploads: Record<string, VideoUpload>
  patchUpload: (ref: string, patch: Partial<VideoUpload> | null) => void
}

export const useVideoStore = create<VideoState>((set) => ({
  videoClips: {},
  addClip: (clip) => set((s) => ({ videoClips: { ...s.videoClips, [clip.ref]: clip } })),
  removeClip: (ref) =>
    set((s) => {
      const { [ref]: _gone, ...rest } = s.videoClips
      return { videoClips: rest }
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

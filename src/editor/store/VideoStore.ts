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
}

export const useVideoStore = create<VideoState>((set) => ({
  videoClips: {},
  addClip: (clip) => set((s) => ({ videoClips: { ...s.videoClips, [clip.ref]: clip } })),
  removeClip: (ref) =>
    set((s) => {
      const { [ref]: _gone, ...rest } = s.videoClips
      return { videoClips: rest }
    }),
}))

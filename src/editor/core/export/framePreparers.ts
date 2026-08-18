/**
 * Frame preparers: async work that must COMPLETE before a frame is rendered.
 * The Video instrument registers one that seeks its <video> element to the
 * exact beat-derived time and resolves on `seeked` - that is what makes
 * exported video frame-exact where live playback merely drift-corrects.
 * Zero registered preparers costs the loop nothing. Returns an unregister fn.
 *
 * Kept apart from exportEngine.ts on purpose: instruments import this at
 * module load, and pulling the whole engine (encoder, muxer, audio render)
 * in with it would put all of that in the editor's initial bundle.
 */
export type FramePreparer = (beat: number) => Promise<void> | void

export const framePreparers = new Set<FramePreparer>()

export function registerFramePreparer(fn: FramePreparer): () => void {
  framePreparers.add(fn)
  return () => framePreparers.delete(fn)
}

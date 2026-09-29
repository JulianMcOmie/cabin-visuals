import type { Scene } from '../../types'

// Instruments whose code exists only on the editor thread: code instruments and
// compositions (instruments/custom), registered at runtime by
// instruments/code/register.tsx. The preview worker can't evaluate a project
// that uses one - its compositions, lanes, camera and look live here - so
// VisualBeatSync previews such a project on the main thread, exactly as when the
// worker is unavailable. Export and the cabin render daemon always evaluate on
// the main thread, so they're unaffected.

let ids: ReadonlySet<string> = new Set()
let memo: { scenes: Record<string, Scene>; ids: ReadonlySet<string>; result: boolean } | null = null

export function setMainThreadInstruments(next: Iterable<string>) {
  ids = new Set(next)
  memo = null
}

/** Does any track in these scenes use a main-thread-only instrument? Memoized
 *  by the scenes object (a store edit replaces it). */
export function usesMainThreadInstruments(scenes: Record<string, Scene>): boolean {
  if (memo && memo.scenes === scenes && memo.ids === ids) return memo.result
  let result = false
  if (ids.size) {
    search: for (const scene of Object.values(scenes)) {
      for (const track of Object.values(scene.tracks)) {
        if (track.instrumentId && ids.has(track.instrumentId)) { result = true; break search }
      }
    }
  }
  memo = { scenes, ids, result }
  return result
}

import { INSTRUMENTS } from '../instruments'
import { getCompositionLayers } from '../core/visual/VisualEngine'
import { useTimeStore } from '../store/TimeStore'
import { useUIStore } from '../store/UIStore'

// DEV-ONLY, `?file=` sessions only: reload the page when the visual engine or
// the instrument registry is hot-reloaded.
//
// Both are module singletons. A hot update re-executes every module that
// imports the edited one, so editing an instrument (or anything in
// instruments/code) re-creates the registry AND the VisualEngine - and the new
// engine comes up with no project and no mounted scenes: a black canvas until a
// manual refresh. In a `cabin` session instruments are edited constantly, so
// trade hot state for a correct frame: this module imports both singletons,
// which makes HMR re-execute it alongside them; its second evaluation stashes
// the playhead and view and reloads. useFileSync restores them after the file
// loads. Plain editor sessions (no ?file=) keep ordinary hot reloading.

export const RESUME_KEY = 'cabin:file-sync-resume'

declare global {
  interface Window { __cabinEngineEvals?: number }
}

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  // Referenced so the imports can't be dropped as unused: they're the point.
  void INSTRUMENTS
  void getCompositionLayers
  window.__cabinEngineEvals = (window.__cabinEngineEvals ?? 0) + 1
  if (window.__cabinEngineEvals > 1 && new URLSearchParams(window.location.search).has('file')) {
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({
        beat: useTimeStore.getState().currentBeat,
        view: useUIStore.getState().canvasView,
      }))
    } catch { /* storage blocked - reload anyway */ }
    window.location.reload()
  }
}

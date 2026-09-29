import { INSTRUMENTS } from '../index'
import { registerCompositions } from '../../core/directors'
import { findTrackId, getResolvedNotes, setProject } from '../../core/visual/VisualEngine'
import { claimCamera } from '../../core/visual/cameraOwner'
import { setCompositionLook, setTrackLook } from '../../core/visual/look'
import { setMainThreadInstruments } from '../../core/visual/mainThreadInstruments'
import { provideWorld } from './world'
import { useProjectStore } from '../../store/ProjectStore'
import { CODE_INSTRUMENTS } from '../custom/instruments.generated'
import { CODE_COMPOSITIONS } from '../custom/compositions.generated'
import { isCodeInstrument } from './define'
import { bumpRegistry } from './live'

// Registers every code instrument and composition (instruments/custom/**) into
// the app's registries. This is the ONLY module that imports the generated
// lists, and nothing in the engine imports it - App mounts <CodeRegistry/> -
// which keeps code files out of the engine's import graph: under HMR an edit
// re-runs only its own module, the generated list and this file (a Fast
// Refresh boundary: it exports nothing but a component), never VisualEngine or
// ProjectStore. The running views pick up the new spec through live.ts; this
// re-registration carries changed metadata (params, rows, names) and triggers
// one re-resolve so the engine sees it.
//
// Node (the cabin CLI, tests) imports this file for its side effect to get the
// full registry.

const holder = globalThis as unknown as { __cabinCodeRegistered?: boolean }
const rerun = !!holder.__cabinCodeRegistered

const registered: string[] = []
for (const def of CODE_INSTRUMENTS) {
  const existing = INSTRUMENTS[def.id]
  if (existing && !isCodeInstrument(existing)) {
    console.error(`[code instruments] id "${def.id}" collides with a built-in instrument - skipped`)
    continue
  }
  INSTRUMENTS[def.id] = def
  registered.push(def.id)
}
registerCompositions(CODE_COMPOSITIONS)
// These exist only on this thread: a project using one previews here, not in
// the preview worker (core/visual/mainThreadInstruments.ts).
setMainThreadInstruments([...registered, ...CODE_COMPOSITIONS.map((c) => c.id)])
// What the SDK reaches outside a track through (world.ts): the engine's notes
// for ctx.lane(), the shared camera claim, the frame's look.
provideWorld({
  laneNotes: (name) => {
    const id = findTrackId(name)
    return id ? getResolvedNotes(id) : undefined
  },
  claimCamera,
  setTrackLook,
  setCompositionLook,
})
holder.__cabinCodeRegistered = true
bumpRegistry()

// A hot re-run: metadata may have changed under resolved tracks.
if (rerun && typeof document !== 'undefined') setProject(useProjectStore.getState())

/** Mounted once by the editor so this module loads (and stays a refresh boundary). */
export function CodeRegistry() {
  return null
}

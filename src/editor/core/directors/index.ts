import { sceneDirector } from './scene'
import { sceneSwitcherDirector } from './sceneSwitcher'
import { cutDirector } from './cut'
import { radialCutDirector } from './radialCut'
import { cropDirector } from './crop'
import type { Track } from '../../types'
import type { CompositionInstrumentDef } from './types'

// The composition-instrument registry (formerly "directors"). These defs are
// ordinary instruments by registration and UI treatment; what sets them apart
// is the capability they declare - resolve() produces CompositionLayer[]s
// consumed by the final compositor instead of an R3F component consumed by a
// scene. This module stays React-free ON PURPOSE: ProjectStore imports it for
// capability checks and must never pull in instruments/index (components →
// stores cycle).

// Order is the library's order on Main (LeftSidebar derives its card list from
// listCompositionInstruments), so the plainest composer comes first.
const DEFINITIONS: CompositionInstrumentDef[] = [sceneDirector, sceneSwitcherDirector, cutDirector, radialCutDirector, cropDirector]
const BY_ID = new Map(DEFINITIONS.map((def) => [def.id, def]))

export function getCompositionInstrument(id: string | undefined): CompositionInstrumentDef | undefined {
  return id ? BY_ID.get(id) : undefined
}

export function listCompositionInstruments(): CompositionInstrumentDef[] {
  return DEFINITIONS
}

/** The composition def a track instantiates through its instrumentId - the one
 *  discriminator every former `type === 'director'` site now reads. */
export function compositionDef(instrumentId: string | undefined): CompositionInstrumentDef | undefined {
  return instrumentId ? BY_ID.get(instrumentId) : undefined
}

/** Is this track a composition instrument? (Pre-v12 'director' tracks are
 *  rewritten to this shape by the upgrade chain before any of this runs.) */
export function isCompositionTrack(track: Pick<Track, 'type' | 'instrumentId'>): boolean {
  return track.type === 'base' && !!compositionDef(track.instrumentId)
}

export type { CompositionLayer, CompositionInstrumentDef } from './types'
export { compositionAutomatableParams } from './types'

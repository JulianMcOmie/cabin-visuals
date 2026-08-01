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

const DEFINITIONS: CompositionInstrumentDef[] = [sceneSwitcherDirector, cutDirector, radialCutDirector, cropDirector]
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

/** Is this track a composition instrument? Accepts BOTH shapes during the
 *  migration: the current `type: 'base'` + composition instrumentId, and the
 *  legacy `type: 'director'` + directorId still present in unhydrated fixtures
 *  and pre-upgrade documents. The legacy arm dies with the TrackType member. */
export function isCompositionTrack(
  track: Pick<Track, 'type' | 'instrumentId'> & { directorId?: string },
): boolean {
  if (track.type === 'base') return !!compositionDef(track.instrumentId)
  return (track.type as string) === 'director'
}

export type { CompositionLayer, CompositionInstrumentDef } from './types'
export { compositionAutomatableParams } from './types'

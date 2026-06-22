// Registry: collects every instrument's definition into one map. Adding an
// instrument = one new file + one import/entry here. Nothing else hardcodes the list.

import { cubeInstrument } from './Cube'
import { paramDefault, type InstrumentDef } from './types'

export type { InstrumentDef, ParamDef } from './types'

export const INSTRUMENTS: Record<string, InstrumentDef> = {
  [cubeInstrument.id]: cubeInstrument,
}

export function getInstrument(id: string): InstrumentDef | undefined {
  return INSTRUMENTS[id]
}

/** A track's current value for a param, falling back to the instrument's default. */
export function paramValue(
  track: { instrumentId: string; params?: Record<string, number> },
  key: string,
): number {
  const def = INSTRUMENTS[track.instrumentId]
  if (!def) return 0
  return track.params?.[key] ?? paramDefault(def, key)
}

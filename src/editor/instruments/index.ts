// Registry: collects every object instrument's definition into one map. Adding an
// instrument = one new file + one import/entry here. Nothing else hardcodes the
// list, and renderers resolve the visual component via the def (def.component).

import { cubeInstrument } from './Cube'
import { circleInstrument, triangleInstrument } from './shapes'
import { icosahedronBurstInstrument } from './IcosahedronBurst'
import { hexagonDotsInstrument } from './HexagonDots'
import { paramDefault, type ObjectInstrumentDef } from './types'

export type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

export const INSTRUMENTS: Record<string, ObjectInstrumentDef> = {
  [cubeInstrument.id]: cubeInstrument,
  [circleInstrument.id]: circleInstrument,
  [triangleInstrument.id]: triangleInstrument,
  [icosahedronBurstInstrument.id]: icosahedronBurstInstrument,
  [hexagonDotsInstrument.id]: hexagonDotsInstrument,
}

export function getInstrument(id: string): ObjectInstrumentDef | undefined {
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

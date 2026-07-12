import { sceneSwitcherDirector } from './sceneSwitcher'
import { cutDirector } from './cut'
import { radialCutDirector } from './radialCut'
import type { DirectorInstrumentDef } from './types'

const DEFINITIONS: DirectorInstrumentDef[] = [sceneSwitcherDirector, cutDirector, radialCutDirector]
const BY_ID = new Map(DEFINITIONS.map((def) => [def.id, def]))

export function getDirector(id: string | undefined): DirectorInstrumentDef | undefined {
  return id ? BY_ID.get(id) : undefined
}

export function listDirectors(): DirectorInstrumentDef[] {
  return DEFINITIONS
}

export type { CompositionLayer, DirectorInstrumentDef } from './types'

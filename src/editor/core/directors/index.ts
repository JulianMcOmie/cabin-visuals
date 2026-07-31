import { sceneSwitcherDirector } from './sceneSwitcher'
import { cutDirector } from './cut'
import { radialCutDirector } from './radialCut'
import { cropDirector } from './crop'
import type { DirectorInstrumentDef } from './types'

const DEFINITIONS: DirectorInstrumentDef[] = [sceneSwitcherDirector, cutDirector, radialCutDirector, cropDirector]
const BY_ID = new Map(DEFINITIONS.map((def) => [def.id, def]))

export function getDirector(id: string | undefined): DirectorInstrumentDef | undefined {
  return id ? BY_ID.get(id) : undefined
}

export function listDirectors(): DirectorInstrumentDef[] {
  return DEFINITIONS
}

export type { CompositionLayer, DirectorInstrumentDef } from './types'
export { directorAutomatableParams } from './types'

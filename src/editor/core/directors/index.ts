import { sceneSwitcherDirector } from './sceneSwitcher'
import type { DirectorInstrumentDef } from './types'

const DEFINITIONS: DirectorInstrumentDef[] = [sceneSwitcherDirector]
const BY_ID = new Map(DEFINITIONS.map((def) => [def.id, def]))

export function getDirector(id: string | undefined): DirectorInstrumentDef | undefined {
  return id ? BY_ID.get(id) : undefined
}

export function listDirectors(): DirectorInstrumentDef[] {
  return DEFINITIONS
}

export type { CompositionLayer, DirectorInstrumentDef } from './types'

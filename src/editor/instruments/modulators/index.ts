// Registry of modulator instruments (the "Modulator" library items). A track whose
// instrumentId is in here is a modulator track: its notes are triggers, routed to
// an object's port. Distinct from the object registry (../index).

import { pulseModulator } from './Pulse'
import type { ModulatorInstrumentDef } from '../types'

export const MODULATORS: Record<string, ModulatorInstrumentDef> = {
  [pulseModulator.id]: pulseModulator,
}

export function getModulator(id: string): ModulatorInstrumentDef | undefined {
  return MODULATORS[id]
}

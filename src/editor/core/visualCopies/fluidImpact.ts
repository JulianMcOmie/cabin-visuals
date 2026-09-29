// A note launches a pressure impulse through the copies' chain-frame positions.
// The field's radial push, curling wake and damped return are all sampled from
// the current beat, so seeking a hit is identical to playing through it. Note
// lengths do not sustain the impulse; velocity controls its strength.

import type { MidiRowDef } from '../../instruments/types'
import { sharedGpuOperation } from './sharedGpuOperation'
import type { MoverOrSplitterDefinition } from './definitions'
import { createFluidImpactSampler, type FluidImpactSettings } from './fluidImpactField'
import { FLUID_IMPACT_COLOR } from './identityColors'

export type { FluidImpactSettings } from './fluidImpactField'

export const FLUID_IMPACT_PITCH = 60

const FLUID_IMPACT_ROWS: MidiRowDef[] = [
  { pitch: FLUID_IMPACT_PITCH, label: 'Impact' },
]

export const fluidImpactMover: MoverOrSplitterDefinition<FluidImpactSettings> = {
  id: 'fluidImpact',
  label: 'Fluid Impact',
  kind: 'mover',
  identityColor: FLUID_IMPACT_COLOR,
  params: [
    { key: 'strength', label: 'Impact', min: 0, max: 10, step: 0.05, default: 2.2, curve: 2 },
    { key: 'radius', label: 'Reach', min: 0.25, max: 20, step: 0.05, default: 6 },
    { key: 'decay', label: 'Settle (beats)', min: 0.1, max: 8, step: 0.05, default: 1.5, curve: 2 },
    { key: 'curl', label: 'Curl', min: -2, max: 2, step: 0.05, default: 0.8 },
    { key: 'turbulence', label: 'Scatter', min: 0, max: 2, step: 0.05, default: 0.65 },
    { key: 'rebound', label: 'Rebound', min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: 'eddySize', label: 'Eddy size', min: 0.1, max: 10, step: 0.05, default: 1.5, curve: 2 },
    { key: 'flow', label: 'Flow', min: -2, max: 2, step: 0.05, default: 0.8 },
    {
      key: 'axis', label: 'Swirl axis', type: 'select',
      options: [{ value: 0, label: 'X' }, { value: 1, label: 'Y' }, { value: 2, label: 'Z' }],
      default: 2,
    },
    { key: 'centerX', label: 'Center X', min: -10, max: 10, step: 0.05, default: 0 },
    { key: 'centerY', label: 'Center Y', min: -10, max: 10, step: 0.05, default: 0 },
    { key: 'centerZ', label: 'Center Z', min: -10, max: 10, step: 0.05, default: 0 },
  ],
  midiRows: () => FLUID_IMPACT_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    // The object's placement carries both formation and field; individual
    // copy rotations never re-aim this chain-root displacement.
    return sharedGpuOperation(createFluidImpactSampler(notes, settings), {
      localSlotMotion: true, preservesDeterminant: true, composition: 'chainRoot',
    })
  },
}

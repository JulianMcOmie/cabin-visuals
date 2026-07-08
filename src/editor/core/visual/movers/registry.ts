import { MOVERS } from './library'
import type { MoverDef, MoverInputDef } from './types'
import type { NumberParamDef, ParamDef } from '../../../instruments/types'
import type { SubsetWeightSpec } from '../../../types'

export { MOVERS as moverRegistry }
export type { MoverDef, MoverInputDef }

export function getMover(id: string | undefined): MoverDef | undefined {
  return id ? MOVERS[id] : undefined
}

export function moverInputParamDefs(def: MoverDef): ParamDef[] {
  return Object.entries(def.inputs)
    .filter(([, input]) => !input.hidden)
    .map(([key, input]) => {
      if (input.type === 'select') {
        return {
          key,
          label: input.label ?? key,
          type: 'select',
          options: input.options ?? [],
          default: input.default,
        }
      }
      return {
        key,
        label: input.label ?? key,
        min: input.min,
        max: input.max,
        step: input.semantic === 'angle' ? 0.01 : 0.05,
        default: input.default,
      }
    })
}

export function isMoverMidiInput(def: MoverDef, inputName: string | undefined): inputName is string {
  if (!inputName) return false
  const input = def.inputs[inputName]
  return !!input && !input.hidden && input.type !== 'select'
}

export function firstMoverMidiInput(def: MoverDef): string | undefined {
  return Object.entries(def.inputs).find(([, input]) => !input.hidden && input.type !== 'select')?.[0]
}

export const MOVER_DEPTH_PARAM: NumberParamDef = {
  key: 'depth',
  label: 'Depth',
  min: -1,
  max: 1,
  step: 0.01,
  default: 1,
}

export const DEFAULT_SUBSET_WEIGHT: SubsetWeightSpec = { mode: 'all' }

export function subsetWeight(spec: SubsetWeightSpec | undefined, i: number, N: number): number {
  const s = spec ?? DEFAULT_SUBSET_WEIGHT
  switch (s.mode) {
    case 'all':
      return 1
    case 'odd':
      return i % 2 === 1 ? 1 : 0
    case 'even':
      return i % 2 === 0 ? 1 : 0
    case 'firstHalf':
      return i < N / 2 ? 1 : 0
    case 'secondHalf':
      return i >= N / 2 ? 1 : 0
    case 'checkerWhite': {
      const cols = Math.ceil(Math.sqrt(N))
      const row = Math.floor(i / cols)
      const col = i % cols
      return (row + col) % 2 === 0 ? 1 : 0
    }
    case 'checkerBlack': {
      const cols = Math.ceil(Math.sqrt(N))
      const row = Math.floor(i / cols)
      const col = i % cols
      return (row + col) % 2 === 1 ? 1 : 0
    }
    case 'gradient': {
      const frac = N <= 1 ? 0 : i / (N - 1)
      return Math.max(0, Math.min(1, s.phase + s.slope * frac))
    }
  }
}

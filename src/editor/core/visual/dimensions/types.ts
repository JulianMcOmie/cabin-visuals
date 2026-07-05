import type { StateVector } from '../types'

export interface DimensionInputDef {
  default: number
  min: number
  max: number
  label?: string
  type?: 'select'
  options?: { value: number; label: string }[]
  semantic?: 'phase' | 'rate' | 'amount' | 'angle' | 'sign' | 'time' | 'index'
  hidden?: boolean
}

export interface DimensionCtx {
  beat: number
  i: number
  N: number
  channels: Record<string, number>
}

export interface DimensionDef {
  id: string
  label: string
  inputs: Record<string, DimensionInputDef>
  /** Inputs scaled by signed MIDI amount mode. Defaults should be neutral values. */
  amountInputs?: string[]
  apply: (
    inState: StateVector,
    inputs: Record<string, number>,
    ctx: DimensionCtx,
    out: StateVector,
  ) => void
}

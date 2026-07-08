import type { StateVector } from '../types'

export interface MoverInputDef {
  default: number
  min: number
  max: number
  label?: string
  type?: 'select'
  options?: { value: number; label: string }[]
  semantic?: 'phase' | 'rate' | 'amount' | 'angle' | 'sign' | 'time' | 'index'
  hidden?: boolean
}

export interface MoverCtx {
  beat: number
  i: number
  N: number
  channels: Record<string, number>
}

export interface MoverDef {
  id: string
  label: string
  inputs: Record<string, MoverInputDef>
  /** Inputs scaled by signed MIDI amount mode. Defaults should be neutral values. */
  amountInputs?: string[]
  apply: (
    inState: StateVector,
    inputs: Record<string, number>,
    ctx: MoverCtx,
    out: StateVector,
  ) => void
}

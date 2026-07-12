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

/** @deprecated Context for the legacy StateVector mover runtime. */
export interface MoverCtx {
  beat: number
  i: number
  N: number
  channels: Record<string, number>
}

/**
 * @deprecated Legacy StateVector mover definition. New movers operate on
 * VisualCopy through the ordered mover-and-splitter chain. Keep this runtime for
 * existing projects until explicit migrations exist; do not add definitions here.
 */
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

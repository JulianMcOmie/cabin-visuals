import type { ModulatorInstance } from './types'
import { evaluatePulse } from '../../instruments/modulators/Pulse'

/** Evaluate a modulator's output at a beat. Dispatches by kind; more kinds
 *  (LFO, envelope, audio-reactive…) slot in here. */
export function evaluateModulator(mod: ModulatorInstance, beat: number): number {
  switch (mod.kind) {
    case 'pulse':
      return evaluatePulse(mod.triggers, beat)
    default:
      return 0
  }
}

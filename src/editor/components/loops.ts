// The library's Loops tab: rhythm patterns a user drags onto a track lane to
// land as a looping MIDI block. Patterns are pitch-agnostic - beats within
// one bar - and get their pitch from the target track's vocabulary at drop
// time (the emphasized midi row, else the first row, else C4).

export interface LoopPattern {
  id: string
  name: string
  /** One sentence for the row tooltip. */
  description: string
  /** Pattern length in bars (the block loops this window). */
  bars: number
  /** [startBeat, durationBeats] pairs within the pattern window. */
  notes: [number, number][]
}

const every = (step: number, dur: number): [number, number][] => {
  const out: [number, number][] = []
  for (let b = 0; b < 4; b += step) out.push([b, dur])
  return out
}

export const LOOP_PATTERNS: LoopPattern[] = [
  { id: 'everyBeat', name: 'Every beat', description: 'One note on every beat.', bars: 1, notes: every(1, 0.5) },
  { id: 'eighths', name: 'Eighths', description: 'Every beat plus one in between.', bars: 1, notes: every(0.5, 0.25) },
  { id: 'offbeats', name: 'Offbeats', description: 'Only the in-betweens.', bars: 1, notes: [[0.5, 0.25], [1.5, 0.25], [2.5, 0.25], [3.5, 0.25]] },
  { id: 'halves', name: 'Half notes', description: 'Beats 1 and 3.', bars: 1, notes: [[0, 0.5], [2, 0.5]] },
  { id: 'whole', name: 'Whole note', description: 'One note per bar.', bars: 1, notes: [[0, 1]] },
  { id: 'sixteenths', name: 'Sixteenths', description: 'A note on every sixteenth.', bars: 1, notes: every(0.25, 0.125) },
  { id: 'tresillo', name: 'Tresillo', description: 'The 3-3-2 rhythm.', bars: 1, notes: [[0, 0.5], [1.5, 0.5], [3, 0.5]] },
  { id: 'gallop', name: 'Gallop', description: 'Beat + a pickup right before the next.', bars: 1, notes: [[0, 0.5], [0.75, 0.2], [1, 0.5], [1.75, 0.2], [2, 0.5], [2.75, 0.2], [3, 0.5], [3.75, 0.2]] },
]

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
  /** [startBeat, durationBeats, velocity?, row?] within the pattern window.
   *  Velocity carries the groove's accents (default 100). `row` is RELATIVE -
   *  0 = the target instrument's top midi row, 1 the next down, and so on;
   *  rows past the instrument's vocabulary land as ghost rows below it. */
  notes: [number, number, number?, number?][]
}

const every = (step: number, dur: number): [number, number, number?, number?][] => {
  const out: [number, number, number?, number?][] = []
  for (let b = 0; b < 4; b += step) out.push([b, dur])
  return out
}

export const LOOP_PATTERNS: LoopPattern[] = [
  // ── Grids ──
  { id: 'everyBeat', name: 'Every beat', description: 'One note on every beat.', bars: 1, notes: every(1, 0.5) },
  { id: 'eighths', name: 'Eighths', description: 'Every beat plus one in between.', bars: 1, notes: every(0.5, 0.25) },
  { id: 'sixteenths', name: 'Sixteenths', description: 'A note on every sixteenth.', bars: 1, notes: every(0.25, 0.125) },
  { id: 'offbeats', name: 'Offbeats', description: 'Only the in-betweens.', bars: 1, notes: [[0.5, 0.25], [1.5, 0.25], [2.5, 0.25], [3.5, 0.25]] },
  { id: 'halves', name: 'Half notes', description: 'Beats 1 and 3.', bars: 1, notes: [[0, 0.5], [2, 0.5]] },
  { id: 'whole', name: 'Whole note', description: 'One note per bar.', bars: 1, notes: [[0, 1]] },
  // ── Beats (accents ride on velocity) ──
  { id: 'backbeat', name: 'Backbeat', description: 'The snare\'s home: beats 2 and 4.', bars: 1, notes: [[1, 0.5, 115], [3, 0.5, 115]] },
  { id: 'rockBeat', name: 'Rock beat', description: 'Kick on 1 and 3 (top row), snare on 2 and 4 (next row down).', bars: 1, notes: [[0, 0.4, 118, 0], [2, 0.4, 112, 0], [1, 0.4, 110, 1], [3, 0.4, 110, 1]] },
  { id: 'house', name: 'House', description: 'Four-on-the-floor (top row) with offbeat ghosts a row down.', bars: 1, notes: [[0, 0.4, 115, 0], [1, 0.4, 105, 0], [2, 0.4, 115, 0], [3, 0.4, 105, 0], [0.5, 0.15, 55, 1], [1.5, 0.15, 55, 1], [2.5, 0.15, 55, 1], [3.5, 0.15, 60, 1]] },
  { id: 'boomBap', name: 'Boom bap', description: 'Kicks on the top row, snares a row down, over two bars.', bars: 2, notes: [[0, 0.5, 120, 0], [2.5, 0.4, 115, 0], [4, 0.5, 120, 0], [4.75, 0.2, 70, 0], [6.5, 0.4, 115, 0], [1, 0.4, 110, 1], [3, 0.4, 105, 1], [5, 0.4, 110, 1], [7, 0.4, 105, 1], [7.5, 0.2, 70, 1]] },
  { id: 'dembow', name: 'Dembow', description: 'The reggaeton engine - kicks up top, snares a row down.', bars: 1, notes: [[0, 0.4, 120, 0], [2, 0.4, 118, 0], [0.75, 0.25, 95, 1], [1.5, 0.25, 100, 1], [2.75, 0.25, 95, 1], [3.5, 0.25, 100, 1]] },
  { id: 'tresillo', name: 'Tresillo', description: 'The 3-3-2 rhythm.', bars: 1, notes: [[0, 0.5, 112], [1.5, 0.5, 104], [3, 0.5, 100]] },
  { id: 'sonClave', name: 'Son clave', description: '3-2 clave over two bars.', bars: 2, notes: [[0, 0.4, 112], [1.5, 0.4, 104], [3, 0.4, 108], [5, 0.4, 104], [6, 0.4, 104]] },
  { id: 'charleston', name: 'Charleston', description: 'The push: 1 and the and-of-2.', bars: 1, notes: [[0, 0.75, 112], [1.5, 0.5, 104]] },
  { id: 'shuffle', name: 'Shuffle', description: 'Swung eighths - triplet feel.', bars: 1, notes: [[0, 0.3, 110], [0.67, 0.2, 80], [1, 0.3, 100], [1.67, 0.2, 80], [2, 0.3, 110], [2.67, 0.2, 80], [3, 0.3, 100], [3.67, 0.2, 80]] },
  { id: 'trapHats', name: 'Trap hats', description: 'Eighth hats with a sixteenth roll into the bar.', bars: 1, notes: [[0, 0.2, 100], [0.5, 0.15, 80], [1, 0.2, 100], [1.5, 0.15, 80], [2, 0.2, 100], [2.5, 0.15, 80], [3, 0.15, 95], [3.25, 0.12, 85], [3.5, 0.12, 90], [3.75, 0.12, 100]] },
  { id: 'gallop', name: 'Gallop', description: 'Beat + a pickup right before the next.', bars: 1, notes: [[0, 0.5], [0.75, 0.2, 75], [1, 0.5], [1.75, 0.2, 75], [2, 0.5], [2.75, 0.2, 75], [3, 0.5], [3.75, 0.2, 75]] },
]

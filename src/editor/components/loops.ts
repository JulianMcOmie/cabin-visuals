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

// Row convention across the beats: 0 = kick, 1 = snare/clap, 2 = hats,
// 3 = extras (open hat / ghost voice) - mapping top-down onto whatever rows
// the target instrument declares.
export const LOOP_PATTERNS: LoopPattern[] = [
  // ── Grids (utility pulses, single row) ──
  { id: 'everyBeat', name: 'Every beat', description: 'One note on every beat.', bars: 1, notes: every(1, 0.5) },
  { id: 'eighths', name: 'Eighths', description: 'Every beat plus one in between.', bars: 1, notes: every(0.5, 0.25) },
  { id: 'offbeats', name: 'Offbeats', description: 'Only the in-betweens.', bars: 1, notes: [[0.5, 0.25], [1.5, 0.25], [2.5, 0.25], [3.5, 0.25]] },
  // ── Beats ──
  {
    id: 'rockBeat', name: 'Rock beat', description: 'Kick 1 & 3, snare 2 & 4, driving eighth hats.', bars: 1,
    notes: [
      [0, 0.4, 118, 0], [2, 0.4, 112, 0], [2.5, 0.3, 80, 0],
      [1, 0.4, 112, 1], [3, 0.4, 112, 1],
      [0, 0.2, 90, 2], [0.5, 0.15, 65, 2], [1, 0.2, 85, 2], [1.5, 0.15, 65, 2], [2, 0.2, 90, 2], [2.5, 0.15, 65, 2], [3, 0.2, 85, 2], [3.5, 0.15, 70, 2],
    ],
  },
  {
    id: 'house', name: 'House', description: 'Four-on-the-floor, claps on 2 & 4, open hats between.', bars: 1,
    notes: [
      [0, 0.4, 118, 0], [1, 0.4, 108, 0], [2, 0.4, 115, 0], [3, 0.4, 108, 0],
      [1, 0.3, 105, 1], [3, 0.3, 108, 1],
      [0.5, 0.25, 95, 2], [1.5, 0.25, 90, 2], [2.5, 0.25, 95, 2], [3.5, 0.25, 90, 2],
      [3.75, 0.12, 55, 3],
    ],
  },
  {
    id: 'boomBap', name: 'Boom bap', description: 'Two bars of kick-snare swagger under steady hats.', bars: 2,
    notes: [
      [0, 0.5, 122, 0], [2.5, 0.4, 112, 0], [4, 0.5, 122, 0], [4.75, 0.2, 78, 0], [6.5, 0.4, 112, 0],
      [1, 0.4, 114, 1], [3, 0.4, 108, 1], [5, 0.4, 114, 1], [7, 0.4, 108, 1], [7.75, 0.15, 55, 1],
      [0, 0.2, 88, 2], [0.5, 0.15, 62, 2], [1, 0.2, 82, 2], [1.5, 0.15, 62, 2], [2, 0.2, 88, 2], [2.5, 0.15, 62, 2], [3, 0.2, 82, 2], [3.5, 0.15, 62, 2],
      [4, 0.2, 88, 2], [4.5, 0.15, 62, 2], [5, 0.2, 82, 2], [5.5, 0.15, 62, 2], [6, 0.2, 88, 2], [6.5, 0.15, 62, 2], [7, 0.2, 82, 2], [7.5, 0.15, 68, 2],
    ],
  },
  {
    id: 'trap', name: 'Trap', description: 'Sparse kicks, snare on 3, rolling hats with a flourish.', bars: 2,
    notes: [
      [0, 0.4, 122, 0], [1.75, 0.3, 105, 0], [4, 0.4, 120, 0], [5.5, 0.3, 108, 0], [6.25, 0.25, 95, 0],
      [2, 0.4, 115, 1], [6, 0.4, 115, 1],
      [0, 0.15, 95, 2], [0.5, 0.15, 78, 2], [1, 0.15, 90, 2], [1.5, 0.15, 78, 2], [2, 0.15, 95, 2], [2.5, 0.15, 78, 2],
      [3, 0.12, 85, 2], [3.25, 0.1, 75, 2], [3.5, 0.1, 85, 2], [3.75, 0.1, 95, 2],
      [4, 0.15, 95, 2], [4.5, 0.15, 78, 2], [5, 0.15, 90, 2], [5.5, 0.15, 78, 2], [6, 0.15, 95, 2], [6.5, 0.15, 78, 2],
      [7, 0.1, 80, 2], [7.125, 0.08, 70, 2], [7.25, 0.08, 80, 2], [7.375, 0.08, 88, 2], [7.5, 0.1, 95, 2], [7.75, 0.1, 105, 2],
      [7.5, 0.4, 70, 3],
    ],
  },
  {
    id: 'dembow', name: 'Dembow', description: 'The reggaeton engine: kicks, dembow snares, shaker eighths.', bars: 1,
    notes: [
      [0, 0.4, 120, 0], [2, 0.4, 118, 0],
      [0.75, 0.25, 100, 1], [1.5, 0.25, 105, 1], [2.75, 0.25, 100, 1], [3.5, 0.25, 105, 1],
      [0, 0.15, 80, 2], [0.5, 0.15, 65, 2], [1, 0.15, 78, 2], [1.5, 0.15, 65, 2], [2, 0.15, 80, 2], [2.5, 0.15, 65, 2], [3, 0.15, 78, 2], [3.5, 0.15, 70, 2],
    ],
  },
  {
    id: 'breakbeat', name: 'Breakbeat', description: 'Two bars of chopped-up kicks and displaced snares.', bars: 2,
    notes: [
      [0, 0.4, 120, 0], [1.5, 0.3, 100, 0], [2.75, 0.3, 108, 0], [4, 0.4, 120, 0], [5.75, 0.3, 105, 0],
      [1, 0.4, 114, 1], [3, 0.35, 110, 1], [3.75, 0.15, 60, 1], [5, 0.4, 114, 1], [6.5, 0.3, 100, 1], [7.25, 0.2, 90, 1],
      [0, 0.2, 85, 2], [0.5, 0.15, 65, 2], [1, 0.2, 80, 2], [1.5, 0.15, 65, 2], [2, 0.2, 85, 2], [2.5, 0.15, 65, 2], [3, 0.2, 80, 2], [3.5, 0.15, 65, 2],
      [4, 0.2, 85, 2], [4.5, 0.15, 65, 2], [5, 0.2, 80, 2], [5.5, 0.15, 65, 2], [6, 0.2, 85, 2], [6.5, 0.15, 65, 2], [7, 0.2, 80, 2], [7.5, 0.15, 72, 2],
    ],
  },
  {
    id: 'tresillo', name: 'Tresillo', description: '3-3-2 bass against a backbeat and shaker.', bars: 1,
    notes: [
      [0, 0.5, 116, 0], [1.5, 0.5, 108, 0], [3, 0.5, 104, 0],
      [1, 0.35, 108, 1], [3, 0.35, 108, 1],
      [0.5, 0.15, 62, 2], [1.5, 0.15, 62, 2], [2.5, 0.15, 62, 2], [3.5, 0.15, 62, 2],
    ],
  },
  {
    id: 'sonClave', name: 'Son clave', description: '3-2 clave over a steady pulse, two bars.', bars: 2,
    notes: [
      [0, 0.4, 114, 1], [1.5, 0.4, 106, 1], [3, 0.4, 110, 1], [5, 0.4, 106, 1], [6, 0.4, 106, 1],
      [0, 0.3, 95, 0], [1, 0.3, 85, 0], [2, 0.3, 92, 0], [3, 0.3, 85, 0], [4, 0.3, 95, 0], [5, 0.3, 85, 0], [6, 0.3, 92, 0], [7, 0.3, 85, 0],
    ],
  },
  {
    id: 'shuffle', name: 'Shuffle', description: 'Swung hats over a kick-snare pocket.', bars: 1,
    notes: [
      [0, 0.4, 114, 0], [2, 0.4, 110, 0],
      [1, 0.4, 110, 1], [3, 0.4, 110, 1],
      [0, 0.25, 92, 2], [0.67, 0.18, 68, 2], [1, 0.25, 85, 2], [1.67, 0.18, 68, 2], [2, 0.25, 92, 2], [2.67, 0.18, 68, 2], [3, 0.25, 85, 2], [3.67, 0.18, 72, 2],
    ],
  },
  {
    id: 'gallop', name: 'Gallop', description: 'Galloping low end with accents answering above.', bars: 1,
    notes: [
      [0, 0.4, 112, 0], [0.75, 0.2, 78, 0], [1, 0.4, 104, 0], [1.75, 0.2, 78, 0], [2, 0.4, 112, 0], [2.75, 0.2, 78, 0], [3, 0.4, 104, 0], [3.75, 0.2, 78, 0],
      [1, 0.3, 100, 1], [3, 0.3, 104, 1],
    ],
  },
  {
    id: 'buildUp', name: 'Build-up', description: 'Two bars accelerating from beats to a sixteenth boil, climbing rows.', bars: 2,
    notes: [
      [0, 0.4, 90, 0], [1, 0.4, 94, 0], [2, 0.4, 98, 0], [3, 0.4, 102, 0],
      [4, 0.22, 100, 1], [4.5, 0.22, 103, 1], [5, 0.22, 106, 1], [5.5, 0.22, 109, 1],
      [6, 0.12, 108, 2], [6.25, 0.12, 110, 2], [6.5, 0.12, 112, 2], [6.75, 0.12, 114, 2],
      [7, 0.1, 116, 3], [7.25, 0.1, 119, 3], [7.5, 0.1, 122, 3], [7.75, 0.1, 125, 3],
    ],
  },
]

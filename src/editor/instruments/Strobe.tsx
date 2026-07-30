import type { ObjectState, ResolvedNote } from '../core/visual/types'
import type { MidiRowDef, ObjectInstrumentDef, ParamDef } from './types'

// Strobe: a beat-locked flash over the whole scene.
//
// Like Color Filters and Bass Ripple it draws nothing and instead post-processes
// the scene it belongs to (the compositor in components/visual/VisualScene.tsx
// consumes this track's ObjectState). It is an object instrument rather than a
// director for the same reason those are: it acts on ONE scene's render target
// before compositing, so a strobing scene still slots into a Crop mask or a Cut
// partition normally.
//
// RATE IS THE MIDI VOCABULARY, not a knob. A strobe's expressive dimension is
// its speed - the build from eighths to sixty-fourths is the whole gesture - so
// each rate gets its own labelled row and you *play* the acceleration instead of
// automating a slider. That also keeps the panel down to the three things that
// are genuinely settings: which look, how strong, how long each flash lasts.

/** Length of one on/off cycle, in beats, per labelled row. */
interface StrobeRateRow extends MidiRowDef {
  beatsPerCycle: number
}

/** Fastest at the top, so the rows climb like the energy does. Every rate is a
 *  power-of-two division of the beat, which is what keeps the flashes landing on
 *  the grid the music is already on.
 *
 *  1/64 is past what a 60fps frame can resolve cleanly (at 120bpm it is 32Hz,
 *  under two frames per cycle) - it reads as a rough shimmer rather than
 *  countable flashes, and the exact texture depends on the frame rate. That is
 *  the honest ceiling of "as fast as possible" and it is kept because the smear
 *  is a usable look; 1/32 is the fastest rate that still strobes crisply. */
export const STROBE_RATE_ROWS: StrobeRateRow[] = [
  { pitch: 72, label: '1/64 · smear', beatsPerCycle: 1 / 16 },
  { pitch: 71, label: '1/32 · buzz', beatsPerCycle: 1 / 8 },
  { pitch: 70, label: '1/16 · rapid fire', beatsPerCycle: 1 / 4, emphasized: true },
  { pitch: 69, label: '1/8 · flicker', beatsPerCycle: 1 / 2 },
  { pitch: 68, label: '1/4 · pulse', beatsPerCycle: 1 },
]

const RATE_BY_PITCH = new Map(STROBE_RATE_ROWS.map((row) => [row.pitch, row]))

// Style values are this instrument's own small enum, stored in the document, and
// deliberately NOT the shader's mode numbers: the compositor's mode vocabulary is
// an internal detail of one fragment shader, and renumbering it must not
// repaint every saved project. STYLE_MODES is the one place the two meet.
export const STROBE_STYLE_INVERT = 0
export const STROBE_STYLE_BLACKOUT = 1
export const STROBE_STYLE_FLASH = 2

/** Style → mode in the compositor's colour-filter pass (COLOR_FILTER_FRAGMENT).
 *  Invert reuses the mode Color Filters already ships; blackout and flash were
 *  added to that shader for this instrument. */
export const STROBE_STYLE_MODES: Record<number, number> = {
  [STROBE_STYLE_INVERT]: 1,
  [STROBE_STYLE_BLACKOUT]: 10,
  [STROBE_STYLE_FLASH]: 11,
}

const PARAMS: ParamDef[] = [
  {
    key: 'style',
    label: 'Style',
    type: 'select',
    default: STROBE_STYLE_INVERT,
    options: [
      { value: STROBE_STYLE_INVERT, label: 'Invert' },
      { value: STROBE_STYLE_BLACKOUT, label: 'Blackout' },
      { value: STROBE_STYLE_FLASH, label: 'Flash' },
    ],
  },
  { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, default: 1 },
  // Never 0 or 1: both ends are degenerate (a strobe that never lights, or one
  // that never goes dark and so is just a held filter).
  { key: 'width', label: 'Width', min: 0.05, max: 0.95, step: 0.01, default: 0.5 },
]

/**
 * The on/off gate: 1 while the flash is lit, 0 while it is dark. A hard edge, on
 * purpose - a strobe that ramps in and out is a pulse, and Bass Ripple already
 * covers held-and-decaying.
 *
 * Phase comes from the ABSOLUTE beat, not from the held note's start. Two
 * consequences worth having: every strobe in the project flashes on the same
 * grid (so two of them at different rates stay locked to each other rather than
 * drifting by however far apart their notes were placed), and a note nudged off
 * the grid still flashes on it. Notes normally start on a division anyway, in
 * which case note-relative phase would agree.
 *
 * Exported so the settings panel's preview can flash to the exact same math.
 */
export function strobeGate(beat: number, beatsPerCycle: number, width: number): number {
  if (beatsPerCycle <= 0) return 0
  const phase = beat / beatsPerCycle
  // Not `% 1`: that keeps the sign, and beats before zero would gate inverted.
  return phase - Math.floor(phase) < width ? 1 : 0
}

export interface ActiveStrobe {
  /** Mode for the compositor's colour-filter pass. */
  mode: number
  /** 0..1 effect amount for THIS frame, already gated - a dark half of the cycle
   *  resolves to null rather than to 0, so the compositor skips the pass. */
  amount: number
  beat: number
}

/**
 * Resolve one track's flash this frame. Mirrors Color Filters while a note is
 * held - the latest-started recognized note wins, and velocity plus track
 * opacity both scale Depth, so how hard the note is struck is how hard the frame
 * flips - with the gate applied on top.
 *
 * Everything here is a closed-form function of `state.beat`, so a paused frame
 * is a frozen flash and scrubbing shows exactly what playback shows.
 */
export function resolveActiveStrobe(
  state: Pick<ObjectState, 'activeNotes' | 'params' | 'opacity' | 'blackedOut' | 'beat'> | undefined,
): ActiveStrobe | null {
  if (!state || state.blackedOut) return null

  let selected: ResolvedNote | undefined
  for (const note of state.activeNotes) {
    if (!RATE_BY_PITCH.has(note.pitch)) continue
    if (!selected || note.beat >= selected.beat) selected = note
  }
  if (!selected) return null

  const row = RATE_BY_PITCH.get(selected.pitch)!
  const width = Math.max(0, Math.min(1, state.params.width ?? 0.5))
  if (strobeGate(state.beat, row.beatsPerCycle, width) <= 0) return null

  const velocity = selected.velocity <= 1 ? selected.velocity : selected.velocity / 127
  const amount = Math.max(0, Math.min(1, (state.params.depth ?? 1) * state.opacity * velocity))
  if (amount <= 0) return null

  const style = Math.round(state.params.style ?? STROBE_STYLE_INVERT)
  return {
    mode: STROBE_STYLE_MODES[style] ?? STROBE_STYLE_MODES[STROBE_STYLE_INVERT],
    amount,
    beat: state.beat,
  }
}

function StrobeVisual() {
  // The scene compositor consumes this track's ObjectState and flashes the scene
  // after it has rendered. No geometry belongs in the scene.
  return null
}

export const strobeInstrument: ObjectInstrumentDef = {
  id: 'strobe',
  name: 'Strobe',
  kind: 'object',
  // A strobe's own light is white, but an achromatic identity falls back to the
  // track hue cycle (utils/trackDisplayColor.ts) - so the identity is the hot
  // yellow of a flash bulb, matching the bolt the library icon wears.
  identityColor: '#fde047',
  params: PARAMS,
  userInterfaceRenderer: 'strobe',
  midiRows: STROBE_RATE_ROWS,
  component: StrobeVisual,
}

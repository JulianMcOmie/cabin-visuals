import type { ObjectState, ResolvedNote } from '../core/visual/types'
import { paramDefault, type MidiRowDef, type ObjectInstrumentDef, type ParamDef } from './types'

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

/**
 * A row is one on/off cycle length, expressed on ONE of two axes.
 *
 * `beatsPerCycle` rows are musical: they stretch with the tempo.
 * `framesPerCycle` rows are wall-clock: a fixed Hz on a nominal 60fps grid, so
 * they hold their speed no matter the BPM. Exactly one is set per row.
 */
export interface StrobeRateRow extends MidiRowDef {
  beatsPerCycle?: number
  framesPerCycle?: number
  /** Divides the beat in THREE rather than in two. Presentation groups on this;
   *  the gate itself only ever sees a resolved cycle length. */
  triplet?: true
}

/**
 * The frame grid the `f` rows count against — NOMINAL, never the real render
 * rate. Reading an actual frame counter would break the one rule this whole
 * codebase rests on (every visual is a pure function of the current beat): a
 * paused frame would keep flickering, scrubbing would not match playback, and
 * an export at 30 or 120fps would come out at a different speed than the
 * preview. So "2 frames" means 2/60 of a second, derived from the beat, and a
 * 60fps export lands exactly one flash per frame pair.
 */
export const STROBE_REFERENCE_FPS = 60

/**
 * Two feels, fastest-first within each. Straight rows divide the beat in two,
 * triplet rows divide it in three, and both land on a grid the music is already
 * on - which is the whole point of a rate vocabulary instead of a Hz knob.
 *
 * **Pitches 68-72 are frozen.** They shipped meaning 1/4 … 1/64, and a saved
 * project stores the PITCH, not the rate - so renumbering them would silently
 * re-time every existing strobe. Triplets therefore take new pitches BELOW the
 * straight block (67 down to 65), which also keeps pitch monotonically
 * descending down the whole list. Interleaving triplets with their straight
 * neighbours by raw speed would read as one smooth accelerando, but it would
 * scramble that pitch order and, worse, could not be done without moving the
 * frozen five.
 *
 * The triplet ladder stops at 1/16T on purpose. 1/32T is 24Hz at 120bpm - past
 * the point a 60fps frame resolves anything countable, and indistinguishable
 * from 1/64's smear, so it would be a row that only looks like a new option.
 * For the same reason 1/64 straight (32Hz) is kept as a texture rather than a
 * rate; 1/32 is the fastest row that still strobes crisply.
 */
export const STROBE_RATE_ROWS: StrobeRateRow[] = [
  { pitch: 72, label: '1/64 · smear', beatsPerCycle: 1 / 16 },
  { pitch: 71, label: '1/32 · buzz', beatsPerCycle: 1 / 8 },
  { pitch: 70, label: '1/16 · rapid fire', beatsPerCycle: 1 / 4, emphasized: true },
  { pitch: 69, label: '1/8 · flicker', beatsPerCycle: 1 / 2 },
  { pitch: 68, label: '1/4 · pulse', beatsPerCycle: 1 },
  { pitch: 67, label: '1/16T · triplet buzz', beatsPerCycle: 1 / 6, triplet: true },
  { pitch: 66, label: '1/8T · triplet run', beatsPerCycle: 1 / 3, triplet: true },
  { pitch: 65, label: '1/4T · triplet pulse', beatsPerCycle: 2 / 3, triplet: true },
  // Frame rows, appended below the musical block for the same frozen-pitch
  // reason. Hz figures are exact at the nominal 60fps and independent of tempo.
  { pitch: 64, label: '2f · 30Hz alternating', framesPerCycle: 2 },
  { pitch: 63, label: '3f · 20Hz', framesPerCycle: 3 },
  { pitch: 62, label: '4f · 15Hz', framesPerCycle: 4 },
  { pitch: 61, label: '6f · 10Hz', framesPerCycle: 6 },
]

const RATE_BY_PITCH = new Map(STROBE_RATE_ROWS.map((row) => [row.pitch, row]))

/**
 * A row's cycle length on the beat axis the gate runs on. Musical rows are
 * already there; frame rows are seconds and need the tempo to convert, which is
 * precisely why they hold a fixed Hz while the musical rows scale with BPM.
 *
 * Exported so the settings panel and the runtime resolve rows the same way.
 * Assumes a constant tempo (seconds = beat × secPerBeat) — the project has one
 * BPM, so this is exact today; a real tempo map would need integrating instead.
 */
export function strobeCycleBeats(row: StrobeRateRow, secPerBeat: number): number {
  if (row.beatsPerCycle !== undefined) return row.beatsPerCycle
  if (row.framesPerCycle === undefined || secPerBeat <= 0) return 0
  return row.framesPerCycle / STROBE_REFERENCE_FPS / secPerBeat
}

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
 *
 * Deliberately UNIT-AGNOSTIC: it is a square wave of `cycleLength` period
 * sampled at `position`, and only ever divides the two. The runtime passes
 * beats, the panel's preview passes seconds — both are honest, and neither
 * needs its own copy of the phase logic.
 */
export function strobeGate(position: number, cycleLength: number, width: number): number {
  if (cycleLength <= 0) return 0
  const phase = position / cycleLength
  // Not `% 1`: that keeps the sign, and positions before zero would gate inverted.
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
  state: Pick<ObjectState, 'activeNotes' | 'params' | 'opacity' | 'blackedOut' | 'beat' | 'secPerBeat'> | undefined,
): ActiveStrobe | null {
  if (!state || state.blackedOut) return null

  let selected: ResolvedNote | undefined
  for (const note of state.activeNotes) {
    if (!RATE_BY_PITCH.has(note.pitch)) continue
    if (!selected || note.beat >= selected.beat) selected = note
  }
  if (!selected) return null

  const row = RATE_BY_PITCH.get(selected.pitch)!
  // Fallbacks read the SCHEMA rather than repeating its numbers: a track that
  // predates a param must render at the value the panel is showing.
  const par = (key: string) => state.params[key] ?? paramDefault(strobeInstrument, key)
  const width = Math.max(0, Math.min(1, par('width')))
  if (strobeGate(state.beat, strobeCycleBeats(row, state.secPerBeat), width) <= 0) return null

  const velocity = selected.velocity <= 1 ? selected.velocity : selected.velocity / 127
  const amount = Math.max(0, Math.min(1, par('depth') * state.opacity * velocity))
  if (amount <= 0) return null

  const style = Math.round(par('style'))
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
  // A strobe's own light is white, and the identity is that white - matching
  // the bolt the library icon wears. Being achromatic, timeline blocks fall
  // back to the track hue cycle (utils/trackDisplayColor.ts) so they stay
  // legible among colored neighbours, while chrome that NAMES the instrument
  // (resolveTrackIdentityColor) wears the true white of the flash.
  identityColor: '#ffffff',
  params: PARAMS,
  userInterfaceRenderer: 'strobe',
  midiRows: STROBE_RATE_ROWS,
  component: StrobeVisual,
}

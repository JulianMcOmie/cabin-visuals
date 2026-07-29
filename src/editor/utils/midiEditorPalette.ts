import { colorToOklch, oklchToHex, oklchCss, type Oklch } from './oklch'

// The MIDI editor's color voice, all derived from the edited track's color:
// notes wear the track hue (velocity bends it - see midiNoteColor), and the
// editor chrome (ruler band, block region, loop dashes, marquee) is a calmer
// voicing of the same hue, so the editor reads as an extension of the block
// you double-clicked rather than a generic purple room.

// The neon voice (Tyler's pick, 2026-07-29): notes sit bright AND charged so
// they read like lit signage on the dark grid; selection lifts lightness on
// top of the laser glow.
const NOTE_L = 0.82
const NOTE_C = 0.16
const NOTE_SELECTED_L = 0.92

// Velocity bends the note's hue around the track color: the default velocity
// (100) sits exactly on it, softer notes drift cooler, accents push a touch
// warmer. Kept gentle (~25° at the very softest) so every note still reads
// as the track's color against the matching editor chrome.
const VELOCITY_HUE_DEG_PER_STEP = 0.25
const VELOCITY_CENTER = 100

const FALLBACK: Oklch = { l: 0.6, c: 0.1, h: 258 }

function sourceOklch(color: string): Oklch {
  const parsed = colorToOklch(color)
  if (!parsed) return FALLBACK
  // Grey tracks stay grey: don't resurrect chroma from a colorless source.
  return parsed.c > 0.02 ? parsed : { ...parsed, c: 0 }
}

/** The base note/row color for a track: its hue, renormalized to the note
 *  voice's fixed lightness and chroma. Hex, so MidiRow.color stays parseable. */
export function midiNoteBaseColor(color: string): string {
  const src = sourceOklch(color)
  return oklchToHex(NOTE_L, src.c === 0 ? 0 : NOTE_C, src.h)
}

// Note fills recompute on every render of every note; velocities are integers
// so a tiny cache makes the per-note math free.
const noteColorCache = new Map<string, string>()

/** A note's fill: the row color with the velocity hue-bend applied.
 *  `selected` lifts lightness instead of glowing. */
export function midiNoteColor(rowColor: string, velocity: number, selected = false): string {
  const key = `${rowColor}:${Math.round(velocity)}:${selected ? 1 : 0}`
  const hit = noteColorCache.get(key)
  if (hit) return hit
  const src = sourceOklch(rowColor)
  const hue = src.h + (Math.round(velocity) - VELOCITY_CENTER) * VELOCITY_HUE_DEG_PER_STEP
  const result = oklchToHex(selected ? NOTE_SELECTED_L : src.l, src.c, ((hue % 360) + 360) % 360)
  noteColorCache.set(key, result)
  return result
}

/** Value-lane ramp: the track hue throughout, lightness encodes the value
 *  (dim = min, bright = max) - magnitude reads at a glance and the lane still
 *  belongs to its track. */
export function midiValueColor(trackColor: string, t: number): string {
  const src = sourceOklch(trackColor)
  return oklchToHex(0.55 + t * 0.3, src.c === 0 ? 0 : 0.15, src.h)
}

/** Label text for an emphasized row (the C rows anchoring each octave, or an
 *  instrument's flagship rows): the row's hue lifted to label lightness at low
 *  chroma, so it glows quietly against the gutter instead of shouting. */
export function midiRowLabelColor(rowColor: string): string {
  const src = sourceOklch(rowColor)
  return oklchToHex(0.75, src.c === 0 ? 0 : 0.08, src.h)
}

export interface MidiEditorChrome {
  /** Ruler clip-header band (the draggable block strip under the bar numbers). */
  band: string
  /** Full-height tint over the block's beats in the grid. */
  regionTint: string
  /** The block's left/right edge lines in the grid. */
  regionEdge: string
  /** Dashed line at each loop repeat inside the block. */
  loopDash: string
  /** Marquee selection fill + border. */
  marqueeFill: string
  marqueeEdge: string
}

/** Editor chrome voiced from the track color (fixed L/C recipes, track hue). */
export function midiEditorChrome(color: string): MidiEditorChrome {
  const { c, h } = sourceOklch(color)
  const chroma = (target: number) => (c === 0 ? 0 : target)
  return {
    band: oklchCss(0.64, chroma(0.17), h, 0.82),
    // Tint stays at the calm alpha even in the neon voice: any higher and it
    // reads as a milky film over the beat gridlines (perceived as blur).
    regionTint: oklchCss(0.72, chroma(0.17), h, 0.07),
    regionEdge: oklchCss(0.74, chroma(0.17), h, 0.65),
    loopDash: oklchCss(0.74, chroma(0.17), h, 0.5),
    marqueeFill: oklchCss(0.72, chroma(0.17), h, 0.15),
    marqueeEdge: oklchCss(0.78, chroma(0.17), h, 0.65),
  }
}

export interface MidiToolbarAccent {
  /** Active-toggle pill fill (Snap, Noise). */
  pillBg: string
  /** Active-toggle pill text - bright enough to read on the tinted fill. */
  pillText: string
  /** Slider filled-track color (feeds .slider-console's --slider-color). */
  slider: string
}

/** Toolbar accents voiced from the track color, so the editor's controls
 *  belong to the block being edited like the rest of the chrome. */
export function midiToolbarAccent(color: string): MidiToolbarAccent {
  const { c, h } = sourceOklch(color)
  const chroma = (target: number) => (c === 0 ? 0 : target)
  return {
    pillBg: oklchCss(0.72, chroma(0.17), h, 0.18),
    pillText: oklchCss(0.86, chroma(0.11), h),
    slider: oklchCss(0.68, chroma(0.14), h, 0.9),
  }
}

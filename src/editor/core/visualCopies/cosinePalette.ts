// The Cosine Palette: Inigo Quilez's procedural palette as a colorizer.
// color(t) = a + b·cos(2π(c·t + d)) with per-channel phase d - staggering the
// three channels' phases is what turns one scalar into a hue progression, and
// swapping the d triple re-skins the whole ramp without touching anything else.
//
// Where the Gradient paints a CLAMPED two-stop ramp between picked colors, this
// paints a PERIODIC computed one: t wraps, so a ring of copies can wear a
// seamless rainbow (CYCLES is detented to half-turns for exactly that - a
// non-integer cycle count tears a visible seam where the formation closes).
//
// Each copy's t comes from WHERE IT SITS - one MAP select, kept deliberately
// small: X, Y, Radial (distance from the chain origin in the camera plane),
// Spherical (true 3D distance), Depth (Z), or Copy index (the Gradient's
// convention: the splitter's own ordering is the axis). Position modes read the
// copy's world position the same way the Colorizer's rainbow does.
//
// Time enters twice, both as PHASE (palette turns), both pure functions of the
// beat:
//  - SCROLL is a knob: automate it and the whole palette slides through the
//    formation. One full turn of the knob is exactly one palette period
//    whatever CYCLES says, so a 0→1 automation cycle loops seamlessly.
//  - The Kick row is played: each note shoves the phase forward by velocity ×
//    KICK and eases back, summed closed-form over the note history (onsets
//    only, duration ignored - the impactPulse rule for percussion-shaped
//    movers) so a roll compounds and scrub agrees with playback.
//
// Each copy's color travels as the ABSOLUTE `tint` channel, like the other two
// colorizers: a computed palette sample is "be this color", which relative HSL
// cannot say. Chain rule as ever - a later tint (a note Colorizer's flash)
// takes the color over, and relative hue sweeps ride on top.

import { midiVelocity } from '../../utils/midiVelocity'
import { Vector3 } from 'three'
import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import type { VisualCopy } from './types'
import { COSINE_PALETTE_COLOR } from './identityColors'
import { clamp01 } from '../../utils/math'

export const COSINE_MAP_X = 0
export const COSINE_MAP_Y = 1
export const COSINE_MAP_RADIAL = 2
export const COSINE_MAP_SPHERICAL = 3
export const COSINE_MAP_DEPTH = 4
export const COSINE_MAP_INDEX = 5

/** How the tint mix walks at partial AMOUNT - same pair as the note Colorizer. */
export const COSINE_BLEND_PERCEPTUAL = 0
export const COSINE_BLEND_LINEAR = 1

/** The one MIDI row: a velocity-scaled phase shove. */
export const COSINE_KICK_PITCH = 60

/** The shipped d triples (IQ's canonical values): the phase stagger IS the
 *  palette's character, so a preset is just three numbers. The PHASE R/G/B
 *  knobs offset from the selected preset, so every preset is also a starting
 *  point for a custom palette - and the knobs stay automatable offsets around
 *  it rather than absolute values that a preset switch would fight. */
export const COSINE_PALETTE_PRESETS: readonly { label: string; d: readonly [number, number, number] }[] = [
  { label: 'Rainbow', d: [0.263, 0.416, 0.557] },
  { label: 'Sunset', d: [0.0, 0.1, 0.2] },
  { label: 'Synth', d: [0.3, 0.2, 0.2] },
  { label: 'Ocean', d: [0.8, 0.9, 0.3] },
]

export interface CosinePaletteSettings {
  /** Index into COSINE_PALETTE_PRESETS - the base d triple. */
  palette: number
  /** Per-channel phase offsets on top of the preset, in palette turns. */
  phaseR: number
  phaseG: number
  phaseB: number
  /** IQ's `a`: the level the channels oscillate around. */
  bright: number
  /** IQ's `b`: how far each channel swings. Lower reads pastel. */
  range: number
  /** IQ's `c`, one scalar for all channels: palette periods per SPAN of
   *  distance (or per full copy run in INDEX mode). Half-turn detents so a
   *  closed formation tiles without a seam. */
  cycles: number
  /** Master phase, in palette turns. THE automation target: sweeping 0→1
   *  slides the palette exactly one period, so the lane loops seamlessly. */
  scroll: number
  /** COSINE_MAP_*: which scalar of the copy's position becomes t. */
  mode: number
  /** Position modes: world units of travel per palette period. */
  span: number
  /** Position modes: world units the mapping's zero slides along its axis
   *  (or outward, for the distance modes). */
  offset: number
  /** How far toward the sampled color each copy pulls, 0..1. */
  amount: number
  /** COSINE_BLEND_PERCEPTUAL or COSINE_BLEND_LINEAR. */
  blend: number
  /** Phase turns a full-velocity Kick note shoves, before easing back. */
  kick: number
  /** Beats until a kick has effectively settled (~5% left). */
  kickDecay: number
}

const COSINE_PARAMS: ParamDef[] = [
  {
    key: 'palette',
    label: 'Palette',
    type: 'select',
    options: COSINE_PALETTE_PRESETS.map((preset, value) => ({ value, label: preset.label })),
    default: 0,
  },
  { key: 'scroll', label: 'Scroll', min: 0, max: 1, step: 0.005, default: 0 },
  { key: 'phaseR', label: 'Phase R', min: -0.5, max: 0.5, step: 0.005, default: 0 },
  { key: 'phaseG', label: 'Phase G', min: -0.5, max: 0.5, step: 0.005, default: 0 },
  { key: 'phaseB', label: 'Phase B', min: -0.5, max: 0.5, step: 0.005, default: 0 },
  { key: 'bright', label: 'Bright', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'range', label: 'Range', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'cycles', label: 'Cycles', min: 0.5, max: 4, step: 0.5, default: 1 },
  {
    key: 'mode',
    label: 'Map',
    type: 'select',
    options: [
      { value: COSINE_MAP_X, label: 'X' },
      { value: COSINE_MAP_Y, label: 'Y' },
      { value: COSINE_MAP_RADIAL, label: 'Radial' },
      { value: COSINE_MAP_SPHERICAL, label: 'Spherical' },
      { value: COSINE_MAP_DEPTH, label: 'Depth' },
      { value: COSINE_MAP_INDEX, label: 'Copy index' },
    ],
    default: COSINE_MAP_RADIAL,
  },
  { key: 'span', label: 'Span (units)', min: 0.25, max: 40, step: 0.25, default: 6, curve: 2 },
  { key: 'offset', label: 'Offset (units)', min: -20, max: 20, step: 0.1, default: 0 },
  { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
  {
    key: 'blend',
    label: 'Mix',
    type: 'select',
    options: [
      { value: COSINE_BLEND_PERCEPTUAL, label: 'Perceptual' },
      { value: COSINE_BLEND_LINEAR, label: 'Linear' },
    ],
    default: COSINE_BLEND_PERCEPTUAL,
  },
  { key: 'kick', label: 'Kick', min: 0, max: 1, step: 0.01, default: 0.25 },
  { key: 'kickDecay', label: 'Kick decay', min: 0.05, max: 8, step: 0.01, default: 1, curve: 2 },
]

/** The resolved d triple: the selected preset plus the phase-offset knobs.
 *  Exported so a settings panel derives its strip from the same fold. */
export function cosinePalettePhases(settings: CosinePaletteSettings): [number, number, number] {
  const preset = COSINE_PALETTE_PRESETS[Math.round(settings.palette)] ?? COSINE_PALETTE_PRESETS[0]
  return [preset.d[0] + settings.phaseR, preset.d[1] + settings.phaseG, preset.d[2] + settings.phaseB]
}

const byteHex = (value: number) => Math.round(clamp01(value) * 255).toString(16).padStart(2, '0')

/**
 * The palette at phase `u`, in palette turns (u already carries CYCLES, SCROLL
 * and any kick - this is the formula's last mile). Periodic by construction:
 * u and u+1 are the same color exactly.
 */
export function cosinePaletteColor(settings: CosinePaletteSettings, u: number): string {
  const [dR, dG, dB] = cosinePalettePhases(settings)
  const a = settings.bright
  const b = settings.range
  const TAU = Math.PI * 2
  return '#'
    + byteHex(a + b * Math.cos(TAU * (u + dR)))
    + byteHex(a + b * Math.cos(TAU * (u + dG)))
    + byteHex(a + b * Math.cos(TAU * (u + dB)))
}

/** One period of the palette as `size` hex entries - u ∈ [0,1), wrapping, so a
 *  phase shift is an index rotation. Exported for the settings panel's strip:
 *  the preview renders these same entries, so it cannot drift from the stage. */
export function cosinePaletteLut(settings: CosinePaletteSettings, size: number): string[] {
  return Array.from({ length: size }, (_, i) => cosinePaletteColor(settings, i / size))
}

/**
 * The copy's t before CYCLES/SCROLL/kick - the mapping half of the trick. No
 * clamp anywhere: the palette is periodic, so "past the end" is just the next
 * period (the deliberate difference from the Gradient's fill-style padding).
 *
 * Distance modes measure from the chain origin, which is the splitter's own
 * center once placement is applied - so Radial rings a Radial splitter's
 * formation concentrically, Spherical shells a 3D lattice, and both are
 * symmetric by construction. INDEX spreads one full t across the copy run
 * (first copy 0, last copy 1), so at integer CYCLES a closed formation's seam
 * lands on the same color from both sides.
 */
export function cosinePalettePosition(
  settings: CosinePaletteSettings,
  index: number,
  count: number,
  x: number,
  y: number,
  z: number,
): number {
  if (settings.mode === COSINE_MAP_INDEX) {
    return count > 1 ? index / (count - 1) : 0.5
  }
  const span = Math.max(0.001, settings.span)
  switch (settings.mode) {
    case COSINE_MAP_X: return (x - settings.offset) / span
    case COSINE_MAP_Y: return (y - settings.offset) / span
    case COSINE_MAP_SPHERICAL: return (Math.hypot(x, y, z) - settings.offset) / span
    case COSINE_MAP_DEPTH: return (z - settings.offset) / span
    default: return (Math.hypot(x, y) - settings.offset) / span
  }
}

function normalizedVelocity(velocity: number): number {
  return clamp01(midiVelocity(velocity))
}

/**
 * The Kick row's summed phase shove at `beat`, in palette turns. Each onset
 * contributes velocity × KICK instantly (full push on the onset frame, no
 * ramp - a kick with an attack is a swell, not a kick) and decays
 * exponentially; KICK DECAY is the beats until ~5% remains (e⁻³). Notes sum,
 * so a roll winds the palette further than one hit - and the whole thing is a
 * closed-form function of the note history, never accumulated per frame.
 */
export function cosineKickPhase(
  notes: readonly ResolvedNote[],
  beat: number,
  kick: number,
  kickDecay: number,
): number {
  if (kick <= 0) return 0
  const decay = Math.max(0.05, kickDecay)
  let phase = 0
  for (const note of notes) {
    if (note.pitch !== COSINE_KICK_PITCH) continue
    const age = beat - note.beat
    if (age < 0) continue
    phase += normalizedVelocity(note.velocity) * kick * Math.exp((-3 * age) / decay)
  }
  return phase
}

const COSINE_ROWS: MidiRowDef[] = [{ pitch: COSINE_KICK_PITCH, label: 'Kick' }]

/** Enough entries that adjacent samples sit under ~1.5° of hue apart across a
 *  full rainbow period - the Gradient's 65 covers a partial arc; a whole wheel
 *  needs more to stay visually continuous. */
const LUT_SIZE = 256

export const cosinePaletteColorizer: MoverOrSplitterDefinition<CosinePaletteSettings> = {
  id: 'cosinePalette',
  label: 'Cosine Palette',
  kind: 'colorizer',
  identityColor: COSINE_PALETTE_COLOR,
  params: COSINE_PARAMS,
  midiRows: () => COSINE_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    // The period is fixed per resolve (settings changes - automation included -
    // re-resolve), so per-frame work is one t, one phase sum, and an index into
    // precomputed hex strings: no trig and no string building per copy.
    const lut = cosinePaletteLut(settings, LUT_SIZE)
    const amount = clamp01(settings.amount)
    const cycles = Math.max(0, settings.cycles)
    const perceptual = settings.blend !== COSINE_BLEND_LINEAR
    const scratchPosition = new Vector3()
    return {
      apply(visualCopy, { beat, index, count, placementTransform }) {
        // AMOUNT zero leaves upstream color state alone entirely - "no
        // palette" must not clear a tint another colorizer asked for.
        if (amount <= 0) {
          const passthrough: VisualCopy = {
            transform: visualCopy.transform.clone(),
            opacity: visualCopy.opacity,
            colorShift: { ...visualCopy.colorShift },
          }
          return [passthrough]
        }
        // World position, the same read as the Colorizer's rainbow: the
        // chained transform's translation pushed through the track placement.
        scratchPosition.setFromMatrixPosition(visualCopy.transform)
        if (placementTransform) scratchPosition.applyMatrix4(placementTransform)
        const t = cosinePalettePosition(
          settings, index, count, scratchPosition.x, scratchPosition.y, scratchPosition.z,
        )
        const u = cycles * t + settings.scroll + cosineKickPhase(notes, beat, settings.kick, settings.kickDecay)
        const wrapped = ((u % 1) + 1) % 1
        return [{
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity,
          colorShift: {
            ...visualCopy.colorShift,
            // Tint REPLACES upstream (the chain rule): the palette owns the
            // color; relative hue/sat/lightness continue to ride on top.
            tint: lut[Math.floor(wrapped * LUT_SIZE) % LUT_SIZE],
            tintAmount: amount,
            tintPerceptual: perceptual,
          },
        }]
      },
    }
  },
}

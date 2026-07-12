// Production mover-and-splitter definitions, collected for the registry (the
// new-registry analogue of core/visual/movers/library.ts). Each definition owns
// its complete MIDI grammar - the kernel and the chain resolver know nothing
// about pitches or velocities.

import { Matrix4, Vector3 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import type { VisualCopy } from './types'

// ── Burst ────────────────────────────────────────────────────────────────────
// Directional step mover: each note permanently steps the object a fixed
// distance in one cardinal direction, animated by an ease-out "burst" (violent
// start, soft landing). Steps accumulate - repeated +X notes keep walking the
// object right, a -X note steps it back - so position is fully choreographed by
// the note history, and the summed offset stays a closed-form function of the
// beat (the pause invariant: scrub == playback == export).

/** Burst's MIDI vocabulary: one row per cardinal direction. */
export const BURST_DIRECTIONS: Record<number, { axis: 0 | 1 | 2; sign: 1 | -1 }> = {
  62: { axis: 1, sign: 1 }, // Up (+Y)
  63: { axis: 1, sign: -1 }, // Down (-Y)
  60: { axis: 0, sign: 1 }, // Right (+X)
  61: { axis: 0, sign: -1 }, // Left (-X)
  64: { axis: 2, sign: 1 }, // Forward (+Z)
  65: { axis: 2, sign: -1 }, // Back (-Z)
}

const BURST_ROWS: MidiRowDef[] = [
  { pitch: 62, label: 'Up (+Y)' },
  { pitch: 63, label: 'Down (−Y)' },
  { pitch: 60, label: 'Right (+X)' },
  { pitch: 61, label: 'Left (−X)' },
  { pitch: 64, label: 'Forward (+Z)' },
  { pitch: 65, label: 'Back (−Z)' },
]

export interface BurstSettings {
  /** Beats a burst takes to land on its destination. */
  burstBeats: number
  /** Ease-out family (see BURST_EASINGS order). */
  easing: number
  /** Time-warp exponent: >1 makes the initial jump more violent. */
  sharpness: number
  distanceX: number
  distanceY: number
  distanceZ: number
  /** Overall distance multiplier on top of the per-axis distances. */
  distance: number
}

/** Ease-out curves, indexed by the `easing` select value. All map 0→0, 1→1;
 *  elastic and back deliberately overshoot en route. */
export const BURST_EASINGS: { label: string; ease: (t: number) => number }[] = [
  { label: 'Expo', ease: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)) },
  { label: 'Cubic', ease: (t) => 1 - Math.pow(1 - t, 3) },
  { label: 'Quad', ease: (t) => 1 - (1 - t) * (1 - t) },
  {
    label: 'Elastic',
    ease: (t) =>
      t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  },
  {
    label: 'Back',
    ease: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  },
  { label: 'Linear', ease: (t) => t },
]

/**
 * The summed offset of every burst launched at or before `beat`. Each note
 * contributes `direction * axisDistance * multiplier * velocity * ease(age)`,
 * where the eased progress clamps at 1 once the burst lands - the step is
 * permanent. Pitches outside the vocabulary are ignored.
 */
export function evaluateBurstOffset(
  notes: ResolvedNote[],
  settings: BurstSettings,
  beat: number,
): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  const beats = Math.max(0.0001, settings.burstBeats)
  const sharpness = Math.max(0.0001, settings.sharpness)
  const { ease } = BURST_EASINGS[settings.easing] ?? BURST_EASINGS[0]
  const axisDistance = [settings.distanceX, settings.distanceY, settings.distanceZ]
  for (const note of notes) {
    if (note.beat > beat) continue
    const dir = BURST_DIRECTIONS[note.pitch]
    if (!dir) continue
    const progress = Math.min(1, (beat - note.beat) / beats)
    const eased = ease(Math.pow(progress, 1 / sharpness))
    const velocity = note.velocity <= 1 ? note.velocity : note.velocity / 127
    out[dir.axis] += dir.sign * axisDistance[dir.axis] * settings.distance * velocity * eased
  }
  return out
}

export const burstMover: MoverOrSplitterDefinition<BurstSettings> = {
  id: 'burst',
  label: 'Burst',
  kind: 'mover',
  params: [
    { key: 'burstBeats', label: 'Burst beats', min: 0.05, max: 16, step: 0.05, default: 1 },
    {
      key: 'easing',
      label: 'Easing',
      type: 'select',
      options: BURST_EASINGS.map((e, value) => ({ value, label: e.label })),
      default: 0,
    },
    { key: 'sharpness', label: 'Sharpness', min: 0.25, max: 4, step: 0.05, default: 1 },
    { key: 'distanceX', label: 'Distance X', min: 0, max: 10, step: 0.1, default: 1 },
    { key: 'distanceY', label: 'Distance Y', min: 0, max: 10, step: 0.1, default: 1 },
    { key: 'distanceZ', label: 'Distance Z', min: 0, max: 10, step: 0.1, default: 1 },
    { key: 'distance', label: 'Distance ×', min: 0, max: 10, step: 0.1, default: 1 },
  ],
  midiRows: () => BURST_ROWS,
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, { beat }) {
        const [x, y, z] = evaluateBurstOffset(notes, settings, beat)
        // Composed in the chain-root (placement) frame - delta PRE-multiplies -
        // so burst directions stay cardinal regardless of upstream rotations.
        const next: VisualCopy = {
          transform: new Matrix4().makeTranslation(x, y, z).multiply(visualCopy.transform),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }
        return [next]
      },
    }
  },
}

// ── Radial ───────────────────────────────────────────────────────────────────
// Radial splitter: N structural copies, copy i rotated by i/N of a full turn
// about the chosen plane's normal. The rotation PRE-multiplies (chain-root
// frame), so translations already applied by movers ABOVE it spread radially -
// one Burst +X note blooms every copy outward in its own direction. Movers
// below it move all copies identically (or per-index if they read context).
// Slot count comes only from settings, never from MIDI, so downstream indices
// and the React occurrence list stay stable; notes are ignored.

export interface RadialSettings {
  copies: number
  /** 0 = XY (about Z), 1 = XZ (about Y), 2 = YZ (about X). */
  plane: number
}

const RADIAL_MAX_COPIES = 32
const RADIAL_AXES = [new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)]

export const radialSplitter: MoverOrSplitterDefinition<RadialSettings> = {
  id: 'radial',
  label: 'Radial',
  kind: 'splitter',
  params: [
    { key: 'copies', label: 'Copies', min: 1, max: RADIAL_MAX_COPIES, step: 1, default: 6 },
    {
      key: 'plane',
      label: 'Plane',
      type: 'select',
      options: [
        { value: 0, label: 'XY' },
        { value: 1, label: 'XZ' },
        { value: 2, label: 'YZ' },
      ],
      default: 0,
    },
  ],
  resolve({ settings }) {
    const count = Math.max(1, Math.min(RADIAL_MAX_COPIES, Math.round(settings.copies)))
    const axis = RADIAL_AXES[settings.plane] ?? RADIAL_AXES[0]
    // Structural slot rotations, in slot order (slot 0 is unrotated).
    const rotations = Array.from({ length: count }, (_, slot) =>
      new Matrix4().makeRotationAxis(axis, (slot / count) * Math.PI * 2),
    )
    return {
      apply(visualCopy) {
        return rotations.map((rotation) => ({
          transform: rotation.clone().multiply(visualCopy.transform),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }))
      },
    }
  },
}

/** Every production definition, in picker order. Seeded into the registry. */
export const MOVER_OR_SPLITTER_DEFINITIONS: MoverOrSplitterDefinition<any>[] = [burstMover, radialSplitter]

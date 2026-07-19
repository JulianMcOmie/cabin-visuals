// Wave Terrain: a world-space heightfield mover. Every copy is displaced along
// the scene's Z axis by an animated wave surface z = f(x, y, beat) evaluated at
// the copy's own accumulated (x, y) position - objects ride an invisible water
// surface. Five wave families are selectable (radial, directional, standing,
// two-source, spiral), and two MIDI rows pump the surface's amplitude with
// Burst-style accumulating ease-out steps.

import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { BURST_EASINGS } from './burstEasings'
import { normalizedVelocity } from './motionBasis'

export const WAVE_TERRAIN_AMP_UP_PITCH = 60
export const WAVE_TERRAIN_AMP_DOWN_PITCH = 61

/** Wave families, indexed by the `shape` select value. */
export const WAVE_TERRAIN_SHAPES = [
  'Ripple',
  'Plane',
  'Standing',
  'Interference',
  'Swirl',
] as const

const SHAPE_RIPPLE = 0
const SHAPE_PLANE = 1
const SHAPE_STANDING = 2
const SHAPE_INTERFERENCE = 3
const SHAPE_SWIRL = 4

const TAU = Math.PI * 2

export interface WaveTerrainSettings {
  /** 0 = Ripple, 1 = Plane, 2 = Standing, 3 = Interference, 4 = Swirl. */
  shape: number
  /** Base peak z displacement in world units (MIDI steps add to this). */
  amplitude: number
  /** Spatial wavelength in world units. */
  wavelength: number
  /** Temporal frequency: wave cycles per beat. */
  cyclesPerBeat: number
  /** Radial falloff length from the center; 0 = no falloff. */
  damping: number
  centerX: number
  centerY: number
  /** Travel direction of the Plane shape, degrees (0 = +X, 90 = +Y). */
  directionDeg: number
  /** Distance between the two Interference sources. */
  separation: number
  /** Swirl-only: logarithmic phase twist in turns per e-fold of radius.
   *  Positive tightens the rings toward the center (whirlpool), negative
   *  loosens them, 0 reproduces the Ripple's even spacing. */
  twist: number
  /** Amplitude added per unit-velocity note (each direction row). */
  amount: number
  /** Beats an amplitude step takes to land (Burst envelope). */
  burstBeats: number
  /** Ease-out family (see BURST_EASINGS order). */
  easing: number
  /** Time-warp exponent: >1 makes the initial jump more violent. */
  sharpness: number
}

/** Radial decay shared by every shape: 1 near the center, easing to 0 far away.
 *  A damping of 0 disables the falloff entirely. */
function radialDamp(distance: number, damping: number): number {
  return damping > 0 ? 1 / (1 + distance / damping) : 1
}

/**
 * The amplitude added by the two MIDI direction rows: each note steps the
 * surface amplitude by `amount * velocity`, animated by a Burst-style ease-out
 * over `burstBeats`. Steps accumulate permanently once landed - repeated Up
 * notes keep raising the surface, a Down note steps it back - so amplitude is
 * fully choreographed by the note history and stays a closed-form function of
 * the beat (the pause invariant: scrub == playback == export). The summed
 * step is signed and unclamped: a net-negative amplitude inverts the surface.
 */
export function evaluateWaveAmplitude(
  notes: readonly ResolvedNote[],
  settings: WaveTerrainSettings,
  beat: number,
): number {
  const beats = Math.max(0.0001, settings.burstBeats)
  const sharpness = Math.max(0.0001, settings.sharpness)
  const { ease } = BURST_EASINGS[settings.easing] ?? BURST_EASINGS[0]
  let extra = 0
  for (const note of notes) {
    const direction = note.pitch === WAVE_TERRAIN_AMP_UP_PITCH
      ? 1
      : note.pitch === WAVE_TERRAIN_AMP_DOWN_PITCH
        ? -1
        : 0
    if (direction === 0 || note.beat > beat) continue
    const progress = Math.min(1, (beat - note.beat) / beats)
    const eased = ease(Math.pow(progress, 1 / sharpness))
    extra += direction * settings.amount * normalizedVelocity(note.velocity) * eased
  }
  return settings.amplitude + extra
}

/**
 * The ambient (always-running) wave field, before amplitude and falloff.
 * Returns a unit-range height at local coordinates (dx, dy) - the point
 * relative to the wave center - at `beat`.
 */
function ambientWave(
  settings: WaveTerrainSettings,
  dx: number,
  dy: number,
  distance: number,
  waveNumber: number,
  angularRate: number,
  beat: number,
): number {
  switch (settings.shape) {
    case SHAPE_PLANE: {
      const theta = (settings.directionDeg * Math.PI) / 180
      const along = dx * Math.cos(theta) + dy * Math.sin(theta)
      return Math.sin(waveNumber * along - angularRate * beat)
    }
    case SHAPE_STANDING:
      // A fixed membrane mode: Chladni-style checkerboard that breathes in
      // place instead of traveling (nodes never move).
      return (
        Math.sin(waveNumber * dx) * Math.sin(waveNumber * dy) * Math.cos(angularRate * beat)
      )
    case SHAPE_INTERFERENCE: {
      // Two ripple sources straddling the center along X; their sum forms the
      // classic two-source interference fringe pattern.
      const half = Math.max(0.0001, settings.separation) / 2
      const r1 = Math.hypot(dx - half, dy)
      const r2 = Math.hypot(dx + half, dy)
      return (
        (Math.sin(waveNumber * r1 - angularRate * beat) +
          Math.sin(waveNumber * r2 - angularRate * beat)) / 2
      )
    }
    case SHAPE_SWIRL: {
      // A spiral that stays ROTATIONALLY SYMMETRIC: the displacement depends
      // only on radius, never on angle - every object on a ring around the
      // center lifts by exactly the same amount. The swirl identity comes from
      // a logarithmic phase twist: instead of angular spiral arms (which break
      // rotational symmetry), the ring spacing winds tighter toward the center
      // like the grooves of a whirlpool, and the rings still expand outward
      // with the beat. twist = 0 reduces to the Ripple's even spacing.
      const twistPhase = settings.twist * Math.log(1 + distance / Math.max(0.01, settings.wavelength))
      return Math.sin(waveNumber * distance + TAU * twistPhase - angularRate * beat)
    }
    case SHAPE_RIPPLE:
    default:
      // Concentric rings expanding outward from the center.
      return Math.sin(waveNumber * distance - angularRate * beat)
  }
}

/**
 * Height of the whole wave surface at world position (x, y) and `beat`:
 * the ambient field scaled by the (MIDI-stepped) amplitude and the radial
 * falloff. Pure and closed-form: pause, scrub, playback, and export all
 * evaluate the exact same function.
 */
export function evaluateWaveHeight(
  notes: readonly ResolvedNote[],
  settings: WaveTerrainSettings,
  x: number,
  y: number,
  beat: number,
): number {
  const wavelength = Math.max(0.01, settings.wavelength)
  const waveNumber = TAU / wavelength
  const angularRate = TAU * Math.max(0, settings.cyclesPerBeat)

  const dx = x - settings.centerX
  const dy = y - settings.centerY
  const distance = Math.hypot(dx, dy)
  const damp = radialDamp(distance, settings.damping)

  const ambient = ambientWave(settings, dx, dy, distance, waveNumber, angularRate, beat)
  return evaluateWaveAmplitude(notes, settings, beat) * damp * ambient
}

export const waveTerrainMover: MoverOrSplitterDefinition<WaveTerrainSettings> = {
  id: 'waveTerrain',
  label: 'Wave Terrain',
  kind: 'mover',
  params: [
    {
      key: 'shape',
      label: 'Wave shape',
      type: 'select',
      options: WAVE_TERRAIN_SHAPES.map((label, value) => ({ value, label })),
      default: 0,
    },
    { key: 'amplitude', label: 'Amplitude', min: 0, max: 10, step: 0.05, default: 1 },
    { key: 'wavelength', label: 'Wavelength', min: 0.5, max: 40, step: 0.1, default: 8 },
    { key: 'cyclesPerBeat', label: 'Cycles / beat', min: 0, max: 8, step: 0.05, default: 0.5 },
    { key: 'damping', label: 'Falloff length', min: 0, max: 40, step: 0.1, default: 0 },
    { key: 'centerX', label: 'Center X', min: -20, max: 20, step: 0.1, default: 0 },
    { key: 'centerY', label: 'Center Y', min: -20, max: 20, step: 0.1, default: 0 },
    { key: 'directionDeg', label: 'Direction° (plane)', min: 0, max: 360, step: 1, default: 0 },
    { key: 'separation', label: 'Source separation', min: 0.5, max: 40, step: 0.1, default: 8 },
    { key: 'twist', label: 'Spiral twist', min: -8, max: 8, step: 0.25, default: 2 },
    { key: 'amount', label: 'Amplitude / note', min: 0, max: 5, step: 0.05, default: 0.5 },
    { key: 'burstBeats', label: 'Burst beats', min: 0.05, max: 16, step: 0.05, default: 1 },
    {
      key: 'easing',
      label: 'Easing',
      type: 'select',
      options: BURST_EASINGS.map((e, value) => ({ value, label: e.label })),
      default: 0,
    },
    { key: 'sharpness', label: 'Sharpness', min: 0.25, max: 4, step: 0.05, default: 1 },
  ],
  midiRows: () => [
    { pitch: WAVE_TERRAIN_AMP_UP_PITCH, label: 'Amplitude up' },
    { pitch: WAVE_TERRAIN_AMP_DOWN_PITCH, label: 'Amplitude down' },
  ],
  strictMidiRows: true,
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, { beat, placementTransform }) {
        const placedTransform = placementTransform
          ? placementTransform.clone().multiply(visualCopy.transform)
          : visualCopy.transform
        const position = new Vector3().setFromMatrixPosition(placedTransform)
        const z = evaluateWaveHeight(notes, settings, position.x, position.y, beat)

        // A flat spot preserves the copy bit-for-bit (the pause invariant).
        if (Math.abs(z) <= 1e-10) {
          return [{
            transform: visualCopy.transform.clone(),
            opacity: visualCopy.opacity,
            colorShift: { ...visualCopy.colorShift },
          }]
        }

        // WORLD composition: desiredPlaced = translation * placement * copy.
        // The wave displaces along the SCENE's Z axis, no matter how upstream
        // movers or the track placement have rotated the copy; conjugating by
        // placement turns that world-space delta back into VisualCopy space.
        const translation = new Matrix4().makeTranslation(0, 0, z)
        const transform = placementTransform
          ? placementTransform.clone().invert()
            .multiply(translation)
            .multiply(placementTransform)
            .multiply(visualCopy.transform.clone())
          : translation.multiply(visualCopy.transform.clone())
        return [{
          transform,
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    }
  },
}

import { flattenTrackNotes } from '../visual/noteFlatten'
import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { Track } from '../../types'
import type { DirectorInstrumentDef } from './types'
import { FULL_FRAME } from './types'
import { heldDirectorPitches } from './cut'
import { orderedSceneBindings } from './sceneBindings'

// Crop: a note-gated mask over ONE scene.
//
// The frame is divided into `divisions` even pieces. Each piece gets one MIDI
// row; a held note shows it, silence leaves it transparent. Every piece shows
// the SAME scene, cropped - which is what makes this a mask rather than a
// compositor. (Cut is the compositor: its pieces each show a DIFFERENT scene,
// so its rows are scenes, not slices.)
//
// Two modes, sharing both parameters:
//   * Linear - parallel bands. `angle` is the cut direction; 0 stacks them left
//     to right, 90 bottom to top, 180 right to left.
//   * Radial - wedges around the center, like cutting a pie. `angle` rotates
//     the whole pattern. (Distinct from the Radial Cut director, which makes
//     concentric RINGS rather than wedges.)
//
// Properties the mask geometry guarantees at every angle, handled in the
// partition shader rather than by parameters:
//   * Linear bands are even in width measured PERPENDICULAR to the cut, so a
//     diagonal band is as thick as an upright one, and the band span is derived
//     from the frame's extent along the cut normal, so the outermost bands
//     always reach the corners - no uncovered wedge.
//   * Radial wedges are even in angle about the aspect-corrected center, and
//     cover the frame by construction since every pixel has an angle.

export const DEFAULT_DIVISIONS = 3
export const MAX_DIVISIONS = 32
/** Slice 0 is this pitch; slice i is CROP_BASE_PITCH + i. */
export const CROP_BASE_PITCH = 60

// ── Flash ────────────────────────────────────────────────────────────────────
// Off by default. When on, a piece blows out to white as it arrives, the way a
// flash frame is cut in to make a change of image land hard.
//
// The hit is a literal flash frame - white within a few milliseconds, held a
// frame or so. The fall away from it is much longer than the hit, so the frame
// blooms and then bleeds off rather than snapping back. The attack and hold
// fractions are small precisely because the window is long: they keep the onset
// at roughly the same few milliseconds while the tail gets all the extra room.

/** Rise to full white. A flash frame is instantaneous; this exists only so the
 *  onset does not alias against the frame grid. ~5ms at the default length. */
const FLASH_ATTACK = 0.035
/** Full white is HELD until here (~13ms at the default length). The plateau is
 *  what makes it a frame rather than a spike - without it the peak lands
 *  between rendered frames and the flash reads as a flicker of random
 *  strength, different on every pass. */
const FLASH_HOLD = 0.09
/** Time constant of the falloff, as a share of the DECAY portion. */
const FLASH_DECAY = 0.55
/**
 * Falloff exponent. A plain exponential (1.0) is steepest the instant it leaves
 * the plateau, which is exactly what reads as an abrupt cutoff. Above 1 the
 * curve leaves white with ZERO slope and spends its steepness in the middle, so
 * the flash eases off the peak and then lingers - gentle at both ends.
 */
const FLASH_DECAY_SHAPE = 1.8

/** Smear length at blur = 1, in normalized frame widths. Small by design: this
 *  is a suggestion of movement at the cut, not a defocus. */
export const BLUR_MAX_DISTANCE = 0.055
/**
 * The blur rides the flash envelope raised to this power. Blur comes from
 * MOTION, which stops long before light finishes falling off, so sharing the
 * flash's long gentle tail unmodified would read as a soft-focus lens rather
 * than a smear. Cubing collapses it back onto the onset.
 */
export const BLUR_CONCENTRATION = 3

/** The param readers take any params-bearing shape (a document Track or a
 *  per-frame ObjectState slice), so the Main composition path and the in-scene
 *  mask instrument read one set of defaults. */
export interface CropParamSource {
  params?: Record<string, number>
}

export function cropDivisions(track: CropParamSource): number {
  return Math.max(1, Math.min(MAX_DIVISIONS, Math.round(track.params?.divisions ?? DEFAULT_DIVISIONS)))
}

/** Degrees, wrapped into [0, 360). Continuous with no dead zone: in linear mode
 *  180 is 0 with the slice order reversed, in radial mode it is half a turn of
 *  the wedge pattern - both free, and the natural knob for sweeps. */
export function cropAngle(track: CropParamSource): number {
  const raw = track.params?.angle ?? 0
  return ((raw % 360) + 360) % 360
}

export function cropRadial(track: CropParamSource): boolean {
  return Math.round(track.params?.mode ?? 0) === 1
}

export function cropFlash(track: CropParamSource): number {
  return Math.max(0, Math.min(1, track.params?.flash ?? 0))
}

export function cropBlur(track: CropParamSource): number {
  return Math.max(0, Math.min(1, track.params?.blur ?? 0))
}

export function cropFlashBeats(track: CropParamSource): number {
  return Math.max(0.01, track.params?.flashBeats ?? 0.3)
}

/**
 * Snap to white, hold, then fall away - normalized to a unit window and a peak
 * of exactly 1. The tail is subtracted so the envelope reaches exactly zero at
 * the end of the window; otherwise the flash is cut off mid-decay, which shows
 * up as a step on the last frame.
 */
export function cropFlashEnvelope(t: number): number {
  if (t <= 0 || t >= 1) return 0
  if (t < FLASH_ATTACK) {
    const u = t / FLASH_ATTACK
    return u * u * (3 - 2 * u)
  }
  if (t < FLASH_HOLD) return 1
  // Progress across the decay portion alone, so the shape is independent of how
  // much of the window the attack and hold happen to take.
  const u = (t - FLASH_HOLD) / (1 - FLASH_HOLD)
  const tail = Math.exp(-Math.pow(1 / FLASH_DECAY, FLASH_DECAY_SHAPE))
  return (Math.exp(-Math.pow(u / FLASH_DECAY, FLASH_DECAY_SHAPE)) - tail) / (1 - tail)
}

/** The most recent onset beat per pitch among notes covering `beat`. The flash
 *  is keyed to the cut itself, so unlike a held-pitch test this needs to know
 *  WHEN each note started, not merely that one is sounding. */
function sliceOnsetBeats(
  track: Track,
  beat: number,
  beatsPerBar: number,
  totalBars: number,
): Map<number, number> {
  const onsets = new Map<number, number>()
  for (const note of flattenTrackNotes(track, beatsPerBar, totalBars)) {
    if (beat < note.beat || beat >= note.beat + note.durationBeats) continue
    const previous = onsets.get(note.pitch)
    if (previous === undefined || note.beat > previous) onsets.set(note.pitch, note.beat)
  }
  return onsets
}

/** One schema for both crop surfaces: the Main composition def below and the
 *  in-scene mask instrument (instruments/Crop.tsx). Diverging copies would let
 *  the two panels show different ranges for the same stored keys. */
export const CROP_PARAMS: ParamDef[] = [
  { key: 'divisions', label: 'Divisions', min: 1, max: MAX_DIVISIONS, step: 1, default: DEFAULT_DIVISIONS },
  { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, default: 0 },
  {
    key: 'mode',
    label: 'Mode',
    type: 'select',
    options: [
      { value: 0, label: 'Linear bands' },
      { value: 1, label: 'Radial wedges' },
    ],
    default: 0,
  },
  { key: 'flash', label: 'Entry flash', min: 0, max: 1, step: 0.01, default: 0 },
  { key: 'flashBeats', label: 'Flash length (beats)', min: 0.05, max: 1, step: 0.01, default: 0.3 },
  { key: 'blur', label: 'Onset blur', min: 0, max: 1, step: 0.01, default: 0 },
]

/** One MIDI row per slice/wedge - shared by both crop surfaces so the piano
 *  roll reads identically wherever the crop lives. */
export function cropMidiRows(track: CropParamSource): MidiRowDef[] {
  const divisions = cropDivisions(track)
  const radial = cropRadial(track)
  return Array.from({ length: divisions }, (_, index) => ({
    pitch: CROP_BASE_PITCH + index,
    label: `${radial ? 'Wedge' : 'Slice'} ${index + 1}`,
    color: `hsl(${(index * 67) % 360}, 65%, 58%)`,
    emphasized: index === 0,
  }))
}

export const cropDirector: DirectorInstrumentDef = {
  id: 'crop',
  name: 'Crop',
  params: CROP_PARAMS,
  hideMidiRowsInSettings: true,
  targetsSingleScene: true,
  midiRows(track): MidiRowDef[] {
    return cropMidiRows(track)
  },
  resolve(track, context) {
    // Rows are slices, so the scene is not chosen by MIDI. The settings panel
    // writes the chosen scene as the single binding (targetsSingleScene), and
    // orderedSceneBindings keeps saved bindings ahead of the ones it appends to
    // self-heal, so the first entry IS the choice - falling back to the first
    // visual scene when nothing has been picked yet.
    const sceneId = orderedSceneBindings(track, context.scenes, context.sceneOrder)[0]?.sceneId
    if (!sceneId) return []
    const divisions = cropDivisions(track)
    const angle = cropAngle(track)
    const radial = cropRadial(track)
    const flash = cropFlash(track)
    const blur = cropBlur(track)
    const slices = Array.from({ length: divisions }, (_, index) => index)
    const layer = (index: number, whiteness?: number, smear?: number) => ({
      directorTrackId: track.id,
      sceneId,
      opacity: 1,
      viewport: { ...FULL_FRAME },
      partition: { kind: 'slice' as const, index, count: divisions, angle, radial },
      ...(whiteness ? { flash: whiteness } : {}),
      ...(smear ? { blur: smear } : {}),
    })

    // With no onset effects this is the plain gate: a piece is on while its
    // note is held, and nothing extra is attached to the layer.
    if (flash <= 0 && blur <= 0) {
      const heldPitches = heldDirectorPitches(track, context.beat, context.beatsPerBar, context.totalBars)
      return slices.filter((index) => heldPitches.has(CROP_BASE_PITCH + index)).map((index) => layer(index))
    }

    const duration = cropFlashBeats(track)
    const onsets = sliceOnsetBeats(track, context.beat, context.beatsPerBar, context.totalBars)
    return slices.flatMap((index) => {
      const start = onsets.get(CROP_BASE_PITCH + index)
      if (start === undefined) return []
      const envelope = cropFlashEnvelope((context.beat - start) / duration)
      return [layer(
        index,
        envelope * flash,
        Math.pow(envelope, BLUR_CONCENTRATION) * blur * BLUR_MAX_DISTANCE,
      )]
    })
  },
}

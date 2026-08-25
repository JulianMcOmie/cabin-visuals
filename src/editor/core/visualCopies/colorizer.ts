// The Colorizer: every note is a COLOR EVENT. Six rows, two kinds of event.
//
// FLASH (five rows, one per color slot) pulls the objects toward an absolute
// colour - a palette you PLAY, so a phrase can move through gold, magenta and
// mint without automating a single knob. RAINBOW (its own row) sweeps hue
// across them instead: a travelling wave whose phase comes from each copy's
// position along the XY diagonal and advances rapidly with the beat, so a field
// of objects reads as a band of colour running corner to corner. The two
// compose - hold both and the objects flash to the chosen colour and then sweep
// the wheel from there - because the flash writes the absolute `tint` channel
// while the rainbow writes the relative `hue` one.
//
// Two flash rows at once BLEND rather than fight: each contributes its colour
// weighted by its own envelope x velocity, averaged in OKLab, so a two-note
// chord lands on the colour between them and releasing one crossfades into the
// other. The overall STRENGTH stays the loudest row's rather than the sum -
// two flashes at once are still one flash, and summing would blow past the
// colour the user picked.
//
// Every row is shaped by the same envelope, so all of them inherit the same
// range of character: a short note with no attack and a fast release is a
// percussive hit synced to a snare's amplitude curve, while a held note with a
// slow attack is a sustained wash. There is no mode switch, because the
// difference between the two IS the envelope plus the note length already
// written on the timeline.
//
// The COLOR is absolute, not an offset: a mover never sees the object's own
// color, so it travels as `colorShift.tint` + `tintAmount` and gets mixed where
// the source IS known (core/visual/instrumentColor.ts). That is the whole
// reason the VisualCopy contract carries a tint at all - "flash this gold"
// cannot be said in relative HSL.
//
// That mix defaults to PERCEPTUAL (`tintPerceptual`), which is what makes a
// flash land on the colour you picked. The flash lives at partial strength
// nearly all the time - INTENSITY scales it, the envelope ramps it, velocity
// scales it again - and a straight channel lerp at partial strength sags
// through a desaturated middle, so the object reads as washed out rather than
// as the colour. LINEAR is kept as an option because it is what every project
// authored before this was written already looks like.

import { Vector3 } from 'three'
import type { MidiRowDef, ParamDef } from '../../instruments/types'
import { colorToOklch, oklchToHex } from '../../utils/oklch'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'

/** One row per function, so every declared note has a meaning the user can read
 *  off the piano roll instead of guessing at a keyboard. */
export const COLORIZER_FLASH_PITCH = 60
export const COLORIZER_RAINBOW_PITCH = 61

export const SHAPE_SPIKE = 0
export const SHAPE_EVEN = 1
export const SHAPE_SWELL = 2

/** How the flash walks from the object's own color to the picked one. */
export const BLEND_PERCEPTUAL = 0
export const BLEND_LINEAR = 1

/** When the notes are read. LIVE is every colorizer ever saved: the copy shows
 *  what is sounding right now. AT BIRTH reads the lane at the copy's
 *  `birthBeat` instead (the latch clock a Stagger above publishes - see
 *  MoverOrSplitterContext), so each copy KEEPS the color its note said the
 *  moment it was born, frozen for its whole flight - one note per birth is a
 *  sequence of copy identities. Without an emitter above there is no birth to
 *  latch, and the mode falls back to LIVE rather than going dark.
 *
 *  Latching asks which note OWNS the birth - onset ≤ birth < note end - and
 *  deliberately ignores the attack/release envelope. The envelope shapes live
 *  flashes; a latched copy holds a constant, and a release tail bleeding past
 *  a note's end would otherwise tint every birth on the next note's downbeat
 *  with a 50/50 blend of the outgoing and incoming colors (births and note
 *  boundaries land on the same grid whenever the user quantizes, so that is
 *  the COMMON case, not a corner). Velocity still scales the latched
 *  strength; chords across rows still blend, exactly as live overlaps do. */
export const SAMPLE_LIVE = 0
export const SAMPLE_AT_BIRTH = 1

/** The color slots, in panel and piano-roll order.
 *
 * Pitch 60 and the un-suffixed `color` key are the ORIGINAL single flash row,
 * kept exactly where they were: every project saved before the palette existed
 * keeps its notes and its color without a migration. The four added slots take
 * 62-65 because 61 was already spoken for by the rainbow - which is why the
 * pitches are not contiguous and the row ORDER below is not pitch order. Rows
 * render in the order this array gives them (generateInstrumentRows does not
 * sort), so the five colors sit together with the rainbow underneath.
 */
export interface ColorizerFlashSlot {
  pitch: number
  /** The settings key holding this slot's color. */
  key: 'color' | 'color2' | 'color3' | 'color4' | 'color5'
  label: string
}

export const COLORIZER_FLASH_SLOTS: readonly ColorizerFlashSlot[] = [
  { pitch: COLORIZER_FLASH_PITCH, key: 'color', label: 'Color 1' },
  { pitch: 62, key: 'color2', label: 'Color 2' },
  { pitch: 63, key: 'color3', label: 'Color 3' },
  { pitch: 64, key: 'color4', label: 'Color 4' },
  { pitch: 65, key: 'color5', label: 'Color 5' },
]

/** The shipped palette. Five hues that stay distinct at a glance on a dark
 *  stage and read as one set rather than as five unrelated picks: a warm gold,
 *  a hot pink, a green, a cyan and a violet, all at a similar chroma so no one
 *  slot shouts over the others. Every slot is editable - these are starting
 *  values, not a fixed palette. */
const SLOT_DEFAULT_COLORS = ['#ffd166', '#ef476f', '#06d6a0', '#4cc9f0', '#b5179e']

export interface ColorizerSettings {
  /** How far toward `color` a full-strength event pulls, 0..1. */
  intensity: number
  /** Attack in beats. 0 = the event lands full-strength on the exact beat. */
  attackBeats: number
  /** Release in beats after note-off - the tail. This is the "sound curve". */
  releaseBeats: number
  /** Beats of delay added per upstream copy index, so one hit rolls across a
   *  split as a wave. Negative rolls the other way. */
  staggerBeats: number
  /** The color slot-1 events flash toward, '#rrggbb'. The un-suffixed name is
   *  the original single-color key, kept for saved projects. */
  color: string
  /** Color slots 2-5, one per added flash row. */
  color2: string
  color3: string
  color4: string
  color5: string
  /** BLEND_PERCEPTUAL or BLEND_LINEAR - how the mix toward the color walks. */
  blend: number
  /** SAMPLE_LIVE or SAMPLE_AT_BIRTH - when the notes are read (see above). */
  sample: number
  /** Which curve the envelope's ramps bend along (SHAPE_* above). */
  shape: number
  /** Rainbow row: turns of hue per beat. This is the "rapid fire" - the whole
   *  wheel several times a beat at the top of the range. */
  rainbowRate: number
  /** Rainbow row: turns of hue per world unit along the diagonal. This is what
   *  makes it a SWEEP across the objects rather than every copy flickering the
   *  same colour at the same instant. */
  rainbowSpread: number
}

const COLORIZER_PARAMS: ParamDef[] = [
  { key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.75 },
  { key: 'attackBeats', label: 'Attack', min: 0, max: 4, step: 0.01, default: 0, curve: 2 },
  { key: 'releaseBeats', label: 'Release', min: 0, max: 8, step: 0.01, default: 0.35, curve: 2 },
  { key: 'staggerBeats', label: 'Stagger / copy', min: -0.5, max: 0.5, step: 0.01, default: 0 },
  { key: 'rainbowRate', label: 'Rainbow rate (turns / beat)', min: 0, max: 8, step: 0.05, default: 3 },
  { key: 'rainbowSpread', label: 'Rainbow spread (turns / unit)', min: -1, max: 1, step: 0.01, default: 0.12 },
  ...COLORIZER_FLASH_SLOTS.map((slot, index): ParamDef => ({
    key: slot.key,
    label: slot.label,
    type: 'color',
    default: SLOT_DEFAULT_COLORS[index],
  })),
  {
    key: 'blend',
    label: 'Mix',
    type: 'select',
    options: [
      { value: BLEND_PERCEPTUAL, label: 'Perceptual' },
      { value: BLEND_LINEAR, label: 'Linear' },
    ],
    default: BLEND_PERCEPTUAL,
  },
  {
    key: 'shape',
    label: 'Shape',
    type: 'select',
    options: [
      { value: SHAPE_SPIKE, label: 'Spike' },
      { value: SHAPE_EVEN, label: 'Even' },
      { value: SHAPE_SWELL, label: 'Swell' },
    ],
    default: SHAPE_SPIKE,
  },
  {
    key: 'sample',
    label: 'Sample',
    type: 'select',
    // 'Born' rather than 'At birth': the label is what the console's word
    // segments render (four characters), and "the copy shows the color it was
    // born with" is the sentence the word comes from.
    options: [
      { value: SAMPLE_LIVE, label: 'Live' },
      { value: SAMPLE_AT_BIRTH, label: 'Born' },
    ],
    default: SAMPLE_LIVE,
  },
]

/** Rows carry their own live color, so the piano roll IS the palette: the notes
 *  on row 3 are drawn in slot 3's color, and repainting a slot repaints its
 *  notes. That is the whole reason midiRows takes settings. */
function colorizerRows(settings: ColorizerSettings): MidiRowDef[] {
  return [
    ...COLORIZER_FLASH_SLOTS.map((slot, index) => ({
      pitch: slot.pitch,
      label: slot.label,
      color: settings[slot.key],
      // Slot 1 is the row a Colorizer added before the palette existed already
      // has notes on, and the one a new user should reach for first.
      emphasized: index === 0,
    })),
    { pitch: COLORIZER_RAINBOW_PITCH, label: 'Rainbow sweep' },
  ]
}

/**
 * Where a copy sits along the rainbow's diagonal axis, in world units.
 *
 * The sweep runs across the XY diagonal - up-and-right is "later" in the
 * rainbow - so a grid of copies reads as a band of colour travelling corner to
 * corner rather than in rows or columns. Multiplying by SQRT1_2 keeps it a true
 * distance along that 45-degree axis, so SPREAD means the same thing whichever
 * way the objects happen to be laid out.
 */
export function rainbowDiagonal(x: number, y: number): number {
  return (x + y) * Math.SQRT1_2
}

function normalizedVelocity(velocity: number): number {
  return Math.max(0, Math.min(1, velocity <= 1 ? velocity : velocity / 127))
}

/** Only SWELL softens the onset. SPIKE and EVEN rise linearly so that a
 *  zero-attack note lands on its beat at full intensity with no lead-in. */
function attackRamp(progress: number, shape: number): number {
  return shape === SHAPE_SWELL ? progress * progress : progress
}

/** The release curve is what sells the character. SPIKE drops off a cliff and
 *  rings out in a long tail (a struck drum's amplitude envelope), EVEN fades
 *  linearly, SWELL hangs near full and then falls away (a pad releasing). */
function releaseRamp(remaining: number, shape: number): number {
  if (shape === SHAPE_EVEN) return remaining
  if (shape === SHAPE_SWELL) return remaining * remaining * (3 - 2 * remaining)
  return remaining * remaining * remaining
}

/** One note's envelope at `beat`, in 0..1: attack, hold while the note is
 *  held, release. Deliberately no decay/sustain pair - the two knobs plus the
 *  written note length already span snare to pad, and a four-stage ADSR here
 *  would just be four knobs that all look the same on a 16th note. */
export function evaluateNoteEnvelope(
  note: ResolvedNote,
  beat: number,
  attackBeats: number,
  releaseBeats: number,
  shape: number,
): number {
  const age = beat - note.beat
  if (age < 0) return 0
  const attack = Math.max(0, attackBeats)
  const release = Math.max(0, releaseBeats)
  // A zero-length percussive note still completes its attack: the hold floor is
  // the attack itself, so ATTACK is never truncated by how short the note is.
  const hold = Math.max(Math.max(0, note.durationBeats), attack)
  if (age < attack) return attackRamp(age / attack, shape)
  if (age < hold) return 1
  if (release <= 0) return 0
  const remaining = 1 - (age - hold) / release
  return remaining <= 0 ? 0 : releaseRamp(remaining, shape)
}

export interface ColorizerOutput {
  /** How far toward the settings color to pull this copy right now, 0..1. */
  tintAmount: number
  /**
   * Hue rotation for this copy, in normalized turns - the rainbow row's output.
   *
   * Deliberately a RELATIVE hue offset rather than the flash's absolute tint:
   * a rainbow is a rotation *of whatever the object already is*, so it composes
   * with the flash instead of fighting it. Hold both rows and the object flashes
   * to the chosen colour and then sweeps the wheel from there.
   */
  hue: number
  /**
   * The loudest sounding note's envelope x velocity, in 0..1 - the event's own
   * "sound curve" before INTENSITY scales it. The chain ignores this (only
   * tintAmount reaches a VisualCopy); it is exposed so the settings panel can
   * draw the curve from the same evaluation the stage runs, rather than from
   * its own re-derivation of the envelope.
   */
  envelope: number
  /**
   * The color to flash toward right now, '#rrggbb', or null when nothing is
   * sounding. Usually one slot's own color verbatim; a blend of the sounding
   * slots when more than one is.
   */
  tint: string | null
}

const NO_OUTPUT: ColorizerOutput = { tintAmount: 0, hue: 0, envelope: 0, tint: null }

/**
 * One slot's color, pre-parsed into OKLab for blending.
 *
 * Parsing five hex strings is nothing once, and real work once per copy per
 * frame with a stagger across a hundred-copy field - so `resolve()` does it
 * when the settings change and hands the result down. `hex` is kept alongside
 * so the overwhelmingly common single-slot case can return the user's exact
 * string without a round trip through the color math.
 */
export interface ColorizerSlotColor {
  hex: string
  l: number
  a: number
  b: number
}

export type ColorizerPalette = readonly (ColorizerSlotColor | null)[]

/** The five slot colors in OKLab. Unparseable entries become null and drop out
 *  of the blend rather than dragging it toward black. */
export function colorizerPalette(settings: ColorizerSettings): ColorizerPalette {
  return COLORIZER_FLASH_SLOTS.map((slot) => {
    const oklch = colorToOklch(settings[slot.key])
    if (!oklch) return null
    const hr = (oklch.h * Math.PI) / 180
    // Polar hue cannot be averaged directly (350 deg and 10 deg average to 180,
    // the opposite color), so the blend runs on the Cartesian a/b pair, where
    // the short way round falls out for free and a grey - which has no hue to
    // contribute - simply contributes nothing.
    return { hex: settings[slot.key], l: oklch.l, a: oklch.c * Math.cos(hr), b: oklch.c * Math.sin(hr) }
  })
}

/**
 * The colorizer's output for one copy at one beat.
 *
 * Overlapping notes on ONE row take the loudest rather than summing: two
 * flashes at once are still one flash, and a sum would blow past the color the
 * user picked. Notes on DIFFERENT rows blend - each row's color weighted by its
 * own gain - while the strength stays the loudest row's, for the same reason.
 * Velocity scales the event because dynamics are what a flash is *for* - a
 * ghost note should barely tint, a rimshot should land the full color.
 *
 * `palette` is the pre-parsed slot colors; omit it and it is derived, which is
 * fine for a one-off call but not for a per-copy loop.
 */
export function evaluateColorizer(
  notes: readonly ResolvedNote[],
  settings: ColorizerSettings,
  beat: number,
  index = 0,
  diagonal = 0,
  palette: ColorizerPalette = colorizerPalette(settings),
  latched = false,
): ColorizerOutput {
  // STAGGER is a per-copy time offset, so the copy simply looks at a slightly
  // earlier (or later) point in the same performance. Everything downstream -
  // envelope, velocity - rolls with it for free.
  const localBeat = beat - settings.staggerBeats * Math.max(0, Math.floor(index))

  // The latch's ownership gate (see SAMPLE_AT_BIRTH): a note owns its half-open
  // span, so a birth landing exactly on a boundary belongs to the INCOMING note
  // alone. A zero-length note owns exactly its onset instant.
  const noteOwnsBeat = (note: ResolvedNote): boolean => (
    note.durationBeats > 0
      ? localBeat >= note.beat && localBeat < note.beat + note.durationBeats
      : localBeat === note.beat
  )

  // Per-slot gain, so the sounding rows can be weighed against each other. A
  // fixed-length scratch array would have to be closure- or module-scoped to
  // pay off, and this function is called from the panel and the tests as well
  // as the stage; five numbers is not the cost worth that entanglement.
  const slotGains = [0, 0, 0, 0, 0]
  let gainPeak = 0
  let soundingSlots = 0
  let loudestSlot = -1
  // The rainbow tracks the loudest sounding note's AGE, not the absolute beat:
  // the sweep starts from hue zero when you play it, so playing the same note
  // twice looks the same both times instead of landing on whatever phase the
  // timeline happened to be at.
  let rainbowGain = 0
  let rainbowAge = 0
  for (const note of notes) {
    if (note.pitch === COLORIZER_RAINBOW_PITCH) {
      const envelope = latched
        ? (noteOwnsBeat(note) ? 1 : 0)
        : evaluateNoteEnvelope(note, localBeat, settings.attackBeats, settings.releaseBeats, settings.shape)
      if (envelope <= 0) continue
      const gain = envelope * normalizedVelocity(note.velocity)
      if (gain > rainbowGain) {
        rainbowGain = gain
        rainbowAge = localBeat - note.beat
      }
      continue
    }
    const slot = COLORIZER_FLASH_SLOTS.findIndex((s) => s.pitch === note.pitch)
    if (slot < 0) continue
    const envelope = latched
      ? (noteOwnsBeat(note) ? 1 : 0)
      : evaluateNoteEnvelope(note, localBeat, settings.attackBeats, settings.releaseBeats, settings.shape)
    if (envelope <= 0) continue
    const gain = envelope * normalizedVelocity(note.velocity)
    if (gain <= slotGains[slot]) continue
    if (slotGains[slot] === 0) soundingSlots++
    slotGains[slot] = gain
    if (gain > gainPeak) {
      gainPeak = gain
      loudestSlot = slot
    }
  }
  if (gainPeak <= 0 && rainbowGain <= 0) return NO_OUTPUT

  // Position sets the phase, time advances it: the same travelling-wave shape a
  // chase light has. Scaling by the gain means the sweep fades in and out with
  // the envelope instead of snapping on and popping off.
  const hue = rainbowGain > 0
    ? (rainbowAge * settings.rainbowRate + diagonal * settings.rainbowSpread) * rainbowGain
    : 0

  return {
    tintAmount: Math.max(0, Math.min(1, settings.intensity)) * gainPeak,
    hue,
    envelope: Math.max(gainPeak, rainbowGain),
    tint: blendSlotColors(palette, slotGains, soundingSlots, loudestSlot),
  }
}

/**
 * The sounding slots' colors, averaged in OKLab by gain.
 *
 * One slot sounding - which is nearly always - returns that slot's hex
 * untouched: no parse, no conversion, and the color the user typed reaches the
 * instrument character for character. Only a genuine chord pays for the blend.
 */
function blendSlotColors(
  palette: ColorizerPalette,
  slotGains: readonly number[],
  soundingSlots: number,
  loudestSlot: number,
): string | null {
  if (loudestSlot < 0) return null
  if (soundingSlots <= 1) return palette[loudestSlot]?.hex ?? null

  let weight = 0
  let l = 0
  let a = 0
  let b = 0
  for (let slot = 0; slot < slotGains.length; slot++) {
    const gain = slotGains[slot]
    const color = palette[slot]
    if (gain <= 0 || !color) continue
    weight += gain
    l += color.l * gain
    a += color.a * gain
    b += color.b * gain
  }
  if (weight <= 0) return palette[loudestSlot]?.hex ?? null
  l /= weight
  a /= weight
  b /= weight
  return oklchToHex(l, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI)
}

/**
 * The id stays `calmHueRotate` because it is the persistence key for every
 * saved mover row (see the registry note in CLAUDE.md); only the label and the
 * params changed. Stale values left in old saves merge through harmlessly.
 */
export const noteColorizer: MoverOrSplitterDefinition<ColorizerSettings> = {
  id: 'calmHueRotate',
  label: 'Colorizer',
  kind: 'colorizer',
  params: COLORIZER_PARAMS,
  // The device wears slot 1. It is the palette's primary, the panel's accent
  // and the row a Colorizer's notes land on by default, so following it makes
  // the whole colorizer - device row, notes, panel - one colour.
  identityColor: { param: 'color' },
  midiRows: colorizerRows,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    // Closure-scoped scratch: apply() runs once per copy per frame, and the
    // rainbow only needs a position, so this avoids cloning a Matrix4 per copy
    // the way the world-space movers do.
    const scratchPosition = new Vector3()
    // Settings are fixed for the life of this closure (automation re-resolves),
    // so the palette is parsed once here rather than per copy per frame.
    const palette = colorizerPalette(settings)
    const perceptual = settings.blend !== BLEND_LINEAR
    const latch = settings.sample === SAMPLE_AT_BIRTH
    return {
      apply(visualCopy, { beat, index, placementTransform, birthBeat }) {
        // The copy's WORLD position. (P * T)'s translation column is P applied
        // to T's translation, so transforming the point is equivalent to
        // building the product matrix - and cheaper.
        scratchPosition.setFromMatrixPosition(visualCopy.transform)
        if (placementTransform) scratchPosition.applyMatrix4(placementTransform)
        const diagonal = rainbowDiagonal(scratchPosition.x, scratchPosition.y)
        // AT BIRTH evaluates at the copy's birth instant with the ownership
        // gate in place of the envelope (see SAMPLE_AT_BIRTH): the note whose
        // span holds the birth colors the copy for its whole flight, at its
        // velocity's strength; nothing owning it is honest silence. No birth
        // above = LIVE fallback.
        const latching = latch && birthBeat !== undefined
        const output = evaluateColorizer(
          notes, settings, latching ? birthBeat : beat, index, diagonal, palette, latching,
        )
        return [{
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity,
          colorShift: {
            ...visualCopy.colorShift,
            hue: visualCopy.colorShift.hue + output.hue,
            // Silence leaves whatever is upstream alone rather than clearing
            // it: not flashing is not the same as asking for no color.
            ...(output.tintAmount > 0 && output.tint
              ? { tint: output.tint, tintAmount: output.tintAmount, tintPerceptual: perceptual }
              : null),
          },
        }]
      },
    }
  },
}

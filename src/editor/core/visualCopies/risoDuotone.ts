// Riso Duotone: the copies are a two-ink print.
//
// A risograph lays one ink at a time through a screen, so it cannot mix a
// colour - it can only decide, per dot, whether that ink lands. Two screens and
// a sheet of paper therefore give exactly FOUR outcomes, and everything this
// colorizer does is choose between them per copy:
//
//     paper          neither ink landed
//     paper x A      ink A only
//     paper x B      ink B only
//     paper x A x B  the OVERPRINT - the colour neither ink can make alone
//
// The overprint is the whole reason the look is rich rather than flat: fluoro
// pink over federal blue is a deep violet nothing on the palette contains. Inks
// are semi-transparent, so they compose by MULTIPLY (subtractive), not by
// blending - `overprint()` below.
//
// Where the Gradient paints a continuous ramp and the Cosine Palette a periodic
// one, this one QUANTIZES: a tone ramp across the formation becomes ink
// coverage, and an ordered (Bayer) dither turns coverage into a per-copy yes/no.
// That is what keeps a two-colour print from banding into two solid halves -
// the mid-tones read as a stipple of both inks, exactly as a halftone screen
// reads as grey from across the room. The dither is DETERMINISTIC (a matrix,
// not a random draw), which is what makes it a pure function of the copy rather
// than something that would crawl between frames.
//
// Passive, like the Gradient: no notes, no envelope. TONE is the automation
// target - sweeping it develops the print, ink coming up out of the paper across
// the whole formation.
//
// Each copy's colour travels as the ABSOLUTE `tint` channel, like the other
// colorizers: "be this ink" is not something relative HSL can say. Chain rule as
// ever - a later tint (a note Colorizer's flash) takes the colour over.

import { Vector3 } from 'three'
import type { ParamDef } from '../../instruments/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { RISO_DUOTONE_COLOR } from './identityColors'
import type { VisualCopy } from './types'

/** Which scalar of the copy's placement becomes the tone ramp. Deliberately the
 *  Cosine Palette's vocabulary, value for value: two colorizers asking "where
 *  does this copy sit" should not have two different answers. */
export const RISO_MAP_X = 0
export const RISO_MAP_Y = 1
export const RISO_MAP_RADIAL = 2
export const RISO_MAP_SPHERICAL = 3
export const RISO_MAP_DEPTH = 4
export const RISO_MAP_INDEX = 5

/** How the yes/no per ink is decided. */
export const RISO_DITHER_GRID = 0
export const RISO_DITHER_SEQUENCE = 1
export const RISO_DITHER_OFF = 2

/** How the tint mix walks at partial AMOUNT - same pair as the other colorizers. */
export const RISO_BLEND_PERCEPTUAL = 0
export const RISO_BLEND_LINEAR = 1

export interface RisoDuotoneSettings {
  /** The two inks and the stock, '#rrggbb'. */
  inkA: string
  inkB: string
  paper: string
  /** RISO_MAP_*: which scalar of the copy's position becomes the tone ramp. */
  mode: number
  /** Position modes: world units across the full tone ramp. */
  span: number
  /** Position modes: world units the ramp's zero slides along its axis. */
  offset: number
  /** 0 = A rides the light end, 1 = B does. The Gradient's flip button. */
  flip: number
  /** Master exposure, added to every copy's tone. THE automation target:
   *  sweeping it runs the whole formation from bare paper to full coverage. */
  tone: number
  /** Total ink on the sheet, added to BOTH coverages. Above zero the inks
   *  overlap and the overprint appears; below zero they part and paper shows
   *  through the middle. Zero is the complementary separation. */
  ink: number
  /** RISO_DITHER_*: what the coverage is thresholded against. */
  dither: number
  /** Grid dither: world units per dither cell. */
  grain: number
  /** How far toward the printed color each copy pulls, 0..1. */
  amount: number
  /** RISO_BLEND_PERCEPTUAL or RISO_BLEND_LINEAR. */
  blend: number
}

const RISO_PARAMS: ParamDef[] = [
  // Fluoro Pink 806U over Federal Blue on warm stock: the iconic zine pairing,
  // and the one whose overprint is most obviously a third colour.
  { key: 'inkA', label: 'Ink A', type: 'color', default: '#ff48b0' },
  { key: 'inkB', label: 'Ink B', type: 'color', default: '#3d5588' },
  { key: 'paper', label: 'Paper', type: 'color', default: '#f5f1e6' },
  {
    key: 'mode',
    label: 'Map',
    type: 'select',
    options: [
      { value: RISO_MAP_X, label: 'X' },
      { value: RISO_MAP_Y, label: 'Y' },
      { value: RISO_MAP_RADIAL, label: 'Radial' },
      { value: RISO_MAP_SPHERICAL, label: 'Spherical' },
      { value: RISO_MAP_DEPTH, label: 'Depth' },
      { value: RISO_MAP_INDEX, label: 'Copy index' },
    ],
    default: RISO_MAP_RADIAL,
  },
  { key: 'span', label: 'Span (units)', min: 0.25, max: 40, step: 0.25, default: 6, curve: 2 },
  { key: 'offset', label: 'Offset (units)', min: -20, max: 20, step: 0.1, default: 0 },
  {
    key: 'flip',
    label: 'Direction',
    type: 'select',
    options: [
      { value: 0, label: 'A → B' },
      { value: 1, label: 'B → A' },
    ],
    default: 0,
  },
  { key: 'tone', label: 'Tone', min: -1, max: 1, step: 0.01, default: 0 },
  { key: 'ink', label: 'Ink', min: -0.5, max: 0.5, step: 0.01, default: 0.12 },
  {
    key: 'dither',
    label: 'Screen',
    type: 'select',
    options: [
      { value: RISO_DITHER_GRID, label: 'Grid' },
      { value: RISO_DITHER_SEQUENCE, label: 'Sequence' },
      { value: RISO_DITHER_OFF, label: 'Off' },
    ],
    default: RISO_DITHER_GRID,
  },
  { key: 'grain', label: 'Grain (units)', min: 0.1, max: 8, step: 0.05, default: 1, curve: 2 },
  { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
  {
    key: 'blend',
    label: 'Mix',
    type: 'select',
    options: [
      { value: RISO_BLEND_PERCEPTUAL, label: 'Perceptual' },
      { value: RISO_BLEND_LINEAR, label: 'Linear' },
    ],
    default: RISO_BLEND_PERCEPTUAL,
  },
]

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/**
 * The 8x8 ordered (Bayer) matrix, the classic print screen: thresholds spread
 * so that any coverage level lands its dots as far apart as possible. A random
 * threshold gives clumps and noise; this gives the even stipple that reads as a
 * tone. Values 0..63; `screenThreshold` recentres them into (0,1).
 */
const BAYER_8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
] as const

const wrap8 = (value: number) => ((Math.round(value) % 8) + 8) % 8

/** The matrix entry for a cell, in (0,1). The +0.5 is what keeps coverage 0
 *  fully blank and coverage 1 fully inked - thresholds at exactly 0 or 1 would
 *  make one of the two ends leak a dot. */
export function screenThreshold(cellX: number, cellY: number): number {
  return (BAYER_8[wrap8(cellY) * 8 + wrap8(cellX)] + 0.5) / 64
}

/**
 * Where one copy sits on the tone ramp, 0..1 (0 = ink B's end, 1 = ink A's).
 *
 * CLAMPED, not periodic - a print is a fill, so past either end is simply the
 * end (the Gradient's convention; the Cosine Palette wraps instead because its
 * palette is periodic by construction). The signed axes (X, Y, Depth) put their
 * zero at the MIDDLE of the ramp the way a gradient fill does; the distance
 * modes (Radial, Spherical) start their ramp at the chain origin, since there
 * is no negative distance to leave room for.
 *
 * TONE is added before the clamp, so it can push the whole formation past
 * either end - "fully inked" and "bare paper" are both reachable from any map.
 */
export function risoTone(
  settings: RisoDuotoneSettings,
  index: number,
  count: number,
  x: number,
  y: number,
  z: number,
): number {
  const span = Math.max(0.001, settings.span)
  let t: number
  switch (settings.mode) {
    case RISO_MAP_INDEX: t = count > 1 ? index / (count - 1) : 0.5; break
    case RISO_MAP_X: t = 0.5 + (x - settings.offset) / span; break
    case RISO_MAP_Y: t = 0.5 + (y - settings.offset) / span; break
    case RISO_MAP_DEPTH: t = 0.5 + (z - settings.offset) / span; break
    case RISO_MAP_SPHERICAL: t = (Math.hypot(x, y, z) - settings.offset) / span; break
    default: t = (Math.hypot(x, y) - settings.offset) / span; break
  }
  if (settings.flip >= 0.5) t = 1 - t
  return clamp01(t + settings.tone)
}

/**
 * The two inks' coverage at a tone, each 0..1.
 *
 * At INK zero they are exact complements (`covA + covB = 1`): every copy takes
 * one ink or the other and the sheet is fully covered. INK opens that up in
 * both directions - positive floods both screens so the middle of the ramp
 * takes BOTH inks (the overprint band), negative starves them so the middle
 * takes neither and the paper shows through. One knob, because "more ink" and
 * "more overprint" are the same physical act.
 */
export function risoCoverage(tone: number, ink: number): [number, number] {
  return [clamp01(tone + ink), clamp01(1 - tone + ink)]
}

/** Two inks on a sheet MULTIPLY - they are filters, not lights. Done per sRGB
 *  channel, which is what every print-preview tool means by "multiply"; going
 *  through linear light darkens the overprint well past what a riso actually
 *  puts on paper. Unparseable input degrades to the other operand rather than
 *  throwing, so a half-typed hex in the picker never blanks the stage. */
export function overprint(base: string, ink: string): string {
  const a = parseHex(base)
  const b = parseHex(ink)
  if (!a) return ink
  if (!b) return base
  return '#' + a.map((channel, i) => byteHex((channel * b[i]) / 255)).join('')
}

function parseHex(color: string): [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return null
  return [
    parseInt(color.slice(1, 3), 16),
    parseInt(color.slice(3, 5), 16),
    parseInt(color.slice(5, 7), 16),
  ]
}

const byteHex = (value: number) =>
  Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')

/**
 * The four printable colors, in the order `(onA ? 1 : 0) | (onB ? 2 : 0)`
 * indexes them: paper, A, B, overprint.
 *
 * Exported so a settings panel can show the real four-swatch result - the whole
 * point of a duotone is the colour you did NOT pick, and a panel that only
 * showed the two ink pickers would hide it.
 */
export function risoInks(settings: RisoDuotoneSettings): [string, string, string, string] {
  const paper = settings.paper
  const withA = overprint(paper, settings.inkA)
  const withB = overprint(paper, settings.inkB)
  return [paper, withA, withB, overprint(withA, settings.inkB)]
}

export const risoDuotoneColorizer: MoverOrSplitterDefinition<RisoDuotoneSettings> = {
  id: 'riso',
  label: 'Riso Duotone',
  kind: 'colorizer',
  identityColor: RISO_DUOTONE_COLOR,
  params: RISO_PARAMS,
  // Passive on purpose, like the Gradient: a print does not flash. Movement
  // comes from an automation lane on TONE.
  midiRows: () => [],
  strictMidiRows: true,
  resolve({ settings }) {
    // Only four colors can come out of this, and they are fixed per resolve -
    // so the per-frame work per copy is one tone, two thresholds and an index.
    // No color math and no string building while a 32x32 grid animates.
    const inks = risoInks(settings)
    const amount = clamp01(settings.amount)
    const perceptual = settings.blend !== RISO_BLEND_LINEAR
    const grain = Math.max(0.001, settings.grain)
    const scratchPosition = new Vector3()
    return {
      apply(visualCopy, { index, count, placementTransform }) {
        // AMOUNT zero leaves upstream color state alone entirely - "no print"
        // must not clear a tint another colorizer asked for.
        if (amount <= 0) {
          const passthrough: VisualCopy = {
            transform: visualCopy.transform.clone(),
            opacity: visualCopy.opacity,
            colorShift: { ...visualCopy.colorShift },
          }
          return [passthrough]
        }
        // World position, the same read as the other colorizers: the chained
        // transform's translation pushed through the track placement.
        scratchPosition.setFromMatrixPosition(visualCopy.transform)
        if (placementTransform) scratchPosition.applyMatrix4(placementTransform)
        const tone = risoTone(
          settings, index, count, scratchPosition.x, scratchPosition.y, scratchPosition.z,
        )
        const [coverageA, coverageB] = risoCoverage(tone, settings.ink)

        // The two screens must not agree, or the inks would land on exactly the
        // same copies and the overprint would be the only thing you ever see.
        // A real press turns the second screen to a different angle; here the
        // second read is offset within the matrix, which decorrelates the two
        // the same way. Grid dithers by WHERE the copy is (a lattice gets a real
        // stipple across it); Sequence dithers by the copy's index, which is the
        // only handle a ring or a trail gives you; Off thresholds at the middle,
        // for a hard two-tone poster.
        let thresholdA = 0.5
        let thresholdB = 0.5
        if (settings.dither === RISO_DITHER_GRID) {
          const cellX = scratchPosition.x / grain
          const cellY = scratchPosition.y / grain
          thresholdA = screenThreshold(cellX, cellY)
          thresholdB = screenThreshold(cellX + 3, cellY + 5)
        } else if (settings.dither === RISO_DITHER_SEQUENCE) {
          thresholdA = screenThreshold(index, Math.floor(index / 8))
          thresholdB = screenThreshold(index + 3, Math.floor(index / 8) + 5)
        }

        // A ties on >=, B on >, so a copy landing EXACTLY on its threshold takes
        // one ink rather than none. Not pedantry: at INK zero the coverages are
        // complements, so the middle of any odd-numbered copy run sits at
        // exactly 0.5 against the unscreened 0.5 - and a symmetric comparison
        // leaves that one copy bare paper (or, with >=, a lone overprint) in the
        // middle of an otherwise clean two-tone split.
        const printed = inks[(coverageA >= thresholdA ? 1 : 0) | (coverageB > thresholdB ? 2 : 0)]
        return [{
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity,
          colorShift: {
            ...visualCopy.colorShift,
            // Tint REPLACES upstream (the chain rule): the press owns the
            // color; relative hue/sat/lightness continue to ride on top.
            tint: printed,
            tintAmount: amount,
            tintPerceptual: perceptual,
          },
        }]
      },
    }
  },
}

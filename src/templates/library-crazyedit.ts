import { doc, track, block, n } from './builder'
import { valueToPitch } from '../editor/core/trackTypes'
import { SLOTS, FX_NOTES, FX_PALETTE, FX_LANES, type SlotData } from './library-crazyedit-data'
import type { TemplateDef } from './library'
import type { Block, Note, Track } from '../editor/types'

// Crazy Edit: the "polyester + oversharpen" paper-card template from
// 'crazyedit - Trim.mp4' (@memtroman), DECONSTRUCTED. The source video is an
// unfilled template: every strobing color is an empty photo slot showing its
// placeholder ('background pictures "37"', 'Character "spiderman"', ...). This
// template rebuilds it as real parts: one Photo Slot track per slot - drop
// photos on a track and that slot plays them - with the cut timing as MIDI
// notes, the placeholder palette per note pitch, the counter as note
// velocities, and every region move/tilt as automation lanes. Unfilled, it
// reproduces the source frame-for-frame; filled, it is the same edit over the
// user's pictures.
//
// Timing: 225bpm pins one 30fps source frame to exactly 1/8 beat. The audio
// ships verbatim (public/templates/crazyedit/music.m4a, no re-encode).

const BPM = 225
const BARS = 18
const FPB = 8 // source frames per beat
const beatOf = (f: number) => (f - 1) / FPB
const PHOTO_BASE = 48

// photoSlot param ranges - must match PhotoSlot.tsx's ParamDefs, since
// automation notes encode values as pitches across the param's range.
const RANGES: Record<string, [number, number]> = {
  x: [-0.25, 1.25], y: [-0.25, 1.25], w: [0, 1.5], h: [0, 1.5], rot: [-60, 60],
  wobble: [0, 1], layer: [0, 20], labelStyle: [0, 6], labelSize: [0.02, 0.6],
  labelX: [0, 1], labelY: [0, 1], borderStyle: [0, 3], alpha: [0, 1],
  jackWidth: [0, 1],
}
const STEP_PARAMS = new Set(['labelStyle', 'borderStyle', 'layer'])

/** One slot block: the events of `sd` inside [f0, f1), as notes. Blocks sit at
 *  fractional bars so each counter epoch is its own block (the counter is the
 *  running velocity sum within a block). */
function slotBlock(sd: SlotData, f0: number, f1: number): Block {
  const evs = sd.events.filter((e) => e[0] >= f0 && e[0] < f1)
  const startBeat = beatOf(f0)
  // Event durations run to the next event in the FULL stream; clamp each to
  // this range so a block never spills past its own phase.
  const notes: Note[] = evs.map((e) =>
    n(beatOf(e[0]) - startBeat, PHOTO_BASE + e[2], Math.min(e[1], f1 - e[0]) / FPB, e[3]),
  )
  const endBeat = evs.length
    ? Math.max(...evs.map((e) => beatOf(e[0]) + Math.min(e[1], f1 - e[0]) / FPB))
    : startBeat
  const b = block(0, 0, notes)
  b.startBar = startBeat / 4
  b.durationBars = Math.max(0.03125, (endBeat - startBeat) / 4)
  return b
}

/** Automation child tracks for a slot's lanes (keyframes -> pitch notes). */
function lanesOf(sd: SlotData, stepAll = false) {
  return Object.entries(sd.lanes).map(([param, keys]) =>
    track({
      name: param,
      type: 'automation',
      instrumentId: '',
      targetParam: param,
      interpolation: stepAll || STEP_PARAMS.has(param) ? 'step' : 'linear',
      blocks: [
        block(0, BARS, keys.map(([f, v]) => {
          const [min, max] = RANGES[param] ?? [0, 1]
          return n(beatOf(f), valueToPitch(v, min, max), 0.125, 100)
        })),
      ],
    }),
  )
}

function slotTrack(opts: {
  name: string
  data: SlotData
  ranges: Array<[number, number]>
  color: string
  layer: number
  label?: string
  labelStyle?: number
  labelSize?: number
  labelX?: number
  labelY?: number
  wobble?: number
  stepLanes?: boolean
  params?: Record<string, number>
}): Track & { __children?: Track[] } {
  return track({
    name: opts.name,
    instrumentId: 'photoSlot',
    color: opts.color,
    blocks: opts.ranges.map(([f0, f1]) => slotBlock(opts.data, f0, f1)),
    params: {
      layer: opts.layer,
      labelStyle: opts.labelStyle ?? 0,
      labelSize: opts.labelSize ?? 0.105,
      labelX: opts.labelX ?? 0.5,
      labelY: opts.labelY ?? 0.5,
      wobble: opts.wobble ?? 0,
      hold: 0,
      ...opts.params,
    },
    stringParams: {
      label: opts.label ?? '',
      palette: opts.data.palette.join(','),
    },
    children: lanesOf(opts.data, opts.stepLanes),
  })
}

const S = SLOTS

const crazyTracks = [
  slotTrack({
    name: 'Background pictures', data: S.BG, color: '#d800c8', layer: 4,
    ranges: [[4, 241], [330, 354], [362, 416], [416, 465]],
    label: 'background pictures', labelStyle: 0,
  }),
  slotTrack({
    name: 'Backgrounds (behind)', data: S.BG2, color: '#8c2020', layer: 0,
    ranges: [[239, 310], [330, 356]],
    labelStyle: 6,
  }),
  slotTrack({
    name: 'Masked building background', data: S.MASKED, color: '#cabfe8', layer: 2,
    ranges: [[56, 239], [362, 416]],
    label: 'Masked building picture background', labelStyle: 2, labelSize: 0.051,
  }),
  slotTrack({
    name: 'Character card', data: S.CHAR, color: '#dc4a78', layer: 9,
    ranges: [[4, 182]],
    label: 'Character\n"spiderman"', labelStyle: 6, labelSize: 0.043, wobble: 0.3,
    params: { labelY: 0.18 },
  }),
  slotTrack({
    name: 'Wider spiderman picture', data: S.WIDER, color: '#dc1414', layer: 7,
    ranges: [[182, 254]],
    label: 'Wider\nspiderman\npicture', labelStyle: 5, labelSize: 0.075, wobble: 0.5,
  }),
  slotTrack({
    name: 'Spiderman jumping to wall', data: S.MINT, color: '#63e0ab', layer: 10,
    ranges: [[241, 305]],
    label: 'Spiderman Jumping\nto wall', labelStyle: 5, labelSize: 0.051, labelX: 0.36, wobble: 0.4,
  }),
  slotTrack({
    name: 'Another angled spiderman pic', data: S.ANOTHER, color: '#b41010', layer: 11,
    ranges: [[292, 305]],
    label: 'another\nangled\nspiderman\npic', labelStyle: 5, labelSize: 0.05, wobble: 0.4,
  }),
  slotTrack({
    name: 'Spiderman character', data: S.LCHAR, color: '#d05a5c', layer: 8,
    ranges: [[356, 416]],
    label: 'Spiderman\ncharacter', labelStyle: 5, labelSize: 0.055, wobble: 0.5,
    params: { labelY: 0.45 },
  }),
  slotTrack({
    name: 'Spiderman still jumping', data: S.SLEEVE, color: '#8ce8e0', layer: 12,
    ranges: [[401, 465]],
    label: 'Spiderman still\njumping', labelStyle: 5, labelSize: 0.04, wobble: 0.3,
  }),
  slotTrack({
    name: 'Background picture cards', data: S.CARDS, color: '#6848c8', layer: 8,
    ranges: [[475, 542]],
    label: 'background pictures', labelStyle: 6, labelSize: 0.06, wobble: 0.35,
    stepLanes: true,
  }),
  slotTrack({
    name: 'Spider scene', data: S.SPIDER, color: '#9890d8', layer: 6,
    ranges: [[239, 255], [457, 550]],
    label: 'Spider scene', labelStyle: 4,
  }),
  slotTrack({
    name: 'Title card', data: S.CAPS, color: '#f0f000', layer: 4,
    ranges: [[310, 330]],
    label: 'BACKGROUND PICTURES\nWITH SPIDERMAN ON IT', labelStyle: 1, labelSize: 0.067,
  }),
  slotTrack({
    name: 'Building walls (left)', data: S.WALLSL, color: '#e6aac8', layer: 13,
    ranges: [[239, 305]],
    label: 'BUILDING WALLS', labelStyle: 3, labelSize: 0.08, labelX: 0.28,
  }),
  slotTrack({
    name: 'Building walls (right)', data: S.WALLSR, color: '#e6aac8', layer: 13,
    ranges: [[239, 244]],
    labelStyle: 6,
  }),
  track({
    name: 'Effects', instrumentId: 'polyFx', color: '#17c917',
    params: { layer: 15 },
    stringParams: { palette: FX_PALETTE.join(',') },
    blocks: [block(0, BARS, FX_NOTES.map((r) => n(beatOf(r[0]), r[2], r[1] / FPB, r[3])))],
    children: Object.entries(FX_LANES).map(([param, keys]) =>
      track({
        name: param,
        type: 'automation',
        instrumentId: '',
        targetParam: param,
        interpolation: 'step',
        blocks: [
          block(0, BARS, keys.map(([f, v]) => {
            const [min, max] = RANGES[param] ?? [0, 1]
            return n(beatOf(f), valueToPitch(v, min, max), 0.125, 100)
          })),
        ],
      }),
    ),
  }),
]

// The source edit sits on black (f1-3 and the outro are pure black frames).
const crazyDocument = doc({
    bpm: BPM,
    totalBars: BARS,
    viewAspect: '16:9',
    tracks: crazyTracks,
    audio: [
      {
        name: 'Crazy Edit audio',
        ref: '/templates/crazyedit/music.m4a',
        fileName: 'crazyedit (source audio)',
        duration: 18.581333,
      },
    ],
})
for (const scene of Object.values(crazyDocument.scenes)) scene.backgroundColor = '#000000'

export const crazyEdit: TemplateDef = {
  id: 'crazyedit',
  name: 'Crazy Edit',
  description: 'Upload photos and a cool edit will be created for you.',
  bpm: BPM,
  document: crazyDocument,
}

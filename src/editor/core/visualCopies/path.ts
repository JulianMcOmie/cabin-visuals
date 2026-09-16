// LOCAL composition: upstream transforms frame the entire path. Everything is
// sampled from beat; MIDI travel is integrated once, never accumulated per frame.
import { Color, Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { memoizeEvaluation } from './evaluationMemo'
import { PATH_COLOR } from './identityColors'
import { applySplitterSize, splitterSize, SPLITTER_SIZE_PARAM } from './splitterSize'
import { mixOklabLinearRgb } from '../../utils/oklch'
import { clamp, smoothstep } from '../../utils/math'

export interface PathSettings {
  copies: number
  size: number
  pathMode: number
  length: number
  loopHeight: number
  bend: number
  amplitude: number
  frequency: number
  waveRate: number
  angle: number
  tilt: number
  speed: number
  motion: number
  startSize: number
  endSize: number
  startColor: string
  endColor: string
  colorAmount: number
  fadeStart: number
  fadeEnd: number
}

export const PATH_MIDI_ROWS = [
  { pitch: 60, label: 'Forward · 1×' },
  { pitch: 62, label: 'Forward · 2×' },
  { pitch: 64, label: 'Forward · 4×' },
  { pitch: 61, label: 'Reverse · 1×' },
  { pitch: 63, label: 'Reverse · 2×' },
  { pitch: 65, label: 'Reverse · 4×' },
]
const RATES: Record<number, number> = { 60: 1, 62: 2, 64: 4, 61: -1, 63: -2, 65: -4 }
const TAU = Math.PI * 2
const wrap = (u: number) => ((u % 1) + 1) % 1

/** Latest held note wins; at simultaneous onsets use the fastest row, then
 * forward on a direction tie. Releasing it resumes the previous held note.
 * Velocity is deliberately ignored: the rows promise exact speed multiples. */
export function pathTravelSampler(notes: readonly ResolvedNote[]): (beat: number) => number {
  const ordered = notes.filter(n => RATES[n.pitch] && Number.isFinite(n.beat)
    && Number.isFinite(n.durationBeats) && n.durationBeats > 0)
    .slice().sort((a, b) => a.beat - b.beat
      || Math.abs(RATES[a.pitch]) - Math.abs(RATES[b.pitch]) || RATES[a.pitch] - RATES[b.pitch])
  const events = ordered.flatMap((n, index) => [
    { beat: n.beat, index, on: true },
    { beat: n.beat + n.durationBeats, index, on: false },
  ]).sort((a, b) => a.beat - b.beat)
  const active = new Set<number>()
  const segments: { beat: number; distance: number; rate: number }[] = []
  let distance = 0, rate = 0, previous = events[0]?.beat ?? 0
  for (let i = 0; i < events.length;) {
    const beat = events[i].beat
    distance += (beat - previous) * rate
    while (i < events.length && events[i].beat === beat) {
      const e = events[i++]
      if (e.on) active.add(e.index)
      else active.delete(e.index)
    }
    let latest = -1
    for (const index of active) latest = Math.max(latest, index)
    rate = latest < 0 ? 0 : RATES[ordered[latest].pitch]
    segments.push({ beat, distance, rate })
    previous = beat
  }
  return beat => {
    let lo = 0, hi = segments.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (segments[mid].beat <= beat) lo = mid + 1
      else hi = mid
    }
    const s = segments[lo - 1]
    return s ? s.distance + (beat - s.beat) * s.rate : 0
  }
}

/** Geometry in the path's XY plane, before its angle/tilt. Loop waves use a
 * whole number of lobes so both position and tangent close at the seam. */
export function pathPoint(s: PathSettings, u: number, beat: number): [number, number, number] {
  const loop = s.pathMode === 1
  const frequency = loop ? Math.round(s.frequency) : s.frequency
  const phase = TAU * (frequency * u - s.waveRate * beat)
  const wave = s.amplitude * Math.sin(phase)
  if (loop) {
    const theta = TAU * u
    // A normal displacement in Z permits arbitrarily large waves without
    // collapsing the ring through its center.
    return [s.length / 2 * Math.cos(theta), s.loopHeight / 2 * Math.sin(theta), wave]
  }
  return [(u - 0.5) * s.length, 4 * s.bend * u * (1 - u) + wave, 0]
}

/** Arc-length lookup makes speed and spacing uniform even around a bend.
 * Animated waves remap the same progress onto the current shape. */
export function pathGeometry(s: PathSettings, beat: number) {
  const steps = Math.max(256, Math.ceil(s.frequency * 64))
  const points = Array.from({ length: steps + 1 }, (_, i) => pathPoint(s, i / steps, beat))
  const lengths = [0]
  for (let i = 1; i <= steps; i++) {
    const a = points[i - 1], b = points[i]
    lengths.push(lengths[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))
  }
  const length = Math.max(1e-6, lengths[steps])
  return {
    length,
    at(progress: number): [number, number, number] {
      const distance = clamp(progress, 0, 1) * length
      let lo = 1, hi = steps
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (lengths[mid] < distance) lo = mid + 1
        else hi = mid
      }
      const fraction = (distance - lengths[lo - 1]) / Math.max(1e-9, lengths[lo] - lengths[lo - 1])
      const a = points[lo - 1], b = points[lo]
      return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction, a[2] + (b[2] - a[2]) * fraction]
    },
  }
}

export const pathSplitter: MoverOrSplitterDefinition<PathSettings> = {
  id: 'path', label: 'Path', kind: 'splitter', identityColor: PATH_COLOR,
  particleExecution: {
    fallback: 'unported',
    reason: 'Path assigns an absolute perceptual tint to each moving slot. SharedLocalLayout currently carries only opacity and additive hue per slot, so it cannot represent this color gradient.',
  },
  params: [
    { key: 'copies', label: 'Copies', min: 1, max: 128, step: 1, default: 12, integer: true },
    SPLITTER_SIZE_PARAM,
    { key: 'pathMode', label: 'Path', type: 'select', options: [{ value: 0, label: 'Open' }, { value: 1, label: 'Loop' }], default: 0 },
    { key: 'length', label: 'Width', min: 0.1, max: 40, step: 0.1, default: 8 },
    { key: 'loopHeight', label: 'Loop height', min: 0.1, max: 40, step: 0.1, default: 5, showIf: 'pathMode=1' },
    { key: 'bend', label: 'Bend', min: -20, max: 20, step: 0.1, default: 0, showIf: 'pathMode=0' },
    { key: 'amplitude', label: 'Wave amplitude', min: 0, max: 10, step: 0.05, default: 0 },
    { key: 'frequency', label: 'Wave cycles (whole lobes in loop)', min: 0, max: 12, step: 0.25, default: 2 },
    { key: 'waveRate', label: 'Wave animation (cycles/beat)', min: -4, max: 4, step: 0.05, default: 0 },
    { key: 'angle', label: 'Angle', min: -180, max: 180, step: 1, default: 0 },
    { key: 'tilt', label: 'Tilt', min: -180, max: 180, step: 1, default: 0 },
    { key: 'motion', label: 'Motion', type: 'select', options: [{ value: 0, label: 'MIDI' }, { value: 1, label: 'Forward' }, { value: 2, label: 'Reverse' }], default: 0 },
    { key: 'speed', label: 'Speed (units/beat)', min: 0, max: 20, step: 0.05, default: 1 },
    { key: 'startSize', label: 'Start size ×', min: 0.05, max: 8, step: 0.05, default: 0.25 },
    { key: 'endSize', label: 'End size ×', min: 0.05, max: 8, step: 0.05, default: 1.5 },
    { key: 'startColor', label: 'Start color', type: 'color', default: '#62d8f5' },
    { key: 'endColor', label: 'End color', type: 'color', default: '#ec78ac' },
    { key: 'colorAmount', label: 'Color mix', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'fadeStart', label: 'Start fade (path fraction)', min: 0, max: 1, step: 0.01, default: 0, showIf: 'pathMode=0' },
    { key: 'fadeEnd', label: 'End fade (path fraction)', min: 0, max: 1, step: 0.01, default: 0.2, showIf: 'pathMode=0' },
  ],
  midiRows: () => PATH_MIDI_ROWS,
  strictMidiRows: true,
  resolve({ settings: s, notes }) {
    const count = clamp(Math.round(s.copies), 1, 128)
    const loop = s.pathMode === 1
    const travel = pathTravelSampler(notes)
    const referenceGeometry = pathGeometry(s, 0)
    const geometryAt = memoizeEvaluation((beat: number) =>
      s.amplitude && s.waveRate ? pathGeometry(s, beat) : referenceGeometry)
    const progressAt = memoizeEvaluation((beat: number) => s.speed
      * (s.motion === 1 ? beat : s.motion === 2 ? -beat : travel(beat)) / referenceGeometry.length)
    const orientation = new Matrix4().makeRotationZ(s.angle * Math.PI / 180)
      .multiply(new Matrix4().makeRotationX(s.tilt * Math.PI / 180))
    const start = new Color(s.startColor), end = new Color(s.endColor)
    return {
      cachePolicy: 'beat',
      apply(copy, { beat }) {
        const geometry = geometryAt(beat)
        const travelProgress = progressAt(beat)
        return Array.from({ length: count }, (_, i) => {
          const raw = (loop ? i / count : count === 1 ? 0 : i / (count - 1)) + travelProgress
          const p = loop ? wrap(raw) : clamp(raw, 0, 1)
          // A closed path has no end: the progression returns smoothly on
          // the second half, preventing a scale/color jump on every lap.
          const t = loop ? (1 - Math.cos(TAU * p)) / 2 : p
          const size = splitterSize(s.size) * (s.startSize + (s.endSize - s.startSize) * t)
          const position = geometry.at(p)
          const slot = orientation.clone().multiply(new Matrix4().makeTranslation(...position))
          const color = start.clone()
          mixOklabLinearRgb(color, end, t)
          let opacity = loop || (raw >= 0 && raw <= 1) ? 1 : 0
          if (!loop) {
            if (s.fadeStart > 0) opacity *= smoothstep(p / s.fadeStart)
            if (s.fadeEnd > 0) opacity *= smoothstep((1 - p) / s.fadeEnd)
          }
          return {
            transform: copy.transform.clone().multiply(applySplitterSize(slot, size)),
            opacity: copy.opacity * opacity,
            colorShift: s.colorAmount > 0 ? { ...copy.colorShift,
              tint: `#${color.getHexString()}`, tintAmount: s.colorAmount, tintPerceptual: true,
            } : { ...copy.colorShift },
          }
        })
      },
    }
  },
}

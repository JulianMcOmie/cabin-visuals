import type { ParamDef } from '../../instruments/types'
import type { Track } from '../../types'
import type { CompositionLayer } from './types'

export const SCENE_TRANSITION_PARAMS: ParamDef[] = [
  { key: 'transition', label: 'Transition', type: 'select', default: 0, options: [
    { value: 0, label: 'Cut' }, { value: 1, label: 'Crossfade' }, { value: 2, label: 'Motion' },
  ] },
  { key: 'transitionBeats', label: 'Length (beats)', min: 0, max: 8, step: 0.125, default: 1, showIf: 'transition' },
  { key: 'motionChannel', label: 'Motion', type: 'select', default: 0, showIf: 'transition=2', options: [
    { value: 0, label: 'Scale' }, { value: 1, label: 'Position X' }, { value: 2, label: 'Position Y' },
    { value: 3, label: 'Rotation' }, { value: 4, label: 'Combined' },
  ] },
  { key: 'motionCurve', label: 'Speed curve', type: 'select', default: 1, showIf: 'transition=2', options: [
    { value: 0, label: 'Gentle' }, { value: 1, label: 'Focused' }, { value: 2, label: 'Sharp' },
  ] },
  { key: 'transitionScale', label: 'Scale (%)', min: -90, max: 300, step: 1, default: 50 },
  { key: 'transitionX', label: 'Move X (units)', min: -20, max: 20, step: 0.1, default: 2 },
  { key: 'transitionY', label: 'Move Y (units)', min: -20, max: 20, step: 0.1, default: 2 },
  { key: 'transitionRotation', label: 'Rotate (°)', min: -360, max: 360, step: 1, default: 90 },
]

function value(track: Track, key: string, fallback: number, min: number, max: number) {
  const raw = track.params?.[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : fallback
}
export const transitionMode = (track: Track) => Math.round(value(track, 'transition', 0, 0, 2))
export const motionChannel = (track: Track) => Math.round(value(track, 'motionChannel', 0, 0, 4))

export function sceneTransitionParamVisible(track: Track, param: ParamDef): boolean {
  const mode = transitionMode(track)
  const channel = motionChannel(track)
  const channels: Record<string, number> = { transitionScale: 0, transitionX: 1, transitionY: 2, transitionRotation: 3 }
  if (param.key in channels) return mode === 2 && (channel === 4 || channel === channels[param.key])
  if (param.key === 'transitionBeats') return mode !== 0
  if (param.key === 'motionChannel' || param.key === 'motionCurve') return mode === 2
  return true
}

/** Integral of a symmetric, positive speed profile. All presets start/end at
 * rest with zero acceleration, have peak speed at the cut, and never reverse.
 * Position, velocity and acceleration are evaluated analytically, not sampled
 * from previous frames, so seeking and export share the same trajectory. */
export function motionCurveSample(t: number, curve = 1) {
  const x = Math.min(1, Math.max(0, t))
  const power = Math.round(Math.min(2, Math.max(0, curve))) + 2
  const k = [30, 140, 630][power - 2]
  const position = power === 2 ? x ** 3 * (10 + x * (-15 + 6 * x))
    : power === 3 ? x ** 4 * (35 + x * (-84 + x * (70 - 20 * x)))
    : x ** 5 * (126 + x * (-420 + x * (540 + x * (-315 + 70 * x))))
  return { position, velocity: k * (x * (1 - x)) ** power,
    acceleration: k * power * (x * (1 - x)) ** (power - 1) * (1 - 2 * x) }
}
export const motionBridge = (t: number, curve = 1) => motionCurveSample(t, curve).position
export const motionCurve = (track: Track) => Math.round(value(track, 'motionCurve', 1, 0, 2))

export function transitionMotion(track: Track, t: number): NonNullable<CompositionLayer['objectMotion']> {
  const q = motionBridge(t, motionCurve(track))
  const channel = motionChannel(track)
  const enabled = (c: number) => channel === c || channel === 4
  return {
    // Linear in eased progress: actual scale velocity peaks at the handoff,
    // unlike exp(progress), which shifts that peak toward the end.
    scale: enabled(0) ? 1 + value(track, 'transitionScale', 50, -90, 300) / 100 * q : 1,
    x: enabled(1) ? value(track, 'transitionX', 2, -20, 20) * q : 0,
    y: enabled(2) ? value(track, 'transitionY', 2, -20, 20) * q : 0,
    rotation: enabled(3) ? value(track, 'transitionRotation', 90, -360, 360) * Math.PI / 180 * q : 0,
  }
}

export interface SceneChange { beat: number; sceneId: string | null }

export function applySceneTransition(track: Track, beat: number, changes: readonly SceneChange[], selected: string | null): CompositionLayer[] {
  const layer = (sceneId: string): CompositionLayer => ({ directorTrackId: track.id, sceneId, opacity: 1, viewport: { x: 0, y: 0, width: 1, height: 1 } })
  const mode = transitionMode(track)
  const halfLength = value(track, 'transitionBeats', 1, 0, 8) / 2
  const accumulated = { scale: 1, x: 0, y: 0, rotation: 0 }
  let moved = false
  if (mode && halfLength > 0) {
    for (let i = 1; i < changes.length; i++) {
      const change = changes[i]
      const previous = changes[i - 1]
      if (!change.sceneId && beat >= change.beat) {
        // A real empty rest starts a new phrase. Nothing visible snaps back.
        accumulated.scale = 1; accumulated.x = 0; accumulated.y = 0; accumulated.rotation = 0
        moved = false
      }
      if (!previous.sceneId || !change.sceneId) continue
      const half = Math.min(halfLength, (change.beat - previous.beat) / 2,
        ((changes[i + 1]?.beat ?? Infinity) - change.beat) / 2)
      if (half <= 0 || beat <= change.beat - half) continue
      const t = (beat - change.beat + half) / (2 * half)
      if (mode === 1) {
        if (t >= 1) continue
        const mix = motionBridge(t, 0)
        return [{ ...layer(change.sceneId), crossfade: { sceneId: previous.sceneId, mix } }]
      }
      // Hold the finished pose and let the next handoff continue from it.
      // Each bridge multiplies scale and adds position/angle; no return lobe
      // and no frame-history state. A shrinking bridge remains positive.
      const motion = transitionMotion(track, t)
      accumulated.scale *= motion.scale
      accumulated.x += motion.x; accumulated.y += motion.y
      accumulated.rotation += motion.rotation
      moved = true
    }
  }
  return selected ? [{ ...layer(selected), ...(moved ? { objectMotion: accumulated } : {}) }] : []
}

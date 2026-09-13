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
  { key: 'transitionScale', label: 'Scale (%)', min: -90, max: 300, step: 1, default: 50 },
  { key: 'transitionX', label: 'Move X (%)', min: -100, max: 100, step: 1, default: 25 },
  { key: 'transitionY', label: 'Move Y (%)', min: -100, max: 100, step: 1, default: 25 },
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
  if (param.key === 'motionChannel') return mode === 2
  return true
}

/** A single polynomial across the handoff. Its value, first and second
 * derivatives vanish at the outer edges; at the cut (t=.5), value=1 and
 * velocity=1. The incoming scene continues moving before settling back.
 * This is an added scene transform, not a fit to an object's own animation. */
export function motionBridge(t: number): number {
  if (t <= 0 || t >= 1) return 0
  return 64 * t ** 3 * (1 - t) ** 3 * (0.5 + t)
}

export function transitionMotion(track: Track, t: number): NonNullable<CompositionLayer['motion']> {
  const q = motionBridge(t)
  const channel = motionChannel(track)
  const enabled = (c: number) => channel === c || channel === 4
  return {
    scale: enabled(0) ? Math.exp(Math.log1p(value(track, 'transitionScale', 50, -90, 300) / 100) * q) : 1,
    x: enabled(1) ? value(track, 'transitionX', 25, -100, 100) / 100 * q : 0,
    y: enabled(2) ? value(track, 'transitionY', 25, -100, 100) / 100 * q : 0,
    rotation: enabled(3) ? value(track, 'transitionRotation', 90, -360, 360) * Math.PI / 180 * q : 0,
  }
}

export interface SceneChange { beat: number; sceneId: string | null }

export function applySceneTransition(track: Track, beat: number, changes: readonly SceneChange[], selected: string | null): CompositionLayer[] {
  const layer = (sceneId: string): CompositionLayer => ({ directorTrackId: track.id, sceneId, opacity: 1, viewport: { x: 0, y: 0, width: 1, height: 1 } })
  const mode = transitionMode(track)
  const halfLength = value(track, 'transitionBeats', 1, 0, 8) / 2
  if (mode && halfLength > 0) {
    for (let i = 1; i < changes.length; i++) {
      const change = changes[i]
      const previous = changes[i - 1]
      if (!previous.sceneId || !change.sceneId) continue
      // Equal time on both sides keeps velocity continuous. Shorten against
      // both neighbors, including gaps, so bridges never overlap or fill rests.
      const half = Math.min(halfLength, (change.beat - previous.beat) / 2,
        ((changes[i + 1]?.beat ?? Infinity) - change.beat) / 2)
      if (half <= 0 || beat <= change.beat - half || beat >= change.beat + half) continue
      const t = (beat - change.beat + half) / (2 * half)
      if (mode === 1) {
        const mix = t ** 3 * (10 + t * (-15 + 6 * t))
        return [{ ...layer(change.sceneId), crossfade: { sceneId: previous.sceneId, mix } }]
      }
      return [{ ...layer(beat < change.beat ? previous.sceneId : change.sceneId), motion: transitionMotion(track, t) }]
    }
  }
  return selected ? [layer(selected)] : []
}

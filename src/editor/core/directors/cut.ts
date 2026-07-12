import { flattenTrackNotes } from '../visual/noteFlatten'
import type { Scene, Track } from '../../types'
import type { DirectorInstrumentDef } from './types'
import { FULL_FRAME } from './types'

export const DEFAULT_PARTITION_COUNT = 3
export const MAX_PARTITION_COUNT = 8

export function orderedVisualBindings(track: Track, scenes: Record<string, Scene>, sceneOrder: string[]) {
  const visualIds = sceneOrder.filter((id) => scenes[id] && !scenes[id].isMain)
  return track.sceneBindings?.length
    ? track.sceneBindings.filter((binding) => scenes[binding.sceneId] && !scenes[binding.sceneId].isMain)
    : visualIds.map((sceneId, index) => ({ sceneId, pitch: 60 + index }))
}

export function partitionSceneCount(track: Track, available: number): number {
  return Math.min(available, Math.max(1, Math.min(MAX_PARTITION_COUNT, Math.round(track.params?.sceneCount ?? DEFAULT_PARTITION_COUNT))))
}

export function heldDirectorPitches(track: Track, beat: number, beatsPerBar: number, totalBars: number) {
  return new Set(flattenTrackNotes(track, beatsPerBar, totalBars)
    .filter((note) => beat >= note.beat && beat < note.beat + note.durationBeats)
    .map((note) => note.pitch))
}

function partitionSlant(track: Track): number {
  const style = Math.round(track.params?.cutStyle ?? 0)
  return style === 1 ? 0.22 : style === 2 ? -0.22 : 0
}

export const cutDirector: DirectorInstrumentDef = {
  id: 'cut',
  name: 'Cut',
  params: [
    { key: 'sceneCount', label: 'Scenes', min: 1, max: MAX_PARTITION_COUNT, step: 1, default: DEFAULT_PARTITION_COUNT },
    {
      key: 'cutStyle',
      label: 'Cuts',
      type: 'select',
      options: [
        { value: 0, label: 'Straight' },
        { value: 1, label: 'Diagonal ↗' },
        { value: 2, label: 'Diagonal ↘' },
      ],
      default: 0,
    },
  ],
  midiRows(track, scenes, sceneOrder) {
    const bindings = orderedVisualBindings(track, scenes, sceneOrder)
    const count = partitionSceneCount(track, bindings.length)
    return bindings.slice(0, count).map((binding, index) => ({
      pitch: binding.pitch,
      label: scenes[binding.sceneId]?.name ?? 'Missing scene',
      color: `hsl(${(index * 67) % 360}, 65%, 58%)`,
      emphasized: index === 0,
    }))
  },
  resolve(track, context) {
    const bindings = orderedVisualBindings(track, context.scenes, context.sceneOrder)
    const count = partitionSceneCount(track, bindings.length)
    if (count === 0) return []
    const heldPitches = heldDirectorPitches(track, context.beat, context.beatsPerBar, context.totalBars)
    const slant = partitionSlant(track)
    return bindings.slice(0, count).flatMap((binding, index) => heldPitches.has(binding.pitch) ? [{
      directorTrackId: track.id,
      sceneId: binding.sceneId,
      opacity: 1,
      viewport: { ...FULL_FRAME },
      partition: { kind: 'linear' as const, index, count, slant },
    }] : [])
  },
}

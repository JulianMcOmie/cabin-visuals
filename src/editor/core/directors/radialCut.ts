import type { DirectorInstrumentDef } from './types'
import { FULL_FRAME } from './types'
import {
  DEFAULT_PARTITION_COUNT,
  MAX_PARTITION_COUNT,
  heldDirectorPitches,
  orderedVisualBindings,
  partitionSceneCount,
} from './cut'

export const radialCutDirector: DirectorInstrumentDef = {
  id: 'radialCut',
  name: 'Radial Cut',
  params: [
    { key: 'sceneCount', label: 'Scenes', min: 1, max: MAX_PARTITION_COUNT, step: 1, default: DEFAULT_PARTITION_COUNT },
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
    return bindings.slice(0, count).flatMap((binding, index) => heldPitches.has(binding.pitch) ? [{
      directorTrackId: track.id,
      sceneId: binding.sceneId,
      opacity: 1,
      viewport: { ...FULL_FRAME },
      partition: { kind: 'radial' as const, index, count },
    }] : [])
  },
}

import { flattenTrackNotes } from '../visual/noteFlatten'
import type { DirectorInstrumentDef } from './types'
import { FULL_FRAME } from './types'
import { orderedSceneBindings } from './sceneBindings'

export const sceneSwitcherDirector: DirectorInstrumentDef = {
  id: 'sceneSwitcher',
  name: 'Scene Switcher',
  params: [],
  midiRows: (track, scenes, sceneOrder) => {
    const bindings = orderedSceneBindings(track, scenes, sceneOrder)
    return bindings
      .slice()
      .sort((a, b) => b.pitch - a.pitch)
      .map((binding, i) => ({
        pitch: binding.pitch,
        label: scenes[binding.sceneId]?.name ?? 'Missing scene',
        color: `hsl(${(i * 67) % 360}, 65%, 58%)`,
        emphasized: i === 0,
      }))
  },
  resolve: (track, context) => {
    const visualIds = context.sceneOrder.filter((id) => context.scenes[id] && !context.scenes[id].isMain)
    const fallback = visualIds[0]
    if (!fallback) return []
    const bindings = orderedSceneBindings(track, context.scenes, context.sceneOrder)
    const byPitch = new Map(bindings.map((b) => [b.pitch, b.sceneId]))
    const notes = flattenTrackNotes(track, context.beatsPerBar, context.totalBars)
    let selected = fallback
    let latestBeat = -Infinity
    for (const note of notes) {
      if (note.beat > context.beat || note.beat < latestBeat) continue
      const sceneId = byPitch.get(note.pitch)
      if (!sceneId || context.scenes[sceneId]?.isMain) continue
      selected = sceneId
      latestBeat = note.beat
    }
    return [{ directorTrackId: track.id, sceneId: selected, opacity: 1, viewport: { ...FULL_FRAME } }]
  },
}

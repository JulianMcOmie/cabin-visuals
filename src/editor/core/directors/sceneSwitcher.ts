import { flattenTrackNotes } from '../visual/noteFlatten'
import type { DirectorInstrumentDef } from './types'
import { FULL_FRAME } from './types'

export const sceneSwitcherDirector: DirectorInstrumentDef = {
  id: 'sceneSwitcher',
  name: 'Scene Switcher',
  params: [],
  midiRows: (track, scenes, sceneOrder) => {
    const visualIds = sceneOrder.filter((id) => scenes[id] && !scenes[id].isMain)
    const bindings = track.sceneBindings?.length
      ? track.sceneBindings.filter((b) => scenes[b.sceneId] && !scenes[b.sceneId].isMain)
      : visualIds.map((sceneId, i) => ({ sceneId, pitch: 60 + i }))
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
    const bindings = track.sceneBindings?.length
      ? track.sceneBindings
      : visualIds.map((sceneId, i) => ({ sceneId, pitch: 60 + i }))
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

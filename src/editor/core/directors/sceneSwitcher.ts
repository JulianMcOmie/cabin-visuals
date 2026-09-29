import { flattenTrackNotesMemo } from '../visual/noteFlatten'
import type { SelectParamDef } from '../../instruments/types'
import type { Track } from '../../types'
import type { CompositionInstrumentDef } from './types'
import { SCENE_TRANSITION_PARAMS, applySceneTransition, transitionMode, type SceneChange } from './sceneTransition'
import { orderedSceneBindings } from './sceneBindings'
import { sceneRowColor } from './sceneRowColor'

export const SCENE_SWITCHER_MODE_HOLD = 0
export const SCENE_SWITCHER_MODE_LATCH = 1

/**
 * What a note MEANS on a switcher row - the def's one real decision, hence a
 * segmented control at the top of its panel rather than a dropdown among the
 * params.
 *
 * HOLD (the original behaviour, and the default so no saved project changes):
 * a scene is on screen only while its note is held, and Main shows nothing in
 * the gaps. LATCH reads the same notes as CUTS: the most recent onset owns the
 * frame until the next one, so a switcher can be programmed with short marker
 * notes at each change instead of one note stretched across every section.
 */
export const SCENE_SWITCHER_MODE_PARAM: SelectParamDef = {
  key: 'switchMode',
  label: 'Notes',
  type: 'select',
  options: [
    { value: SCENE_SWITCHER_MODE_HOLD, label: 'Hold' },
    { value: SCENE_SWITCHER_MODE_LATCH, label: 'Latch' },
  ],
  default: SCENE_SWITCHER_MODE_HOLD,
}

export function sceneSwitcherLatches(track: Track): boolean {
  const raw = track.params?.[SCENE_SWITCHER_MODE_PARAM.key] ?? SCENE_SWITCHER_MODE_PARAM.default
  return Math.round(raw) === SCENE_SWITCHER_MODE_LATCH
}

export const sceneSwitcherDirector: CompositionInstrumentDef = {
  id: 'sceneSwitcher',
  mainOnly: true,
  name: 'Scene Switcher',
  params: [SCENE_SWITCHER_MODE_PARAM, ...SCENE_TRANSITION_PARAMS],
  panelSummary:
    'Scene Switcher plays your scenes from one MIDI lane - one row per scene. On HOLD a scene shows only while its note is held; on LATCH the last scene played stays on screen until the next note.',
  midiRows: (track, scenes, sceneOrder) => {
    const bindings = orderedSceneBindings(track, scenes, sceneOrder)
    return bindings
      .slice()
      .sort((a, b) => b.pitch - a.pitch)
      .map((binding, i) => ({
        pitch: binding.pitch,
        label: scenes[binding.sceneId]?.name ?? 'Missing scene',
        // The row IS its scene: it wears that scene's backdrop hue, so writing
        // notes reads as painting the frames the switcher will cut to. Scenes
        // with no hue to lend (default black, transparent) keep the old cycle
        // so their rows still tell each other apart - see sceneRowColor.ts.
        color: sceneRowColor(scenes[binding.sceneId], `hsl(${(i * 67) % 360}, 65%, 58%)`),
        emphasized: i === 0,
      }))
  },
  resolve: (track, context) => {
    const bindings = orderedSceneBindings(track, context.scenes, context.sceneOrder)
    const byPitch = new Map(bindings.map((b) => [b.pitch, b.sceneId]))
    const notes = flattenTrackNotesMemo(track, context.beatsPerBar, context.totalBars)
    const latching = sceneSwitcherLatches(track)
    let selected: string | null = null
    let latestBeat = -Infinity
    for (const note of notes) {
      // The only difference between the modes: hold counts a note while the
      // playhead is inside it, latch counts every note that has STARTED - so
      // the newest onset still wins, it just keeps the frame past its own
      // release. Both then take the LATEST qualifying onset, which is what
      // makes overlapping notes read as "the last one you played".
      const live = latching
        ? context.beat >= note.beat
        : context.beat >= note.beat && context.beat < note.beat + note.durationBeats
      if (!live || note.beat < latestBeat) continue
      const sceneId = byPitch.get(note.pitch)
      if (!sceneId || context.scenes[sceneId]?.isMain) continue
      selected = sceneId
      latestBeat = note.beat
    }
    const changes = transitionMode(track) ? sceneChanges(notes, byPitch, latching) : []
    return applySceneTransition(track, context.beat, changes, selected)
  },
}

// Cache the ownership timeline by flattened notes and bindings, not the sampled
// track: automation may supply a fresh params object on every frame.
const changeCache = new WeakMap<object, { key: string; changes: SceneChange[] }>()
function sceneChanges(notes: ReturnType<typeof flattenTrackNotesMemo>, byPitch: Map<number, string>, latch: boolean): SceneChange[] {
  const key = JSON.stringify([latch, [...byPitch]])
  const hit = changeCache.get(notes)
  if (hit?.key === key) return hit.changes
  const events: { beat: number; index: number; start: boolean }[] = []
  notes.forEach((note, index) => {
    if (!byPitch.has(note.pitch) || !Number.isFinite(note.beat) || (!latch && !(note.durationBeats > 0))) return
    events.push({ beat: note.beat, index, start: true })
    if (!latch) events.push({ beat: note.beat + note.durationBeats, index, start: false })
  })
  events.sort((a, b) => a.beat - b.beat)
  const active = new Set<number>()
  const changes: SceneChange[] = []
  let selected: string | null = null
  let latched = -1
  for (let i = 0; i < events.length;) {
    const beat = events[i].beat
    do {
      const event = events[i++]
      if (latch) {
        if (latched < 0 || notes[event.index].beat > notes[latched].beat ||
          (notes[event.index].beat === notes[latched].beat && event.index > latched)) latched = event.index
      } else if (event.start) active.add(event.index)
      else active.delete(event.index)
    } while (i < events.length && events[i].beat === beat)
    let winner = latched
    if (!latch) for (const index of active) {
      if (winner < 0 || notes[index].beat > notes[winner].beat ||
        (notes[index].beat === notes[winner].beat && index > winner)) winner = index
    }
    const next = winner < 0 ? null : byPitch.get(notes[winner].pitch) ?? null
    if (next !== selected) changes.push({ beat, sceneId: next })
    selected = next
  }
  changeCache.set(notes, { key, changes })
  return changes
}

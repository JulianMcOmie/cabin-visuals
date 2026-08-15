import { flattenTrackNotes } from '../visual/noteFlatten'
import type { SelectParamDef } from '../../instruments/types'
import type { Track } from '../../types'
import type { CompositionInstrumentDef } from './types'
import { FULL_FRAME } from './types'
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
  params: [SCENE_SWITCHER_MODE_PARAM],
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
    const notes = flattenTrackNotes(track, context.beatsPerBar, context.totalBars)
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
    return selected
      ? [{ directorTrackId: track.id, sceneId: selected, opacity: 1, viewport: { ...FULL_FRAME } }]
      : []
  },
}

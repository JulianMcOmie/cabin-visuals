import { flattenTrackNotesMemo } from '../visual/noteFlatten'
import type { MidiRowDef } from '../../instruments/types'
import type { Track } from '../../types'
import type { CompositionInstrumentDef } from './types'
import { FULL_FRAME } from './types'
import { orderedSceneBindings } from './sceneBindings'

// Scene: shows ONE scene, full-frame. The plainest composition instrument there
// is - the Main-scene equivalent of "just render this scene" - and the layer
// every other composer stacks over.
//
// It is PRESENCE-DRIVEN rather than note-gated (the same convention as word
// formation lanes): a track with no notes shows its scene for the whole
// timeline, so dropping one in is never dead, and drawing notes turns it into a
// gate without adding a mode. That is the whole reason this is not just Scene
// Switcher with one row - a switcher renders nothing until you have played it.

/** The one row the track declares. Its pitch follows the scene binding, which
 *  is where the chosen scene's pitch already lives (60 for a fresh track). */
export const SCENE_DEFAULT_PITCH = 60

/**
 * Is the scene on screen at `beat`?
 *
 * No notes anywhere on the track = always on. Once ANY note exists the track is
 * a gate and the scene shows only while one is held - pitch is ignored, because
 * the vocabulary is a single row and a note left on some other pitch (dragged
 * in, imported, or orphaned by a re-binding) should still read as "show it"
 * rather than silently doing nothing.
 */
export function sceneVisibleAt(
  track: Track,
  beat: number,
  beatsPerBar: number,
  totalBars: number,
): boolean {
  const notes = flattenTrackNotesMemo(track, beatsPerBar, totalBars)
  if (notes.length === 0) return true
  return notes.some((note) => beat >= note.beat && beat < note.beat + note.durationBeats)
}

export const sceneDirector: CompositionInstrumentDef = {
  id: 'scene',
  mainOnly: true,
  name: 'Scene',
  params: [],
  targetsSingleScene: true,
  // One row, and its label is the scene the picker already shows - listing it
  // under the settings would say nothing the panel doesn't.
  hideMidiRowsInSettings: true,
  panelSummary: 'Scene renders one scene into the Composite, full-frame.',
  sceneChoiceNote:
    'With no notes on the track this scene shows for the whole timeline. Draw notes on its row to make it show only while one is held.',
  midiRows(track, scenes, sceneOrder): MidiRowDef[] {
    const binding = orderedSceneBindings(track, scenes, sceneOrder)[0]
    return [{
      pitch: binding?.pitch ?? SCENE_DEFAULT_PITCH,
      label: binding ? (scenes[binding.sceneId]?.name ?? 'Missing scene') : 'No scene',
      emphasized: true,
    }]
  },
  resolve(track, context) {
    // targetsSingleScene: the panel writes the chosen scene as the first
    // binding, and orderedSceneBindings keeps saved bindings ahead of the ones
    // it appends to self-heal - so entry 0 IS the choice, falling back to the
    // first visual scene before anything has been picked.
    const sceneId = orderedSceneBindings(track, context.scenes, context.sceneOrder)[0]?.sceneId
    if (!sceneId) return []
    if (!sceneVisibleAt(track, context.beat, context.beatsPerBar, context.totalBars)) return []
    return [{ directorTrackId: track.id, sceneId, opacity: 1, viewport: { ...FULL_FRAME } }]
  },
}

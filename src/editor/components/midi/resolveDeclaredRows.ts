import { compositionDef } from '../../core/directors'
import { getPriorVisualCopyCount } from '../../core/visual/resolve'
import { mergeDefinitionSettings } from '../../core/visualCopies/definitions'
import { getMoverOrSplitterDefinition } from '../../core/visualCopies/registry'
import { WORD_FORMATION_PITCH } from '../../core/visual/wordFormation'
import { getInstrument } from '../../instruments'
import type { MidiRowDef } from '../../instruments/types'
import type { Scene, Track } from '../../types'

interface DeclaredRowProject {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  scenes: Record<string, Scene>
  sceneOrder: string[]
  bpm: number
  beatsPerBar: number
  totalBars: number
}

export interface DeclaredMidiRows {
  rows: MidiRowDef[]
  /** Strict vocabularies intentionally hide notes outside their current rows. */
  strict: boolean
}

/**
 * Resolve the semantic MIDI vocabulary shared by the full MIDI editor and the
 * compact timeline preview. The returned order is visual order: first = top.
 */
export function resolveDeclaredMidiRows(
  track: Track,
  project: DeclaredRowProject,
): DeclaredMidiRows | undefined {
  if (track.type === 'base') {
    const def = getInstrument(track.instrumentId)
    // A composition id that is NOT also an object instrument (sceneSwitcher,
    // cut, radialCut) declares its rows on the composition def. Crop is both;
    // its object rows and composition rows are identical by construction
    // (cropMidiRows), so the object arm winning is not a divergence.
    const rows = def?.midiRowsFor?.(track) ?? def?.midiRows
      ?? compositionDef(track.instrumentId)?.midiRows(track, project.scenes, project.sceneOrder)
    return rows ? { rows, strict: false } : undefined
  }

  // A Word Formation lane says exactly one thing - "this arrangement, from
  // here" - so it gets ONE labelled row rather than a piano. Strict, because a
  // note anywhere else would look like it meant something different and does not.
  if (track.type === 'wordFormation') {
    return { rows: [{ pitch: WORD_FORMATION_PITCH, label: 'Use this formation' }], strict: true }
  }

  if (track.type === 'mover' || track.type === 'splitter') {
    const definition = getMoverOrSplitterDefinition(
      track.type === 'splitter' ? track.splitterId : track.moverId,
    )
    if (!definition?.midiRows) return undefined
    return {
      rows: definition.midiRows(
        mergeDefinitionSettings(definition, track.inputValues),
        { priorCount: getPriorVisualCopyCount(track.id, project) },
      ),
      strict: definition.strictMidiRows === true,
    }
  }

  return undefined
}

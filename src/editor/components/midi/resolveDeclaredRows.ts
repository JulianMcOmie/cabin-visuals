import { getDirector } from '../../core/directors'
import { getPriorVisualCopyCount } from '../../core/visual/resolve'
import { mergeDefinitionSettings } from '../../core/visualCopies/definitions'
import { getMoverOrSplitterDefinition } from '../../core/visualCopies/registry'
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
    const rows = getInstrument(track.instrumentId)?.midiRows
    return rows ? { rows, strict: false } : undefined
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

  if (track.type === 'director') {
    const rows = getDirector(track.directorId)?.midiRows(
      track,
      project.scenes,
      project.sceneOrder,
    )
    return rows ? { rows, strict: false } : undefined
  }

  return undefined
}

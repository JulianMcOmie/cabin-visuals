import { compositionDef } from '../../core/directors'
import { getPriorVisualCopyCount, switcherChildTracks } from '../../core/visual/resolve'
import { orderedSwitcherBindings } from '../../core/switcherBindings'
import { switcherRows } from '../../core/visualCopies/switcher'
import { resolveTrackDisplayColor } from '../../utils/trackDisplayColor'
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
    const def = getInstrument(track.instrumentId)
    // A composition id that is NOT also an object instrument (sceneSwitcher,
    // cut, radialCut) declares its rows on the composition def. Crop is both;
    // its object rows and composition rows are identical by construction
    // (cropMidiRows), so the object arm winning is not a divergence.
    const rows = def?.midiRowsFor?.(track) ?? def?.midiRows
      ?? compositionDef(track.instrumentId)?.midiRows(track, project.scenes, project.sceneOrder)
    return rows ? { rows, strict: false } : undefined
  }

  // A switcher's vocabulary IS its rack: one row per device in child order,
  // each wearing that device's own identity colour (the row is the thing it
  // selects - sceneRowColor's convention), then the reserved None row.
  // Deliberately NOT strict: deleting a device removes its row, and a strict
  // vocabulary would take the notes written on it out of the editor with no
  // trace. Non-strict gives them a dimmed orphan row instead, so the work is
  // still there to move or delete - the rule every other lane here keeps.
  if (track.type === 'switcher') {
    const children = switcherChildTracks(track, project)
    if (children.length === 0) return undefined
    const indexByChild = new Map(children.map((child, index) => [child.id, index]))
    return {
      rows: switcherRows(
        children.map((child) => ({ label: child.name, color: resolveTrackDisplayColor(child) })),
        orderedSwitcherBindings(track, children.map((c) => c.id))
          .map(({ pitch, childTrackId }) => ({ pitch, index: indexByChild.get(childTrackId)! })),
      ),
      strict: false,
    }
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

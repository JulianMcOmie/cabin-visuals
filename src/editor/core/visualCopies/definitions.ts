// Definition contract for the new VisualCopy registry, independent of the
// legacy StateVector mover registry (core/visual/movers). A definition resolves
// its stored settings plus the track's resolved notes into one MoverOrSplitter
// closure. ALL MIDI interpretation lives inside the definition - the kernel has
// no generic continuous/amount/ballistic modes. Closures must stay pure
// functions of beat plus immutable resolved data (no mutable playback state),
// so pause, scrub, playback, and export agree exactly. Closed-form helpers like
// evaluateAdsrGain(notes, beat, adsr) may be reused inside apply() - they are
// already pure functions of the playhead beat.

import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitter } from './types'

/**
 * One definition covers both movers and splitters - they resolve to the same
 * MoverOrSplitter contract, so the distinction is data, not a type. `kind` is
 * a UI-only discriminator (picker grouping, which track field stores the id);
 * resolution logic never branches on it.
 *
 * The UI schema is borrowed from ObjectInstrumentDef: `params` renders the same
 * controls (values stored on the track, merged with defaults at resolution),
 * and `midiRows` declares the definition's MIDI vocabulary for the editor -
 * upgraded here to a function of settings so rows can respond to params (a
 * splitter with `copies: N` declares N gate rows). It is advisory metadata:
 * resolve() stays the single source of truth for what notes DO. Omit it for
 * the full piano roll.
 *
 * A splitter's slot count must be structural (from settings), never from MIDI -
 * notes gate a slot's opacity to zero rather than removing it, so downstream
 * indices stay stable.
 */
export interface MoverOrSplitterDefinition<Settings> {
  id: string
  label: string
  kind: 'mover' | 'splitter'
  params: ParamDef[]
  midiRows?: (settings: Settings, context?: { priorCount: number }) => MidiRowDef[]
  /** Keep the editor to exactly midiRows, even if saved notes use other pitches. */
  strictMidiRows?: boolean
  resolve(args: { settings: Settings; notes: ResolvedNote[] }): MoverOrSplitter
}

/** The settings a definition's resolve()/midiRows() receive: its numeric param
 *  defaults overlaid with the track's stored inputValues. One helper so the
 *  engine and the editor UI derive identical settings. */
export function mergeDefinitionSettings(
  def: MoverOrSplitterDefinition<any>,
  inputValues: Record<string, number> | undefined,
): Record<string, number> {
  const settings: Record<string, number> = {}
  for (const pd of def.params) if (typeof pd.default === 'number') settings[pd.key] = pd.default
  return Object.assign(settings, inputValues)
}

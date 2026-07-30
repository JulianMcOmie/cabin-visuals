// Definition contract for the new VisualCopy registry, independent of the
// legacy StateVector mover registry (core/visual/movers). A definition resolves
// its stored settings plus the track's resolved notes into one MoverOrSplitter
// closure. ALL MIDI interpretation lives inside the definition - the kernel has
// no generic continuous/amount/ballistic modes. Closures must stay pure
// functions of beat plus immutable resolved data (no mutable playback state),
// so pause, scrub, playback, and export agree exactly. Closed-form helpers like
// evaluateAdsrGain(notes, beat, adsr) may be reused inside apply() - they are
// already pure functions of the playhead beat.

import { isStringParam, type MidiRowDef, type ParamDef } from '../../instruments/types'
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
  /** Colorizers share the mover storage field, but get their own library and UI
   *  category because they alter appearance rather than spatial transforms. */
  kind: 'mover' | 'splitter' | 'colorizer'
  params: ParamDef[]
  midiRows?: (settings: Settings, context?: { priorCount: number }) => MidiRowDef[]
  /** Keep the editor to exactly midiRows, even if saved notes use other pitches. */
  strictMidiRows?: boolean
  resolve(args: { settings: Settings; notes: ResolvedNote[] }): MoverOrSplitter
}

/** The settings a definition's resolve()/midiRows() receive: its param defaults
 *  overlaid with the track's stored values. One helper so the engine and the
 *  editor UI derive identical settings.
 *
 *  Numeric params live in the track's `inputValues`; string-valued ones (color /
 *  string ParamDefs) live in the shared `stringParams` field, exactly as they do
 *  for instruments - the two are kept apart so the engine's numeric paths
 *  (automation lanes, envelopes) never have to consider a string. */
export function mergeDefinitionSettings(
  def: MoverOrSplitterDefinition<any>,
  inputValues: Record<string, number> | undefined,
  stringValues?: Record<string, string>,
): Record<string, number | string> {
  const settings: Record<string, number | string> = {}
  for (const pd of def.params) {
    if (typeof pd.default === 'number') settings[pd.key] = pd.default
  }
  Object.assign(settings, inputValues)
  for (const pd of def.params) {
    if (!isStringParam(pd)) continue
    const stored = stringValues?.[pd.key]
    settings[pd.key] = stored ?? pd.default
  }
  return settings
}

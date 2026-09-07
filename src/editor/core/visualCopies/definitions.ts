// Definition contract for the new VisualCopy registry, independent of the
// legacy StateVector mover registry (core/visual/movers). A definition resolves
// its stored settings plus the track's resolved notes into one MoverOrSplitter
// closure. ALL MIDI interpretation lives inside the definition - the kernel has
// no generic continuous/amount/ballistic modes. Closures must stay pure
// functions of beat plus immutable resolved data (no mutable playback state),
// so pause, scrub, playback, and export agree exactly. Closed-form helpers like
// adsrGateGain(note, beat, adsr) may be reused inside apply() - they are
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
 * A splitter's slot count is structural: fixed per resolve, never a function
 * of the beat. A COUNT LANE (countLane.ts - the default MIDI vocabulary on
 * splitters with a count knob) does let notes name the count, but through the
 * automated-settings machinery: the entry re-resolves per sampled count and
 * publishes `structuralVariants` bracketing the lane's reach, so the mounted
 * pool is sized once for everything the notes can ask for.
 */
export interface MoverOrSplitterDefinition<Settings> {
  id: string
  label: string
  /** Colorizers share the mover storage field, but get their own library and UI
   *  category because they alter appearance rather than spatial transforms. */
  kind: 'mover' | 'splitter' | 'colorizer'
  params: ParamDef[]
  /**
   * The color this definition's tracks WEAR in the UI - timeline blocks,
   * piano-roll rows and notes, the inspector's tab rail, and its settings
   * panel's accent. A fixed '#rrggbb', or `{ param }` to follow one of its own
   * color params live (same contract as an instrument's, in instruments/types).
   *
   * REQUIRED in practice: every shipped definition declares one, because chain
   * entries no longer inherit their object instrument's color - see the
   * independence note in `utils/trackDisplayColor.ts`. The fixed values live
   * together in `identityColors.ts` (a palette is only reviewable as a whole),
   * and a definition with a bespoke panel must have the panel IMPORT its
   * constant rather than repeat the hex, so console and notes cannot drift.
   *
   * Use `{ param }` when the entry genuinely IS about a color the user picked -
   * the Colorizer's palette is the case it exists for, where its device row,
   * its notes and its panel all showing the same color is the difference
   * between reading a chain and decoding it.
   */
  identityColor?: string | { param: string }
  /**
   * This definition acts on the DEVICE it is nested under, not on copies, so it
   * only makes sense as a child of a mover/splitter/colorizer track. The Bypass
   * is the only one (bypass.ts).
   *
   * It is `kind: 'mover'` for storage and chrome - the track field, the
   * inspector, the timeline row are all a mover's - but the pickers read this
   * flag: it is kept out of the library shelf and out of the "add mover track"
   * lists on objects and groups, where it would resolve to nothing, and gets
   * its own group on the tracks it can actually gate.
   */
  parentGate?: boolean
  /**
   * Superseded by another definition, but kept registered so existing projects
   * keep resolving. The library demotes it to its shelf's Extras folder (still
   * reachable, out of the first impression) and the track context menu's "Add
   * mover / colorizer / splitter track" lists drop it outright - a right-click
   * menu has no Extras drawer to hide it in, so a back-catalog entry there just
   * competes with the definition that replaced it.
   */
  legacy?: boolean
  /**
   * This definition is a TIME EMITTER: its resolved entries may emit the
   * per-copy clock channel (`MoverOrSplitter.emitsCopyClocks`). Declared on the
   * definition as well as on the resolved entry because the RESOLVER needs the
   * answer before resolving - sibling lanes and prefix walks count the emitters
   * above/below a child by its definition to route each lane's clock (see
   * `clockSkipEmitters` in types.ts). Structural: true regardless of notes.
   */
  emitsCopyClocks?: boolean
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
 *  (automation lanes) never have to consider a string. */
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

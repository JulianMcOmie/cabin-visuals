// Instrument schema types. Kept separate from the core project types.ts (Track/
// Block/Note) since "what an instrument exposes" is a different concern from "what
// a project is". Each instrument owns its own def, colocated with its visual
// component; the registry (./index) just collects them.

import type { FC } from 'react'
import type { UserInterfaceRendererId } from '../userInterfaceRenderers/ids'
import type { PanelSpec } from '../userInterfaceRenderers/console/spec'

// A param is either numeric-valued (number / select / boolean - stored in track.params)
// or string-valued (color / string - stored in track.stringParams). The union keeps the
// numeric engine paths (localTransform / spec / automation) untouched.
interface ParamBase {
  key: string
  label: string
  /** Show this param only while another (numeric) param is "on": visible when
   *  the track's value for `showIf` is >= 0.5. Booleans are 0/1, and counts
   *  work too (e.g. delay params gated on `delayTaps` >= 1). 'key=2' pins to
   *  ONE select value instead (e.g. `layoutMode=1` for a scatter-only
   *  slider). The param keeps its value while hidden - hiding is
   *  presentation only. */
  showIf?: string
}
export interface NumberParamDef extends ParamBase {
  type?: 'number'
  min: number
  max: number
  step: number
  default: number
  /** Slider response exponent (1 = linear, the default). 2 squares the thumb
   *  position, packing most of the travel into the low end - for params whose
   *  useful range spans orders of magnitude (e.g. size down to 0.0001). Curved
   *  sliders round to 3 significant digits instead of snapping to `step`,
   *  which would erase the fine low-end values the curve exists to reach. */
  curve?: number
}
export interface SelectParamDef extends ParamBase {
  type: 'select'
  options: { value: number; label: string }[]
  default: number
}
export interface BooleanParamDef extends ParamBase {
  type: 'boolean'
  default: number // 0 or 1
}
export interface ColorParamDef extends ParamBase {
  type: 'color'
  default: string // '#rrggbb'
}
export interface StringParamDef extends ParamBase {
  type: 'string'
  default: string
  multiline?: boolean
}
export type ParamDef = NumberParamDef | SelectParamDef | BooleanParamDef | ColorParamDef | StringParamDef

/** A param whose value is a string (stored in track.stringParams), not a number. */
export function isStringParam(p: ParamDef): p is ColorParamDef | StringParamDef {
  return p.type === 'color' || p.type === 'string'
}
/** A plain numeric slider param (the only kind automation can target). */
export function isNumberParam(p: ParamDef): p is NumberParamDef {
  return p.type === undefined || p.type === 'number'
}

/** How an ability lane presents pitch in its MIDI editor - a free, per-lane choice
 *  (a pitched piano-roll, drum-style rows, or a single trigger row). Only `pitched`
 *  is wired initially; the field lets an instrument declare intent for later. */
export type EditorKind = 'pitched' | 'drum' | 'trigger'

/**
 * A signature ability of an object instrument - its own MIDI lane. Bespoke and
 * intrinsic: declared *by the instrument*, edited in a nested sub-row, and expressed
 * by the instrument's own render (the code escape hatch for now; a declarative
 * `onAbility` grammar grows from these later). A "lane" here is a whole MIDI editor,
 * not a labelled row. Not generic and not attachable - an ability belongs to one
 * instrument and no other.
 */
export interface AbilityLaneDef {
  key: string
  label: string
  /** Which editor kind this lane uses. Defaults to `pitched`. */
  editor?: EditorKind
  /** Accent colour for the lane's sub-row and its notes. */
  color?: string
}

/**
 * One row of an instrument's MIDI vocabulary. Instruments declare a SHORT,
 * fully-labelled row list (`midiRows`) instead of the full piano: every row
 * says what the note DOES ("Warp forward", "Pulse · hard", "Next word"), and
 * the editor shows only these rows, in the declared order (first = top).
 * Continuous responses (intensity, position) quantize to 5-10 rows; discrete
 * triggers get exactly one row per function.
 */
export interface MidiRowDef {
  pitch: number
  label: string
  color?: string
  emphasized?: boolean
}

/** An object's transform relative to its parent (identity-ish defaults). Position in
 *  world units, rotation as XYZ Euler radians, scale uniform or per-axis.
 *  POSITION and ROTATION are placement: the engine composes them down the hierarchy
 *  into the world transform (see core/visual), so movers and child tracks see them.
 *  SCALE is a mesh property (the instrument's size): it is kept OUT of the world
 *  transform and applied to the mesh itself, BEFORE mover tracks lay out copies and
 *  BEFORE children compose - mover distances and child placements stay in unscaled
 *  world units no matter the size. */
export interface LocalTransform {
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
}

/** Per-frame inputs an instrument's transform derives from. */
export interface TransformCtx {
  params: Record<string, number>
  /** The object's note-pulse signal (see core/visual/energy.ts). */
  energy: number
  beat: number
}

/** An object / source / shape instrument - renders something. */
export interface ObjectInstrumentDef {
  id: string
  name: string
  kind: 'object'
  params: ParamDef[]
  /** The instrument's color identity - what its track wears in the timeline,
   *  piano roll, and editor chrome (all re-voiced through the OKLCH recipes).
   *  A hex literal is a fixed identity; `{ param }` follows that color param's
   *  current value, so recoloring the instrument recolors its MIDI. Omitted:
   *  an instrument with exactly ONE color param follows it automatically;
   *  otherwise the track keeps its hue-cycle color. Near-achromatic derived
   *  values (white/black/grey) also fall back to the cycle - see
   *  utils/trackDisplayColor.ts. */
  identityColor?: string | { param: string }
  /** Registered settings UI. Every instrument explicitly chooses one.
   *  Ignored when `panelSpec` is declared. */
  userInterfaceRenderer: UserInterfaceRendererId
  /** A declarative console panel (userInterfaceRenderers/console/spec.tsx):
   *  accent, optional preview component, rows of knobs/segments. Declaring one
   *  here IS the whole settings UI - no ids.ts entry, no registry entry -
   *  and it wins over `userInterfaceRenderer`. Type-only import: the def
   *  carries data, TrackEditor does the rendering. */
  panelSpec?: PanelSpec
  /** This instrument's signature abilities - each becomes a nested MIDI-lane sub-row
   *  on the track, and its notes are expressed by `component`. Omit for none. */
  abilities?: AbilityLaneDef[]
  /** The instrument's MIDI vocabulary: the ONLY rows its editor shows, in this
   *  order (first entry renders at the top). Omit for the full piano roll. */
  midiRows?: MidiRowDef[]
  /** Settings-dependent MIDI vocabulary: rows derived from the track's current
   *  params (Crop's one row per division). Wins over `midiRows` when both are
   *  declared. Takes a structural slice of Track so this file stays free of the
   *  project types; only the row RESOLVER calls it (resolveDeclaredRows.ts) -
   *  the static call sites (`useLoopBlockDrag`, drop-layer defaults) keep
   *  reading `midiRows` and simply see none for such an instrument. */
  midiRowsFor?: (track: { params?: Record<string, number>; stringParams?: Record<string, string> }) => MidiRowDef[]
  /** This object's transform relative to its parent, per frame. The engine composes
   *  it with its ancestors' transforms; the component renders at the result. Omit for
   *  a non-transforming object (identity). */
  localTransform?: (ctx: TransformCtx) => LocalTransform
  /** The R3F visual; pulls its per-frame state by trackId from the engine. */
  component: FC<{ trackId: string }>
  /** A full-frame instrument sizes itself to the viewport (a screen-filling plane) rather
   *  than sitting at a 3D position. The renderer skips the placement transform + the
   *  transform/clone effect chain for these. */
  fullFrame?: boolean
  /** Full-frame is a MODE this instrument's track switches, not a fixed fact:
   *  the track is full-frame exactly while this numeric param is >= 0.5, and an
   *  ordinary in-scene object otherwise (Oscilloscope's "Fit to screen"). The
   *  on-top pass follows the same param - a screen-pinned overlay that also
   *  depth-sorted against scenery would be neither one thing nor the other.
   *  Read it through `isFullFrameTrack` / `isOnTopTrack`, never directly. */
  fullFrameParam?: string
  /** Tracks of this instrument draw on top of everything by default (the per-track
   *  "In front" toggle overrides). Text wants this: words are captions, not scenery. */
  defaultOnTop?: boolean
}

/** A numeric param's schema default (no track/registry lookup). Non-numeric params → 0. */
export function paramDefault(def: ObjectInstrumentDef, key: string): number {
  const p = def.params.find((p) => p.key === key)
  return p && typeof p.default === 'number' ? p.default : 0
}

/**
 * Is this track full-frame RIGHT NOW - a viewport-filling plane pinned to the
 * camera, with the placement transform and the transform/clone chain skipped?
 *
 * Two sources, deliberately in one function: a fixed `fullFrame` def always is,
 * and a `fullFrameParam` def is whenever that param is on. Both the renderer
 * (which subtree to mount) and the compositor (which pass to draw in) must
 * reach the same answer, so neither reads the flags itself.
 */
export function isFullFrameTrack(
  def: ObjectInstrumentDef | undefined,
  params: Record<string, number> | undefined,
): boolean {
  if (!def) return false
  if (def.fullFrame) return true
  if (!def.fullFrameParam) return false
  return (params?.[def.fullFrameParam] ?? paramDefault(def, def.fullFrameParam)) >= 0.5
}

/** Does this track draw in the depth-cleared on-top pass? The stored per-track
 *  override wins; a mode-switched full-frame instrument is on top exactly while
 *  it IS full-frame; everything else falls back to the def's `defaultOnTop`. */
export function isOnTopTrack(
  def: ObjectInstrumentDef | undefined,
  params: Record<string, number> | undefined,
  onTop: boolean | undefined,
): boolean {
  if (onTop !== undefined) return onTop
  if (def?.fullFrameParam) return isFullFrameTrack(def, params)
  return def?.defaultOnTop ?? false
}

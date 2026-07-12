// Instrument schema types. Kept separate from the core project types.ts (Track/
// Block/Note) since "what an instrument exposes" is a different concern from "what
// a project is". Each instrument owns its own def, colocated with its visual
// component; the registry (./index) just collects them.

import type { FC } from 'react'

// A param is either numeric-valued (number / select / boolean - stored in track.params)
// or string-valued (color / string - stored in track.stringParams). The union keeps the
// numeric engine paths (localTransform / spec / automation) untouched.
interface ParamBase {
  key: string
  label: string
}
export interface NumberParamDef extends ParamBase {
  type?: 'number'
  min: number
  max: number
  step: number
  default: number
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
 *  world units, rotation as XYZ Euler radians, scale uniform or per-axis. The engine
 *  composes these down the hierarchy into a world transform (see core/visual). */
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
  /** This instrument's signature abilities - each becomes a nested MIDI-lane sub-row
   *  on the track, and its notes are expressed by `component`. Omit for none. */
  abilities?: AbilityLaneDef[]
  /** The instrument's MIDI vocabulary: the ONLY rows its editor shows, in this
   *  order (first entry renders at the top). Omit for the full piano roll. */
  midiRows?: MidiRowDef[]
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
  /** Tracks of this instrument draw on top of everything by default (the per-track
   *  "In front" toggle overrides). Text wants this: words are captions, not scenery. */
  defaultOnTop?: boolean
}

/** A numeric param's schema default (no track/registry lookup). Non-numeric params → 0. */
export function paramDefault(def: ObjectInstrumentDef, key: string): number {
  const p = def.params.find((p) => p.key === key)
  return p && typeof p.default === 'number' ? p.default : 0
}

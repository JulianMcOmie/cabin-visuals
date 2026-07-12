// Resolved-graph types - derived by the engine, never persisted. The document
// types (Track/Block/Note) live in src/editor/types.ts; the dependency points one
// way (engine → document), which keeps the editor independent of the engine.

import type { Matrix4 } from 'three'
import type { ElementLayoutCtx, LocalTransform, TransformCtx } from '../../instruments/types'
import type { AdsrEnvelope, InterpolationMode, MidiMode, PhotoPad, SubsetWeightSpec, VideoPad } from '../../types'
import type { AutomationKeyframe } from './automation'
import type { MoverDef } from './movers/types'

export interface StateVector {
  pos: [number, number, number]
  /** Axis-angle vector: direction = axis, length = angle in radians. */
  rot: [number, number, number]
  /** Uniform scale stored as ln(s); composeMatrix applies exp(). */
  logScale: number
  /** Material opacity. Kept out of the matrix, but interpolated with movers. */
  opacity: number
  /** Open scalar channels for later visual state (energy, hue, etc.). */
  aux: Record<string, number>
}

/** A resolved automation lane: keyframes (pitch→value, absolute beats) driving one of
 *  the object's params, interpolated per `mode`. Sampled per frame in computeAtBeat. */
export interface ResolvedAutomation {
  param: string
  mode: InterpolationMode
  keyframes: AutomationKeyframe[]
}

/** A resolved automation lane targeting one effect instance's setting (or its
 *  'enabled' pseudo-param as a 0/1 lane). Sampled per frame in computeAtBeat
 *  into ObjectState.effectOverrides; the effect wrappers merge it over the
 *  instance's stored settings. */
export interface ResolvedEffectAutomation {
  instanceId: string
  key: string
  mode: InterpolationMode
  keyframes: AutomationKeyframe[]
}

/**
 * A resolved `envelope` child track: its notes gate a closed-form ADSR whose gain
 * modulates one target per frame (see adsr.ts + computeAtBeat).
 *  - kind 'opacity': the reserved 'opacity' target - multiplies the object's
 *    rendered opacity by mix(1, gain, depth).
 *  - kind 'param': one of the parent instrument's numeric params - overlays
 *    base + (envTarget - base) * gain * depth on top of automation.
 *  - kind 'fx': an `fx:<instanceId>:<key>` effect setting - same lerp, written
 *    into ObjectState.effectOverrides (fxBase is the stored setting, the fallback
 *    base when no automation lane drives the same key).
 */
export interface ResolvedEnvelope {
  /** The envelope child track's id - syncParams refreshes live-editable fields by it. */
  trackId: string
  kind: 'opacity' | 'param' | 'fx'
  /** kind 'param': the parent instrument's param key. */
  param?: string
  /** kind 'param': the param's default - the lerp base when the user never set it. */
  paramDefault?: number
  /** kind 'fx': the effect instance + setting key. */
  instanceId?: string
  key?: string
  /** kind 'fx': the stored setting value (base when no fx automation lane runs). */
  fxBase?: number
  /** Target bounds - envTarget stays clamped inside them. */
  min: number
  max: number
  /** The value the target reaches at full gain (unused for kind 'opacity'). */
  envTarget: number
  adsr: AdsrEnvelope
  depth: number
  notes: ResolvedNote[]
}

/** One of a track's notes, flattened to absolute project beats, carrying the
 *  bounds of its containing block so the engine can tell which notes are "live". */
export interface ResolvedNote {
  beat: number
  blockStartBeat: number
  blockEndBeat: number
  pitch: number
  velocity: number
  /** Note length in beats - a modifier note's [beat, beat+durationBeats) is its region. */
  durationBeats: number
}

/** A time span (beats) during which a muted object is hidden at render. */
export interface BlackoutRegion {
  start: number
  end: number
}

/** A renderable object instance derived from a track. */
export interface ResolvedObject {
  trackId: string
  instrumentId: string
  /** Hierarchy parent (a track id), for composing transforms down the tree. */
  parentId?: string
  muted: boolean
  params: Record<string, number>
  /** String-valued params (color / string), passed straight to the instrument. */
  stringParams: Record<string, string>
  /** The instrument's local-transform fn (from its def), composed by the engine. */
  localTransform?: (ctx: TransformCtx) => LocalTransform
  elementCount: number
  layoutState?: (ctx: ElementLayoutCtx, out: StateVector) => void
  elementMatrices: Matrix4[]
  elementOpacities: number[]
  /** The object's notes after its child event modifiers (suppress/add/override) fold in. */
  notes: ResolvedNote[]
  /** Blackout spans from `mute` child modifiers - the object is hidden inside them. */
  blackouts: BlackoutRegion[]
  /** This object's ability-lane notes, keyed by the instrument's ability key. The
   *  instrument's own render consumes these (the code escape hatch). Empty if the
   *  instrument declares no abilities or none have been played. */
  abilityEvents: Map<string, ResolvedNote[]>
  /** Automation lanes (from `automation` child tracks) driving this object's params
   *  over time. Sampled per frame in computeAtBeat, overriding the base param value. */
  automations: ResolvedAutomation[]
  /** Automation lanes targeting this object's effect instances. */
  effectAutomations: ResolvedEffectAutomation[]
  /** Envelope lanes (from `envelope` child tracks): note-gated ADSR modulation of
   *  one param / effect setting / the reserved opacity multiplier per lane. */
  envelopes: ResolvedEnvelope[]
  /** Video-instrument-only: ordered pads (fresh array per resolve). */
  videoPads?: VideoPad[]
  /** Photo-instrument-only: ordered photos (fresh array per resolve). */
  photoPads?: PhotoPad[]
  /** Ordered child mover chain. Muted movers are bypassed, not blacked out. */
  moverChain: ResolvedMover[]
  scratchBase: StateVector
  scratchA: StateVector
  scratchB: StateVector
  scratchEntry: StateVector
  scratchAdd: StateVector
  scratchInputs: Record<string, number>
  scratchChannels: Record<string, number>
  /** Cross-cutting group labels - top-level movers target tags (see Routing). */
  tags: string[]
}

export interface ResolvedMover {
  trackId: string
  def: MoverDef
  depth: number
  bypassed: boolean
  inputBase: Record<string, number>
  opMode: 'transform' | 'add'
  midiMode: MidiMode
  midiTargetInput?: string
  interpolation: InterpolationMode
  envelope?: { attack: number; decay: number }
  notes: ResolvedNote[]
  continuousKeyframes: Record<string, AutomationKeyframe[]>
  amountKeyframes: AutomationKeyframe[]
  weight: SubsetWeightSpec
  automations: ResolvedAutomation[]
}

export interface ResolvedGraph {
  objects: ResolvedObject[]
  /** tag → object trackIds, so tag-scoped mover targets expand to a group. */
  tagIndex: Map<string, string[]>
}

/** Per-frame state the renderer pulls for one object. */
export interface ObjectState {
  /** The playhead this frame (fractional beats) - THE time source for instruments.
   *  The pause invariant: every visual is a pure function of this (+ params/notes),
   *  so a static playhead is a static frame and scrub == playback. */
  beat: number
  /** Seconds per beat (60/bpm this frame), for beat-age → seconds conversions. */
  secPerBeat: number
  params: Record<string, number>
  /** Decaying pulse from the object's own most recent note (the old implicit
   *  `energy` port) - the universal "a note just hit" signal instruments read. */
  energy: number
  /** Video-instrument-only: ordered pads (per-resolve identity). */
  videoPads?: VideoPad[]
  /** Photo-instrument-only: ordered photos (per-resolve identity). */
  photoPads?: PhotoPad[]
  /** True this frame if a mute modifier's region covers the current beat (hide it). */
  blackedOut: boolean
  /** World transform (local composed with all ancestors). Reused across frames -
   *  the renderer reads it imperatively in the same frame, after computeAtBeat. */
  world: Matrix4
  elementCount: number
  /** Per-element local matrices for ensemble instruments; empty for single objects. */
  elementMatrices: Matrix4[]
  elementOpacities: number[]
  opacity: number
  /** Color-mover output (HSL offsets applied to every material's base color by
   *  the placement wrapper): hue in wheel turns, sat/light in [-1, 1]. */
  hueShift: number
  satShift: number
  lightShift: number
  /** Sampled effect automation for this frame: instanceId → key → value
   *  ('enabled' as 0/1). Absent when the object has no effect automation. */
  effectOverrides?: Record<string, Record<string, number>>
  /** String-valued params (color / string) for the instrument component. */
  stringParams: Record<string, string>
  /** The object's ability-lane notes (absolute beats), keyed by ability key. The
   *  instrument samples these against the current beat to drive its signature move. */
  abilityEvents: Map<string, ResolvedNote[]>
  /** The object's full resolved note stream (absolute beats, pitch/velocity/duration),
   *  so a pitch-reactive instrument can read it. Static per resolve. */
  notes: ResolvedNote[]
  /** The notes live at the current beat (`beat ∈ [note.beat, note.beat+duration)`),
   *  recomputed each frame - the analogue of Tyler's `activeNotes`. */
  activeNotes: ResolvedNote[]
}

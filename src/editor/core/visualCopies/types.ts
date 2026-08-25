// The VisualCopy pipeline: one instrument track produces one opaque visual
// output, and an ordered chain of movers and splitters describes how many times
// that output is rendered and how each copy is transformed or visually adjusted.
//
// This module is deliberately isolated: it must not import instruments, stores,
// React, ObjectState, StateVector, or project-track types. It operates only on
// generic instructions for rendering copies of an already-processed output.

import type { Matrix4 } from 'three'

/**
 * "Render the same already-processed instrument output once with this transform
 * and these generic appearance adjustments."
 *
 * The contract is closed and small on purpose. Do not add instrument data, MIDI
 * notes, splitter ancestry, custom channels, source-element information, or
 * arbitrary metadata here.
 */
export interface VisualCopy {
  /**
   * Applied on top of the object's existing track/world placement:
   * `final = existing placement * transform`. Position, orientation, and scale
   * all live here; self-rotation vs orbit are different COMPOSITION operations
   * (local: `previous * delta`; chain-root: `delta * previous`), and each
   * mover/splitter definition must document which one it uses.
   *
   * The DEFAULT convention is LOCAL composition: each chain entry re-frames
   * the entries below it, so the accumulated transform IS the copy's reference
   * frame (a splitter that rotates copies makes downstream translations move
   * each copy along its own axes). No separate frame matrix is needed -
   * a definition wanting frame-independent (chain-root) motion opts out by
   * pre-multiplying instead.
   */
  transform: Matrix4
  /** Multiplied into the object's existing rendered opacity (0..1). */
  opacity: number
  /**
   * Added to the object's instrument-declared color parameters before the
   * instrument renders. Units match three.js `Color.offsetHSL`: hue is a
   * normalized turn (1 = full wheel), saturation and lightness are additive
   * offsets. This deliberately does not tint final materials: instruments keep
   * ownership of emissive, lighting, shader, and HDR color calculations.
   */
  colorShift: {
    hue: number
    saturation: number
    lightness: number
    /**
     * An ABSOLUTE color to pull the object's declared colors toward, as
     * '#rrggbb', or null for none. The HSL fields above can only ever nudge a
     * color relative to whatever it already is, which cannot express "flash
     * this gold" - a mover never sees the object's own color. The mix therefore
     * happens where the source IS known (instrumentColor.ts): lerp toward
     * `tint` by `tintAmount` FIRST, then apply the HSL offsets on top.
     *
     * Still not a material tint: it retargets the same instrument-declared
     * color *params*, so instruments keep ownership of emissive, lighting,
     * shader, and HDR calculations.
     *
     * Chain rule: a tint REPLACES rather than accumulates - the last entry to
     * set one owns the color. Two colorizers averaging their targets would make
     * neither one's setting mean what it says.
     */
    tint: string | null
    /** How far toward `tint` to pull, 0..1. Ignored when `tint` is null. */
    tintAmount: number
    /**
     * Walk toward `tint` in OKLab rather than by a straight channel lerp.
     * OPTIONAL, defaulting to false - a straight lerp is what every definition
     * written before this field did, and existing saves keep looking the way
     * they were authored.
     *
     * It matters at PARTIAL `tintAmount`, which is where a note colorizer
     * spends nearly all of its time: a channel lerp between two saturated
     * colors sags through a desaturated middle, so a flash caught at 0.5 reads
     * as a wash rather than as the color it was pointed at. Set this and the
     * halfway point still looks like the picked color, just less of it.
     *
     * Only the tint mix changes. The HSL offsets above still ride on top in
     * three's own units, and `tint` is still an absolute target that REPLACES
     * rather than accumulates.
     */
    tintPerceptual?: boolean
    /**
     * Turn `hue` in OKLCH rather than in HSL. OPTIONAL, defaulting to false -
     * `Color.offsetHSL` is what every definition written before this field did,
     * and existing saves keep looking the way they were authored.
     *
     * HSL's hue circle is not perceptual: its yellows are far lighter than its
     * blues at the same nominal lightness, so a hue sweep in HSL PULSES in
     * brightness twice a turn, and an object's lit form flattens out every time
     * the sweep passes through yellow. OKLCH holds lightness and chroma while
     * only the hue turns, so the object keeps its shading - which is what makes
     * a rotation safe to automate across a whole turn rather than nudge.
     *
     * Only the hue turn changes. `saturation` and `lightness` still ride on top
     * in three's own HSL units, because they are offsets someone dialled in
     * against that scale.
     */
    huePerceptual?: boolean
  }
}

/** Per-copy evaluation context for one chain step. `index`/`count` describe the
 *  complete result of the PREVIOUS step, so downstream movers can react to the
 *  multiplicity created by upstream splitters. */
export interface MoverOrSplitterContext {
  /**
   * The beat this copy's chain runs at. Usually the object's beat - but an
   * emitter above (Stagger) shifts it per copy via `FramedVisualCopy.beatOffset`,
   * so entries below one see each copy's OWN clock (its age within the
   * emitter's cycle). Entries never need to know which: evaluating at
   * `context.beat` is always correct.
   */
  beat: number
  index: number
  count: number
  /**
   * The absolute beat this copy was BORN at, when an emitter above declared
   * one (Stagger: the copy's last cycle wrap). Undefined on ordinary chains.
   *
   * This is the LATCH clock: a sequenced entry may sample its own notes at
   * this instant instead of at `context.beat`, so every copy keeps the value
   * its sequence held at its birth for its whole flight (the Colorizer's
   * "At birth" sample mode). Expressed in the clock of the chain ABOVE the
   * emitting entry - the real timeline unless emitters nest.
   */
  birthBeat?: number
  /**
   * The object's placement before this VisualCopy transform is applied. Runtime
   * evaluation supplies it so world-space movers can react to the actual object
   * position; direct/test evaluation may omit it and gets an identity placement.
   * Treat it as immutable.
   */
  placementTransform?: Matrix4
  /**
   * Every copy this step is about to transform, in index order - the FORMATION
   * the entries above it built, of which this copy is `index` of `count`.
   *
   * A mover needs this when what it does to one copy depends on how the others
   * are arranged: Conveyor loops each copy at the formation's own repeat
   * distance, which is the only way a per-copy wrap can leave the arrangement
   * intact (wrapping at some other distance tears it apart). It is a WINDOW on
   * the same objects, not a copy of them - treat it as immutable, and note that
   * the array identity is stable across one step, which is what makes memoizing
   * a derived measurement safe.
   *
   * Runtime evaluation supplies it; direct/test evaluation may omit it, and a
   * definition that reads it must then treat its own copy as the whole
   * formation.
   */
  formation?: readonly VisualCopy[]
}

/**
 * One chain step's output when the entry separates the copy's REFERENCE FRAME
 * from motion INTERNAL to it. `visualCopy.transform` is the frame - the thing
 * downstream chain entries compose against, unchanged by the internal motion.
 * `internalTransform` is applied at render time only (frame · internal), is
 * inherited by every downstream copy derived from this one, and composes
 * inside inherited internal motion (deepest contributor innermost). This is
 * what lets a mover nested under a splitter animate the splitter's formation
 * without re-framing the entries below it: a second grid duplicates a SPINNING
 * sub-grid instead of laying its cells out in a spinning frame.
 */
export interface FramedVisualCopy {
  visualCopy: VisualCopy
  internalTransform?: Matrix4
  /**
   * OPTIONAL: this copy's chain-clock LAG, in beats. The kernel evaluates every
   * entry BELOW the emitting one at `context.beat = beat − offset` for this
   * copy and its descendants; nested emitters' offsets SUM (each measures its
   * own in the already-shifted clock it was handed). It shifts the CHAIN's
   * clock only - never the instrument's own animation/notes/energy, the
   * object-level automation overlay, envelopes, or `warpBeat` (which stays
   * object-wide at the real beat). Purity holds: the offset is recomputed per
   * evaluation as a function of the incoming beat, so a copy is still a pure
   * function of the playhead.
   */
  beatOffset?: number
  /**
   * OPTIONAL: the absolute beat this copy was BORN at - the latch clock
   * `MoverOrSplitterContext.birthBeat` carries to entries below. An emitter
   * that loops copies through a cycle (Stagger) sets it to each copy's last
   * wrap; a later emitter OVERWRITES it (its births supersede an ancestor's),
   * while ordinary entries inherit it untouched.
   */
  birthBeat?: number
}

/**
 * One resolved chain entry: receives one copy, returns one or more copies. A
 * mover normally returns a one-item array; a splitter returns multiple items.
 *
 * Contract for definitions:
 *  - Treat the incoming copy as immutable; return new VisualCopy values with
 *    independently owned matrices.
 *  - Evaluation must be a pure function of (visualCopy, context) plus immutable
 *    resolved data closed over at resolve time, so pause, scrub, playback, and
 *    export agree exactly.
 *  - The NUMBER of returned copies must not depend on `beat`. A splitter's
 *    configured copy count is structural; MIDI gates copies by driving opacity
 *    to zero, never by removing slots, so downstream indices stay stable.
 *    An entry whose SETTINGS legitimately vary per beat (see
 *    `structuralVariants`) may return fewer copies than its structural
 *    maximum - the runtime pads the difference with hidden copies - but never
 *    more.
 */
export interface MoverOrSplitter {
  apply(visualCopy: VisualCopy, context: MoverOrSplitterContext): VisualCopy[]
  /**
   * OPTIONAL: the composition convention this entry's transform uses, as
   * documented on `VisualCopy.transform`. 'local' (the default when absent)
   * post-multiplies (`previous · delta`); 'chainRoot' PRE-multiplies
   * (`delta · previous`) and may read the incoming copy's chain-frame
   * position to aim its delta (Symmetric Motion). Ordinary chain evaluation
   * never consults it - the entry composes its own output - but a splitter's
   * CHILD chain (splitterChildChain.ts) must re-anchor LOCAL deltas about the
   * splitter's origin while taking chain-root deltas as-is, since those are
   * already expressed on the frame's fixed axes. A chain-root definition that
   * omits this still behaves correctly under translation-only splitters
   * (grids), where the two anchorings coincide.
   */
  composition?: 'local' | 'chainRoot'
  /**
   * OPTIONAL: like `apply`, but separates each output copy's reference frame
   * from motion internal to it (see `FramedVisualCopy`). The chain kernel
   * prefers this when present, carries each copy's accumulated internal motion
   * through the remaining steps, and folds it into the final transforms it
   * returns; `apply` must return the same copies with the internal motion
   * folded in immediately (`frame · internal`), which is what direct callers
   * and a chain's LAST entry observe either way. Implemented by
   * splitterChildChain (internal motion) and by TIME EMITTERS (Stagger), whose
   * per-copy `beatOffset`/`birthBeat` ride this channel - a time field dropped
   * by `apply` is unobservable there, since it only steers entries below.
   * Ordinary spatial definitions never need it.
   */
  applyFramed?(visualCopy: VisualCopy, context: MoverOrSplitterContext): FramedVisualCopy[]
  /**
   * OPTIONAL: alternative resolutions of this same entry whose output COUNTS
   * bracket everything `apply` can ever produce. The runtime attaches these
   * when an entry's settings vary with the beat (an automated mover), resolving
   * the definition once with every varying param at its maximum reach and once
   * at its minimum; the engine sizes the MOUNTED copy pool against them instead
   * of against a single-beat sample, so a count that breathes with automation
   * always fits. Probe-only - never applied to render a frame - and sound as
   * long as an entry's count is monotonic in each of its params (true of every
   * shipped definition; the engine's overflow clamp backstops the rest).
   */
  structuralVariants?: readonly MoverOrSplitter[]
  /**
   * OPTIONAL, and the one thing a chain entry may say about time rather than
   * space: remap the beat the whole object is evaluated at.
   *
   * `apply` can only ever restate the copy it is handed, computed at the
   * current beat - it cannot un-compute the instrument animation, automation
   * lanes or upstream mover motion baked into the placement below it. Freezing
   * or reversing an object therefore cannot be a transform; it has to be a
   * change of WHEN. An entry that implements this receives the REAL playhead
   * beat and returns the beat its object should be evaluated at instead, and
   * `computeAtBeat` applies the result to everything about that object: energy,
   * automation, envelopes, localTransform, active notes, and the entire chain
   * (this entry's own position in the chain is irrelevant - the remap is
   * object-wide, not a partition of the chain).
   *
   * Must be a pure function of the beat plus resolved data, like `apply`.
   * Several entries compose by SUMMING their deltas against the real beat, so
   * each one keeps reading its own notes at their true timeline positions.
   */
  warpBeat?(beat: number): number
  /**
   * OPTIONAL, and the one thing a chain entry may say about ANOTHER entry
   * rather than about a copy: "the device I am nested under is switched off at
   * this beat".
   *
   * `apply` can only restate the copy it is handed, so "make this rotation stop
   * contributing" is not something a chain entry can express - and for a
   * splitter it is not even a matrix, it is a copy count. An entry that
   * implements this contributes nothing itself; core/visual/resolve.ts lifts it
   * off the entry, keeps it OUT of the parent's frame/child chain, and wraps
   * the parent in `bypassGated` (bypass.ts) instead.
   *
   * Must be a pure function of the beat plus resolved data, like `apply`.
   * Several gates on one parent compose by OR.
   */
  bypassAt?(beat: number): boolean
}

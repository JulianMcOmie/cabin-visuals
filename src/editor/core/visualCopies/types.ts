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
  }
}

/** Per-copy evaluation context for one chain step. `index`/`count` describe the
 *  complete result of the PREVIOUS step, so downstream movers can react to the
 *  multiplicity created by upstream splitters. */
export interface MoverOrSplitterContext {
  beat: number
  index: number
  count: number
  /**
   * The object's placement before this VisualCopy transform is applied. Runtime
   * evaluation supplies it so world-space movers can react to the actual object
   * position; direct/test evaluation may omit it and gets an identity placement.
   * Treat it as immutable.
   */
  placementTransform?: Matrix4
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
 */
export interface MoverOrSplitter {
  apply(visualCopy: VisualCopy, context: MoverOrSplitterContext): VisualCopy[]
}

// Bypass: the one device that acts on ANOTHER DEVICE rather than on copies.
//
// Nest it under a mover, splitter or colorizer and its notes switch that parent
// off: while a note is held the parent evaluates to identity - the rotation
// stops contributing, the grid collapses back to the single object, the
// colorizer stops tinting - and everything else in the chain keeps running. The
// MODE segment flips the polarity, so the parent can instead be off at rest and
// switched ON for the length of each note.
//
// ── Why this is not an entry in the chain ────────────────────────────────────
//
// Every other definition here answers "what do I do to this copy". A bypass has
// no answer: it is a statement about the device it is nested under, so it
// contributes no transform, no opacity and no colorShift, and its `apply` is the
// identity. What it really exports is `bypassAt` (an optional field on
// MoverOrSplitter, in the same spirit as `warpBeat`: the escape hatch a chain
// entry uses to say something the copy contract cannot) plus `bypassGated`,
// the wrapper resolve.ts puts around the parent.
//
// It is therefore excluded from the chain the parent's children build - a
// bypass under a MOVER is not part of that mover's frame, and under a SPLITTER
// it is not part of the child chain. `isChainEntryTrack` in core/visual/resolve.ts
// is the one predicate that says so, and every walk over a track's chain
// children shares it so the entry lists cannot drift out of step with each
// other.
//
// ── Bypassing a SPLITTER varies the copy count with the beat ─────────────────
//
// Which the module's central invariant forbids... for a definition's own
// settings. The sanctioned way out is the same one automated movers take:
// `bypassGated` publishes the UNGATED entry as a `structuralVariant`, so the
// structural probe sizes the mounted pool against the splitter running at full
// fan-out and the frames where it is bypassed are simply padded with hidden
// copies (VisualEngine's computeAtBeat). The pool is never overflowed, which is
// the property the invariant exists to protect; what a gated splitter does is
// return FEWER copies, which the runtime already handles.
//
// ── The gate is binary on purpose ───────────────────────────────────────────
//
// There is no depth or blend knob. A chain entry's contribution is a matrix,
// and "half a mover" is not a well-defined interpolation of one (a splitter's
// is not even a matrix - it is a copy count). Anything shaped like a fade
// already has a home: automate the parent's own params, or reach for Visibility
// when what you want is the object dimming rather than the device stopping.

import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { BYPASS_COLOR } from './identityColors'
import type { MoverOrSplitter } from './types'

export const BYPASS_ID = 'bypass'

/** MODE values for `BypassSettings.mode`. */
export const BYPASS_ON_NOTE = 0
export const BYPASS_ON_REST = 1

/** One row, on middle C. A bypass has exactly one thing to say, and saying it
 *  needs no pitch vocabulary - so the pitch is frozen here rather than being a
 *  scale the user has to decode. */
export const BYPASS_PITCH = 60

/** A zero-length note still holds for a hair, matching the engine's convention
 *  for single-tick triggers everywhere else (Freeze's `MIN_HELD_BEATS`). */
const MIN_HELD_BEATS = 0.05

export interface BypassSettings {
  /** BYPASS_ON_NOTE or BYPASS_ON_REST - see BYPASS_PARAMS. */
  mode: number
}

const BYPASS_PARAMS: ParamDef[] = [
  {
    key: 'mode',
    label: 'Notes',
    type: 'select',
    options: [
      // The parent runs normally and each note switches it OFF for its length.
      { value: BYPASS_ON_NOTE, label: 'Switch off' },
      // The mirror image: the parent is off until played, so the device only
      // exists for the length of a note. This is the half that makes a Bypass
      // worth having over simply muting the parent - a muted device is off for
      // the whole timeline, this one is off between the notes.
      { value: BYPASS_ON_REST, label: 'Switch on' },
    ],
    default: BYPASS_ON_NOTE,
  },
]

function bypassRows(settings: BypassSettings): MidiRowDef[] {
  return [{
    pitch: BYPASS_PITCH,
    label: Math.round(settings.mode) === BYPASS_ON_REST ? 'Switch parent on' : 'Switch parent off',
  }]
}

/** True while a note is sounding at `beat`. */
function noteHeld(notes: readonly ResolvedNote[], beat: number): boolean {
  for (const note of notes) {
    if (note.pitch !== BYPASS_PITCH) continue
    if (beat < note.beat) continue
    if (beat < note.beat + Math.max(note.durationBeats || 0, MIN_HELD_BEATS)) return true
  }
  return false
}

/**
 * Whether the parent device is bypassed at `beat`. Pure, and exported so the
 * settings UI and the tests read the same gate the stage runs.
 */
export function evaluateBypassed(
  notes: readonly ResolvedNote[],
  settings: BypassSettings,
  beat: number,
): boolean {
  const held = noteHeld(notes, beat)
  return Math.round(settings.mode) === BYPASS_ON_REST ? !held : held
}

/**
 * Wraps a resolved device so its bypass lanes can switch it off per beat.
 *
 * Several lanes compose by OR: any lane saying "bypassed" bypasses the device,
 * which is the only reading under which adding a second lane cannot silently
 * weaken the first. No lanes returns `entry` untouched, so an ordinary device
 * pays nothing for this.
 *
 * Note what each arm is asked about. `apply` gates on `context.beat`, the beat
 * the OBJECT is being evaluated at (post-`warpBeat`), because that is the beat
 * every other device in the chain reads its own notes at. `warpBeat` gates on
 * the real playhead beat it is handed, because a remap is asked about real time
 * by contract - so bypassing a Freeze un-freezes the object, which is the whole
 * point of being able to put a Bypass under one.
 */
export function bypassGated(
  entry: MoverOrSplitter,
  gates: readonly ((beat: number) => boolean)[],
): MoverOrSplitter {
  if (gates.length === 0) return entry
  const bypassed = (beat: number) => gates.some((gate) => gate(beat))

  const gated: MoverOrSplitter = {
    apply(visualCopy, context) {
      // Passing the copy through unchanged is the module's own convention for
      // "this entry declines to act" (copyTargets.ts's untargeted copies), and
      // it is what keeps a bypassed device count-neutral instead of hiding
      // anything.
      if (bypassed(context.beat)) return [visualCopy]
      return entry.apply(visualCopy, context)
    },
  }
  if (entry.composition) gated.composition = entry.composition
  if (entry.emitsCopyClocks) gated.emitsCopyClocks = true
  if (entry.applyFramed) {
    const applyFramed = entry.applyFramed.bind(entry)
    gated.applyFramed = (visualCopy, context) => (
      // No `internalTransform`: the kernel reads its absence as "this entry
      // contributed no internal motion", leaving whatever the copy inherited.
      bypassed(context.beat) ? [{ visualCopy }] : applyFramed(visualCopy, context)
    )
  }
  if (entry.warpBeat) {
    const warpBeat = entry.warpBeat.bind(entry)
    gated.warpBeat = (beat) => (bypassed(beat) ? beat : warpBeat(beat))
  }
  // The ungated entry heads the variant list, so the structural probe sizes the
  // mounted copy pool against the device running at full fan-out. Without this
  // a splitter that happens to be bypassed at beat 0 - the beat the probe
  // samples - would mount a pool of one and every later frame would overflow it.
  gated.structuralVariants = [entry, ...(entry.structuralVariants ?? [])]
  return gated
}

export const bypassMover: MoverOrSplitterDefinition<BypassSettings> = {
  id: BYPASS_ID,
  label: 'Bypass',
  kind: 'mover',
  parentGate: true,
  identityColor: BYPASS_COLOR,
  params: BYPASS_PARAMS,
  midiRows: bypassRows,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    return {
      // A bypass contributes nothing of its own; the copy passes through with
      // its own matrix, per the contract. Everything it does is in `bypassAt`,
      // which resolve.ts lifts off the lane and hands to `bypassGated`.
      apply(visualCopy) {
        return [{
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
      bypassAt(beat) {
        return evaluateBypassed(notes, settings, beat)
      },
    }
  },
}

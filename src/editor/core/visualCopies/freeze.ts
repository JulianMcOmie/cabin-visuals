// Freeze: the one mover that edits TIME instead of space.
//
// Two rows. Hold FREEZE and the objects it targets stop dead at the instant the
// note landed - not just their mover motion, but their instrument animation,
// automation lanes, envelopes and note reactions too. Hold REVERSE and the same
// performance runs backwards out of that instant, retracing exactly the path it
// arrived by.
//
// Both are the same operation at different rates: a piecewise-linear remap of
// the beat the whole object is evaluated at. Normal time runs at rate +1, a
// held freeze at rate 0, a held reverse at rate -1. That is why they share one
// mover rather than being two - and why the result is still a pure function of
// the playhead beat, so pause, scrub, playback and export land identical
// frames. Nothing here remembers a previous frame.
//
// The remap reaches the whole object (see `warpBeat` on the MoverOrSplitter
// contract, folded in by core/visual/VisualEngine's computeAtBeat), which is
// what makes a frozen object a genuine still frame instead of a still frame of
// a thing that is visibly still wobbling.

import type { MidiRowDef, ParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { FREEZE_COLOR } from './identityColors'

/** Freeze sits on middle C with Reverse a whole step above it: two rows the
 *  user reads as one gesture and its undo, not a keyboard to decode. */
export const FREEZE_HOLD_PITCH = 60
export const FREEZE_REVERSE_PITCH = 62

/** Release modes for `FreezeSettings.release`. */
export const RELEASE_CONTINUE = 0
export const RELEASE_SNAP = 1

/** A zero-length note still holds for a hair, matching the engine's convention
 *  for single-tick triggers everywhere else (`durationBeats || 0.05`). */
const MIN_HELD_BEATS = 0.05

export interface FreezeSettings {
  /** RELEASE_CONTINUE or RELEASE_SNAP - see FREEZE_PARAMS for what they mean. */
  release: number
}

const FREEZE_PARAMS: ParamDef[] = [
  {
    key: 'release',
    label: 'On release',
    type: 'select',
    options: [
      // CONTINUE treats the held time as a debt the track carries forever
      // after: a 2-beat freeze leaves everything permanently 2 beats behind, so
      // motion resumes from precisely where it stopped with no visual jump, and
      // freezes stack. SNAP makes each note independent - time returns to the
      // true beat the moment the note ends, so the object cuts to wherever it
      // would have been had it never frozen.
      { value: RELEASE_CONTINUE, label: 'Continue' },
      { value: RELEASE_SNAP, label: 'Snap back' },
    ],
    default: RELEASE_CONTINUE,
  },
]

const FREEZE_ROWS: MidiRowDef[] = [
  { pitch: FREEZE_HOLD_PITCH, label: 'Freeze' },
  { pitch: FREEZE_REVERSE_PITCH, label: 'Reverse' },
]

/** One stretch of remapped time: `[start, end)` running at `rate` instead of
 *  the usual +1. Only abnormal stretches are stored; the gaps between them are
 *  ordinary forward time. */
interface TimeSpan {
  start: number
  end: number
  /** 0 while frozen, -1 while reversing. */
  rate: number
}

/**
 * The track's notes as an ordered, non-overlapping list of abnormal-rate spans.
 *
 * Notes are allowed to overlap on the timeline, so the spans are cut at every
 * note edge and each resulting slice is classified independently. REVERSE wins
 * wherever both are held: freeze is the weaker statement (stop) and reverse the
 * stronger one (go the other way), so a reverse note layered over a freeze
 * reads as "actually, rewind" rather than as a contradiction.
 *
 * Adjacent slices are deliberately NOT merged. Under Snap back each slice holds
 * at its OWN start, so merging two back-to-back freeze notes would silently
 * change what the second one does.
 */
export function buildFreezeSpans(notes: readonly ResolvedNote[]): TimeSpan[] {
  const held = notes
    .filter((note) => note.pitch === FREEZE_HOLD_PITCH || note.pitch === FREEZE_REVERSE_PITCH)
    .map((note) => ({
      start: note.beat,
      end: note.beat + Math.max(note.durationBeats || 0, MIN_HELD_BEATS),
      rate: note.pitch === FREEZE_REVERSE_PITCH ? -1 : 0,
    }))
  if (held.length === 0) return []

  const edges = [...new Set(held.flatMap((span) => [span.start, span.end]))].sort((a, b) => a - b)
  const spans: TimeSpan[] = []
  for (let i = 0; i < edges.length - 1; i++) {
    const start = edges[i]
    const end = edges[i + 1]
    if (end <= start) continue
    const midpoint = (start + end) / 2
    let rate = 1
    for (const span of held) {
      if (midpoint < span.start || midpoint >= span.end) continue
      if (span.rate === -1) {
        rate = -1
        break
      }
      rate = 0
    }
    if (rate === 1) continue
    spans.push({ start, end, rate })
  }
  return spans
}

/** How much warped time each span costs: a freeze loses one beat per beat, a
 *  reverse loses two (the one it does not advance plus the one it gives back). */
function deficitRate(rate: number): number {
  return 1 - rate
}

/** Total time debt owed BEFORE each span begins, so the continuous remap is a
 *  binary search rather than a walk over every note the track ever played. */
function cumulativeDeficits(spans: readonly TimeSpan[]): number[] {
  let running = 0
  return spans.map((span) => {
    const before = running
    running += deficitRate(span.rate) * (span.end - span.start)
    return before
  })
}

/** Index of the last span starting at or before `beat`, or -1. */
function spanIndexAt(spans: readonly TimeSpan[], beat: number): number {
  let low = 0
  let high = spans.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (spans[mid].start <= beat) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found
}

/** Continuous mode: warped time is the real beat minus every beat of debt
 *  accrued so far, which makes the remap unbroken across note edges. */
function continuousWarp(spans: readonly TimeSpan[], deficits: readonly number[], beat: number): number {
  const index = spanIndexAt(spans, beat)
  if (index < 0) return beat
  const span = spans[index]
  const insideSpan = Math.max(0, Math.min(beat, span.end) - span.start)
  return beat - (deficits[index] + deficitRate(span.rate) * insideSpan)
}

/** Snap-back mode: each span acts alone and only while it is held. */
function snapWarp(spans: readonly TimeSpan[], beat: number): number {
  const index = spanIndexAt(spans, beat)
  if (index < 0) return beat
  const span = spans[index]
  if (beat >= span.end) return beat
  // Frozen: hold the instant the span began. Reversing: mirror around it, so
  // the object retraces the run-up to the note at the speed it arrived.
  return span.rate === 0 ? span.start : span.start - (beat - span.start)
}

/**
 * The beat this track's objects should be evaluated at, given the real
 * playhead beat. Pure, and exported so the settings UI and tests read the exact
 * same map the stage runs.
 */
export function evaluateFreezeWarp(
  notes: readonly ResolvedNote[],
  settings: FreezeSettings,
  beat: number,
): number {
  const spans = buildFreezeSpans(notes)
  if (spans.length === 0) return beat
  return Math.round(settings.release) === RELEASE_SNAP
    ? snapWarp(spans, beat)
    : continuousWarp(spans, cumulativeDeficits(spans), beat)
}

export const freezeMover: MoverOrSplitterDefinition<FreezeSettings> = {
  id: 'freeze',
  label: 'Freeze',
  kind: 'mover',
  identityColor: FREEZE_COLOR,
  params: FREEZE_PARAMS,
  midiRows: () => FREEZE_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const spans = buildFreezeSpans(notes)
    const deficits = cumulativeDeficits(spans)
    const snap = Math.round(settings.release) === RELEASE_SNAP
    return {
      // Freeze contributes no transform of its own: it says WHEN the rest of
      // the chain is evaluated, not where. Pass the copy through untouched
      // (with its own matrix, per the contract) and let warpBeat do the work.
      apply(visualCopy) {
        return [{
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }]
      },
      warpBeat(beat) {
        if (spans.length === 0) return beat
        return snap ? snapWarp(spans, beat) : continuousWarp(spans, deficits, beat)
      },
    }
  },
}

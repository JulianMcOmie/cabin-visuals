// Switcher: a rack of alternative DEVICES with one MIDI lane over them.
//
// Every other file here answers "what do I do to this copy". A switcher answers
// "which of these devices is running", and it answers it for a whole SPAN of the
// chain rather than for one slot. Its children are spliced into the chain it
// sits in - contiguously, in child order - each wrapped in the gate below, so:
//
//   **Gate mode with every row held is bit-identical to those devices being
//   plain chain siblings, with no switcher at all.**
//
// That property is the design. Exclusivity, latching and the empty lane are all
// restrictions on WHICH SUBSET of the span runs; none of them changes how the
// running entries compose. `switcher.test.ts` pins the identity directly.
//
// ── Why the children are spliced rather than delegated to ────────────────────
//
// The obvious shape - one entry whose `apply` runs a sub-chain internally - is
// wrong, and quietly. `apply` is called PER COPY by the kernel, so entries
// inside a nested sub-chain would see `index`/`count`/`formation` describing
// that one copy's private fan-out instead of the real formation, and every
// position-reading device (Symmetric Motion, a world-placed field, Conveyor's
// belt period) would measure the wrong thing. Handing them to the real kernel
// as real siblings means the problem does not exist - and it lets each child
// keep its own `composition` declaration, which a folded-together entry could
// not have expressed for a mixed set.
//
// ── Chain order is CHILD order, never onset order ────────────────────────────
//
// A held chord composes in child order however it was played. Chain order is
// spatial semantics (a Motion above an Impact Scatter drifts the object away
// from the blast; below it the blast stays full strength), so letting
// performance order set it would make the same chord render differently
// depending on how you arrived at it, and scrubbing into a simultaneous onset
// would have no defined answer.

import type { MidiRowDef, SelectParamDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitter } from './types'

/** MODE values for `SwitcherSettings.mode`. APPEND-ONLY: a track stores the
 *  number, so renumbering would silently re-mode every saved project. */
export const SWITCHER_GATE = 0
export const SWITCHER_TOGGLE = 1
export const SWITCHER_SOLO = 2
export const SWITCHER_LATCH = 3

/** Child rows count up from here; `orderedSwitcherBindings` never assigns below
 *  it, which is what keeps the None row's pitch free forever. */
export const SWITCHER_FIRST_PITCH = 60

/** The one reserved row, below the child block: "nothing running". Under Latch
 *  there is otherwise no way to say it - the most recent onset always owns the
 *  beat - and giving it a meaning in the other three modes costs nothing (see
 *  `liveChildrenAt`). The Mover's Return row at pitch 66 is the precedent for a
 *  reserved row that means "back to neutral". */
export const SWITCHER_NONE_PITCH = 59

/** A zero-length note still holds for a hair, matching the engine's convention
 *  for single-tick triggers everywhere else (Bypass, Freeze). */
const MIN_HELD_BEATS = 0.05

export interface SwitcherSettings {
  /** One of the SWITCHER_* constants above. */
  mode: number
}

/** One row of the lane: a pitch, and which child (by position in the spliced
 *  span) it addresses. Deliberately not the track id - this module never learns
 *  what a project track is. */
export interface SwitcherBinding {
  pitch: number
  index: number
}

export const SWITCHER_MODE_PARAM: SelectParamDef = {
  key: 'mode',
  label: 'Mode',
  type: 'select',
  options: [
    { value: SWITCHER_GATE, label: 'Gate' },
    { value: SWITCHER_TOGGLE, label: 'Toggle' },
    { value: SWITCHER_SOLO, label: 'Solo' },
    { value: SWITCHER_LATCH, label: 'Latch' },
  ],
  default: SWITCHER_GATE,
}

/** What each mode does, in one sentence, for the panel's description line. The
 *  copy lives beside the evaluator so the two cannot drift. */
export const SWITCHER_MODE_HINTS: Record<number, string> = {
  [SWITCHER_GATE]: 'Every device whose row is sounding runs, composed in child order.',
  [SWITCHER_TOGGLE]: 'Each row switches its device on and off as you tap it. Editing one note flips that device for the rest of the timeline.',
  [SWITCHER_SOLO]: 'Only the newest sounding row runs. Nothing runs between notes.',
  [SWITCHER_LATCH]: 'The last row played keeps running until the next one.',
}

/** Solo and Latch leave at most one child running. This is the flag the
 *  structural budget reads too: an exclusive switcher's copy ceiling is the
 *  LARGEST child rather than the product of all of them (see
 *  `switcherVariantsFor`). */
export function switcherExclusive(mode: number): boolean {
  const m = Math.round(mode)
  return m === SWITCHER_SOLO || m === SWITCHER_LATCH
}

function heldAt(note: ResolvedNote, beat: number): boolean {
  return beat >= note.beat && beat < note.beat + Math.max(note.durationBeats || 0, MIN_HELD_BEATS)
}

/**
 * Which children are running at `beat`, as indices into the spliced span, in
 * ascending (child) order.
 *
 * **An empty lane returns every child.** That is not a special case bolted on -
 * it is the full subset, i.e. the transparent span this file's header
 * describes, and it is what makes wrapping devices in a switcher
 * non-destructive: the picture does not change until you play it. Same
 * convention as the `scene` composition def, which exists precisely because
 * Scene Switcher rendering nothing until played made a freshly dropped track
 * look broken. The discontinuity is real and deliberate: drawing the FIRST note
 * narrows the set to whatever the mode says.
 *
 * Pure, and the only place the mode is read - the panel, the roll's row
 * highlight and the stage all come through here, so they cannot disagree.
 */
export function liveChildrenAt(
  bindings: readonly SwitcherBinding[],
  notes: readonly ResolvedNote[],
  settings: SwitcherSettings,
  beat: number,
): number[] {
  const all = bindings.map((b) => b.index).sort((a, b) => a - b)
  if (notes.length === 0) return all

  const indexByPitch = new Map<number, number>()
  for (const b of bindings) indexByPitch.set(b.pitch, b.index)
  const mode = Math.round(settings.mode)

  if (mode === SWITCHER_GATE) {
    const live = new Set<number>()
    for (const note of notes) {
      if (!heldAt(note, beat)) continue
      // A held None row silences the whole rack for its length - the same thing
      // it means everywhere else, stated in the mode where several rows can be
      // on at once.
      if (note.pitch === SWITCHER_NONE_PITCH) return []
      const index = indexByPitch.get(note.pitch)
      if (index !== undefined) live.add(index)
    }
    return [...live].sort((a, b) => a - b)
  }

  if (mode === SWITCHER_TOGGLE) {
    // Parity of onsets, restarted by the most recent None. Pure and
    // deterministic, but it does NOT self-correct: inserting or deleting one
    // note flips that child for the entire rest of the timeline, where Latch
    // heals at its next onset. That is the price of not having to hold notes,
    // and the panel says so.
    let since = -Infinity
    for (const note of notes) {
      if (note.pitch !== SWITCHER_NONE_PITCH || note.beat > beat) continue
      if (note.beat > since) since = note.beat
    }
    const flips = new Map<number, number>()
    for (const note of notes) {
      if (note.beat > beat || note.beat < since) continue
      const index = indexByPitch.get(note.pitch)
      if (index === undefined) continue
      flips.set(index, (flips.get(index) ?? 0) + 1)
    }
    return all.filter((index) => (flips.get(index) ?? 0) % 2 === 1)
  }

  // Solo and Latch: the newest qualifying ONSET owns the beat. The only
  // difference is what qualifies - Solo counts a note while the playhead is
  // inside it, Latch counts every note that has started, so it keeps the frame
  // past its own release. Both then take the latest, which is what makes
  // overlapping notes read as "the last one you played". Lifted verbatim from
  // core/directors/sceneSwitcher.ts so the two switchers can never disagree
  // about what a chord means.
  const latching = mode === SWITCHER_LATCH
  let selected: number | null = null
  let latestBeat = -Infinity
  for (const note of notes) {
    const qualifies = latching ? beat >= note.beat : heldAt(note, beat)
    if (!qualifies || note.beat < latestBeat) continue
    if (note.pitch === SWITCHER_NONE_PITCH) {
      selected = null
      latestBeat = note.beat
      continue
    }
    const index = indexByPitch.get(note.pitch)
    if (index === undefined) continue
    selected = index
    latestBeat = note.beat
  }
  return selected === null ? [] : [selected]
}

/** An entry that declines to act, which this module spells "return the copy
 *  unchanged" (copyTargets.ts's untargeted copies, bypass's gated apply). */
const PASS_THROUGH: MoverOrSplitter = { apply: (visualCopy) => [visualCopy] }

/**
 * What the structural probe should be handed for child `index`.
 *
 * The mounted copy pool is sized once per resolve by `structuralCopyCount`,
 * which swaps each entry's `structuralVariants[rank]` in across the WHOLE chain
 * and takes the max. The mode decides which shape of variant list gets the
 * right answer out of that machinery:
 *
 *  - **Gate / Toggle** - every child can run at once, so the ceiling is the
 *    PRODUCT of their fan-outs. Publishing the ungated entry at rank 0 makes
 *    rank 0 probe "everything running", which is exactly that. Skip this and a
 *    switcher whose beat-0 subset happens to be the smallest child mounts a pool
 *    sized for it and overflows on every later frame - the bug bypass.ts
 *    describes.
 *  - **Solo / Latch** - at most one child runs, so the ceiling is the MAX over
 *    children. Rank `index` carries this child ungated and every other rank
 *    passes through, so rank r probes "only child r running". Exclusivity
 *    therefore SAVES the pool rather than costing it, which is worth knowing
 *    before reaching for Gate out of habit.
 */
export function switcherVariantsFor(
  entry: MoverOrSplitter,
  mode: number,
  index: number,
  childCount: number,
): MoverOrSplitter[] {
  if (!switcherExclusive(mode)) return [entry]
  const variants: MoverOrSplitter[] = []
  for (let rank = 0; rank < childCount; rank++) variants.push(rank === index ? entry : PASS_THROUGH)
  return variants
}

/**
 * Wraps one spliced child so the lane can switch it off per beat. The same
 * shape as `bypassGated`, and the same reasoning about which beat each arm is
 * asked about:
 *
 * `apply` gates on `context.beat` - the beat the OBJECT is being evaluated at,
 * post-`warpBeat`, because that is the beat every other device in the chain
 * reads its own notes at. `warpBeat` gates on the real playhead beat it is
 * handed, because a remap is asked about real time by contract - so an
 * unselected Freeze does not warp, and a selected one does.
 *
 * Note the contrast with copy targeting, which deliberately does NOT gate
 * `warpBeat` (a time remap reaches the whole object by contract). A switcher is
 * the opposite case: an off device contributes nothing at all, time included.
 */
export function switchGated(
  entry: MoverOrSplitter,
  isLive: (beat: number) => boolean,
  structuralVariants: MoverOrSplitter[],
): MoverOrSplitter {
  const gated: MoverOrSplitter = {
    apply(visualCopy, context) {
      if (!isLive(context.beat)) return [visualCopy]
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
      isLive(context.beat) ? applyFramed(visualCopy, context) : [{ visualCopy }]
    )
  }
  if (entry.warpBeat) {
    const warpBeat = entry.warpBeat.bind(entry)
    gated.warpBeat = (beat) => (isLive(beat) ? warpBeat(beat) : beat)
  }
  if (entry.bypassAt) {
    const bypassAt = entry.bypassAt.bind(entry)
    gated.bypassAt = (beat) => bypassAt(beat)
  }
  gated.structuralVariants = structuralVariants
  return gated
}

/** The lane's rows: one per child in child order, then None. Row ORDER is not
 *  pitch order and `generateInstrumentRows` does not sort, so the None row
 *  renders last however its pitch compares. Colors are the CHILDREN's identity
 *  colors, supplied by the caller - this module never learns what a device is
 *  called or what colour it wears. */
export function switcherRows(
  children: readonly { label: string; color?: string }[],
  bindings: readonly SwitcherBinding[],
): MidiRowDef[] {
  const pitchByIndex = new Map(bindings.map((b) => [b.index, b.pitch]))
  const rows: MidiRowDef[] = []
  children.forEach((child, index) => {
    const pitch = pitchByIndex.get(index)
    if (pitch === undefined) return
    rows.push({ pitch, label: child.label, color: child.color, emphasized: index === 0 })
  })
  rows.push({ pitch: SWITCHER_NONE_PITCH, label: 'None', color: 'hsl(0, 0%, 45%)' })
  return rows
}

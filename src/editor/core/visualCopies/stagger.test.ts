import assert from 'node:assert/strict'
import test from 'node:test'
import { noteColorizer, SAMPLE_AT_BIRTH, type ColorizerSettings } from './colorizer'
import { gatedMoverOrSplitter } from './copyTargets'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import { resolveVisualCopies } from './resolveVisualCopies'
import { splitterWithChildChain } from './splitterChildChain'
import { staggerSplitter, STAGGER_LIFE_ENDLESS, STAGGER_LIFE_TIMED, STAGGER_SPAWN_PITCH } from './stagger'
import type { MoverOrSplitter, MoverOrSplitterContext, VisualCopy } from './types'
import type { ResolvedNote } from '../visual/types'

// The Stagger is a TIME emitter: what has to be proven is the clocks - that
// entries below it run at each copy's age, that birthBeat is its last wrap,
// that descendants inherit both, that nested emitters compose, and that the
// wrappers (child chain, copy targeting) do not silently drop the channel.
// Plus the triggered mode: spawn notes birth copies through a first-fit voice
// pool, and copies outside a flight go dark without leaving the slot count.

const clone = (visualCopy: VisualCopy): VisualCopy => ({
  transform: visualCopy.transform.clone(),
  opacity: visualCopy.opacity,
  colorShift: { ...visualCopy.colorShift },
})

function resolvedNote(beat: number, durationBeats: number, pitch: number): ResolvedNote {
  return { beat, durationBeats, pitch, velocity: 100, blockStartBeat: 0, blockEndBeat: 32 }
}

const spawn = (beat: number) => resolvedNote(beat, 0.25, STAGGER_SPAWN_PITCH)

function stagger(
  copies: number,
  duration: number,
  notes: ResolvedNote[] = [],
  life = STAGGER_LIFE_TIMED,
): MoverOrSplitter {
  return staggerSplitter.resolve({ settings: { copies, duration, life }, notes })
}

interface ProbeSample {
  beat: number
  birthBeat: number | undefined
  opacity: number
}

/** Records the clock and visibility of every copy reaching it. */
function probe(log: ProbeSample[]): MoverOrSplitter {
  return {
    apply(visualCopy: VisualCopy, context: MoverOrSplitterContext) {
      log.push({ beat: context.beat, birthBeat: context.birthBeat, opacity: visualCopy.opacity })
      return [clone(visualCopy)]
    },
  }
}

/** Fans one copy into two, contributing no clock of its own. */
const pair: MoverOrSplitter = {
  apply: (visualCopy) => [clone(visualCopy), clone(visualCopy)],
}

// ── The free-running loop (empty lane) ──────────────────────────────────────

test('entries below a stagger run at each copy age; birthBeat is its last wrap', () => {
  const log: ProbeSample[] = []
  // copies 4, period 4 → interval 1. At beat 10: age_i = mod(10 − i, 4).
  const copies = resolveVisualCopies([stagger(4, 4), probe(log)], 10)
  assert.equal(copies.length, 4)
  assert.deepEqual(log.map((s) => s.beat), [2, 1, 0, 3])
  assert.deepEqual(log.map((s) => s.birthBeat), [8, 9, 10, 7])
})

test('an entry above the stagger still runs at the real beat', () => {
  const log: ProbeSample[] = []
  resolveVisualCopies([probe(log), stagger(4, 4)], 10)
  assert.deepEqual(log, [{ beat: 10, birthBeat: undefined, opacity: 1 }])
})

test('copies born before the timeline start mid-flight with negative births', () => {
  const log: ProbeSample[] = []
  resolveVisualCopies([stagger(4, 4), probe(log)], 0)
  assert.deepEqual(log.map((s) => s.beat), [0, 3, 2, 1])
  assert.deepEqual(log.map((s) => s.birthBeat), [0, -3, -2, -1])
})

test('descendants of a copy inherit its clock, input-major', () => {
  const log: ProbeSample[] = []
  // stagger(2, 4) at beat 10: ages [2, 0], births [8, 10]; the pair below fans
  // each copy, and both children ride their parent's clock.
  const copies = resolveVisualCopies([stagger(2, 4), pair, probe(log)], 10)
  assert.equal(copies.length, 4)
  assert.deepEqual(log.map((s) => s.beat), [2, 2, 0, 0])
  assert.deepEqual(log.map((s) => s.birthBeat), [8, 8, 10, 10])
})

test('nested staggers: offsets sum, the inner births overwrite the outer ones', () => {
  const log: ProbeSample[] = []
  // Outer stagger(2, 8) at beat 10: ages [2, 6]. The inner stagger(2, 4)
  // measures in that handed clock: ages mod(ageA − 2j, 4), births ageA − ageB.
  resolveVisualCopies([stagger(2, 8), stagger(2, 4), probe(log)], 10)
  assert.deepEqual(log.map((s) => s.beat), [2, 0, 2, 0])
  assert.deepEqual(log.map((s) => s.birthBeat), [0, 2, 4, 6])
})

test('copy count never depends on the beat', () => {
  for (const beat of [0, 3.7, 100.01]) {
    assert.equal(resolveVisualCopies([stagger(5, 4)], beat).length, 5)
  }
})

test('the child-chain wrapper threads the clocks through', () => {
  const identityChild: MoverOrSplitter = { apply: (visualCopy) => [clone(visualCopy)] }
  const log: ProbeSample[] = []
  resolveVisualCopies([splitterWithChildChain(stagger(4, 4), [identityChild]), probe(log)], 10)
  assert.deepEqual(log.map((s) => s.beat), [2, 1, 0, 3])
  assert.deepEqual(log.map((s) => s.birthBeat), [8, 9, 10, 7])
})

// ── clockSkipEmitters: the resolver's position routing, honored by the kernel ─

test('an entry skipping the emitter runs at the real beat, birthBeat intact', () => {
  const log: ProbeSample[] = []
  const live = { ...probe(log), clockSkipEmitters: 1 }
  const copies = resolveVisualCopies([stagger(4, 4), live], 10)
  assert.equal(copies.length, 4)
  // Live overlay: every copy evaluated at the timeline beat...
  assert.deepEqual(log.map((s) => s.beat), [10, 10, 10, 10])
  // ...but the latch clock still rides along, so Born-mode devices keep working.
  assert.deepEqual(log.map((s) => s.birthBeat), [8, 9, 10, 7])
})

test('skip counts a SUFFIX of the emitters: partial skips ride only the later ones', () => {
  // Two hand-built emitters with fixed offsets, so the arithmetic is exact:
  // e1 lags every copy 5 beats, e2 another 2.
  const emitter = (lag: number): MoverOrSplitter => ({
    emitsCopyClocks: true,
    apply: (visualCopy) => [clone(visualCopy)],
    applyFramed: (visualCopy) => [{ visualCopy: clone(visualCopy), beatOffset: lag }],
  })
  const pattern: ProbeSample[] = []
  const middle: ProbeSample[] = []
  const live: ProbeSample[] = []
  resolveVisualCopies([
    emitter(5),
    { ...emitter(2), clockSkipEmitters: 1 },
    probe(pattern),                            // skip 0: both lags
    { ...probe(middle), clockSkipEmitters: 1 } // only e2's lag
    ,
    { ...probe(live), clockSkipEmitters: 2 },  // neither
  ], 20)
  assert.deepEqual(pattern.map((s) => s.beat), [13])
  assert.deepEqual(middle.map((s) => s.beat), [18])
  assert.deepEqual(live.map((s) => s.beat), [20])
})

test('clocksOut carries per-copy checkpoints in emitter order', () => {
  const clocks = { beatOffsets: null, birthBeats: null, checkpoints: null } as import('./resolveVisualCopies').CopyClocks
  resolveVisualCopies([stagger(2, 4)], 10, undefined, clocks)
  // stagger(2, 4) at beat 10: ages [2, 0] → offsets [8, 10], one emitter each.
  assert.deepEqual(clocks.beatOffsets, [8, 10])
  assert.deepEqual(clocks.checkpoints, [[8], [10]])
})

test('copy targeting: an untargeted copy passes through on the real clock', () => {
  const log: ProbeSample[] = []
  // Two incoming copies; the stagger owns slice 0 only, so copy 1 must reach
  // the probe untouched and unshifted.
  const gated = gatedMoverOrSplitter(stagger(4, 4), { rule: 'every', slices: 2, on: [0] })
  const copies = resolveVisualCopies([pair, gated, probe(log)], 10)
  assert.equal(copies.length, 5)
  assert.deepEqual(log.map((s) => s.beat), [2, 1, 0, 3, 10])
  assert.deepEqual(log.map((s) => s.birthBeat), [8, 9, 10, 7, undefined])
})

// ── Triggered births (spawn notes) ──────────────────────────────────────────

test('a spawn note births a copy: age runs from the onset, birthBeat is the onset', () => {
  const log: ProbeSample[] = []
  resolveVisualCopies([stagger(2, 4, [spawn(2)]), probe(log)], 3)
  // One note = a pool of one (the COPIES knob is the loop's divider, inert
  // here); its copy flies from the onset.
  assert.deepEqual(log, [{ beat: 1, birthBeat: 2, opacity: 1 }])
})

test('a copy goes dark when its flight ends, and the slot count never moves', () => {
  const entry = stagger(2, 4, [spawn(0)])
  for (const [beat, opacity] of [[0, 1], [3.9, 1], [4, 0], [10, 0]] as const) {
    const copies = resolveVisualCopies([entry], beat)
    assert.equal(copies.length, 1, `count at beat ${beat}`)
    assert.equal(copies[0].opacity, opacity, `slot 0 at beat ${beat}`)
  }
})

test('allocation is first-fit: a slot is reused once its flight ends', () => {
  const log: ProbeSample[] = []
  // Duration 2. Onsets at 0, 1, 2.5: slot 0 takes 0 (free again at 2),
  // slot 1 takes 1, slot 0 takes 2.5 - a pool of exactly two. At beat 2.6
  // slot 0 flies its SECOND flight and slot 1 is still on its first.
  resolveVisualCopies([stagger(1, 2, [spawn(0), spawn(1), spawn(2.5)]), probe(log)], 2.6)
  assert.deepEqual(log.map((s) => s.birthBeat), [2.5, 1])
  assert.deepEqual(log.map((s) => s.opacity), [1, 1])
})

test('Endless life: every spawn is permanent, slots are never reused', () => {
  const log: ProbeSample[] = []
  // Duration 2 would let a timed slot 0 take the 2.5 onset; Endless never
  // frees a slot, so three onsets are three copies - all still flying at
  // beat 100, each holding its own clock.
  const entry = stagger(1, 2, [spawn(0), spawn(1), spawn(2.5)], STAGGER_LIFE_ENDLESS)
  resolveVisualCopies([entry, probe(log)], 100)
  assert.deepEqual(log.map((s) => s.birthBeat), [0, 1, 2.5])
  assert.deepEqual(log.map((s) => s.opacity), [1, 1, 1])
  assert.deepEqual(log.map((s) => s.beat), [100, 99, 97.5])
  // Before its birth a copy is still dark - permanence starts at the note.
  const early: ProbeSample[] = []
  resolveVisualCopies([entry, probe(early)], 0.5)
  assert.deepEqual(early.map((s) => s.opacity), [1, 0, 0])
})

test('every spawn flies: a dense phrase grows the pool instead of dropping notes', () => {
  const log: ProbeSample[] = []
  // Three onsets inside one duration → three slots, all mid-flight at beat 2,
  // whatever the COPIES knob says.
  resolveVisualCopies([stagger(1, 4, [spawn(0), spawn(1), spawn(1.5)]), probe(log)], 2)
  assert.deepEqual(log.map((s) => s.birthBeat), [0, 1, 1.5])
  assert.deepEqual(log.map((s) => s.opacity), [1, 1, 1])
})

test('an empty lane is exactly the free-running loop', () => {
  const looped = resolveVisualCopies([stagger(3, 4)], 7)
  const triggered = resolveVisualCopies([stagger(3, 4, [resolvedNote(0, 1, 61)])], 7)
  // A note off the Spawn row is a no-op: same copies, same visibility.
  assert.deepEqual(
    triggered.map((c) => c.opacity),
    looped.map((c) => c.opacity),
  )
})

// ── The Colorizer's Born latch ──────────────────────────────────────────────

function latchColorizer(): MoverOrSplitter {
  const settings = mergeDefinitionSettings(
    noteColorizer,
    { sample: SAMPLE_AT_BIRTH },
  ) as unknown as ColorizerSettings
  // Slot 1 (pitch 60) sounds over [0, 2), slot 2 (pitch 62) over [2, 4).
  return noteColorizer.resolve({
    settings,
    notes: [resolvedNote(0, 2, 60), resolvedNote(2, 2, 62)],
  })
}

const colorizerContext = (beat: number, birthBeat?: number): MoverOrSplitterContext => ({
  beat,
  index: 0,
  count: 1,
  birthBeat,
})

test('Born samples the lane at the copy birth and holds it', () => {
  const entry = latchColorizer()
  // Born at 0 while slot 1 sounds: slot 1's color, however far the flight is.
  const early = entry.apply(identityVisualCopy(), colorizerContext(3, 0))[0]
  assert.equal(early.colorShift.tint, '#ffd166')
  const late = entry.apply(identityVisualCopy(), colorizerContext(3.9, 0))[0]
  assert.deepEqual(late.colorShift, early.colorShift)
  // Born at 2 while slot 2 sounds: slot 2's color, at the same playhead beat.
  const second = entry.apply(identityVisualCopy(), colorizerContext(3, 2))[0]
  assert.equal(second.colorShift.tint, '#ef476f')
})

test('Born with no emitter above falls back to Live', () => {
  const entry = latchColorizer()
  const output = entry.apply(identityVisualCopy(), colorizerContext(3))[0]
  // Live at beat 3: slot 2 is the sounding note.
  assert.equal(output.colorShift.tint, '#ef476f')
})

test('a birth before any note latches silence, not a stale color', () => {
  const entry = latchColorizer()
  const output = entry.apply(identityVisualCopy(), colorizerContext(3, -1))[0]
  assert.equal(output.colorShift.tint, null)
})

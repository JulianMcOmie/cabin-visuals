import assert from 'node:assert/strict'
import test from 'node:test'
import { canonSplitter } from './canon'
import { noteColorizer, SAMPLE_AT_BIRTH, type ColorizerSettings } from './colorizer'
import { gatedMoverOrSplitter } from './copyTargets'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import { resolveVisualCopies } from './resolveVisualCopies'
import { splitterWithChildChain } from './splitterChildChain'
import type { MoverOrSplitter, MoverOrSplitterContext, VisualCopy } from './types'
import type { ResolvedNote } from '../visual/types'

// The Canon is a TIME emitter: what has to be proven is the clocks - that
// entries below it run at each copy's age, that birthBeat is its last wrap,
// that descendants inherit both, that nested emitters compose, and that the
// wrappers (child chain, copy targeting) do not silently drop the channel.
// The spatial half is trivial (untouched clones) and asserted in passing.

const clone = (visualCopy: VisualCopy): VisualCopy => ({
  transform: visualCopy.transform.clone(),
  opacity: visualCopy.opacity,
  colorShift: { ...visualCopy.colorShift },
})

function canon(copies: number, period: number): MoverOrSplitter {
  return canonSplitter.resolve({ settings: { copies, period }, notes: [] })
}

interface ProbeSample {
  beat: number
  birthBeat: number | undefined
}

/** Records the clock every copy reaching it runs on. */
function probe(log: ProbeSample[]): MoverOrSplitter {
  return {
    apply(visualCopy: VisualCopy, context: MoverOrSplitterContext) {
      log.push({ beat: context.beat, birthBeat: context.birthBeat })
      return [clone(visualCopy)]
    },
  }
}

/** Fans one copy into two, contributing no clock of its own. */
const pair: MoverOrSplitter = {
  apply: (visualCopy) => [clone(visualCopy), clone(visualCopy)],
}

test('entries below a canon run at each copy age; birthBeat is its last wrap', () => {
  const log: ProbeSample[] = []
  // copies 4, period 4 → interval 1. At beat 10: age_i = mod(10 − i, 4).
  const copies = resolveVisualCopies([canon(4, 4), probe(log)], 10)
  assert.equal(copies.length, 4)
  assert.deepEqual(log.map((s) => s.beat), [2, 1, 0, 3])
  assert.deepEqual(log.map((s) => s.birthBeat), [8, 9, 10, 7])
})

test('an entry above the canon still runs at the real beat', () => {
  const log: ProbeSample[] = []
  resolveVisualCopies([probe(log), canon(4, 4)], 10)
  assert.deepEqual(log, [{ beat: 10, birthBeat: undefined }])
})

test('copies born before the timeline start mid-flight with negative births', () => {
  const log: ProbeSample[] = []
  resolveVisualCopies([canon(4, 4), probe(log)], 0)
  assert.deepEqual(log.map((s) => s.beat), [0, 3, 2, 1])
  assert.deepEqual(log.map((s) => s.birthBeat), [0, -3, -2, -1])
})

test('descendants of a copy inherit its clock, input-major', () => {
  const log: ProbeSample[] = []
  // canon(2, 4) at beat 10: ages [2, 0], births [8, 10]; the pair below fans
  // each copy, and both children ride their parent's clock.
  const copies = resolveVisualCopies([canon(2, 4), pair, probe(log)], 10)
  assert.equal(copies.length, 4)
  assert.deepEqual(log.map((s) => s.beat), [2, 2, 0, 0])
  assert.deepEqual(log.map((s) => s.birthBeat), [8, 8, 10, 10])
})

test('nested canons: offsets sum, the inner births overwrite the outer ones', () => {
  const log: ProbeSample[] = []
  // Outer canon(2, 8) at beat 10: ages [2, 6]. The inner canon(2, 4) measures
  // in that handed clock: ages mod(ageA − 2j, 4), births ageA − ageB.
  resolveVisualCopies([canon(2, 8), canon(2, 4), probe(log)], 10)
  assert.deepEqual(log.map((s) => s.beat), [2, 0, 2, 0])
  assert.deepEqual(log.map((s) => s.birthBeat), [0, 2, 4, 6])
})

test('copy count never depends on the beat', () => {
  for (const beat of [0, 3.7, 100.01]) {
    assert.equal(resolveVisualCopies([canon(5, 4)], beat).length, 5)
  }
})

test('the child-chain wrapper threads the clocks through', () => {
  const identityChild: MoverOrSplitter = { apply: (visualCopy) => [clone(visualCopy)] }
  const log: ProbeSample[] = []
  resolveVisualCopies([splitterWithChildChain(canon(4, 4), [identityChild]), probe(log)], 10)
  assert.deepEqual(log.map((s) => s.beat), [2, 1, 0, 3])
  assert.deepEqual(log.map((s) => s.birthBeat), [8, 9, 10, 7])
})

test('copy targeting: an untargeted copy passes through on the real clock', () => {
  const log: ProbeSample[] = []
  // Two incoming copies; the canon owns slice 0 only, so copy 1 must reach the
  // probe untouched and unshifted.
  const gated = gatedMoverOrSplitter(canon(4, 4), { rule: 'every', slices: 2, on: [0] })
  const copies = resolveVisualCopies([pair, gated, probe(log)], 10)
  assert.equal(copies.length, 5)
  assert.deepEqual(log.map((s) => s.beat), [2, 1, 0, 3, 10])
  assert.deepEqual(log.map((s) => s.birthBeat), [8, 9, 10, 7, undefined])
})

// ── The Colorizer's At-birth latch ──────────────────────────────────────────

function resolvedNote(beat: number, durationBeats: number, pitch: number): ResolvedNote {
  return { beat, durationBeats, pitch, velocity: 100, blockStartBeat: 0, blockEndBeat: 8 }
}

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

test('At birth samples the lane at the copy birth and holds it', () => {
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

test('At birth with no emitter above falls back to Live', () => {
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

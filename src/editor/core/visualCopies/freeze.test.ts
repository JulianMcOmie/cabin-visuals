import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import {
  FREEZE_HOLD_PITCH,
  FREEZE_REVERSE_PITCH,
  RELEASE_CONTINUE,
  RELEASE_SNAP,
  buildFreezeSpans,
  evaluateFreezeWarp,
  freezeMover,
  type FreezeSettings,
} from './freeze'
import { identityVisualCopy } from './identityVisualCopy'
import { warpChainBeat } from './resolveVisualCopies'

function note(beat: number, durationBeats: number, pitch = FREEZE_HOLD_PITCH): ResolvedNote {
  return { beat, pitch, durationBeats, velocity: 1, blockStartBeat: 0, blockEndBeat: 1024 }
}

function settings(overrides: Partial<FreezeSettings> = {}): FreezeSettings {
  return {
    ...mergeDefinitionSettings(freezeMover, undefined),
    ...overrides,
  } as unknown as FreezeSettings
}

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)

const warp = (notes: ResolvedNote[], release: number, beat: number) =>
  evaluateFreezeWarp(notes, settings({ release }), beat)

test('a track with no freeze notes leaves time alone', () => {
  close(warp([], RELEASE_CONTINUE, 7.25), 7.25)
  close(warp([note(4, 2, 71)], RELEASE_CONTINUE, 7.25), 7.25)
})

test('defaults to continuing from where it stopped', () => {
  assert.equal(mergeDefinitionSettings(freezeMover, undefined).release, RELEASE_CONTINUE)
})

test('a held freeze holds the instant the note landed', () => {
  const notes = [note(4, 2)]
  close(warp(notes, RELEASE_CONTINUE, 3), 3)
  close(warp(notes, RELEASE_CONTINUE, 4), 4)
  close(warp(notes, RELEASE_CONTINUE, 5), 4)
  close(warp(notes, RELEASE_CONTINUE, 6), 4)
})

test('continue mode carries the held time as a permanent debt', () => {
  const notes = [note(4, 2)]
  // Two beats frozen, so everything afterwards runs two beats behind - which is
  // what makes the release seamless rather than a jump.
  close(warp(notes, RELEASE_CONTINUE, 7), 5)
  close(warp(notes, RELEASE_CONTINUE, 100), 98)
})

test('snap-back mode returns to real time the moment the note ends', () => {
  const notes = [note(4, 2)]
  close(warp(notes, RELEASE_SNAP, 5), 4)
  close(warp(notes, RELEASE_SNAP, 6), 6)
  close(warp(notes, RELEASE_SNAP, 7), 7)
})

test('back-to-back freeze notes each hold their own start under snap back', () => {
  const notes = [note(0, 2), note(2, 2)]
  close(warp(notes, RELEASE_SNAP, 1), 0)
  close(warp(notes, RELEASE_SNAP, 3), 2)
  close(warp(notes, RELEASE_SNAP, 4), 4)
})

test('a held reverse runs time backwards out of the note', () => {
  const notes = [note(4, 2, FREEZE_REVERSE_PITCH)]
  // Mirrored around the note start: one beat in, time is one beat before it.
  close(warp(notes, RELEASE_SNAP, 5), 3)
  close(warp(notes, RELEASE_SNAP, 6), 6)
  close(warp(notes, RELEASE_CONTINUE, 5), 3)
  // Two beats of reverse costs four: the two not advanced plus the two undone.
  close(warp(notes, RELEASE_CONTINUE, 6), 2)
  close(warp(notes, RELEASE_CONTINUE, 10), 6)
})

test('continue mode is continuous across every note edge', () => {
  const notes = [note(2, 1), note(4, 2, FREEZE_REVERSE_PITCH), note(8, 0.5)]
  const epsilon = 1e-6
  for (const edge of [2, 3, 4, 6, 8, 8.5]) {
    close(warp(notes, RELEASE_CONTINUE, edge - epsilon), warp(notes, RELEASE_CONTINUE, edge + epsilon), 1e-5)
  }
})

test('reverse wins wherever it overlaps a freeze', () => {
  const notes = [note(0, 8), note(2, 2, FREEZE_REVERSE_PITCH)]
  const spans = buildFreezeSpans(notes)
  assert.deepEqual(spans.map((s) => [s.start, s.end, s.rate]), [
    [0, 2, 0],
    [2, 4, -1],
    [4, 8, 0],
  ])
  close(warp(notes, RELEASE_CONTINUE, 3), -1)
})

test('a zero-length note still registers as a held moment', () => {
  const spans = buildFreezeSpans([note(4, 0)])
  assert.equal(spans.length, 1)
  close(spans[0].end - spans[0].start, 0.05)
})

test('freeze passes copies through untouched - it says when, not where', () => {
  const resolved = freezeMover.resolve({ settings: settings(), notes: [note(0, 4)] })
  const input = identityVisualCopy()
  input.opacity = 0.5
  input.transform.makeTranslation(1, 2, 3)
  const out = resolved.apply(input, { beat: 2, index: 0, count: 1 })
  assert.equal(out.length, 1)
  assert.equal(out[0].opacity, 0.5)
  assert.ok(out[0].transform.equals(input.transform))
  assert.notEqual(out[0].transform, input.transform)
})

test('the chain sums each remap against the real beat', () => {
  const first = freezeMover.resolve({ settings: settings(), notes: [note(0, 2)] })
  const second = freezeMover.resolve({ settings: settings(), notes: [note(4, 1)] })
  // Both freezes are behind us at beat 8: two beats of debt plus one.
  close(warpChainBeat([first, second], 8), 5)
  // An entry with no remap is inert.
  close(warpChainBeat([{ apply: (copy) => [copy] }], 8), 8)
  close(warpChainBeat([], 8), 8)
})

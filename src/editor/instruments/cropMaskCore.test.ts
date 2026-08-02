import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ResolvedNote } from '../core/visual/types'
import { CROP_BASE_PITCH, MAX_DIVISIONS, cropFlashEnvelope } from '../core/directors/crop'
import { resolveCropSliceStates } from './cropMaskCore'

function note(pitch: number, beat: number, durationBeats = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 64, pitch, velocity: 100, durationBeats }
}

test('no notes at all resolves to null (unmasked), not all-masked', () => {
  assert.equal(resolveCropSliceStates([], 2, 3, 0.3), null)
})

test('a held slice is on, silence leaves a slice at zero', () => {
  const notes = [note(CROP_BASE_PITCH + 1, 0, 4)]
  const states = resolveCropSliceStates(notes, 2, 3, 0.3)!
  assert.equal(states.length, MAX_DIVISIONS)
  assert.equal(states[0], 0)
  // Beat 2 is far past the 0.3-beat flash window: held state is exactly 1.
  assert.equal(states[1], 1)
  assert.equal(states[2], 0)
})

test('notes exist but none held = fully masked (all zero), not null', () => {
  const states = resolveCropSliceStates([note(CROP_BASE_PITCH, 4, 1)], 2, 3, 0.3)!
  assert.deepEqual([...states.slice(0, 3)], [0, 0, 0])
})

test('an onset carries the flash envelope above 1 and decays back to 1', () => {
  const notes = [note(CROP_BASE_PITCH, 1, 4)]
  const flashBeats = 0.5
  // Mid-hold of the envelope (t in the plateau) reads exactly 2.
  const during = resolveCropSliceStates(notes, 1 + flashBeats * 0.05, 3, flashBeats)!
  assert.equal(during[0], 2)
  // Mid-decay sits strictly between 1 and 2 and matches the shared envelope.
  const t = 0.5
  const mid = resolveCropSliceStates(notes, 1 + flashBeats * t, 3, flashBeats)!
  assert.equal(mid[0], Math.fround(1 + cropFlashEnvelope(t)))
  assert.ok(mid[0] > 1 && mid[0] < 2)
  // Past the window the slice holds at 1 while the note lasts.
  const after = resolveCropSliceStates(notes, 1 + flashBeats + 0.01, 3, flashBeats)!
  assert.equal(after[0], 1)
})

test('a retrigger mid-hold restarts the flash from the newest onset', () => {
  const notes = [note(CROP_BASE_PITCH, 0, 8), note(CROP_BASE_PITCH, 4, 2)]
  const flashBeats = 0.5
  const states = resolveCropSliceStates(notes, 4 + flashBeats * 0.05, 3, flashBeats)!
  assert.equal(states[0], 2)
})

test('divisions clamp to MAX_DIVISIONS and out-of-range pitches are ignored', () => {
  const inRange = note(CROP_BASE_PITCH + MAX_DIVISIONS - 1, 0, 4)
  const outOfRange = note(CROP_BASE_PITCH + MAX_DIVISIONS, 0, 4)
  const below = note(CROP_BASE_PITCH - 1, 0, 4)
  const states = resolveCropSliceStates([inRange, outOfRange, below], 2, 99, 0.3)!
  assert.equal(states[MAX_DIVISIONS - 1], 1)
  assert.equal(states.length, MAX_DIVISIONS)
})

test('slices at index >= divisions stay off even when their pitch is held', () => {
  const states = resolveCropSliceStates([note(CROP_BASE_PITCH + 2, 0, 4)], 1, 2, 0.3)!
  assert.equal(states[2], 0)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../core/visual/types'
import { BASS_RIPPLE_PITCH, resolveActiveBassRipple } from './BassRipple'

function note(beat: number, durationBeats = 1, pitch = BASS_RIPPLE_PITCH, velocity = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 64 }
}

function stateAt(beat: number, notes: ResolvedNote[], params: Record<string, number> = {}) {
  return {
    beat,
    notes,
    activeNotes: notes.filter((n) => beat >= n.beat && beat < n.beat + (n.durationBeats || 0.05)),
    params,
    opacity: 1,
    blackedOut: false,
  }
}

test('release decays the tail to nothing over its own length in beats', () => {
  const notes = [note(0, 2)]
  const params = { release: 2 }
  // Held: full intensity, no tail applied.
  assert.equal(resolveActiveBassRipple(stateAt(1, notes, params))?.amount, 1)
  // Squared falloff: half way through the release is a quarter of the bend.
  assert.equal(resolveActiveBassRipple(stateAt(3, notes, params))?.amount, 0.25)
  // Past the release the track stops warping the scene entirely.
  assert.equal(resolveActiveBassRipple(stateAt(4, notes, params)), null)
})

test('a zero release still snaps straight the instant the note ends', () => {
  const notes = [note(0, 2)]
  assert.equal(resolveActiveBassRipple(stateAt(1.99, notes, { release: 0 }))?.amount, 1)
  assert.equal(resolveActiveBassRipple(stateAt(2, notes, { release: 0 })), null)
})

test('the most recently ended note owns the tail when releases overlap', () => {
  const notes = [note(0, 1), note(1, 1)]
  // The beat-1 note ends at 2, so at 2.5 the tail is its own age, not the older one's.
  assert.equal(resolveActiveBassRipple(stateAt(2.5, notes, { release: 4 }))?.amount, 0.765625)
})

test('a note starting later never back-dates a release tail', () => {
  const notes = [note(8, 1)]
  assert.equal(resolveActiveBassRipple(stateAt(2, notes, { release: 4 })), null)
})

test('velocity and the release tail compound', () => {
  const notes = [note(0, 2, BASS_RIPPLE_PITCH, 0.5)]
  assert.equal(resolveActiveBassRipple(stateAt(1, notes, { release: 2 }))?.amount, 0.5)
  assert.equal(resolveActiveBassRipple(stateAt(3, notes, { release: 2 }))?.amount, 0.125)
})

test('unrecognized pitches neither warp the scene nor start a release', () => {
  const notes = [note(0, 1, 40)]
  assert.equal(resolveActiveBassRipple(stateAt(0.5, notes, { release: 2 })), null)
  assert.equal(resolveActiveBassRipple(stateAt(1.5, notes, { release: 2 })), null)
})

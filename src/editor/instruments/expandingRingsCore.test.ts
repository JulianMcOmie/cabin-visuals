import assert from 'node:assert/strict'
import test from 'node:test'
import { ringInnerRadius, easeLife, ringGradientT, ringOpacity, ringsFromNotes } from './expandingRingsCore'

test('ease curve: 0 is linear, + accelerates, - decelerates, endpoints pinned', () => {
  assert.equal(easeLife(0, 0.7), 0)
  assert.equal(easeLife(1, -0.7), 1)
  assert.ok(Math.abs(easeLife(0.5, 0) - 0.5) < 1e-12)
  assert.ok(easeLife(0.5, 0.5) < 0.5)
  assert.ok(easeLife(0.5, -0.5) > 0.5)
})

const note = (beat: number, durationBeats: number) => ({ beat, durationBeats })

test('no rings until a note is pressed; the press spawns one at zero size', () => {
  assert.equal(ringsFromNotes([], 5, 4, 8).length, 0)
  assert.equal(ringsFromNotes([note(2, 4)], 1.99, 4, 8).length, 0)
  const at = ringsFromNotes([note(2, 4)], 2, 4, 8)
  assert.equal(at.length, 1)
  assert.equal(at[0].life, 0)
})

test('a held note emits a ring every period/count, evenly phased', () => {
  const rings = ringsFromNotes([note(0, 100)], 3.1, 4, 8)
  assert.equal(rings.length, 7)
  for (let i = 1; i < rings.length; i++) assert.ok(Math.abs(rings[i - 1].born - rings[i].born - 0.5) < 1e-9)
  rings.forEach(r => assert.ok(r.life >= 0 && r.life < 1))
})

test('release stops spawning; rings in flight finish, or vanish with cut', () => {
  const held = ringsFromNotes([note(0, 1)], 2, 4, 8)
  assert.equal(held.length, 2) // spawned at 0 and 0.5, still flying
  assert.equal(ringsFromNotes([note(0, 1)], 2, 4, 8, true).length, 0)
  assert.equal(ringsFromNotes([note(0, 1)], 5.01, 4, 8).length, 0)
})

test('state is a pure function of the beat (seek == play)', () => {
  assert.deepEqual(ringsFromNotes([note(1, 3)], 3.3, 3, 5), ringsFromNotes([note(1, 3)], 3.3, 3, 5))
})

test('cycle gradient ping-pongs across spawns; radius gradient follows radius', () => {
  assert.equal(ringGradientT(1, 0, 0.9, 4), 0)
  assert.equal(ringGradientT(1, 4, 0.9, 4), 1)
  assert.equal(ringGradientT(1, 8, 0.9, 4), 0)
    assert.equal(ringGradientT(0, 3, 0.37, 4), 0.37)
})

test('fade-out spans the last fraction of life', () => {
  assert.equal(ringOpacity(0.5, 0.4), 1)
  assert.ok(Math.abs(ringOpacity(0.8, 0.4) - 0.5) < 1e-12)
  assert.equal(ringOpacity(0.5, 0), 1)
})

test('width modes: fill meets the next ring, constant is fixed, taper thins outward', () => {
  assert.equal(ringInnerRadius(0, 4, 3, 0.5, 0.8), 3)
  assert.equal(ringInnerRadius(0, 4, 0, 0.5, 0.8), 0)
  assert.equal(ringInnerRadius(1, 4, 3, 0.5, 0.8), 3.5)
  assert.equal(ringInnerRadius(1, 0.2, 3, 0.5, 0.1), 0)
  const near = 1 - ringInnerRadius(2, 1, 0, 0.5, 0)
  const far = 1 - ringInnerRadius(2, 1, 0, 0.5, 1)
  assert.ok(Math.abs(near - 0.5) < 1e-12 && far < near * 0.06)
})

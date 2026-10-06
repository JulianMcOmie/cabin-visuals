import assert from 'node:assert/strict'
import test from 'node:test'
import { easeLife, ringGradientT, ringOpacity, ringsAt } from './expandingRingsCore'

test('ease curve: 0 is linear, + accelerates, - decelerates, endpoints pinned', () => {
  assert.equal(easeLife(0, 0.7), 0)
  assert.equal(easeLife(1, -0.7), 1)
  assert.ok(Math.abs(easeLife(0.5, 0) - 0.5) < 1e-12)
  assert.ok(easeLife(0.5, 0.5) < 0.5)
  assert.ok(easeLife(0.5, -0.5) > 0.5)
})

test('rings are evenly phased, one respawns at the center every period/count', () => {
  const rings = ringsAt(10, 4, 8)
  assert.equal(rings.length, 8)
  const lives = rings.map(r => r.life)
  lives.forEach(l => assert.ok(l >= 0 && l < 1))
  for (let i = 1; i < lives.length; i++) assert.ok(Math.abs(lives[i] - lives[i - 1] - 1 / 8) < 1e-9)
  // Just past a spawn boundary the newest ring is at the center.
  assert.ok(ringsAt(0.5001, 4, 8)[0].life < 1e-3)
})

test('state is a pure function of the beat (seek == play), including before beat 0', () => {
  assert.deepEqual(ringsAt(7.3, 3, 5), ringsAt(7.3, 3, 5))
  const early = ringsAt(0, 4, 4)
  assert.equal(early.length, 4)
  early.forEach(r => assert.ok(r.life >= 0 && r.life < 1))
})

test('cycle gradient ping-pongs across spawns; radius gradient follows radius', () => {
  assert.equal(ringGradientT(1, 0, 0.9, 4), 0)
  assert.equal(ringGradientT(1, 4, 0.9, 4), 1)
  assert.equal(ringGradientT(1, 8, 0.9, 4), 0)
  assert.equal(ringGradientT(1, -4, 0.9, 4), 1)
  assert.equal(ringGradientT(0, 3, 0.37, 4), 0.37)
})

test('fade-out spans the last fraction of life', () => {
  assert.equal(ringOpacity(0.5, 0.4), 1)
  assert.ok(Math.abs(ringOpacity(0.8, 0.4) - 0.5) < 1e-12)
  assert.equal(ringOpacity(0.5, 0), 1)
})

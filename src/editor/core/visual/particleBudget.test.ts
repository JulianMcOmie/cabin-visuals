import assert from 'node:assert/strict'
import test from 'node:test'
import { particleBudget, limitParticleCount } from './particleBudget'

test('preview caps reduce dense emitters without increasing sparse ones', () => {
  for (const [quality, cap] of [['auto', 8000], ['fast', 4000], ['fastest', 1000]] as const) {
    assert.equal(limitParticleCount(50000, particleBudget(quality, true)), cap)
    assert.equal(limitParticleCount(50, particleBudget(quality, true)), 50)
  }
})

test('Final, paused Auto, and pinned captures preserve full particle counts', () => {
  assert.equal(limitParticleCount(50000, particleBudget('final', true)), 50000)
  assert.equal(limitParticleCount(50000, particleBudget('auto', false)), 50000)
  for (const quality of ['final', 'auto', 'fast', 'fastest'] as const) {
    assert.equal(limitParticleCount(50000, particleBudget(quality, true, true)), 50000)
  }
  assert.equal(particleBudget('fast', false), 4000)
  assert.equal(particleBudget('fastest', false), 1000)
})

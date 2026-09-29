import test from 'node:test'
import assert from 'node:assert/strict'
import { easeByName, easeNames } from './easing'

test('every named ease runs 0 → 1; names cover families, CSS and the editor words', () => {
  for (const n of easeNames()) {
    if (n === 'step') continue
    const f = easeByName(n)!
    assert.ok(f, n)
    assert.ok(Math.abs(f(0)) < 1e-3 && Math.abs(f(1) - 1) < 1e-3, n)
  }
  assert.ok(easeNames().includes('expo.out') && easeNames().includes('css.emphasized') && easeNames().includes('ease-in-out'))
  assert.equal(easeByName('nope'), undefined)
  assert.ok(Math.max(...Array.from({ length: 50 }, (_, i) => easeByName('back.out')!(i / 49))) > 1.05) // overshoots
})

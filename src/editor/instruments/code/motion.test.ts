import test from 'node:test'
import assert from 'node:assert/strict'
import { bezier, curl3, ease, hash, impulse, keyframes, noise2, noise3, rng, spring, springKick, tween } from './motion'

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

test('every ease runs 0 → 1', () => {
  const eases = [ease.linear, ease.quad.out, ease.cubic.inOut, ease.expo.in, ease.expo.out, ease.sine.inOut, ease.circ.out,
    ease.back().out, ease.elastic().out, ease.bounce.out, ease.css.emphasized]
  for (const f of eases) {
    close(f(0), 0, 1e-3)
    close(f(1), 1, 1e-3)
  }
})

test('bezier matches CSS linear and is monotone for ease', () => {
  const lin = bezier(0, 0, 1, 1)
  for (const t of [0.1, 0.5, 0.9]) close(lin(t), t, 1e-4)
  let prev = 0
  for (let i = 1; i <= 20; i++) {
    const v = ease.css.ease(i / 20)
    assert.ok(v >= prev - 1e-9)
    prev = v
  }
})

test('tween and keyframes', () => {
  assert.equal(tween(0, 1, 2), 0)
  assert.equal(tween(5, 1, 2), 1)
  const k = keyframes([[0, 0], [1, 10, ease.linear], [2, 0, ease.linear]])
  assert.equal(k(-1), 0)
  close(k(0.5), 5)
  close(k(1.5), 5)
  assert.equal(k(9), 0)
})

test('spring step response settles at 1, overshooting when underdamped', () => {
  assert.equal(spring(0), 0)
  close(spring(20), 1, 1e-4)
  let peak = 0
  for (let t = 0; t < 2; t += 0.001) peak = Math.max(peak, spring(t, { freq: 2, damping: 0.2 }))
  assert.ok(peak > 1.3)
  close(spring(10, { damping: 1 }), 1, 1e-4)
  close(spring(10, { damping: 2 }), 1, 1e-3)
})

test('springKick peaks at 1 and dies away', () => {
  let peak = 0
  for (let t = 0; t < 2; t += 0.0005) peak = Math.max(peak, springKick(t))
  close(peak, 1, 1e-3)
  assert.ok(Math.abs(springKick(5)) < 1e-3)
})

test('impulse: attack then decay', () => {
  assert.equal(impulse(-1), 0)
  close(impulse(0.005, 0.01, 0.25), 0.5)
  close(impulse(0.01 + 0.25, 0.01, 0.25), Math.exp(-1))
})

test('noise and randomness are deterministic and bounded', () => {
  assert.equal(noise3(1.2, 3.4, 5.6), noise3(1.2, 3.4, 5.6))
  assert.equal(hash(1, 2, 3), hash(1, 2, 3))
  assert.notEqual(hash(1, 2, 3), hash(1, 2, 4))
  for (let i = 0; i < 200; i++) {
    const a = noise2(i * 0.37, i * 0.11), b = noise3(i * 0.21, i * 0.13, i * 0.07)
    assert.ok(a >= -1.001 && a <= 1.001 && b >= -1.001 && b <= 1.001)
  }
  const r1 = rng(42), r2 = rng(42)
  for (let i = 0; i < 5; i++) assert.equal(r1(), r2())
  const c = curl3(0.3, 0.4, 0.5)
  assert.equal(c.length, 3)
  assert.ok(c.every(Number.isFinite))
})

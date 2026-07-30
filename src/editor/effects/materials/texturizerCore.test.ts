import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { FINISH, resolveFinish, toonSteps, type OriginalLook } from './texturizerCore'

const litOriginal: OriginalLook = { unlit: false, metalness: 0.2, roughness: 0.6, envMapIntensity: 1 }
const unlitOriginal: OriginalLook = { unlit: true, metalness: 0, roughness: 1, envMapIntensity: 0 }

test('chrome at full amount is a mirror: full metalness, near-zero roughness, boosted env', () => {
  const t = resolveFinish(FINISH.chrome, 1, 0, 0, litOriginal)
  assert.equal(t.metalness, 1)
  assert.equal(t.roughness, 0)
  assert.ok(t.envMapIntensity > 1.5)
  assert.equal(t.transmission, 0)
  assert.equal(t.sheen, 0)
})

test('amount 0 returns exactly the original look on every lerped channel', () => {
  const t = resolveFinish(FINISH.chrome, 0, 0.25, 0, litOriginal)
  assert.equal(t.metalness, litOriginal.metalness)
  assert.equal(t.roughness, litOriginal.roughness)
  assert.equal(t.envMapIntensity, litOriginal.envMapIntensity)
  assert.equal(t.sheen, 0)
  assert.equal(t.transmission, 0)
  assert.equal(t.emissiveIntensity, 0)
})

test('amount blends halfway between original and finish', () => {
  const full = resolveFinish(FINISH.metal, 1, 0.5, 0, litOriginal)
  const half = resolveFinish(FINISH.metal, 0.5, 0.5, 0, litOriginal)
  assert.ok(Math.abs(half.metalness - (litOriginal.metalness + full.metalness) / 2) < 1e-9)
  assert.ok(Math.abs(half.roughness - (litOriginal.roughness + full.roughness) / 2) < 1e-9)
})

test('matte kills reflections and highlights', () => {
  const t = resolveFinish(FINISH.matte, 1, 0.25, 0, litOriginal)
  assert.equal(t.metalness, 0)
  assert.equal(t.roughness, 1)
  assert.ok(t.envMapIntensity < 0.1)
  assert.ok(t.specularIntensity < 0.1)
})

test('neon is self-lit even with the glow knob at zero', () => {
  const t = resolveFinish(FINISH.neon, 1, 0.25, 0, litOriginal)
  assert.ok(t.emissiveIntensity >= 1)
  assert.equal(t.envMapIntensity, 0)
})

test('the glow knob adds emissive to any finish, scaled by amount', () => {
  const t = resolveFinish(FINISH.chrome, 1, 0.25, 2, litOriginal)
  assert.equal(t.emissiveIntensity, 2)
  const half = resolveFinish(FINISH.chrome, 0.5, 0.25, 2, litOriginal)
  assert.equal(half.emissiveIntensity, 1)
})

test('glass gets transmission and refraction only as amount rises', () => {
  assert.equal(resolveFinish(FINISH.glass, 1, 0, 0, litOriginal).transmission, 1)
  assert.equal(resolveFinish(FINISH.glass, 0.25, 0, 0, litOriginal).transmission, 0.25)
})

test('velvet raises sheen with a soft body', () => {
  const t = resolveFinish(FINISH.velvet, 1, 0.25, 0, litOriginal)
  assert.equal(t.sheen, 1)
  assert.equal(t.metalness, 0)
  assert.equal(t.roughness, 1)
})

test('unlit originals fade their emissive emulation out as amount rises', () => {
  assert.equal(resolveFinish(FINISH.chrome, 0.25, 0, 0, unlitOriginal).emissiveIntensity, 0.75)
  assert.equal(resolveFinish(FINISH.chrome, 1, 0, 0, unlitOriginal).emissiveIntensity, 0)
})

test('toon band count follows the rough knob inversely and stays in 2-5', () => {
  assert.equal(toonSteps(1), 2)
  assert.equal(toonSteps(0), 5)
  for (const r of [0, 0.25, 0.5, 0.75, 1]) {
    const s = toonSteps(r)
    assert.ok(s >= 2 && s <= 5)
  }
})

test('amount is clamped', () => {
  const t = resolveFinish(FINISH.chrome, 5, 0, 0, litOriginal)
  assert.equal(t.metalness, 1)
})

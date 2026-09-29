import test from 'node:test'
import assert from 'node:assert/strict'
import { GLOW_DEFAULTS, GLOW_PRESETS, glowAxes, glowIsNeutral, glowSettings, glowWeights } from './glow'
import { acquireShaderScratch, releaseShaderScratch } from '../../components/visual/shaderScratchPool'
import { HalfFloatType } from 'three'

test('strength zero preserves a neutral core; brightness/white remain independent', () => {
  assert.equal(glowIsNeutral({ ...GLOW_DEFAULTS, strength: 0 }), true)
  assert.equal(glowIsNeutral({ ...GLOW_DEFAULTS, strength: 0, coreBrightness: 2 }), false)
  assert.equal(glowIsNeutral({ ...GLOW_DEFAULTS, strength: 0, coreWhite: 1 }), false)
  assert.deepEqual(glowSettings({ strength: 8 }).coreBrightness, 1)
})
test('radius occupies the same frame fraction at preview, HD and UHD', () => {
  for (const size of [
    [480, 270],
    [1920, 1080],
    [3840, 2160],
  ])
    assert.deepEqual(glowAxes(36, 1, 0, size[0], size[1]), glowAxes(36, 1, 0, 1920, 1080))
  const [horizontal, vertical] = glowAxes(36, 8, 0, 1920, 1080)
  assert.equal(horizontal[0] / vertical[1], 8 / (1920 / 1080))
  const [turned] = glowAxes(36, 8, 90, 1920, 1080)
  assert.ok(Math.abs(turned[0]) < 1e-12)
  assert.ok(turned[1] > 0.26)
})
test('spread redistributes normalized emission without a hidden gain', () => {
  for (const s of [0, 0.25, 0.5, 0.75, 1])
    assert.ok(Math.abs(glowWeights(s).reduce((a, b) => a + b, 0) - 1) < 1e-12)
  assert.ok(glowWeights(0)[0] > glowWeights(1)[0])
  assert.ok(glowWeights(1)[2] > glowWeights(0)[2])
})
test('presets are complete editable settings and finite inputs are bounded', () => {
  for (const preset of Object.values(GLOW_PRESETS))
    assert.deepEqual(Object.keys(preset).sort(), Object.keys(GLOW_DEFAULTS).sort())
  assert.equal(glowSettings({ radius: NaN }).radius, GLOW_DEFAULTS.radius)
  assert.equal(glowSettings({ strength: -10 }).strength, 0)
  assert.equal(glowSettings({ stretch: 100 }).stretch, 12)
})
test('shared shader scratch preserves HDR and releases the final borrower', () => {
  const a = acquireShaderScratch(17, 19, true),
    b = acquireShaderScratch(17, 19, true)
  assert.equal(a, b)
  for (const t of [a.src, a.ping, a.pong]) assert.equal(t.texture.type, HalfFloatType)
  let disposed = 0
  a.src.addEventListener('dispose', () => disposed++)
  releaseShaderScratch(a)
  assert.equal(disposed, 0)
  releaseShaderScratch(b)
  assert.equal(disposed, 1)
})

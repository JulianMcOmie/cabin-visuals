import assert from 'node:assert/strict'
import test from 'node:test'
import { PLUGIN_LIST } from '../index'
import { SCENE_FX_PREVIEW_PRELUDE, sceneFxPreviewFragment, sceneFxPreviewUniformNames } from './previewFrame'
import { SCENE_FX_RATES, SCENE_FX_RATE_DETENTS, formatSceneFxRate } from './rate'

// The panel previews run each device's REAL shader over a procedural reference
// frame, which only works while the rewiring in previewFrame.ts still matches
// how the devices sample. A device that read the frame some other way would
// preview as a black window with no error anywhere - these tests are that
// tripwire (GLSL cannot be compiled here, so they assert the source).

const scenePlugins = PLUGIN_LIST.filter((plugin) => plugin.category === 'scene')

test('every scene device rewires onto the reference frame, leaving no scene-texture reads', () => {
  for (const plugin of scenePlugins) {
    const source = sceneFxPreviewFragment(plugin.fragmentShader!)
    assert.ok(
      !/texture2D\s*\(\s*tDiffuse/.test(source),
      `${plugin.id}: a tDiffuse read survived the rewiring (the preview would be black)`,
    )
    assert.ok(
      source.includes('sceneFxReferenceTexel('),
      `${plugin.id}: nothing was rewired onto the reference frame`,
    )
  }
})

test('the assembled program declares the shared symbols exactly once', () => {
  for (const plugin of scenePlugins) {
    const source = sceneFxPreviewFragment(plugin.fragmentShader!)
    for (const declaration of ['varying vec2 vUv;', 'uniform float aspect;']) {
      const count = source.split(declaration).length - 1
      assert.equal(count, 1, `${plugin.id}: '${declaration}' appears ${count}× (a duplicate fails to link)`)
    }
    assert.ok(!source.includes('uniform sampler2D tDiffuse;'), `${plugin.id}: the sampler survived`)
    assert.ok(source.startsWith(SCENE_FX_PREVIEW_PRELUDE), `${plugin.id}: the prelude must come first`)
  }
})

test('the preview drives every one of a device’s params, plus the shared two', () => {
  for (const plugin of scenePlugins) {
    const names = sceneFxPreviewUniformNames(plugin)
    assert.ok(names.includes('aspect') && names.includes('time'), `${plugin.id}: shared uniforms missing`)
    for (const param of plugin.params) {
      assert.ok(names.includes(param.key), `${plugin.id}: '${param.key}' would never reach the preview`)
    }
  }
})

test('the reference frame carries what each device needs to be legible', () => {
  // Named so that deleting an element of the frame fails HERE rather than
  // quietly making one device's preview useless (see previewFrame.ts's header).
  assert.ok(SCENE_FX_PREVIEW_PRELUDE.includes('sceneFxEmitter'), 'emitters above 1.0 — Grade’s headroom')
  assert.ok(SCENE_FX_PREVIEW_PRELUDE.includes('horizon'), 'the straight-line floor grid — Lens and Blur')
  assert.ok(SCENE_FX_PREVIEW_PRELUDE.includes('vec2(-0.46, 0.14)'), 'the OFF-CENTRE subject — Mirror')
})

test('the musical rate ladder stays inside every re-seeding device param range', () => {
  const rateDevices = scenePlugins.filter((plugin) => plugin.params.some((param) => param.key === 'rate'))
  assert.ok(rateDevices.length >= 2, 'Grain and Glitch both re-seed')
  for (const plugin of rateDevices) {
    const def = plugin.params.find((param) => param.key === 'rate')!
    assert.ok('min' in def && 'max' in def)
    for (const rate of SCENE_FX_RATE_DETENTS) {
      assert.ok(
        rate >= (def as { min: number }).min && rate <= (def as { max: number }).max,
        `${plugin.id}: detent ${rate} falls outside the param range, so the knob would write a clamped value`,
      )
    }
  }
})

test('a rate between detents still reads as the nearest note value', () => {
  assert.equal(formatSceneFxRate(4), '1/16')
  assert.equal(formatSceneFxRate(3.6), '1/16')
  assert.equal(formatSceneFxRate(0.25), '1/1')
  assert.equal(SCENE_FX_RATES.length, SCENE_FX_RATE_DETENTS.length)
})

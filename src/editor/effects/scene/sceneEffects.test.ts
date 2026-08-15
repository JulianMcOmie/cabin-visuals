import assert from 'node:assert/strict'
import test from 'node:test'
import { PLUGIN_LIST } from '../index'

// The scene-effect contract (effects/types.ts): a scene device is a fragment
// shader over tDiffuse whose AMOUNT param at 0 is a passthrough (the runtime
// skips the pass). VisualScene wires ONE float uniform per param key, so a
// param the shader never declares is a dead knob and a uniform the params
// never declare is never driven - this test pins both directions.
const scenePlugins = PLUGIN_LIST.filter((p) => p.category === 'scene')

test('scene devices exist and declare the fragment-shader shape', () => {
  assert.ok(scenePlugins.length >= 7)
  for (const plugin of scenePlugins) {
    assert.ok(plugin.fragmentShader, `${plugin.id} has no fragmentShader`)
    assert.ok(!plugin.applyTransform && !plugin.materialField && !plugin.vertexField,
      `${plugin.id} declares object-effect hooks`)
  }
})

test('every scene device carries an amount param the runtime can gate on', () => {
  for (const plugin of scenePlugins) {
    const amount = plugin.params.find((p) => p.key === 'amount')
    assert.ok(amount, `${plugin.id} has no amount param`)
  }
})

test('params and shader uniforms agree in both directions', () => {
  for (const plugin of scenePlugins) {
    const shader = plugin.fragmentShader!
    const declared = new Set(
      [...shader.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]),
    )
    for (const p of plugin.params) {
      assert.ok(declared.has(p.key), `${plugin.id}: param '${p.key}' is not a shader uniform`)
    }
    const wired = new Set([...plugin.params.map((p) => p.key), 'tDiffuse', 'time', 'resolution', 'aspect'])
    for (const name of declared) {
      assert.ok(wired.has(name), `${plugin.id}: uniform '${name}' is never driven`)
    }
  }
})

test('scene shaders sample tDiffuse and stay beat-pure', () => {
  for (const plugin of scenePlugins) {
    const shader = plugin.fragmentShader!
    assert.ok(shader.includes('tDiffuse'), `${plugin.id} never reads the frame`)
    // No wall-clock or frame-count inputs exist in this pipeline; anything
    // animated must derive from `time` (the beat). A stray backtick would
    // truncate the template literal - the classic silent GLSL killer.
    assert.ok(!shader.includes('`'), `${plugin.id} shader contains a backtick`)
  }
})

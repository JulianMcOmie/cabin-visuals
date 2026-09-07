import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { fractalSplitter } from './fractal'
import { wallpaperSplitter } from './wallpaper'
import { scatterSplitter } from './scatter'
import { parametricPatternSplitter } from './parametricPattern'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'

for (const definition of [fractalSplitter, wallpaperSplitter, scatterSplitter, parametricPatternSplitter]) {
  test(`${definition.label} composes locally and preserves incoming appearance without mutation`, () => {
    const settings = mergeDefinitionSettings(definition, definition.id === 'parametricPattern' ? { pattern: 6 } : {})
    // These definitions have different settings shapes; the registry boundary
    // performs this same merge before handing each one its declared settings.
    const resolved = definition.resolve({ settings: settings as never, notes: [] })
    const context = { beat: 0, index: 0, count: 1 }
    const local = resolved.apply(identityVisualCopy(), context)
    const incoming = identityVisualCopy()
    incoming.transform = new Matrix4().makeTranslation(3, -4, 1).multiply(new Matrix4().makeRotationZ(.4)).multiply(new Matrix4().makeScale(2, 3, 1))
    incoming.opacity = .37
    incoming.colorShift.hue = .2
    const before = incoming.transform.elements.slice()
    const result = resolved.apply(incoming, context)
    result.forEach((copy, i) => {
      assert.deepEqual(copy.transform.elements, incoming.transform.clone().multiply(local[i].transform).elements)
      assert.equal(copy.opacity, .37)
      assert.deepEqual(copy.colorShift, incoming.colorShift)
      assert.notEqual(copy.colorShift, incoming.colorShift)
    })
    assert.deepEqual(incoming.transform.elements, before)
  })
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { Color } from 'three'
import { applyColorShiftToColor } from './colorShift'
import { createCopyColorSampler } from './copyColorSampler'

test('cached copy colors match uncached mixing across mutable shifts, source changes and eviction', () => {
  const sample = createCopyColorSampler(2), out = new Color(), tint = new Color()
  const shift = { hue: .13, saturation: .1, lightness: -.04, tint: '#ff3300', tintAmount: .6, tintPerceptual: true, huePerceptual: true }
  for (const source of ['#ffffff', '#124578', 'red', '#ffffff']) for (const hue of [.13, .13, -.2, 0, .5, .13]) for (const perceptual of [true, false]) {
    shift.hue = hue; shift.huePerceptual = perceptual
    const expected = applyColorShiftToColor(new Color(source), shift, tint)
    assert.equal(sample(source, shift, out), out)
    assert.deepEqual(out, expected)
    out.set('#000000')
    assert.deepEqual(sample(source, { ...shift }, out), expected, 'copy identity and mutation of output cannot corrupt cached values')
  }
  assert.deepEqual(sample('#fff123', undefined, out), new Color('#fff123'))
})

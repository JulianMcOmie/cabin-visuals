import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultAutomationCombine } from './automationCombineDefaults'

test('counts are absolute, including numbered copies and count-valued dimensions', () => {
  for (const key of ['copies', 'copies0', 'copiesPerRing', 'starCount', 'rows', 'columns', 'mirrors', 'segments', 'seed']) {
    assert.equal(defaultAutomationCombine(key), 'override', key)
  }
  assert.equal(defaultAutomationCombine('depth', { integer: true, default: 1 }), 'override')
  assert.equal(defaultAutomationCombine('depth', { default: 24 }), 'multiply')
  assert.equal(defaultAutomationCombine('columnsRadius', { default: 1 }), 'multiply')
})

test('dimensions, size and levels multiply while coordinates and rotations sum', () => {
  for (const key of ['size', 'tfSize', 'fontSize', 'scale', 'width', 'height', 'radius0', 'spacing', 'distance', 'spanX', 'wavelength', 'zoom', 'tfOpacity', 'opacity', 'volume', 'gain', 'intensity']) {
    assert.equal(defaultAutomationCombine(key, { default: 1 }), 'multiply', key)
  }
  for (const key of ['tfX', 'tfY', 'tfZ', 'posX', 'centerY', 'pivotZ', 'offset', 'offsetZ', 'tfRotX', 'tfRotY', 'tfRotZ', 'angle', 'hueShift', 'phaseR']) {
    assert.equal(defaultAutomationCombine(key), 'sum', key)
  }
  assert.equal(defaultAutomationCombine('exposure', { min: -2 }), 'sum')
})

test('timing, switches and unknown settings override; zero levels do not get stuck multiplying zero', () => {
  for (const key of ['enabled', 'attackBeats', 'duration', 'staggerBeats', 'rollBeats', 'phaseRate', 'spinSpeed', 'frequencyA']) {
    assert.equal(defaultAutomationCombine(key, { min: -1 }), 'override', key)
  }
  assert.equal(defaultAutomationCombine('amount'), 'override')
  assert.equal(defaultAutomationCombine('unrecognized'), 'override')
  assert.equal(defaultAutomationCombine('intensity', { default: 0 }), 'override')
})

test('effect instance ids never influence the default', () => {
  assert.equal(defaultAutomationCombine('fx:copies:size:enabled'), 'override')
  assert.equal(defaultAutomationCombine('fx:opaque:id:opacity', { default: 1 }), 'multiply')
  assert.equal(defaultAutomationCombine('fx:opaque:id:hue'), 'sum')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { p, rowsFrom, toMidiRows, toParamDefs } from './params'
import { declareMissing, glslTypeOf } from './shaderSupport'
import { Color, Vector2 } from 'three'

test('param builders become ordinary ParamDefs', () => {
  const defs = toParamDefs({ speed: p.num(1, 0, 4), count: p.int(8, 1, 64), on: p.bool(true), shape: p.select(['A', 'B'], 1), tint: p.color('#ff0000'), label: p.text('hi') })
  assert.deepEqual(defs.map((d) => d.key), ['speed', 'count', 'on', 'shape', 'tint', 'label'])
  assert.equal(defs[0].label, 'Speed')
  assert.equal((defs[0] as { step: number }).step, 0.01)
  assert.equal((defs[1] as { integer?: boolean }).integer, true)
  assert.equal(defs[2].type, 'boolean')
  assert.equal((defs[2] as { default: number }).default, 1)
  assert.deepEqual((defs[3] as { options: unknown[] }).options, [{ value: 0, label: 'A' }, { value: 1, label: 'B' }])
  assert.equal(defs[4].type, 'color')
  assert.equal(defs[5].type, 'string')
})

test('rows are sorted highest pitch first', () => {
  const rows = toMidiRows({ 60: 'Low', 72: { label: 'High', emphasized: true }, 64: 'Mid' })!
  assert.deepEqual(rows.map((r) => r.pitch), [72, 64, 60])
  assert.equal(rows[0].emphasized, true)
  assert.equal(toMidiRows(undefined), undefined)
  assert.deepEqual(Object.keys(rowsFrom(48, ['C', 'C#'])), ['48', '49'])
})

test('shader declarations are added only when missing (comma lists included)', () => {
  const src = 'uniform float uA, uB;\nvarying vec2 vUv;\nvoid main(){}'
  const out = declareMissing(src, [
    { qualifier: 'uniform', type: 'float', name: 'uB' },
    { qualifier: 'uniform', type: 'float', name: 'uC' },
    { qualifier: 'varying', type: 'vec2', name: 'vUv' },
    { qualifier: 'uniform', type: 'float', name: 'uC' },
  ])
  assert.equal(out.split('\n')[0], 'uniform float uC;')
  assert.equal(out.match(/uC;/g)?.length, 1)
  assert.equal(glslTypeOf(1), 'float')
  assert.equal(glslTypeOf(new Vector2()), 'vec2')
  assert.equal(glslTypeOf(new Color()), 'vec3')
  assert.equal(glslTypeOf([1, 2, 3, 4]), 'vec4')
  assert.equal(glslTypeOf({}), null)
})

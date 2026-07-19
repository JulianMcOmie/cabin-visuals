import assert from 'node:assert/strict'
import test from 'node:test'
import { Color } from 'three'
import { applyColorShiftToInstrumentParams } from './instrumentColor'

const params = [
  { key: 'color', defaultColor: '#25dfff' },
  { key: 'strokeColor', defaultColor: '#000000' },
]

test('copy hue changes declared instrument color params, including schema defaults', () => {
  const output: Record<string, string> = {}
  applyColorShiftToInstrumentParams(
    { label: 'LASER' },
    params,
    0.25,
    0,
    0,
    output,
    new Color(),
  )

  const expected = `#${new Color('#25dfff').offsetHSL(0.25, 0, 0).getHexString()}`
  assert.equal(output.color, expected)
  assert.equal(output.label, 'LASER')
})

test('stored colors are shifted while non-color and intentionally empty params are preserved', () => {
  const output: Record<string, string> = { stale: 'remove me' }
  applyColorShiftToInstrumentParams(
    { color: '#ff0000', strokeColor: '', geometry: 'cube' },
    params,
    -1 / 3,
    0,
    0,
    output,
    new Color(),
  )

  assert.equal(output.color, `#${new Color('#ff0000').offsetHSL(-1 / 3, 0, 0).getHexString()}`)
  assert.equal(output.strokeColor, '')
  assert.equal(output.geometry, 'cube')
  assert.equal('stale' in output, false)
})

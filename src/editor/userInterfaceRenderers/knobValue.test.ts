import test from 'node:test'
import assert from 'node:assert/strict'
import { exactKnobValue, growthEntry, noteRateEntry, numberEntry, parseKnobNumber, percentEntry, periodEntry, turnsEntry } from './knobValueParsing'
import { knobPosition, knobValueAt } from './useKnobInteraction'

const options = { value: 0, min: -10, max: 10, step: 0.5, defaultValue: 0, onChange: () => {} }
test('exact entry accepts complete decimal, exponent, signed and fraction tokens only', () => {
  for (const [text, expected] of [['.125', 0.125], ['−2.5', -2.5], ['1e-7', 1e-7], ['-1/8', -0.125], ['+4', 4]] as const) assert.equal(parseKnobNumber(text), expected)
  for (const text of ['', ' ', '1e', '1/0', 'Infinity', 'NaN', '0x10', '12junk', '1+2', '1/2/3', '1,2']) assert.equal(parseKnobNumber(text), null, text)
})
test('exact values preserve precision and reject range violations instead of clamping', () => {
  assert.equal(exactKnobValue('0.123456789', numberEntry(), 0, 1), 0.123456789)
  assert.equal(exactKnobValue('1e-9', numberEntry(), 0, 1), 1e-9)
  assert.equal(exactKnobValue('1.001', numberEntry(), 0, 1), null)
  assert.equal(exactKnobValue('-0.001', numberEntry(), 0, 1), null)
  assert.equal(exactKnobValue('1', numberEntry(), 1, 1), 1)
  assert.equal(exactKnobValue('2.5', numberEntry(), 1, 12, true), null)
  assert.equal(exactKnobValue('3', numberEntry(), 1, 12, true), 3)
})
test('displayed units convert to stored units without rounding', () => {
  assert.equal(percentEntry.parse('12.345%'), 0.12345)
  assert.equal(percentEntry.parse('110'), 1.1)
  assert.equal(turnsEntry.parse('90°'), 0.25)
  assert.equal(numberEntry('°').parse('90°'), 90)
  assert.equal(numberEntry('b').parse('1/8 beats'), 0.125)
  assert.equal(numberEntry('/b').parse('1.25/beat'), 1.25)
  assert.equal(numberEntry('×').parse('2.5x'), 2.5)
  assert.equal(growthEntry.parse('×1.25'), Math.log2(1.25))
  assert.equal(growthEntry.parse('0'), null)
})
test('musical periods distinguish beats, note values and raw off-grid rates', () => {
  assert.equal(periodEntry(1, true).parse('1/4b'), 4)
  assert.equal(periodEntry(1, true).parse('−8b'), -0.125)
  assert.equal(periodEntry(360, true, '°').parse('-8b'), -45)
  assert.equal(periodEntry(360, true, '°').parse('22.75°'), 22.75)
  assert.equal(periodEntry(360, false, '°').parse('22.75'), 22.75)
  assert.equal(periodEntry(1, false).parse('0.45'), 0.45)
  assert.equal(periodEntry(1, false).parse('2b'), 0.5)
  assert.equal(periodEntry(360, true).parse('0'), 0)
  assert.equal(noteRateEntry.parse('1/16'), 4)
  assert.equal(noteRateEntry.parse('1/10'), 2.5)
  assert.equal(noteRateEntry.parse('0'), null)
})
test('opening a draft retains sub-display precision across all conversion codecs', () => {
  for (const codec of [numberEntry(), percentEntry, turnsEntry, growthEntry, noteRateEntry, periodEntry(360, true)]) {
    const original = 0.123456789
    const parsed = codec.parse(codec.edit(original))!
    assert.ok(Math.abs(parsed - original) < 1e-14)
  }
})
test('drag grids and curved small-value precision remain independent of exact entry', () => {
  assert.equal(knobValueAt(0.513, options), 0.5)
  assert.equal(knobValueAt(-1, options), -10)
  assert.equal(knobValueAt(2, options), 10)
  const curved = { ...options, min: 0, max: 10000, curve: 4, step: 1 }
  assert.equal(knobValueAt(0.001, curved), 1e-8)
  assert.equal(knobPosition(0.0001, 0, 10000, 4), 0.01)
})
test('uneven detents only constrain dragging, with real values on the shared primitive', () => {
  const detents = [-180, -45, 0, 45, 180]
  assert.equal(knobPosition(30, -180, 180, 1, detents), 0.75)
  assert.equal(knobValueAt(0.75, { ...options, detents }), 45)
  assert.equal(exactKnobValue('22.75°', periodEntry(360, true, '°'), -180, 180), 22.75)
  assert.equal(knobPosition(1, 1, 1), 0)
  assert.equal(knobValueAt(0.5, { ...options, min: 1, max: 1 }), 1)
})

test('every named knob/dial in instrument panels delegates to the shared behavior', async () => {
  const { readdir, readFile } = await import('node:fs/promises')
  const ts = await import('typescript')
  const directory = new URL('./', import.meta.url)
  const variants: string[] = []
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.tsx')) continue
    const text = await readFile(new URL(file, directory), 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: import('typescript').Node) => {
      if (ts.isFunctionDeclaration(node) && node.name && /(?:Knob|Dial)$/.test(node.name.text)) {
        variants.push(node.name.text)
        assert.match(node.getText(source), /(?:<LaserKnob\b|<Knob\b|useKnobInteraction\()/, `${file}: ${node.name.text} must use shared knob behavior`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.ok(variants.includes('LaserKnob'))
  assert.ok(variants.includes('ShockKnob'))
  assert.ok(variants.includes('OrientationDial'))
  assert.ok(variants.length >= 15, `audit unexpectedly saw only ${variants.length} wrappers/skins`)
})

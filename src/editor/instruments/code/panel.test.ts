import test from 'node:test'
import assert from 'node:assert/strict'
import { autoPanel } from './panel'
import { p } from './params'

test('auto panels: segmented selects, knob rows of four with short captions, labelled pills', () => {
  const spec = {
    id: 'x.y', name: 'Y',
    params: {
      mode: p.select(['A', 'B'], 0), grains: p.int(10, 1, 100), size: p.num(1, 0, 2, { label: 'Plate size' }),
      settle: p.num(1, 0, 8, { label: 'Settle (beats)' }), alpha: p.num(1, 0, 1, { label: 'Density' }), extra: p.num(1, 0, 1),
      gated: p.num(1, 0, 1, { showIf: 'on' }), on: p.bool(true), tint: p.color('#ff0000', { label: 'In flight' }),
    },
  }
  const panel = autoPanel(spec as never)!
  assert.deepEqual(panel.rows[0], { segmented: 'mode' })
  const knobRow = panel.rows[1] as { row: Array<{ param: string; label: string; large?: boolean }> }
  assert.equal(knobRow.row.length, 4)
  assert.deepEqual(knobRow.row.map((k) => k.label), ['GRAINS', 'PLATE', 'SETTLE', 'DENSITY'])
  assert.equal(knobRow.row[0].large, true)
  const second = panel.rows[2] as { row: Array<{ param: string; optional?: boolean }> }
  assert.deepEqual(second.row.map((k) => k.param), ['extra', 'gated'])
  assert.equal(second.row[1].optional, true)
  assert.deepEqual((panel.rows[3] as { row: unknown[] }).row, [{ pill: 'tint', label: 'TINT' }])
  assert.deepEqual(panel.accent, { param: 'tint', fallback: '#ff0000' })
  assert.equal(autoPanel({ id: 'x.z', name: 'Z' } as never), undefined)
})

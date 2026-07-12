import assert from 'node:assert/strict'
import test from 'node:test'
import { gridCellOrder, gridSplitter, type GridSettings } from './library'
import { resolveVisualCopies } from './resolveVisualCopies'

const settings = (overrides: Partial<GridSettings> = {}): GridSettings => ({
  rows: 2,
  columns: 3,
  plane: 0,
  indexing: 0,
  ...overrides,
})

function resolveGrid(overrides: Partial<GridSettings> = {}) {
  return resolveVisualCopies([gridSplitter.resolve({ settings: settings(overrides), notes: [] })], 0)
}

function position(copy: ReturnType<typeof resolveGrid>[number]): [number, number, number] {
  return [copy.transform.elements[12], copy.transform.elements[13], copy.transform.elements[14]]
}

function scale(copy: ReturnType<typeof resolveGrid>[number]): [number, number, number] {
  return [copy.transform.elements[0], copy.transform.elements[5], copy.transform.elements[10]]
}

function rounded(values: [number, number, number][]): [number, number, number][] {
  return values.map((value) => value.map((n) => Number(n.toFixed(10))) as [number, number, number])
}

test('grid defaults to XY axes and English reading order', () => {
  const copies = resolveGrid()
  assert.equal(copies.length, 6)
  assert.deepEqual(rounded(copies.map(position)), [
    [-0.3333333333, 0.25, 0],
    [0, 0.25, 0],
    [0.3333333333, 0.25, 0],
    [-0.3333333333, -0.25, 0],
    [0, -0.25, 0],
    [0.3333333333, -0.25, 0],
  ])
  for (const copy of copies) assert.deepEqual(scale(copy), [1 / 3, 0.5, 1])
})

test('grid can split across XZ or YZ', () => {
  const xz = resolveGrid({ rows: 2, columns: 2, plane: 1 })
  assert.deepEqual(position(xz[0]), [-0.25, 0, 0.25])
  assert.deepEqual(scale(xz[0]), [0.5, 1, 0.5])

  const yz = resolveGrid({ rows: 2, columns: 2, plane: 2 })
  assert.deepEqual(position(yz[0]), [0, -0.25, 0.25])
  assert.deepEqual(scale(yz[0]), [1, 0.5, 0.5])
})

test('grid indexing modes change downstream index order without changing cells', () => {
  assert.deepEqual(gridCellOrder(2, 3, 0), [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]])
  assert.deepEqual(gridCellOrder(2, 3, 1), [[1, 2], [1, 1], [1, 0], [0, 2], [0, 1], [0, 0]])
  assert.deepEqual(gridCellOrder(2, 3, 2), [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]])
  assert.deepEqual(gridCellOrder(2, 3, 3), [[1, 2], [0, 2], [1, 1], [0, 1], [1, 0], [0, 0]])
})

test('grid dimensions clamp to the structural 1..32 range', () => {
  assert.equal(resolveGrid({ rows: 0, columns: 0 }).length, 1)
  assert.equal(resolveGrid({ rows: 100, columns: 100 }).length, 1024)
})

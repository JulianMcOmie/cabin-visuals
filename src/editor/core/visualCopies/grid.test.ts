import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { gridCellOrder, gridCellOrder3, gridSplitter, type GridSettings } from './library'
import { resolveVisualCopies } from './resolveVisualCopies'

const settings = (overrides: Partial<GridSettings> = {}): GridSettings => ({
  rows: 2,
  columns: 3,
  depth: 1,
  spacing: 1,
  plane: 0,
  indexing: 0,
  columnsMode: 0,
  rowsMode: 0,
  depthMode: 0,
  columnsRadius: 2,
  rowsRadius: 2,
  depthRadius: 2,
  ...overrides,
})

function note(pitch: number, durationBeats = 1): ResolvedNote {
  return { beat: 0, blockStartBeat: 0, blockEndBeat: 16, pitch, velocity: 1, durationBeats }
}

function resolveGrid(overrides: Partial<GridSettings> = {}, notes: ResolvedNote[] = [], beat = 0) {
  return resolveVisualCopies([gridSplitter.resolve({ settings: settings(overrides), notes })], beat)
}

function position(copy: ReturnType<typeof resolveGrid>[number]): [number, number, number] {
  return [copy.transform.elements[12], copy.transform.elements[13], copy.transform.elements[14]]
}

function scale(copy: ReturnType<typeof resolveGrid>[number]): [number, number, number] {
  return [copy.transform.elements[0], copy.transform.elements[5], copy.transform.elements[10]]
}

function rounded(values: [number, number, number][]): [number, number, number][] {
  return values.map((value) => value.map((n) => Number(n.toFixed(10)) || 0) as [number, number, number])
}

test('grid defaults to XY axes and English reading order', () => {
  const copies = resolveGrid()
  assert.equal(copies.length, 6)
  assert.deepEqual(rounded(copies.map(position)), [
    [-1, 0.5, 0],
    [0, 0.5, 0],
    [1, 0.5, 0],
    [-1, -0.5, 0],
    [0, -0.5, 0],
    [1, -0.5, 0],
  ])
  for (const copy of copies) assert.deepEqual(scale(copy), [1, 1, 1])
})

test('grid can split across XZ or YZ', () => {
  const xz = resolveGrid({ rows: 2, columns: 2, plane: 1 })
  assert.deepEqual(position(xz[0]), [-0.5, 0, 0.5])
  assert.deepEqual(scale(xz[0]), [1, 1, 1])

  const yz = resolveGrid({ rows: 2, columns: 2, plane: 2 })
  assert.deepEqual(position(yz[0]), [0, -0.5, 0.5])
  assert.deepEqual(scale(yz[0]), [1, 1, 1])
})

test('grid spacing changes cell-center distance while every copy stays full size', () => {
  const copies = resolveGrid({ rows: 2, columns: 2, spacing: 2 })
  assert.deepEqual(copies.map(position), [
    [-1, 1, 0],
    [1, 1, 0],
    [-1, -1, 0],
    [1, -1, 0],
  ])
  for (const copy of copies) assert.deepEqual(scale(copy), [1, 1, 1])
})

test('grid preserves an incoming non-unit scale', () => {
  const incomingScale = {
    apply(copy: ReturnType<typeof resolveGrid>[number]) {
      return [{
        ...copy,
        transform: copy.transform.clone().multiply(new Matrix4().makeScale(2, 3, 4)),
        colorShift: { ...copy.colorShift },
      }]
    },
  }
  const grid = gridSplitter.resolve({ settings: settings({ rows: 2, columns: 2 }), notes: [] })
  const copies = resolveVisualCopies([incomingScale, grid], 0)
  for (const copy of copies) assert.deepEqual(scale(copy), [2, 3, 4])
})

test('grid MIDI rows disable cells only while their notes are held', () => {
  const rows = gridSplitter.midiRows!(settings({ rows: 2, columns: 2 }))
  assert.deepEqual(rows.map((row) => row.label), [
    'Disable cell 1',
    'Disable cell 2',
    'Disable cell 3',
    'Disable cell 4',
  ])
  assert.equal(gridSplitter.strictMidiRows, true)

  const held = resolveGrid({ rows: 2, columns: 2 }, [note(rows[1].pitch)], 0.5)
  const released = resolveGrid({ rows: 2, columns: 2 }, [note(rows[1].pitch)], 1)
  assert.deepEqual(held.map((copy) => copy.opacity), [1, 0, 1, 1])
  assert.deepEqual(released.map((copy) => copy.opacity), [1, 1, 1, 1])
})

test('large grids group every cell across the 128 available MIDI rows', () => {
  const largeSettings = settings({ rows: 32, columns: 32 })
  const rows = gridSplitter.midiRows!(largeSettings)
  assert.equal(rows.length, 128)
  assert.equal(rows[0].label, 'Disable cells 1–8')
  assert.equal(rows[127].label, 'Disable cells 1017–1024')

  const copies = resolveGrid(largeSettings, [note(rows[127].pitch)], 0.5)
  assert.equal(copies.filter((copy) => copy.opacity === 0).length, 8)
  assert.deepEqual(copies.slice(-8).map((copy) => copy.opacity), Array(8).fill(0))
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

test('depth stacks layers along the plane normal, front layer first', () => {
  const copies = resolveGrid({ rows: 1, columns: 1, depth: 3, spacing: 2 })
  assert.deepEqual(rounded(copies.map(position)), [
    [0, 0, 2],
    [0, 0, 0],
    [0, 0, -2],
  ])
  for (const copy of copies) assert.deepEqual(scale(copy), [1, 1, 1])

  // On the X/Z plane the normal is Y.
  const xz = resolveGrid({ rows: 1, columns: 1, depth: 2, plane: 1 })
  assert.deepEqual(rounded(xz.map(position)), [
    [0, 0.5, 0],
    [0, -0.5, 0],
  ])
})

test('gridCellOrder3 walks layers outermost and depth 1 matches gridCellOrder', () => {
  assert.deepEqual(gridCellOrder3(2, 2, 2, 0), [
    [0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0],
    [0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 1],
  ])
  assert.deepEqual(gridCellOrder3(2, 2, 2, 1), gridCellOrder3(2, 2, 2, 0).slice().reverse())
  for (const indexing of [0, 1, 2, 3]) {
    assert.deepEqual(
      gridCellOrder3(2, 3, 1, indexing).map(([row, column]) => [row, column]),
      gridCellOrder(2, 3, indexing),
    )
  }
})

test('circular columns wrap into a ring about the plane normal, slot 0 unrotated', () => {
  const copies = resolveGrid({ rows: 1, columns: 4, columnsMode: 1, columnsRadius: 2 })
  assert.deepEqual(rounded(copies.map(position)), [
    [2, 0, 0],
    [0, 2, 0],
    [-2, 0, 0],
    [0, -2, 0],
  ])
})

test('circular columns above linear rows: rings offset along world Y, not swept', () => {
  const copies = resolveGrid({ rows: 2, columns: 2, columnsMode: 1, columnsRadius: 1 })
  assert.deepEqual(rounded(copies.map(position)), [
    [1, 0.5, 0],
    [-1, 0.5, 0],
    [1, -0.5, 0],
    [-1, -0.5, 0],
  ])
})

test('circular depth is a floor ring; adding linear rows makes a standing cylinder', () => {
  const ring = resolveGrid({ rows: 1, columns: 1, depth: 4, depthMode: 1, depthRadius: 2 })
  assert.deepEqual(rounded(ring.map(position)), [
    [0, 0, 2],
    [2, 0, 0],
    [0, 0, -2],
    [-2, 0, 0],
  ])

  const cylinder = resolveGrid({ rows: 2, columns: 1, depth: 4, depthMode: 1, depthRadius: 2 })
  for (const copy of cylinder) {
    const [x, y, z] = position(copy)
    assert.equal(Number(Math.hypot(x, z).toFixed(9)), 2)
    assert.equal(Number(Math.abs(y).toFixed(9)), 0.5)
  }
})

test('two circular dimensions nest into a torus that collapses to a sphere at radius 0', () => {
  // Rows ring (about X) framing a depth ring (about the rotated Y): with the
  // outer radius at 0 every copy sits exactly depthRadius from the origin.
  const sphere = resolveGrid({
    rows: 4, columns: 1, depth: 6,
    rowsMode: 1, rowsRadius: 0,
    depthMode: 1, depthRadius: 3,
  })
  assert.equal(sphere.length, 24)
  for (const copy of sphere) {
    const [x, y, z] = position(copy)
    assert.equal(Number(Math.hypot(x, y, z).toFixed(9)), 3)
  }

  // Circular columns + circular depth is the true torus pair: the depth ring's
  // plane contains both the columns arm (X) and the columns axis (Z), so every
  // copy sits exactly depthRadius from the spine (radius-2 circle about Z).
  const torus = resolveGrid({
    rows: 1, columns: 8, depth: 4,
    columnsMode: 1, columnsRadius: 2,
    depthMode: 1, depthRadius: 0.5,
  })
  for (const copy of torus) {
    const [x, y, z] = position(copy)
    const spineDistance = Math.hypot(Math.hypot(x, y) - 2, z)
    assert.equal(Number(spineDistance.toFixed(9)), 0.5)
  }
})

test('MIDI rows cover rows x columns x depth cells', () => {
  const rows = gridSplitter.midiRows!(settings({ rows: 2, columns: 2, depth: 2 }))
  assert.equal(rows.length, 8)
  assert.equal(rows[7].label, 'Disable cell 8')

  const copies = resolveGrid({ rows: 2, columns: 2, depth: 2 }, [note(rows[4].pitch)], 0.5)
  assert.deepEqual(copies.map((copy) => copy.opacity), [1, 1, 1, 1, 0, 1, 1, 1])
})

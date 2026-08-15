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
  size: 1,
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

function note(beat: number, pitch: number, durationBeats = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 16, pitch, velocity: 1, durationBeats }
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

test('size scales every copy about its own center, independent of spacing', () => {
  const plain = resolveGrid({ rows: 2, columns: 2, spacing: 2 })
  const scaled = resolveGrid({ rows: 2, columns: 2, spacing: 2, size: 0.5 })
  // Same lattice - SIZE never feeds back into the offsets...
  assert.deepEqual(rounded(scaled.map(position)), rounded(plain.map(position)))
  // ...and every copy is uniformly half size.
  for (const copy of scaled) assert.deepEqual(scale(copy), [0.5, 0.5, 0.5])
  // The default of 1 is neutral, so a save written before the knob existed
  // resolves to exactly the matrices it always did.
  for (const copy of plain) assert.deepEqual(scale(copy), [1, 1, 1])
})

test('size leaves a circular dimension its ring radius', () => {
  const ring = { columns: 4, rows: 1, depth: 1, columnsMode: 1, columnsRadius: 3 }
  const plain = resolveGrid(ring)
  const scaled = resolveGrid({ ...ring, size: 2 })
  assert.deepEqual(rounded(scaled.map(position)), rounded(plain.map(position)))
  // Circular copies are ROTATED, so read the scale off the basis column length
  // rather than the diagonal.
  for (const copy of scaled) {
    const e = copy.transform.elements
    assert.ok(Math.abs(Math.hypot(e[0], e[1], e[2]) - 2) < 1e-10)
  }
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

test('the MIDI lane is a value lane: 9 spacing detent rows over 0-4, bottom = exactly 0', () => {
  const rows = gridSplitter.midiRows!(settings())
  assert.equal(rows.length, 9) // every 6th pitch of the 36..84 span
  assert.deepEqual(rows[0], { pitch: 84, label: 'S 4.0' })
  assert.deepEqual(rows[4], { pitch: 60, label: 'S 2.0' })
  assert.deepEqual(rows[8], { pitch: 36, label: 'S 0.0' })
  assert.equal(gridSplitter.strictMidiRows, true)
})

test('between onsets the spacing swells 0 -> s -> 0; outside the span it rests at the knob', () => {
  // A 1x2 grid: the copies sit at +-spacing/2 on X, so their gap IS the spacing.
  const resolved = gridSplitter.resolve({
    settings: settings({ rows: 1, columns: 2, spacing: 1 }),
    notes: [note(1, 84), note(3, 84)], // pitch 84 = spacing 4
  })
  const spacingAtBeat = (beat: number) => {
    const copies = resolveVisualCopies([resolved], beat)
    return Number((position(copies[1])[0] - position(copies[0])[0]).toFixed(10))
  }
  assert.equal(spacingAtBeat(0.5), 1, 'rests at the knob before the first onset')
  assert.equal(spacingAtBeat(1), 0, 'collapsed on the onset')
  assert.equal(spacingAtBeat(2), 4, 'peaks at the note value mid-cycle')
  assert.equal(spacingAtBeat(1.5), 3, 'the symmetric swell: 4u(1-u) at u = 0.25')
  assert.equal(spacingAtBeat(2.5), 3, '...and its mirror at u = 0.75')
  assert.equal(spacingAtBeat(3), 1, 'rests again from the last onset on')

  // A pitch between detents still decodes through the automation encoding:
  // pitch 60 is the midpoint, spacing 2.
  const half = gridSplitter.resolve({
    settings: settings({ rows: 1, columns: 2, spacing: 0 }),
    notes: [note(0, 60), note(2, 60)],
  })
  const copies = resolveVisualCopies([half], 1)
  assert.equal(Number((position(copies[1])[0] - position(copies[0])[0]).toFixed(10)), 2)
})

test('the value lane scales only the linear lattice; ring radii and mute pitches are inert', () => {
  // Circular columns keep their radius knob while the linear rows collapse to
  // spacing 0 on the onset.
  const ring = gridSplitter.resolve({
    settings: settings({ rows: 2, columns: 4, columnsMode: 1, columnsRadius: 2, spacing: 1 }),
    notes: [note(0, 84), note(2, 84)],
  })
  const collapsed = resolveVisualCopies([ring], 0)
  for (const copy of collapsed) {
    const [x, y] = position(copy)
    assert.equal(Number(Math.hypot(x, y).toFixed(9)), 2, 'ring radius holds at the knob')
  }
  // The two linear rows coincide at spacing 0: each column's pair collapses.
  for (let column = 0; column < 4; column++) {
    assert.deepEqual(rounded([position(collapsed[column])]), rounded([position(collapsed[column + 4])]))
  }

  // The retired per-cell mute rows (pitch 96 up) fall outside the value span:
  // old saves degrade to the knob spacing and nothing is hidden.
  const legacy = resolveGrid({ rows: 2, columns: 2 }, [note(0, 127), note(2, 126)], 1)
  assert.deepEqual(rounded(legacy.map(position)), [
    [-0.5, 0.5, 0],
    [0.5, 0.5, 0],
    [-0.5, -0.5, 0],
    [0.5, -0.5, 0],
  ])
  assert.deepEqual(legacy.map((copy) => copy.opacity), [1, 1, 1, 1])
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


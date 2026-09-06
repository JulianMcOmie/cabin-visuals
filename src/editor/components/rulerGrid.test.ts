import assert from 'node:assert/strict'
import test from 'node:test'
import { computeRulerGrid } from './rulerGrid'

test('Smart MIDI grid passes through quarter-beat snapping while zooming in and out', () => {
  const zooms = [16, 23.99, 24, 36, 47.99, 48, 96]
  const expectedSnaps = [0.5, 0.5, 0.25, 0.25, 0.25, 0.125, 0.125]
  const snaps = zooms.map((zoom) => computeRulerGrid(zoom, 4, 32).playheadSnapBeats)
  assert.deepEqual(snaps, expectedSnaps)
  assert.deepEqual(
    zooms.toReversed().map((zoom) => computeRulerGrid(zoom, 4, 32).playheadSnapBeats),
    expectedSnaps.toReversed(),
  )
})

test('ruler subdivisions and Smart snapping stay aligned across meters', () => {
  for (const beatsPerBar of [3, 4, 5, 7]) {
    for (const [zoom, subBeats] of [[24, 0.5], [48, 0.25]] as const) {
      const grid = computeRulerGrid(zoom, beatsPerBar, 32)
      assert.equal(grid.majorBars, 1)
      assert.equal(grid.minorBeats, 1)
      assert.equal(grid.subBeats, subBeats)
      assert.equal(grid.smallestBeats, subBeats)
      assert.equal(grid.playheadSnapBeats, subBeats / 2)
    }
  }
})

test('zoomed-out bar thinning retains its existing grid', () => {
  for (const [zoom, majorBars, snap] of [[2, 8, 4], [4, 4, 2], [8, 2, 1]] as const) {
    const grid = computeRulerGrid(zoom, 4, 32)
    assert.equal(grid.majorBars, majorBars)
    assert.equal(grid.subBeats, null)
    assert.equal(grid.playheadSnapBeats, snap)
  }
})

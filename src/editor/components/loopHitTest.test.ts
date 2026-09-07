import assert from 'node:assert/strict'
import test from 'node:test'
import { hitLoopRegion } from './loopHitTest'

const region = { startBeat: 16, endBeat: 32, enabled: true }

test('loop edge targets straddle both boundaries with a fixed pixel radius at every zoom', () => {
  for (const zoom of [2, 4, 16, 48, 96, 192]) {
    const start = region.startBeat * zoom
    const end = region.endBeat * zoom
    for (const offset of [-7, -3, 0, 3, 7]) {
      assert.equal(hitLoopRegion(start + offset, region, zoom), 'start')
      assert.equal(hitLoopRegion(end + offset, region, zoom), 'end')
    }
    assert.equal(hitLoopRegion(start - 7.1, region, zoom), 'create')
    assert.equal(hitLoopRegion(start + 7.1, region, zoom), 'move')
    assert.equal(hitLoopRegion(end - 7.1, region, zoom), 'move')
    assert.equal(hitLoopRegion(end + 7.1, region, zoom), 'create')
  }
})

test('overlapping targets choose the closest edge of a short loop', () => {
  const short = { startBeat: 4, endBeat: 5, enabled: true }
  assert.equal(hitLoopRegion(7, short, 2), 'start')
  assert.equal(hitLoopRegion(8.5, short, 2), 'start')
  assert.equal(hitLoopRegion(9.5, short, 2), 'end')
  assert.equal(hitLoopRegion(11, short, 2), 'end')
})

test('disabled and absent loops allow creation everywhere, including both edges and the middle', () => {
  for (const zoom of [2, 16, 96]) {
    for (const beat of [0, 16, 17, 24, 31, 32, 40]) {
      assert.equal(hitLoopRegion(beat * zoom, { ...region, enabled: false }, zoom), 'create')
      assert.equal(hitLoopRegion(beat * zoom, null, zoom), 'create')
    }
  }
})

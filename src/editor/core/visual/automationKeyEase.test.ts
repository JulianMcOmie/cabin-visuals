import test from 'node:test'
import assert from 'node:assert/strict'
import { extractKeyframes, sampleLane } from './automation'
import type { Block } from '../../types'

test('automation keys: an exact value beats the pitch row, and a key ease shapes its segment', () => {
  const blocks: Block[] = [{
    id: 'b', startBar: 0, durationBars: 4, loop: false,
    notes: [
      { id: 'a', startBeat: 0, durationBeats: 0.25, pitch: 36, velocity: 100, value: 0.37, ease: 'expo.out' },
      { id: 'b', startBeat: 8, durationBeats: 0.25, pitch: 84, velocity: 100 },
      { id: 'c', startBeat: 12, durationBeats: 0.25, pitch: 60, velocity: 100, ease: 'step' },
      { id: 'd', startBeat: 14, durationBeats: 0.25, pitch: 84, velocity: 100 },
    ],
  }]
  const keys = extractKeyframes(blocks, 4, 0, 2)
  assert.equal(keys[0].value, 0.37)
  assert.equal(keys[0].ease, 'expo.out')
  assert.equal(keys[1].value, 2)
  // expo.out is far ahead of linear a quarter of the way in
  const quarter = sampleLane(keys, 2, 'linear')
  assert.ok(quarter > 0.37 + (2 - 0.37) * 0.25 + 0.4, `expo.out at 1/4: ${quarter}`)
  // the lane's own mode still shapes un-eased segments
  assert.equal(sampleLane(keys, 10, 'linear'), 2 + (keys[2].value - 2) * 0.5)
  // a 'step' key holds until the next
  assert.equal(sampleLane(keys, 13.9, 'linear'), keys[2].value)
})

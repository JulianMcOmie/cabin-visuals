import assert from 'node:assert/strict'
import test from 'node:test'
import { monochrome } from './library-monochrome'
import { automationMode, extractBurstGates, sampleBurstLane } from '../editor/core/visual/automation'

test('Line Sweeps traverses the boil line over five beats and repeats each loop', () => {
  const doc = monochrome.document
  const tracks = Object.values(doc.scenes).flatMap((s) => Object.values(s.tracks))
  const lane = tracks.find((t) => t.name === 'Line Sweeps')!
  assert.equal(lane.type, 'automation')
  assert.equal(automationMode(lane), 'burst')
  const parent = tracks.find((t) => t.id === lane.parentId)!
  const effect = parent.effects!.find((e) => e.pluginId === 'boil')!
  assert.equal(lane.targetParam, `fx:${effect.id}:linePhase`)
  const base = effect.settings.linePhase
  const gates = extractBurstGates(lane.blocks, doc.beatsPerBar, 0, 1, doc.totalBars)
  const value = (beat: number) => {
    const v = sampleBurstLane(lane.burst!, gates, beat, base)
    return Number.isNaN(v) ? base : v
  }
  for (const offset of [0, 8, 16]) {
    for (const [beat, expected] of [[1, 0], [2, 0], [4.5, 0.5], [7, 1], [7.005, 0.5], [7.02, 0]]) {
      assert.ok(Math.abs(value(beat + offset) - expected) < 1e-9, `beat ${beat + offset}`)
    }
  }
  const sampled = value(4.5)
  value(23)
  assert.equal(value(4.5), sampled)
})

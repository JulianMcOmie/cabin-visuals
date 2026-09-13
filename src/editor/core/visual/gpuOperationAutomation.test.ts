import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Track } from '../../types'
import { resolveProject } from './resolve'
import { applyGpuOperation } from '../visualCopies/gpuOperations'
import { identityVisualCopy } from '../visualCopies/identityVisualCopy'
import { entryMaxOutputCount } from '../visualCopies/maxOutputCount'

function track(id: string, fields: Partial<Track>): Track {
  return { id, name: id, type: 'base', instrumentId: '', color: '#fff', muted: false,
    solo: false, blocks: [], childIds: [], ...fields }
}

for (const [moverId, param] of [['symmetricMotion', 'distance'], ['symmetricRotation', 'fold']]) {
  test(`${moverId} automation forwards live GPU samples through an inert mover frame`, () => {
    for (const hasFrame of [false, true]) {
      const tracks = [
        track('p', { instrumentId: 'particle', childIds: ['m'] }),
        track('m', { type: 'mover', moverId, parentId: 'p', childIds: hasFrame ? ['lane', 'frame'] : ['lane'],
          inputValues: { motion: 1, fold: 45 },
          blocks: [{ id: 'motion', startBar: 0, durationBars: 4, loop: false,
            notes: [{ id: 'held', pitch: 60, startBeat: 0, durationBeats: 8, velocity: 100 }] }] }),
        track('lane', { type: 'automation', parentId: 'm', targetParam: param,
          blocks: [{ id: 'automation', startBar: 0, durationBars: 4, loop: false,
            notes: [{ id: 'low', pitch: 60, startBeat: 0, durationBeats: .5, velocity: 100 },
              { id: 'high', pitch: 84, startBeat: 4, durationBeats: .5, velocity: 100 }] }] }),
        ...(hasFrame ? [track('frame', { type: 'mover', moverId: 'mover', parentId: 'm',
          inputValues: { motion: 0, mode: 1, distanceX: 5 } })] : []),
      ]
      const graph = resolveProject({ tracks: Object.fromEntries(tracks.map(value => [value.id, value])),
        rootTrackIds: ['p'], beatsPerBar: 4, bpm: 120 })
      const entry = graph.objects[0].moverAndSplitterChain[0]
      assert.equal(entry.structuralVariants?.length, 2)
      assert.ok(entry.gpuOperationAtBeat)
      assert.equal(entryMaxOutputCount(entry), 1)
      const sampled = new Map<number, readonly number[]>()
      for (const beat of [0, 1, 3, 4, -1, 1]) {
        const placement = new Matrix4().makeTranslation(2, -3, 1)
        const operation = entry.gpuOperationAtBeat(beat, placement)
        if (sampled.has(beat)) assert.deepEqual(operation.parameters, sampled.get(beat))
        sampled.set(beat, [...operation.parameters])
        const copy = identityVisualCopy()
        copy.transform.makeRotationY(.7).setPosition(2, -1, .5)
        copy.opacity = .4; copy.colorShift.hue = .2
        const actual = entry.apply(copy, { beat, index: 0, count: 1, placementTransform: placement })[0]
        assert.deepEqual(applyGpuOperation(operation, copy.transform, new Matrix4()).elements, actual.transform.elements)
        assert.equal(actual.opacity, copy.opacity)
        assert.deepEqual(actual.colorShift, copy.colorShift)
      }
      assert.notDeepEqual(sampled.get(0), sampled.get(4), 'automation must update the shared operation')
    }
  })
}

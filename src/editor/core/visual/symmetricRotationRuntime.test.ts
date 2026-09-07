import assert from 'node:assert/strict'
import test from 'node:test'
import { Vector3 } from 'three'
import type { Track } from '../../types'
import { resolveProject } from './resolve'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'

function track(id: string, fields: Partial<Track>): Track {
  return { id, name: id, type: 'base', instrumentId: 'cube', color: '#fff', muted: false, solo: false, blocks: [], childIds: [], ...fields }
}

function copies(fold: number, falloff = 0) {
  const tracks = [
    track('cube', { childIds: ['grid', 'bow'] }),
    track('grid', { type: 'splitter', splitterId: 'grid', parentId: 'cube', inputValues: { columns: 3, rows: 3, depth: 1 } }),
    track('bow', { type: 'mover', moverId: 'symmetricRotation', parentId: 'cube', inputValues: { axis: 2, fold, falloff } }),
  ]
  const graph = resolveProject({ tracks: Object.fromEntries(tracks.map(t => [t.id, t])), rootTrackIds: ['cube'], beatsPerBar: 4, bpm: 120 })
  const object = graph.objects.find(o => o.trackId === 'cube')!
  return resolveVisualCopies(object.moverAndSplitterChain, 0)
}

test('real track resolution carries paused Fold changes through an XY grid while preserving copy centers', () => {
  const flat = copies(0)
  const bow = copies(45)
  const more = copies(60)
  assert.ok(flat.length > 1)
  let changed = 0
  flat.forEach((copy, i) => {
    const position = new Vector3().setFromMatrixPosition(copy.transform)
    assert.ok(position.distanceTo(new Vector3().setFromMatrixPosition(bow[i].transform)) < 1e-9)
    if (Math.hypot(position.x, position.y) > 1e-6) {
      changed++
      assert.notDeepEqual(bow[i].transform.elements, copy.transform.elements)
      assert.notDeepEqual(more[i].transform.elements, bow[i].transform.elements)
    }
  })
  assert.ok(changed > 0)
  assert.deepEqual(copies(60, 1).map(c => c.transform.elements), flat.map(c => c.transform.elements), 'Along Z reproduces the reported zero Fold')
})

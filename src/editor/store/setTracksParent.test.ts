import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate } from '../../persistence/serialize'
import type { Track } from '../types'
import { useProjectStore } from './ProjectStore'

const cube = (id: string): Track => ({ id, name: id, type: 'base', instrumentId: 'cube', color: '#fff', muted: false, solo: false, blocks: [], childIds: [] })

const st = () => useProjectStore.getState()

test('setTracksParent keeps group order when a member precedes the drop point', () => {
  hydrate(emptyDocument())
  for (const id of ['p', 'd', 'x', 'b']) st().addTrack(cube(id))
  st().setTrackParent('d', 'p')
  st().setTrackParent('x', 'p')
  st().setTrackParent('b', 'p')
  assert.deepEqual(st().tracks.p.childIds, ['d', 'x', 'b'])

  // Move {d, b} (visual order) to after x. Index counts the siblings that
  // remain once both are detached ([x]) - the drop-target convention. The
  // sequential-setTrackParent equivalent would misplace d here, because b
  // still sits in the list when d is spliced in.
  st().setTracksParent(['d', 'b'], 'p', 1)
  assert.deepEqual(st().tracks.p.childIds, ['x', 'd', 'b'])
})

test('setTracksParent lets descendants of a moved member ride along', () => {
  hydrate(emptyDocument())
  for (const id of ['p', 'a', 'b']) st().addTrack(cube(id))
  st().setTrackParent('b', 'a')

  // Selecting a parent and its child then group-moving must move the subtree
  // once, not re-parent the child out of it.
  st().setTracksParent(['a', 'b'], 'p', 0)
  assert.deepEqual(st().tracks.p.childIds, ['a'])
  assert.deepEqual(st().tracks.a.childIds, ['b'])
  assert.equal(st().tracks.b.parentId, 'a')
})

test('setTracksParent refuses a parent inside a moved subtree', () => {
  hydrate(emptyDocument())
  for (const id of ['a', 'b']) st().addTrack(cube(id))
  st().setTrackParent('b', 'a')
  const before = st().tracks.a.childIds
  st().setTracksParent(['a'], 'b', 0)
  assert.equal(st().tracks.a.parentId, undefined)
  assert.deepEqual(st().tracks.a.childIds, before)
})

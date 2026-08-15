import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate, serialize } from '../../persistence/serialize'
import type { Track } from '../types'
import { useProjectStore } from './ProjectStore'

const cube = (id: string): Track => ({
  id,
  name: 'Cube',
  type: 'base',
  instrumentId: 'cube',
  params: { size: 2.5, tfX: 3, tfSize: 1.4 },
  stringParams: { color: '#ff0000' },
  color: '#fff',
  muted: false,
  solo: false,
  blocks: [],
  childIds: [],
})

test('swapping away stashes the outgoing params and swapping back restores them', () => {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(cube('t'))

  useProjectStore.getState().setTrackInstrument('t', 'laserLine', 'Laser Line')
  let t = useProjectStore.getState().tracks.t
  assert.equal(t.instrumentId, 'laserLine')
  assert.equal(t.name, 'Laser Line')
  // First wear of laserLine starts at defaults - no cube keys leak across.
  assert.equal(t.params?.size, undefined)
  assert.equal(t.stringParams?.color, undefined)
  assert.deepEqual(t.paramsByInstrument?.cube, { params: { size: 2.5 }, stringParams: { color: '#ff0000' } })

  useProjectStore.getState().setTrackParam('t', 'width', 0.7)
  useProjectStore.getState().setTrackInstrument('t', 'cube', 'Cube')
  t = useProjectStore.getState().tracks.t
  // Round trip: cube comes back exactly as it was left.
  assert.equal(t.params?.size, 2.5)
  assert.equal(t.stringParams?.color, '#ff0000')
  // And laserLine's edit is stashed for its own return.
  assert.deepEqual(t.paramsByInstrument?.laserLine, { params: { width: 0.7 }, stringParams: {} })
})

test('tf* transform rides the live params through swaps, never the stash', () => {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(cube('t'))

  useProjectStore.getState().setTrackInstrument('t', 'laserLine')
  let t = useProjectStore.getState().tracks.t
  assert.equal(t.params?.tfX, 3)
  assert.equal(t.params?.tfSize, 1.4)
  assert.equal(t.paramsByInstrument?.cube?.params?.tfX, undefined)

  // Move the object while wearing laserLine; the move survives swapping back.
  useProjectStore.getState().setTrackParam('t', 'tfX', -5)
  useProjectStore.getState().setTrackInstrument('t', 'cube')
  t = useProjectStore.getState().tracks.t
  assert.equal(t.params?.tfX, -5)
  assert.equal(t.params?.size, 2.5)
})

test('the wardrobe stash persists through serialize/hydrate', () => {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(cube('t'))
  useProjectStore.getState().setTrackInstrument('t', 'laserLine')

  hydrate(serialize())
  const t = useProjectStore.getState().tracks.t
  assert.equal(t.instrumentId, 'laserLine')
  assert.deepEqual(t.paramsByInstrument?.cube, { params: { size: 2.5 }, stringParams: { color: '#ff0000' } })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from '../../persistence/types'
import { hydrate, serialize } from '../../persistence/serialize'
import type { Track } from '../types'
import { useProjectStore } from './ProjectStore'

const cube = (id: string): Track => ({ id, name: id, type: 'base', instrumentId: 'cube', color: '#fff', muted: false, solo: false, blocks: [], childIds: [] })

test('track edits are written only into the selected scene ownership map', () => {
  hydrate(emptyDocument())
  const firstId = useProjectStore.getState().activeSceneId
  useProjectStore.getState().addTrack(cube('one'))
  const secondId = useProjectStore.getState().addScene()
  useProjectStore.getState().setActiveScene(secondId)
  useProjectStore.getState().addTrack(cube('two'))
  const state = useProjectStore.getState()
  assert.ok(state.scenes[firstId].tracks.one)
  assert.equal(state.scenes[firstId].tracks.two, undefined)
  assert.ok(state.scenes[secondId].tracks.two)
  assert.equal(state.scenes[secondId].tracks.one, undefined)
})

test('active compatibility fields are not serialized as a second ownership source', () => {
  const doc = serialize() as unknown as Record<string, unknown>
  assert.equal('tracks' in doc, false)
  assert.equal('rootTrackIds' in doc, false)
  assert.ok(doc.scenes)
})

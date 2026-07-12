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

test('selected scene is persisted and restored without duplicating its tracks', () => {
  hydrate(emptyDocument())
  const secondId = useProjectStore.getState().addScene()
  useProjectStore.getState().setActiveScene(secondId)
  useProjectStore.getState().addTrack(cube('selected'))

  const doc = serialize()
  assert.equal(doc.activeSceneId, secondId)
  hydrate(doc)

  const state = useProjectStore.getState()
  assert.equal(state.activeSceneId, secondId)
  assert.ok(state.tracks.selected)
  assert.equal(state.scenes[secondId].tracks.selected, state.tracks.selected)
})

test('older v5 documents without a selected scene fall back to the first visual scene', () => {
  const doc = emptyDocument()
  const firstVisualId = doc.sceneOrder.find((id) => !doc.scenes[id].isMain)!
  delete doc.activeSceneId

  hydrate(doc)

  assert.equal(useProjectStore.getState().activeSceneId, firstVisualId)
})

test('scene background color defaults, edits, duplicates, and persists with the scene', () => {
  hydrate(emptyDocument())
  const sceneId = useProjectStore.getState().activeSceneId
  assert.equal(useProjectStore.getState().scenes[sceneId].backgroundColor, '#000000')

  useProjectStore.getState().setSceneBackgroundColor(sceneId, '#123456')
  const copyId = useProjectStore.getState().duplicateScene(sceneId)!
  assert.equal(useProjectStore.getState().scenes[copyId].backgroundColor, '#123456')

  const document = serialize()
  hydrate(document)
  assert.equal(useProjectStore.getState().scenes[sceneId].backgroundColor, '#123456')
})

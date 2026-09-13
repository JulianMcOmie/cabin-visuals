import assert from 'node:assert/strict'
import test from 'node:test'
import { useProjectStore } from './ProjectStore'

test('initial and newly added scenes contain no default lighting', () => {
  const initial = useProjectStore.getState()
  for (const scene of Object.values(initial.scenes)) {
    assert.deepEqual(scene.tracks, {})
    assert.deepEqual(scene.rootTrackIds, [])
  }
  const sceneId = initial.addScene()
  initial.setActiveScene(sceneId)
  const state = useProjectStore.getState()
  assert.deepEqual(state.scenes[sceneId].tracks, {})
  assert.deepEqual(state.scenes[sceneId].rootTrackIds, [])
  assert.ok(!Object.values(state.tracks).some((track) => track.instrumentId === 'light'))
})

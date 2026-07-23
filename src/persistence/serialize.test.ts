import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useTimeStore } from '../editor/store/TimeStore'
import { emptyDocument } from './types'
import { hydrate, serialize } from './serialize'

test('transport loop region survives serialize and hydrate', () => {
  const loopRegion = { startBeat: 4, endBeat: 12, enabled: false }
  useTimeStore.getState().setLoopRegion(loopRegion)

  const document = serialize()
  assert.deepEqual(document.loopRegion, loopRegion)

  useTimeStore.getState().setLoopRegion(null)
  hydrate(document)
  assert.deepEqual(useTimeStore.getState().loopRegion, loopRegion)
})

test('documents without a loop region clear the previous project loop', () => {
  useTimeStore.getState().setLoopRegion({ startBeat: 8, endBeat: 16, enabled: true })
  const document = emptyDocument()
  delete document.loopRegion

  hydrate(document)
  assert.equal(useTimeStore.getState().loopRegion, null)
})

test('hydrating a project resets the playhead to the start', () => {
  // currentBeat is session-scoped module state: without the reset, a newly
  // created project opened mid-timeline wherever the previous project's
  // playhead sat.
  useTimeStore.setState({ currentBeat: 42 })

  hydrate(emptyDocument())
  assert.equal(useTimeStore.getState().currentBeat, 0)
})

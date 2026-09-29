import { test } from 'node:test'
import assert from 'node:assert/strict'
import { thumbnailBeat } from './thumbnailBeat'
import { emptyDocument } from './types'
import type { Track } from '../editor/types'

test('samples inside the first audible visual note in the selected scene', () => {
  const doc = emptyDocument(), scene = doc.scenes[doc.activeSceneId!]
  scene.tracks.visual = { type: 'base', blocks: [{ startBar: 2, durationBars: 4, notes: [
    { startBeat: 0, durationBeats: 1, velocity: 0 },
    { startBeat: 3, durationBeats: 0.2, velocity: 1 },
  ] }] } as Track
  assert.equal(thumbnailBeat(doc, scene.id), 11.1)
  assert.equal(thumbnailBeat(doc, doc.sceneOrder[0]), 0)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { bestHit, layersUnderPoint } from './hoverPickCore'

test('layersUnderPoint remaps the pointer into a viewport layer, topmost first', () => {
  const layers = [
    { sceneId: 'under', viewport: { x: 0, y: 0, width: 1, height: 1 } },
    { sceneId: 'left', viewport: { x: 0, y: 0, width: 0.5, height: 1 } },
    { sceneId: 'right', viewport: { x: 0.5, y: 0, width: 0.5, height: 1 } },
  ]
  const hits = layersUnderPoint(layers, 0.75, 0.25)
  assert.deepEqual(hits.map((h) => h.sceneId), ['right', 'under'])
  // The right half's centre-line is that layer's NDC x = 0; a quarter up the
  // frame is y = -0.5 in every layer that spans the full height.
  assert.equal(Math.abs(hits[0].ndcX) < 1e-9, true)
  assert.equal(hits[0].ndcY, -0.5)
  assert.equal(hits[1].ndcX, 0.5)
})

test('layersUnderPoint skips layers the point is outside of', () => {
  const layers = [{ sceneId: 'a', viewport: { x: 0.6, y: 0.6, width: 0.4, height: 0.4 } }]
  assert.deepEqual(layersUnderPoint(layers, 0.2, 0.2), [])
})

test('bestHit prefers real objects, then over-drawn passes, then distance', () => {
  const base = (trackId: string, distance: number, fullFrame = false) =>
    ({ trackId, distance, pass: 'base' as const, fullFrame })
  assert.equal(bestHit([])?.trackId, undefined)
  assert.equal(bestHit([base('far', 9), base('near', 2)])?.trackId, 'near')
  // A full-frame plane in front of everything still loses to the cube behind it.
  assert.equal(bestHit([base('video', 0.1, true), base('cube', 5)])?.trackId, 'cube')
  // ...but wins when it is the only thing under the pointer.
  assert.equal(bestHit([base('video', 0.1, true)])?.trackId, 'video')
  // Front pass is drawn over base, so a farther front hit beats a nearer base hit.
  assert.equal(bestHit([base('cube', 1), { trackId: 'overlay', distance: 8, pass: 'front', fullFrame: false }])?.trackId, 'overlay')
})

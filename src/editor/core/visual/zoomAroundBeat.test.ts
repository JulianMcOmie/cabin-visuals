import assert from 'node:assert/strict'
import test from 'node:test'
import { scrollLeftAroundBeat } from '../../utils/zoomAroundBeat'

test('horizontal zoom keeps the anchor beat at the same viewport position', () => {
  const beat = 24
  const previousPixelsPerBeat = 16
  const nextPixelsPerBeat = 40
  const previousScrollLeft = 210
  const previousViewportX = beat * previousPixelsPerBeat - previousScrollLeft

  const nextScrollLeft = scrollLeftAroundBeat(
    previousScrollLeft,
    beat,
    previousPixelsPerBeat,
    nextPixelsPerBeat,
  )

  assert.equal(beat * nextPixelsPerBeat - nextScrollLeft, previousViewportX)
})

test('horizontal zoom never requests negative scroll', () => {
  assert.equal(scrollLeftAroundBeat(10, 2, 100, 5), 0)
})

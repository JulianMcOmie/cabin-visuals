import test from 'node:test'
import assert from 'node:assert/strict'
import { beginFrameLooks, DEFAULT_LOOK, resolveLook, setCompositionLook, setTrackLook } from './look'

test('looks: defaults untouched, on-screen tracks merge, the composition wins, off-screen tracks ignored', () => {
  assert.equal(resolveLook(() => true), DEFAULT_LOOK)
  setTrackLook('a', { bloom: 2, aberration: 3 })
  setTrackLook('b', { bloom: 5 })
  const on = (id: string) => id === 'a'
  assert.equal(resolveLook(on).bloom, 2)
  assert.equal(resolveLook(on).aberration, 3)
  assert.equal(resolveLook(on).saturation, DEFAULT_LOOK.saturation)
  setCompositionLook({ bloom: 0.1, aberration: undefined })
  assert.equal(resolveLook(on).bloom, 0.1)
  assert.equal(resolveLook(on).aberration, 3)
  beginFrameLooks()
  assert.equal(resolveLook(on).bloom, 2)
  setTrackLook('a', null)
  setTrackLook('b', null)
  assert.equal(resolveLook(() => true), DEFAULT_LOOK)
})

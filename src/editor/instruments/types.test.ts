import assert from 'node:assert/strict'
import test from 'node:test'
import { isFullFrameTrack, isOnTopTrack, type ObjectInstrumentDef } from './types'

// A def is only ever read for its flags and param schema here, so these stand in
// for real instruments without dragging the R3F components (and the registry
// import cycle they sit in) into a node test.
const def = (extra: Partial<ObjectInstrumentDef>): ObjectInstrumentDef => ({
  id: 'stub',
  name: 'Stub',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: [],
  component: (() => null) as unknown as ObjectInstrumentDef['component'],
  ...extra,
})

const plain = def({})
const alwaysFull = def({ fullFrame: true, defaultOnTop: true })
// The Oscilloscope's shape: full-frame is a mode, defaulting to OFF.
const switchable = def({
  fullFrameParam: 'fitToScreen',
  params: [{ key: 'fitToScreen', label: 'Placement', type: 'select', default: 0, options: [] }],
})

test('a plain instrument is never full-frame', () => {
  assert.equal(isFullFrameTrack(plain, undefined), false)
  assert.equal(isFullFrameTrack(plain, { fitToScreen: 1 }), false)
  assert.equal(isFullFrameTrack(undefined, undefined), false)
})

test('a fixed fullFrame def ignores params', () => {
  assert.equal(isFullFrameTrack(alwaysFull, undefined), true)
  assert.equal(isFullFrameTrack(alwaysFull, { fitToScreen: 0 }), true)
})

test('fullFrameParam makes full-frame a per-track mode, off by schema default', () => {
  // A track that predates the param stores nothing: it falls back to the schema.
  assert.equal(isFullFrameTrack(switchable, undefined), false)
  assert.equal(isFullFrameTrack(switchable, {}), false)
  assert.equal(isFullFrameTrack(switchable, { fitToScreen: 0 }), false)
  assert.equal(isFullFrameTrack(switchable, { fitToScreen: 1 }), true)
})

test('the on-top pass follows the full-frame mode', () => {
  // Pinned to the frame = drawn over everything, exactly like the old fixed
  // fullFrame + defaultOnTop pairing.
  assert.equal(isOnTopTrack(switchable, { fitToScreen: 1 }, undefined), true)
  // In scene = depth-sorted, so the scope can sit BEHIND other objects.
  assert.equal(isOnTopTrack(switchable, { fitToScreen: 0 }, undefined), false)
  assert.equal(isOnTopTrack(switchable, undefined, undefined), false)
})

test('a stored per-track onTop override still wins over the mode', () => {
  assert.equal(isOnTopTrack(switchable, { fitToScreen: 1 }, false), false)
  assert.equal(isOnTopTrack(switchable, { fitToScreen: 0 }, true), true)
  assert.equal(isOnTopTrack(alwaysFull, undefined, false), false)
})

test('instruments without the mode fall back to defaultOnTop', () => {
  assert.equal(isOnTopTrack(alwaysFull, undefined, undefined), true)
  assert.equal(isOnTopTrack(plain, undefined, undefined), false)
  assert.equal(isOnTopTrack(undefined, undefined, undefined), false)
})

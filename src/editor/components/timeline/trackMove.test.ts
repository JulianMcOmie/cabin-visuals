import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, type PointerEvent as ReactPointerEvent } from 'react'
import { renderToString } from 'react-dom/server'
import { useProjectStore, MAX_TOTAL_BARS } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import { useTrackGestures } from './useTrackGestures'
import type { Block } from '../../types'

test('moving looped clips grows the project on each frame and preserves mixed selections', () => {
  const globals = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'] as const
  const previousGlobals = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  const previousProject = useProjectStore.getState()
  const previousUI = useUIStore.getState()
  const events = new EventTarget()
  let frame: FrameRequestCallback | undefined
  const replacements = [events, {
    body: { style: { setProperty() {}, removeProperty() {}, userSelect: '' }, classList: { add() {}, remove() {} } },
  }, (callback: FrameRequestCallback) => { frame = callback; return 1 }, () => { frame = undefined }]
  globals.forEach((key, i) => Object.defineProperty(globalThis, key, { configurable: true, value: replacements[i] }))

  let gestures!: ReturnType<typeof useTrackGestures>
  function Harness() {
    gestures = useTrackGestures({ laneRef: { current: null }, dragGuideRef: { current: null }, moveSnapBeats: 1 })
    return null
  }
  const emit = (type: string, x: number) => {
    const event = new Event(type)
    Object.assign(event, { clientX: x, clientY: 20 })
    events.dispatchEvent(event)
  }
  const move = (deltaBars: number) => {
    emit('pointermove', 100 + deltaBars * 40)
    const callback = frame
    frame = undefined
    callback?.(0)
  }
  const loop: Block = {
    id: 'loop', startBar: 4, durationBars: 4, loop: true, loopLengthBars: 1, notes: [],
  }
  const plain: Block = { id: 'plain', startBar: 1, durationBars: 1, loop: false, notes: [] }
  try {
    useProjectStore.getState().addTrack({
      id: 'drag-test', name: 'Drag test', type: 'base', instrumentId: 'cube', color: '#fff',
      muted: false, solo: false, childIds: [], blocks: [loop, plain],
    })
    useProjectStore.getState().setTotalBars(8)
    useUIStore.setState({ tracksPixelsPerBeat: 10, selectedBlockIds: new Set(['loop', 'plain']) })
    renderToString(createElement(Harness))
    gestures.handleBlockPointerDown({
      button: 0, clientX: 100, clientY: 20, stopPropagation() {},
      currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 40 }) },
    } as unknown as ReactPointerEvent, 'drag-test', 'loop')

    const blocks = () => useProjectStore.getState().tracks['drag-test'].blocks
    move(3.25)
    assert.deepEqual(blocks(), [{ ...loop, startBar: 7.25 }, { ...plain, startBar: 4.25 }])
    assert.equal(useProjectStore.getState().totalBars, 12, 'grows before pointerup to include all repeats')
    move(10)
    assert.equal(blocks()[0].startBar, 14, 'keeps following the pointer beyond the original boundary')
    assert.equal(useProjectStore.getState().totalBars, 18)
    move(0)
    assert.deepEqual(blocks(), [loop, plain])
    assert.equal(useProjectStore.getState().totalBars, 18, 'moving back does not shrink the project')
    move(-10)
    assert.equal(blocks()[0].startBar, 0, 'still respects the timeline start')
    move(MAX_TOTAL_BARS)
    assert.equal(blocks()[0].startBar, MAX_TOTAL_BARS - loop.durationBars)
    assert.equal(useProjectStore.getState().totalBars, MAX_TOTAL_BARS)
    assert.equal(blocks()[0].loopLengthBars, 1)
    emit('pointerup', 100)
  } finally {
    emit('pointerup', 100)
    useProjectStore.setState(previousProject)
    useUIStore.setState(previousUI)
    globals.forEach((key, i) => {
      const descriptor = previousGlobals[i]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
})

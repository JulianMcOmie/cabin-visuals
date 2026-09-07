import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, type PointerEvent as ReactPointerEvent } from 'react'
import { renderToString } from 'react-dom/server'
import { useLoopDrag } from '../hooks/useLoopDrag'
import { useTimeStore } from '../store/TimeStore'

test('disabled-loop drags replace the range and clicks reactivate it', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousRegion = useTimeStore.getState().loopRegion
  const events = new EventTarget()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: events })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    body: { style: { setProperty() {}, removeProperty() {}, userSelect: '' }, classList: { add() {}, remove() {} } },
  } })
  let gestures!: ReturnType<typeof useLoopDrag>
  function Harness() {
    gestures = useLoopDrag({ computeBeat: (x) => x, maxBeat: 100 })
    return null
  }
  const pointer = (x: number) => ({ clientX: x, stopPropagation() {} }) as ReactPointerEvent
  const emit = (type: string, x: number) => {
    const event = new Event(type)
    Object.assign(event, { clientX: x, clientY: 0 })
    events.dispatchEvent(event)
  }
  try {
    renderToString(createElement(Harness))
    const starts = [
      gestures.startLoopDrag,
      gestures.startLoopMove,
      (e: ReactPointerEvent) => gestures.startLoopResize(e, 'start'),
      (e: ReactPointerEvent) => gestures.startLoopResize(e, 'end'),
    ]
    for (const start of starts) {
      useTimeStore.getState().setLoopRegion({ startBeat: 16, endBeat: 32, enabled: false })
      start(pointer(24))
      emit('pointermove', 40)
      emit('pointerup', 40)
      assert.deepEqual(useTimeStore.getState().loopRegion, { startBeat: 24, endBeat: 40, enabled: true })

      useTimeStore.getState().setLoopRegion({ startBeat: 16, endBeat: 32, enabled: false })
      start(pointer(24))
      emit('pointerup', 24)
      assert.deepEqual(useTimeStore.getState().loopRegion, { startBeat: 16, endBeat: 32, enabled: true })
    }
  } finally {
    useTimeStore.getState().setLoopRegion(previousRegion)
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

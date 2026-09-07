import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement, type PointerEvent as ReactPointerEvent } from 'react'
import { renderToString } from 'react-dom/server'
import { computeRulerGrid } from '../rulerGrid'
import { useTrackGestures } from './useTrackGestures'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import type { Track } from '../../types'

test('timeline MIDI pointer drags follow visible ticks across zoom and meter', () => {
  const globals = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'] as const
  const descriptors = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  const previousProject = useProjectStore.getState()
  const previousUI = useUIStore.getState()
  const events = new EventTarget()
  const replacements = [events, {
    body: { style: { setProperty() {}, removeProperty() {}, userSelect: '' }, classList: { add() {}, remove() {} } },
  }, () => 1, () => {}]
  globals.forEach((key, i) => Object.defineProperty(globalThis, key, { configurable: true, value: replacements[i] }))
  const emit = (type: string, x: number) => {
    const event = new Event(type)
    Object.assign(event, { clientX: x, clientY: 30 })
    events.dispatchEvent(event)
  }
  try {
    for (const beatsPerBar of [3, 4, 7]) {
      for (const zoom of [2, 8, 16, 23.99, 24, 47.99, 48, 96]) {
        for (const mode of ['move', 'duplicate', 'resize'] as const) {
          const track: Track = {
            id: 'snap-track', name: 'Snap', type: 'base', instrumentId: 'cube',
            color: '#fff', muted: false, solo: false, childIds: [],
            blocks: [{ id: 'snap-block', startBar: 0, durationBars: 4, loop: false, notes: [] }],
          }
          useProjectStore.setState({ beatsPerBar, totalBars: 32, tracks: { [track.id]: track }, rootTrackIds: [track.id] })
          useUIStore.setState({ tracksPixelsPerBeat: zoom, selectedBlockIds: new Set(), collapsedTrackIds: new Set() })
          const grid = computeRulerGrid(zoom, beatsPerBar, 32)
          let gestures!: ReturnType<typeof useTrackGestures>
          function Harness() {
            gestures = useTrackGestures({ laneRef: { current: null }, dragGuideRef: { current: null }, moveSnapBeats: grid.smallestBeats })
            return null
          }
          renderToString(createElement(Harness))
          const x = mode === 'resize' ? 199 : 100
          gestures.handleBlockPointerDown({
            button: 0, clientX: x, clientY: 30, altKey: mode === 'duplicate', stopPropagation() {},
            currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 40 }) },
          } as unknown as ReactPointerEvent, track.id, 'snap-block')
          const deltaBeats = grid.smallestBeats * 0.75
          emit('pointermove', x + deltaBeats * zoom)
          emit('pointerup', x + deltaBeats * zoom)
          const blocks = useProjectStore.getState().tracks[track.id].blocks
          const moved = blocks[mode === 'duplicate' ? 1 : 0]
          if (mode === 'resize') {
            // High zoom still uses whole-beat resizing, despite finer move ticks.
            if (zoom >= 48) assert.equal(moved.durationBars, 4)
            assert.equal(moved.startBar, 0)
          } else {
            assert.ok(Math.abs(moved.startBar * beatsPerBar - grid.smallestBeats) < 1e-9,
              `${mode}: ${zoom}px/beat, ${beatsPerBar} beats/bar`)
            assert.equal(moved.durationBars, 4)
            if (mode === 'duplicate') assert.equal(blocks[0].startBar, 0)
          }
        }
      }
    }
  } finally {
    useProjectStore.setState(previousProject)
    useUIStore.setState(previousUI)
    globals.forEach((key, i) => {
      const descriptor = descriptors[i]
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    })
  }
})

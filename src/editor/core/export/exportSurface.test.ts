import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RootState } from '@react-three/fiber'
import { pinExportSurface } from './exportSurface'

function renderer() {
  const canvas = Object.assign(new EventTarget(), { width: 1600, height: 1200, style: { width: '800px', height: '600px' } })
  let lost = false
  const context = { drawingBufferWidth: 1600, drawingBufferHeight: 1200, isContextLost: () => lost }
  const state = {
    size: { width: 800, height: 600, top: 5, left: 10 },
    viewport: { dpr: 2 }, frameloop: 'demand',
    gl: { domElement: canvas, getContext: () => context },
    set: (patch: object) => { Object.assign(state, patch) },
    setSize: (width: number, height: number, top = 0, left = 0) => {
      state.size = { width, height, top, left }; resize()
    },
    setDpr: (dpr: number | [number, number]) => {
      state.viewport.dpr = typeof dpr === 'number' ? dpr : dpr[1]; resize()
    },
    setFrameloop: (value = 'always') => { state.frameloop = value },
  }
  function resize() {
    canvas.width = context.drawingBufferWidth = state.size.width * state.viewport.dpr
    canvas.height = context.drawingBufferHeight = state.size.height * state.viewport.dpr
    canvas.style.width = `${state.size.width}px`
    canvas.style.height = `${state.size.height}px`
  }
  return { state, canvas, context, get: () => state as unknown as RootState, lose: (value: boolean) => { lost = value } }
}

test('layout, display DPR, and loop requests cannot alter pinned rendering; latest requests restore', async () => {
  const r = renderer(), originalSize = r.state.setSize
  const pin = pinExportSurface(r.get, 1920, 1080)
  // These arrive between frames while asynchronous media/encoder work yields.
  await Promise.resolve()
  r.state.setSize(450, 700, 30, 40)
  r.state.setDpr([1, 2])
  r.state.setFrameloop('always')
  r.state.setSize(900, 500, 50, 60)
  pin.assertValid()
  assert.equal(r.canvas.width, 1920)
  assert.equal(r.canvas.height, 1080)
  assert.equal(r.state.viewport.dpr, 1)
  assert.equal(r.state.frameloop, 'never')
  pin.release()
  assert.deepEqual(r.state.size, { width: 900, height: 500, top: 50, left: 60 })
  assert.equal(r.canvas.width, 1800)
  assert.equal(r.canvas.height, 1000)
  assert.equal(r.state.frameloop, 'always')
  assert.equal(r.state.setSize, originalSize)
  pin.release()
  assert.throws(pin.assertValid, /released/)
  // Normal preview resizes resume after completion/cancel/error.
  r.state.setSize(600, 400)
  assert.equal(r.canvas.width, 1200)
})

test('a pin with no intervening layout restores the original viewport and offsets', () => {
  const r = renderer()
  const pin = pinExportSurface(r.get, 1080, 1920)
  pin.assertValid()
  pin.release()
  assert.deepEqual(r.state.size, { width: 800, height: 600, top: 5, left: 10 })
  assert.equal(r.state.viewport.dpr, 2)
  assert.equal(r.state.frameloop, 'demand')
})

test('bypassed setters and undersized GPU buffers fail instead of encoding distorted frames', () => {
  for (const corrupt of [
    (r: ReturnType<typeof renderer>) => { r.canvas.width = 640 },
    (r: ReturnType<typeof renderer>) => { r.context.drawingBufferHeight = 256 },
    (r: ReturnType<typeof renderer>) => { r.state.size.width = 500 },
    (r: ReturnType<typeof renderer>) => { r.state.viewport.dpr = 2 },
  ]) {
    const r = renderer(), pin = pinExportSurface(r.get, 1920, 1080)
    corrupt(r)
    assert.throws(pin.assertValid, /Export stopped/)
    pin.release()
  }
})

test('context loss fails even if the browser restores it before the next frame', () => {
  const r = renderer(), pin = pinExportSurface(r.get, 1920, 1080)
  r.lose(true)
  assert.throws(pin.assertValid, /graphics context was lost/)
  r.canvas.dispatchEvent(new Event('webglcontextlost'))
  r.lose(false)
  assert.throws(pin.assertValid, /graphics context was lost/)
  pin.release()
  const retry = pinExportSurface(r.get, 1920, 1080)
  retry.assertValid()
  retry.release()
})

test('failed pin rolls back size, DPR, loop and intercepted setters', () => {
  const r = renderer(), originalSize = r.state.setSize
  r.lose(true)
  assert.throws(() => pinExportSurface(r.get, 1920, 1080), /graphics context was lost/)
  assert.equal(r.state.setSize, originalSize)
  assert.equal(r.canvas.width, 1600)
  assert.equal(r.state.viewport.dpr, 2)
  assert.equal(r.state.frameloop, 'demand')
})

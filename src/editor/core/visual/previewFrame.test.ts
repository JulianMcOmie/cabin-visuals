import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { createVisualEngine } from './VisualEngine'
import type { Track } from '../../types'

const cube: Track = { id: 'cube', name: 'cube', instrumentId: 'cube', type: 'base', color: '#fff', muted: false, solo: false, childIds: [], params: { tfX: 3 }, blocks: [{ id: 'block', startBar: 0, durationBars: 4, loop: true, loopLengthBars: 1, notes: [{ id: 'note', pitch: 60, velocity: 100, startBeat: 0, durationBeats: 1 }] }] }
const project = (track = cube) => ({ tracks: { cube: track }, rootTrackIds: ['cube'], beatsPerBar: 4, bpm: 120, totalBars: 4 })

test('structured-cloned preview frames equal deterministic evaluation across seeks', () => {
  const worker = createVisualEngine(), renderer = createVisualEngine()
  worker.setProject(project())
  let publications = 0
  renderer.subscribeObjects(() => publications++)
  for (const beat of [0, 0.5, 5, 12, 0]) {
    worker.computeAtBeat(beat)
    renderer.applyFrame(structuredClone(worker.captureFrame()), publications > 0)
    assert.deepEqual(renderer.getObjectState('cube'), worker.getObjectState('cube'))
    assert.deepEqual(renderer.getVisualCopies('cube'), worker.getVisualCopies('cube'))
    assert.deepEqual(renderer.getCompositionLayers(), worker.getCompositionLayers())
    assert.ok(renderer.getObjectState('cube')!.world instanceof Matrix4)
    assert.ok(renderer.getVisualCopy('cube', 0)!.transform instanceof Matrix4)
  }
  assert.equal(publications, 1, 'frames do not reconcile the object tree')
})

test('unchanged document retains static input identity; note edits and deletion arrive', () => {
  const worker = createVisualEngine(), renderer = createVisualEngine()
  worker.setProject(project()); worker.computeAtBeat(0)
  renderer.applyFrame(structuredClone(worker.captureFrame()))
  const notes = renderer.getObjectState('cube')!.notes
  worker.computeAtBeat(2); renderer.applyFrame(structuredClone(worker.captureFrame()), true)
  assert.equal(renderer.getObjectState('cube')!.notes, notes)
  worker.setProject(project({ ...cube, blocks: [] })); worker.computeAtBeat(0)
  renderer.applyFrame(structuredClone(worker.captureFrame()))
  assert.deepEqual(renderer.getObjectState('cube')!.notes, [])
  worker.setProject({ ...project(), tracks: {}, rootTrackIds: [] }); worker.computeAtBeat(0)
  renderer.applyFrame(structuredClone(worker.captureFrame()))
  assert.equal(renderer.getObjectState('cube'), undefined)
  assert.equal(renderer.getVisualCopyCount('cube'), 0)
  assert.deepEqual(renderer.getObjectList(), [])
})

test('export reclaims the engine after asynchronous preview without changing its math', () => {
  const worker = createVisualEngine(), renderer = createVisualEngine(), reference = createVisualEngine()
  worker.setProject(project()); worker.computeAtBeat(8)
  renderer.applyFrame(structuredClone(worker.captureFrame()))
  const edited = project({ ...cube, params: { tfX: 7 } })
  renderer.setProject(edited); reference.setProject(edited)
  for (const beat of [0, 1 / 30, 2 / 30, 4]) {
    renderer.computeAtBeat(beat); reference.computeAtBeat(beat)
    assert.deepEqual(renderer.getObjectState('cube'), reference.getObjectState('cube'))
  }
})


test('worker capability gate supports media/raster and fails closed for unknown instruments', async () => {
  const { canRenderInWorker } = await import('./previewProtocol')
  const supported = ['cube', 'video', 'photo', 'textDisplay', 'emojiDisplay', 'filmCard', 'midiRoll', 'kaleidoSolid', 'photoSlot', 'oscilloscope']
  for (const instrumentId of [...supported, 'futureInstrument']) {
    const document = { ...project(), scenes: { scene: { tracks: { cube: { ...cube, instrumentId } } } } }
    assert.equal(canRenderInWorker(document as unknown as Parameters<typeof canRenderInWorker>[0]), supported.includes(instrumentId), instrumentId)
  }
})


test('every current registry instrument has an explicitly audited worker path', async () => {
  const { INSTRUMENTS } = await import('../../instruments')
  const { canRenderInWorker } = await import('./previewProtocol')
  for (const instrumentId of Object.keys(INSTRUMENTS)) {
    const document = { ...project(), scenes: { scene: { tracks: { cube: { ...cube, instrumentId } } } } }
    assert.ok(canRenderInWorker(document as unknown as Parameters<typeof canRenderInWorker>[0]), instrumentId)
  }
})

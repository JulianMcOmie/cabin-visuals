import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { applyObjectTransition } from './objectTransition'
import { createVisualEngine } from './VisualEngine'
import { PreviewFrameEncoder, PreviewFrameDecoder } from './previewFrameCodec'
import type { Track, Scene } from '../../types'

const motion = { scale: 2, x: 1, y: -2, rotation: Math.PI / 2 }
test('object motion changes the basis around its own origin and preserves affine shear', () => {
  const world = new Matrix4().set(1, .3, 0, 7, 0, 1, 0, 4, 0, 0, 1, 2, 0, 0, 0, 1)
  applyObjectTransition(world, motion)
  assert.deepEqual(world.elements.slice(12, 15), [8, 2, 2])
  assert.ok(Math.abs(world.elements[0]) < 1e-9)
  assert.ok(Math.abs(world.elements[1] - 2) < 1e-9)
  assert.ok(Math.abs(world.elements[4] + 2) < 1e-9)
  assert.ok(Math.abs(world.elements[5] - .6) < 1e-9)
})

const object = (id: string, extra: Partial<Track> = {}): Track => ({ id, name: id, type: 'base', instrumentId: 'cube', muted: false, solo: false, color: '#fff', childIds: [], blocks: [], ...extra })
const room = (id: string): Scene => {
  const parent = object(id + '-parent', { childIds: [id + '-child'], params: { tfX: 3, tfY: 1 } })
  const child = object(id + '-child', { parentId: parent.id, params: { tfX: 2 } })
  const light = object(id + '-light', { instrumentId: 'light', params: { tfX: -3 } })
  return { id, name: id, isMain: false, backgroundColor: '#345678', backgroundTransparent: false,
    tracks: { [parent.id]: parent, [child.id]: child, [light.id]: light }, rootTrackIds: [parent.id, light.id] }
}
function project(transition: number) {
  const a = room('a'), b = room('b')
  const switcher = object('switcher', { instrumentId: 'sceneSwitcher', params: { switchMode: 1, transition, transitionBeats: 2, motionChannel: 4 },
    sceneBindings: [{ pitch: 60, sceneId: 'a' }, { pitch: 61, sceneId: 'b' }],
    blocks: [{ id: 'block', startBar: 0, durationBars: 4, loop: false, notes: [
      { id: 'a', startBeat: 0, durationBeats: 4, pitch: 60, velocity: 100 },
      { id: 'b', startBeat: 4, durationBeats: 12, pitch: 61, velocity: 100 },
    ] }] })
  const main: Scene = { ...room('main'), isMain: true, tracks: { switcher }, rootTrackIds: ['switcher'] }
  return { scenes: { main, a, b }, sceneOrder: ['main', 'a', 'b'], activeSceneId: 'main', tracks: main.tracks, rootTrackIds: main.rootTrackIds, beatsPerBar: 4, totalBars: 4, bpm: 120 }
}

test('nested objects move exactly once while backdrops and lights stay unchanged, including seeks and repeated frames', () => {
  const moving = createVisualEngine(), original = createVisualEngine()
  moving.setProject(project(2)); original.setProject(project(0))
  for (const beat of [4, 3.9, 4.1, 5, 6, 6, 0, 4, 4]) {
    moving.computeAtBeat(beat); original.computeAtBeat(beat)
    const layer = moving.getCompositionLayers()[0]
    for (const suffix of ['parent', 'child', 'light']) {
      const id = layer.sceneId + '-' + suffix
      const expected = original.getObjectState(id)!.world.clone()
      if (layer.objectMotion && suffix !== 'light') applyObjectTransition(expected, layer.objectMotion)
      assert.deepEqual(moving.getObjectState(id)!.world.elements, expected.elements, `${id} at ${beat}`)
    }
    assert.deepEqual(moving.getSceneBackdrop(layer.sceneId), original.getSceneBackdrop(layer.sceneId))
  }
})

test('worker packets and export recomputation retain object motion and its final pose', () => {
  const worker = createVisualEngine(), renderer = createVisualEngine(), direct = createVisualEngine()
  const document = project(2)
  worker.setProject(document); direct.setProject(document)
  const encoder = new PreviewFrameEncoder(), decoder = new PreviewFrameDecoder()
  let id = 0
  for (const beat of [3.9, 4, 4.1, 5, 6, 3.9]) {
    worker.computeAtBeat(beat); direct.computeAtBeat(beat)
    const packet = encoder.encode(worker.captureFrame(), ++id, 1, id > 1 ? id - 1 : undefined)
    const frame = decoder.decode(structuredClone(packet))
    assert.ok(frame)
    renderer.applyFrame(frame)
    const sceneId = worker.getCompositionLayers()[0].sceneId
    assert.deepEqual(renderer.getObjectState(sceneId + '-parent')!.world, direct.getObjectState(sceneId + '-parent')!.world)
    assert.deepEqual(renderer.getObjectState(sceneId + '-parent')!.objectMotion, direct.getObjectState(sceneId + '-parent')!.objectMotion)
  }
  renderer.setProject(document); renderer.computeAtBeat(6)
  direct.computeAtBeat(6)
  assert.deepEqual(renderer.getObjectState('b-parent')!.world, direct.getObjectState('b-parent')!.world)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { sceneSwitcherDirector } from './sceneSwitcher'
import { motionBridge, motionCurveSample, transitionMotion } from './sceneTransition'
import type { Scene, Track } from '../../types'

const scene = (id: string): Scene => ({ id, name: id, isMain: false, backgroundColor: '#000000', backgroundTransparent: false, tracks: {}, rootTrackIds: [] })
const scenes = { a: scene('a'), b: scene('b'), c: scene('c') }
const track: Track = {
  id: 'switcher', name: 'Switcher', type: 'base', instrumentId: 'sceneSwitcher', color: '#fff', muted: false, solo: false, childIds: [],
  params: { transition: 2, transitionBeats: 2, switchMode: 1 },
  sceneBindings: [{ pitch: 60, sceneId: 'a' }, { pitch: 61, sceneId: 'b' }, { pitch: 62, sceneId: 'c' }],
  blocks: [{ id: 'block', startBar: 0, durationBars: 4, loop: false, notes: [
    { id: 'a', startBeat: 0, durationBeats: 4, pitch: 60, velocity: 100 },
    { id: 'b', startBeat: 4, durationBeats: 4, pitch: 61, velocity: 100 },
    { id: 'c', startBeat: 8, durationBeats: 2, pitch: 62, velocity: 100 },
  ] }],
}
const resolve = (beat: number, t = track) => sceneSwitcherDirector.resolve(t, { beat, beatsPerBar: 4, totalBars: 4, scenes, sceneOrder: ['a', 'b', 'c'] })
const close = (a: number, b: number, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`)

test('motion starts before the cut and continues the same growing scale afterward', () => {
  assert.equal(resolve(3)[0].objectMotion, undefined)
  assert.equal(resolve(3.9)[0].sceneId, 'a')
  assert.equal(resolve(4)[0].sceneId, 'b')
  close(resolve(4)[0].objectMotion!.scale, 1.25)
  assert.ok(resolve(4.01)[0].objectMotion!.scale > resolve(4)[0].objectMotion!.scale)
  close(resolve(5)[0].objectMotion!.scale, 1.5)
  close(resolve(6)[0].objectMotion!.scale, 1.5)
})

test('value, velocity and acceleration agree on either side of the handoff in every channel', () => {
  const t = { ...track, params: { ...track.params, motionChannel: 4 } }
  const h = 0.0001
  for (const key of ['scale', 'x', 'y', 'rotation'] as const) {
    const f = (b: number) => resolve(b, t)[0].objectMotion![key]
    const vLeft = (3 * f(4) - 4 * f(4 - h) + f(4 - 2 * h)) / (2 * h)
    const vRight = (-3 * f(4) + 4 * f(4 + h) - f(4 + 2 * h)) / (2 * h)
    const aLeft = (2 * f(4) - 5 * f(4 - h) + 4 * f(4 - 2 * h) - f(4 - 3 * h)) / h ** 2
    const aRight = (2 * f(4) - 5 * f(4 + h) + 4 * f(4 + 2 * h) - f(4 + 3 * h)) / h ** 2
    close(vLeft, vRight)
    close(aLeft, aRight)
    assert.ok(vLeft > 0)
  }
})

test('the bridge meets a stationary scene with zero velocity and acceleration at both edges', () => {
  const h = 1e-5
  for (const edge of [0, 1]) {
    close(motionBridge(edge), edge)
    close((motionBridge(edge + h) - motionBridge(edge - h)) / (2 * h), 0)
    close((motionBridge(edge + h) - 2 * motionBridge(edge) + motionBridge(edge - h)) / h ** 2, 0, 0.002)
  }
})

test('crossfade yields one texture blend, avoiding the opacity dip of two fading layers', () => {
  const t = { ...track, params: { ...track.params, transition: 1 } }
  const layers = resolve(4, t)
  assert.equal(layers.length, 1)
  assert.equal(layers[0].opacity, 1)
  assert.deepEqual(layers[0].crossfade, { sceneId: 'a', mix: 0.5 })
  assert.equal(layers[0].sceneId, 'b')
  assert.equal(resolve(3, t)[0].sceneId, 'a')
  assert.equal(resolve(5, t)[0].crossfade, undefined)
})

test('hold releases bridge back to older held scenes, with short windows that do not overlap', () => {
  const t: Track = { ...track, params: { transition: 2, transitionBeats: 8 }, blocks: [{ ...track.blocks[0], notes: [
    { id: 'a', startBeat: 0, durationBeats: 10, pitch: 60, velocity: 100 },
    { id: 'b', startBeat: 4, durationBeats: 1, pitch: 61, velocity: 100 },
  ] }] }
  close(resolve(4.5, t)[0].objectMotion!.scale, 1.5)
  assert.equal(resolve(4.9, t)[0].sceneId, 'b')
  assert.equal(resolve(5, t)[0].sceneId, 'a')
  close(resolve(5, t)[0].objectMotion!.scale, 1.5 * 1.25)
  assert.deepEqual(resolve(10, t), [])
})

test('same-scene retriggers and unmapped notes do not interrupt a bridge; gaps stay empty', () => {
  const t: Track = { ...track, params: { transition: 2 }, blocks: [{ ...track.blocks[0], notes: [
    { id: 'a', startBeat: 0, durationBeats: 2, pitch: 60, velocity: 100 },
    { id: 'repeat', startBeat: 1, durationBeats: 1, pitch: 60, velocity: 100 },
    { id: 'unmapped', startBeat: 2, durationBeats: 4, pitch: 100, velocity: 100 },
    { id: 'b', startBeat: 4, durationBeats: 2, pitch: 61, velocity: 100 },
  ] }] }
  assert.equal(resolve(1, t)[0].objectMotion, undefined)
  assert.deepEqual(resolve(3.9, t), [])
  assert.equal(resolve(4, t)[0].objectMotion, undefined)
})

test('scrubbing produces the same frame regardless of evaluation order', () => {
  const expected = [3.9, 4, 4.1, 7.9, 8].map((b) => resolve(b))
  resolve(9); resolve(0); resolve(6)
  assert.deepEqual([3.9, 4, 4.1, 7.9, 8].map((b) => resolve(b)), expected)
})

test('zero duration disables transitions and invalid amounts remain finite', () => {
  assert.equal(resolve(4, { ...track, params: { transition: 2, transitionBeats: 0 } })[0].objectMotion, undefined)
  const motion = transitionMotion({ ...track, params: { motionChannel: 4, transitionScale: NaN, transitionX: Infinity, transitionY: -Infinity } }, 0.5)
  assert.ok(Object.values(motion).every(Number.isFinite))
})

test('crossfade evaluates both scenes and survives worker frame transfer and export recomputation', async () => {
  const { createVisualEngine } = await import('../visual/VisualEngine')
  const worker = createVisualEngine(), renderer = createVisualEngine()
  const cube = (id: string): Track => ({ id, name: id, type: 'base', instrumentId: 'cube', muted: false, solo: false, color: '#fff', childIds: [], blocks: [] })
  const a = { ...scenes.a, tracks: { cubeA: cube('cubeA') }, rootTrackIds: ['cubeA'] }
  const b = { ...scenes.b, tracks: { cubeB: cube('cubeB') }, rootTrackIds: ['cubeB'] }
  const switcher = { ...track, params: { ...track.params, transition: 1 } }
  const main: Scene = { ...scene('main'), isMain: true, tracks: { switcher }, rootTrackIds: ['switcher'] }
  const project = { scenes: { main, a, b }, sceneOrder: ['main', 'a', 'b'], activeSceneId: 'main',
    tracks: main.tracks, rootTrackIds: main.rootTrackIds, beatsPerBar: 4, bpm: 120, totalBars: 4 }
  worker.setProject(project)
  for (const beat of [3.9, 4, 4.1, 0, 4]) {
    worker.computeAtBeat(beat)
    const frame = worker.captureFrame()
    if (beat > 3) {
      assert.ok(frame.activeTrackIds.has('cubeA'))
      assert.ok(frame.activeTrackIds.has('cubeB'))
    }
    renderer.applyFrame(structuredClone(frame))
    assert.deepEqual(renderer.getCompositionLayers(), worker.getCompositionLayers())
    renderer.setProject(project)
    renderer.computeAtBeat(beat)
    assert.deepEqual(renderer.getCompositionLayers(), worker.getCompositionLayers())
  }
})


test('all speed curves peak at the cut and every motion channel progresses without reversal or reset', () => {
  for (const curve of [0, 1, 2]) {
    const t = { ...track, params: { ...track.params, motionChannel: 4, motionCurve: curve } }
    const peak = motionCurveSample(0.5, curve)
    close(peak.position, 0.5)
    close(peak.acceleration, 0)
    let last = { scale: 1, x: 0, y: 0, rotation: 0 }
    for (let i = 0; i <= 200; i++) {
      const sample = motionCurveSample(i / 200, curve)
      assert.ok(sample.velocity <= peak.velocity + 1e-8)
      const motion = resolve(3 + i / 100, t)[0].objectMotion ?? last
      for (const key of ['scale', 'x', 'y', 'rotation'] as const) assert.ok(motion[key] >= last[key] - 1e-8)
      last = motion
    }
    assert.deepEqual(resolve(6, t)[0].objectMotion, last)
  }
})

test('negative moves and shrinking stay monotonic and hold their final pose', () => {
  const t = { ...track, params: { ...track.params, motionChannel: 4, transitionScale: -80, transitionX: -3, transitionY: -2, transitionRotation: -90 } }
  let last = transitionMotion(t, 0)
  for (let i = 1; i <= 100; i++) {
    const motion = resolve(3 + i / 50, t)[0].objectMotion!
    for (const key of ['scale', 'x', 'y', 'rotation'] as const) assert.ok(motion[key] <= last[key] + 1e-8)
    assert.ok(motion.scale > 0)
    last = motion
  }
  assert.deepEqual(resolve(6, t)[0].objectMotion, last)
})

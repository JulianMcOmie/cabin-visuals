import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { InstancedCopyFrame } from '../core/visual/instancedFrame'
import type { ObjectState, ResolvedNote } from '../core/visual/types'
import { createParticleStreamSampler } from './particleStreamFrame'
import { createParticleFieldMesh } from './particleFieldRenderer'
import { STREAM_CAPACITY, buildStreamPaths, buildStreamTiming, sampleStreamJourney, streamParticleJourney, streamPatternWeights, streamNoteEvents } from './particleStreamCore'

const notes: ResolvedNote[] = [2.133, 2.163, 2.177, 4.241, 7.26].map((beat, i) => ({ beat, pitch: 60 + i, velocity: 100, durationBeats: .25, blockStartBeat: 0, blockEndBeat: 10 }))
const params = { count: 6, density: 16, speed: 1, twist: .35, spread: 4, meetX: 1.2, meetY: -.7, pattern: 1 }

test('shared field matches the original per-copy choreography across seeks and parameter/note edits', () => {
  const sample = createParticleStreamSampler()
  const point = { x: 0, y: 0, z: 0, fade: 0 }
  for (const count of [6, 16, 1]) for (const density of [16, 48, 2]) for (const speed of [.1, 1, 4]) {
    for (const beat of [0, 2.133, 2.177, 7.26, -10, 10000, 2.133]) {
      const settings = { ...params, count, density, speed }
      const frame = sample({ params: settings, notes, beat })
      const events = streamNoteEvents(notes), timing = buildStreamTiming(events, density, speed)
      assert.equal(frame.count, count * density)
      assert.equal(frame.positions.length, STREAM_CAPACITY * 4)
      for (let dot = 0; dot < density; dot++) {
        const journey = streamParticleJourney(dot, density, beat, speed, timing)
        const paths = buildStreamPaths(settings, streamPatternWeights(events, journey.crossBeat, settings.pattern))
        for (let stream = 0; stream < count; stream++) {
          sampleStreamJourney(point, paths[stream], journey.fraction)
          const offset = (stream * density + dot) * 4
          assert.deepEqual(Array.from(frame.positions.subarray(offset, offset + 4)), [point.x, point.y, point.z, point.fade].map(Math.fround))
        }
      }
    }
  }
  const before = Array.from(sample({ params, notes, beat: 2.133 }).positions)
  sample({ params: { ...params, twist: 2, spread: 10 }, notes: [], beat: 3 })
  assert.deepEqual(Array.from(sample({ params, notes, beat: 2.133 }).positions), before)
})

test('copy texture packs exact placement, color and fade while storage grows by copies, not particles', () => {
  const sample = createParticleStreamSampler(), field = createParticleFieldMesh(STREAM_CAPACITY, 1024)
  const state: ObjectState = { params, notes, beat: 2.133, opacity: .4, blackedOut: false, secPerBeat: .5, beatsPerBar: 4, energy: 0, world: new Matrix4(), meshScale: 1, stringParams: {}, abilityEvents: new Map(), automations: [], baseParams: params, activeNotes: [] }
  const copies = Array.from({ length: 2048 }, (_, i) => ({ transform: new Matrix4().makeRotationZ(i / 100).scale(new Vector3(2, 3, -4)).setPosition(i / 100, 2, -3), opacity: i % 3 === 0 ? 0 : .5, colorShift: { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 } }))
  const frame: InstancedCopyFrame = {
    state, copies,
    composePlacement: out => out.identity(),
    composeCopyMatrix: (i, out) => out.copy(copies[i].transform),
    copyFade: i => state.blackedOut ? 0 : state.opacity * copies[i].opacity,
    copyColor: (i, _source, out) => out.setRGB(i / 2048, .2, .3),
  }
  try {
    const local = sample(state)
    field.update(frame, local, '#ffffff', .02, .6)
    assert.equal(field.mesh.geometry.instanceCount, copies.filter(c => c.opacity > 0).length * local.count)
    const data = field.copyTexture.image.data as Float32Array
    assert.ok(data.length < copies.length * 24, 'one matrix/color per copy, independent of local density')
    assert.equal(field.localTexture.image.data.byteLength, STREAM_CAPACITY * 16)
    assert.deepEqual(Array.from(data.subarray(0, 16)), copies[1].transform.elements.map(Math.fround))
    assert.deepEqual(Array.from(data.subarray(16, 20)), [1 / 2048, .2, .3, .2].map(Math.fround))
    const texture = field.copyTexture
    frame.copies = copies.slice(0, 2)
    state.params = { ...params, density: 2, count: 1 }
    field.update(frame, sample(state), '#ffffff', 0, 0)
    assert.equal(field.mesh.geometry.instanceCount, 2)
    assert.equal(field.copyTexture, texture)
    state.blackedOut = true
    field.update(frame, sample(state), '#ffffff', .02, 0)
    assert.equal(field.mesh.geometry.instanceCount, 0)
    assert.equal(field.mesh.visible, false)
    state.blackedOut = false
    frame.copies = copies
    state.params = { ...params, count: 16, density: 48 }
    field.update(frame, sample(state), '#ffffff', -.03, .9)
    assert.equal(field.mesh.geometry.instanceCount, copies.filter(c => c.opacity > 0).length * 768)
    assert.equal(field.mesh.visible, true)
  } finally { field.dispose() }
})

test('equivalent thumbnail states share sampling, while seeks, edits and eviction remain exact', async () => {
  const { createSharedParticleStreamSampler } = await import('./particleStreamFrame')
  const shared = createSharedParticleStreamSampler(2), direct = createParticleStreamSampler()
  const input = { params, notes, beat: 2.133 }
  const first = shared(input)
  const expected = Array.from(first.positions)
  assert.equal(shared({ ...input, notes: notes.map(note => ({ ...note })), params: { ...params, size: .9, glow: .8 } }), first, 'equivalent resolved inputs share the same sampled frame')
  for (const beat of [100, -10, 7.26, 2.133]) {
    const state = { ...input, beat }
    assert.deepEqual(shared(state), direct(state))
  }
  shared({ ...input, params: { ...params, spread: 9 } })
  shared({ ...input, notes: [] })
  assert.deepEqual(Array.from(shared(input).positions), expected, 'eviction never becomes animation history')
})

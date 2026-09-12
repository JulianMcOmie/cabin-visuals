import assert from 'node:assert/strict'
import test from 'node:test'
import { Group } from 'three'
import type { ResolvedNote } from '../core/visual/types'
import { applyMaterialOpacity } from '../core/visual/animatedOpacity'
import { createParticlePool, disposeParticlePool } from './particleCore'
import { particleStreamInstrument } from './ParticleStream'
import { STREAM_CAPACITY, STREAM_CROSS_AGE, STREAM_FAR_Z, STREAM_NEAR_Z, streamCount, streamNoteEvents, streamPacketAge, streamPacketsAtBeat, streamTrajectory } from './particleStreamCore'

const settings = { count: 6, twist: 0.35, spread: 4, meetX: 0, meetY: 0 }
const point = (stream: number, t: number, pattern = 1, config = settings) => streamTrajectory({ x: 0, y: 0, z: 0, fade: 0 }, stream, t, pattern, config)
const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`)
const note = (beat: number, pitch: number): ResolvedNote => ({ beat, pitch, velocity: 100, durationBeats: 0.25, blockStartBeat: 0, blockEndBeat: 100 })

test('the primary control is stream count; dot density is independent and bounded', () => {
  const count = particleStreamInstrument.params.find(p => p.key === 'count')!
  assert.equal(count.label, 'Streams')
  assert.equal(count.default, 6)
  assert.ok(particleStreamInstrument.params.some(p => p.key === 'density'))
  assert.equal(streamCount(0), 1)
  assert.equal(streamCount(999999), 16)
  assert.equal(streamCount(NaN), 6)
})

test('six streams meet centrally or as three distinct adjacent pairs, including at maximum twist', () => {
  for (const twist of [-2, 0, 0.35, 2]) {
    const config = { ...settings, twist, meetX: 1.1, meetY: -0.7 }
    const points = Array.from({ length: 6 }, (_, i) => point(i, STREAM_CROSS_AGE, 2, config))
    for (let i = 0; i < 6; i++) {
      const center = point(i, STREAM_CROSS_AGE, 1, config)
      near(center.x, 1.1); near(center.y, -0.7); near(center.z, -4)
      const partner = points[i % 2 ? i - 1 : i + 1]
      near(points[i].x, partner.x); near(points[i].y, partner.y)
    }
    assert.equal(new Set(points.filter((_, i) => i % 2 === 0).map(p => `${p.x.toFixed(6)},${p.y.toFixed(6)}`)).size, 3)
  }
  const odd = point(4, STREAM_CROSS_AGE, 2, { ...settings, count: 5 })
  near(odd.x, 0); near(odd.y, 0)
})

test('paths cross with continuous nonzero velocity and positive forward acceleration', () => {
  const h = 1e-5
  for (const pattern of [0, 1, 2, 3, 4]) for (const twist of [-2, 0, 2]) {
    for (let stream = 0; stream < 6; stream++) {
      const sample = (t: number) => point(stream, t, pattern, { ...settings, twist })
      const a = sample(STREAM_CROSS_AGE - h), b = sample(STREAM_CROSS_AGE), c = sample(STREAM_CROSS_AGE + h)
      for (const axis of ['x', 'y', 'z'] as const) near((b[axis] - a[axis]) / h, (c[axis] - b[axis]) / h, 0.03)
      assert.ok((c.z - a.z) / (2 * h) > 30, 'particles shoot through the meeting plane')
      for (let t = 0.05; t < 0.95; t += 0.05) {
        const before = sample(t - h), at = sample(t), after = sample(t + h)
        assert.ok(after.z > at.z && at.z > before.z)
        near((after.z - 2 * at.z + before.z) / (h * h), 16, 0.001)
      }
    }
  }
})

test('spawn and retirement are invisible; open mode stays distinct and zero twist stays straight', () => {
  for (let i = 0; i < 6; i++) {
    assert.equal(point(i, 0).fade, 0)
    assert.equal(point(i, 1).fade, 0)
    near(point(i, 0).z, STREAM_FAR_Z)
    near(point(i, 1).z, STREAM_NEAR_Z)
    const config = { ...settings, twist: 0 }
    const a = point(i, 0.2, 0, config), b = point(i, 0.8, 0, config)
    near(a.x, b.x); near(a.y, b.y)
  }
  assert.equal(new Set(Array.from({ length: 6 }, (_, i) => JSON.stringify(point(i, STREAM_CROSS_AGE, 0)))).size, 6)
})

test('off-grid notes schedule exact-time crossings, chord rules and latching are deterministic', () => {
  const events = streamNoteEvents([note(5.17, 61), note(2.33, 60), note(5.17, 62), note(1, 80), note(1, 60.5)])
  assert.deepEqual(events, [{ crossingBeat: 2.33, pattern: 1 }, { crossingBeat: 5.17, pattern: 3 }])
  for (const speed of [0.1, 1, 4]) for (const event of events) {
    const { packets, lifetime } = streamPacketsAtBeat(events, event.crossingBeat, speed, 16, 0)
    assert.equal(packets.filter(p => p.crossingBeat === event.crossingBeat).length, 1)
    near(streamPacketAge(event.crossingBeat, event.crossingBeat, lifetime), STREAM_CROSS_AGE)
    for (const packet of packets.filter(p => p.crossingBeat > 5.17)) assert.equal(packet.pattern, 3)
  }
})

test('MIDI route transitions retain packet position and velocity; backward seeks match direct samples', () => {
  const events = streamNoteEvents([note(4.13, 61), note(6.29, 60), note(8.11, 63)])
  const sample = (beat: number, crossing: number) => {
    const { packets, lifetime } = streamPacketsAtBeat(events, beat, 1, 16, 1)
    const packet = packets.find(p => p.crossingBeat === crossing)!
    assert.ok(packet)
    return point(0, streamPacketAge(beat, crossing, lifetime), packet.pattern)
  }
  const expected = sample(6.29, 8.11)
  sample(11, 8.11); sample(4, 8.11)
  assert.deepEqual(sample(6.29, 8.11), expected)
  for (const crossing of [4.13, 6.29, 8.11]) {
    const a = sample(6.29 - 1e-5, crossing), b = sample(6.29, crossing), c = sample(6.29 + 1e-5, crossing)
    for (const axis of ['x', 'y', 'z'] as const) near((b[axis] - a[axis]) / 1e-5, (c[axis] - b[axis]) / 1e-5, 0.003)
  }
  const beforeZero = streamPacketsAtBeat([], -7, 1, 16, 1)
  assert.ok(beforeZero.packets.length >= 16)
})

test('dense MIDI and maximum settings stay inside the single shared Particle pool', () => {
  const events = streamNoteEvents(Array.from({ length: 5000 }, (_, i) => note(i / 1000, 60)))
  const { packets } = streamPacketsAtBeat(events, 3, 0.1, 48, 1)
  assert.ok(packets.length * 16 <= STREAM_CAPACITY)
  const pool = createParticlePool(2, true)
  const ordinary = createParticlePool(2)
  assert.equal(pool.mesh.material.defines.PARTICLE_OBJECT_OPACITY, 1)
  assert.equal(ordinary.mesh.material.defines.PARTICLE_OBJECT_OPACITY, undefined, 'ordinary copy fades are already packed')
  const root = new Group().add(pool.mesh)
  applyMaterialOpacity(root, 0.25)
  assert.equal(pool.mesh.material.uniforms.uOpacity.value, 0.25)
  assert.equal(pool.mesh.material.transparent, true)
  disposeParticlePool(pool); disposeParticlePool(ordinary)
})

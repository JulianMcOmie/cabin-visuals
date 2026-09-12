import assert from 'node:assert/strict'
import test from 'node:test'
import { Group } from 'three'
import type { ResolvedNote } from '../core/visual/types'
import { applyMaterialOpacity } from '../core/visual/animatedOpacity'
import { createParticlePool, disposeParticlePool } from './particleCore'
import { particleStreamInstrument } from './ParticleStream'
import { STREAM_CAPACITY, STREAM_CROSS_AGE, STREAM_FAR_Z, STREAM_NEAR_Z, streamCount, streamDensity, streamNoteEvents, streamPatternWeights, buildStreamPaths, sampleStreamPath, streamParticleFraction, streamParticleJourney, streamTrajectory } from './particleStreamCore'

const settings = { count: 6, twist: 0.35, spread: 4, meetX: 0, meetY: 0 }
const point = (stream: number, t: number, pattern = 1, config = settings) => streamTrajectory({ x: 0, y: 0, z: 0, fade: 0 }, stream, t, pattern, config)
const blank = () => ({ x: 0, y: 0, z: 0, fade: 0 })
const near = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`)
const note = (beat: number, pitch: number): ResolvedNote => ({ beat, pitch, velocity: 100, durationBeats: 0.25, blockStartBeat: 0, blockEndBeat: 100 })
const weights = (pattern: number) => [0, 1, 2, 3, 4].map(p => p === pattern ? 1 : 0)

test('streams and fixed density are independent bounded controls', () => {
  assert.equal(particleStreamInstrument.params.find(p => p.key === 'count')?.label, 'Streams')
  assert.equal(particleStreamInstrument.params.find(p => p.key === 'count')?.default, 6)
  assert.equal(particleStreamInstrument.params.find(p => p.key === 'density')?.label, 'Particle density')
  assert.equal(streamCount(0), 1); assert.equal(streamCount(99999), 16); assert.equal(streamCount(NaN), 6)
  assert.equal(streamDensity(0), 2); assert.equal(streamDensity(99999), 48); assert.equal(streamDensity(NaN), 16)
  assert.equal(STREAM_CAPACITY, 16 * 48)
})

test('six paths retain central and three adjacent-pair intersections', () => {
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

test('the flow moves away from the camera without stopping at intersections', () => {
  for (const pattern of [0, 1, 2, 3, 4]) for (const twist of [-2, 0, 2]) {
    const paths = buildStreamPaths({ ...settings, twist }, weights(pattern))
    for (const path of paths) {
      near(sampleStreamPath(blank(), path, 0).z, STREAM_NEAR_Z)
      near(sampleStreamPath(blank(), path, 1).z, STREAM_FAR_Z)
      for (let t = 0.001; t < 1; t += 0.005) {
        const a = sampleStreamPath(blank(), path, t - 1e-5), b = sampleStreamPath(blank(), path, t)
        assert.ok(b.z < a.z, 'each next sample travels into the distance')
      }
      const a = sampleStreamPath(blank(), path, 0.5 - 1e-5), b = sampleStreamPath(blank(), path, 0.5 + 1e-5)
      assert.ok((a.z - b.z) / 2e-5 > 1, 'the crossing must not halt the flow')
    }
  }
})

test('particles remain evenly spaced along curved paths by distance, not depth', () => {
  for (const twist of [0.35, 2]) {
    const path = buildStreamPaths({ ...settings, twist }, weights(1))[0]
    const lengths = []
    for (let dot = 0; dot < 16; dot++) {
      let previous = sampleStreamPath(blank(), path, dot / 16), length = 0
      for (let i = 1; i <= 40; i++) {
        const next = sampleStreamPath(blank(), path, (dot + i / 40) / 16)
        length += Math.hypot(next.x - previous.x, next.y - previous.y, next.z - previous.z)
        previous = next
      }
      lengths.push(length)
    }
    assert.ok(Math.max(...lengths) / Math.min(...lengths) < 1.005)
  }
})

test('MIDI never changes the fixed slots or their spacing, including dense rolls and negative beats', () => {
  const events = streamNoteEvents(Array.from({ length: 1000 }, (_, i) => note(i / 100, 60 + i % 5)))
  for (const beat of [-100, 0, 0.001, 4.13, 5, 8, 10000]) for (const density of [2, 16, 48]) {
    const phases = Array.from({ length: density }, (_, i) => streamParticleFraction(i, density, beat, 1)).sort((a, b) => a - b)
    assert.equal(phases.length, density)
    assert.equal(new Set(phases).size, density)
    for (let i = 1; i < phases.length; i++) near(phases[i] - phases[i - 1], 1 / density, 1e-10)
    near(phases[0] + 1 - phases[phases.length - 1], 1 / density, 1e-10)
    const blend = streamPatternWeights(events, beat, 1)
    near(blend.reduce((a, b) => a + b), 1)
    assert.ok(blend.every(w => w >= -1e-12 && w <= 1 + 1e-12))
  }
})

test('MIDI starts smooth path changes rather than scheduling new dot arrivals', () => {
  const events = streamNoteEvents([note(2.33, 60), note(5.17, 61), note(5.17, 62), note(1, 80), note(1, 60.5)])
  assert.deepEqual(events, [{ beat: 2.33, pattern: 1 }, { beat: 5.17, pattern: 3 }])
  assert.deepEqual(streamPatternWeights(events, 2.33, 0), weights(0))
  assert.deepEqual(streamPatternWeights(events, 3.33, 0), weights(1))
  near(streamPatternWeights(events, 2.83, 0)[1], 0.5)
  assert.deepEqual(streamPatternWeights(events, 6.17, 0), weights(3))
})

test('a particle keeps its original route and velocity through later MIDI changes and seeks', () => {
  const events = streamNoteEvents([note(4.13, 61), note(4.29, 60), note(4.51, 63)])
  const original = buildStreamPaths(settings, weights(1))[0]
  const sample = (beat: number) => {
    const journey = streamParticleJourney(3, 16, beat, 1)
    const path = buildStreamPaths(settings, streamPatternWeights(events, journey.birthBeat, 1))[0]
    return sampleStreamPath(blank(), path, journey.fraction)
  }
  for (const beat of [0, 4.13, 4.29, 4.51, 5.13, 5.29, 5.51, 6.49]) {
    const journey = streamParticleJourney(3, 16, beat, 1)
    assert.equal(journey.birthBeat, -1.5)
    assert.deepEqual(sample(beat), sampleStreamPath(blank(), original, journey.fraction), 'later notes cannot bend an existing journey')
  }
  const expected = sample(4.4)
  sample(8); sample(-2)
  assert.deepEqual(sample(4.4), expected)
  const h = 1e-5
  for (const beat of [4.13, 4.29, 4.51, 5.13, 5.29, 5.51]) {
    const a = sample(beat - h), b = sample(beat), c = sample(beat + h)
    for (const axis of ['x', 'y', 'z'] as const) near((b[axis] - a[axis]) / h, (c[axis] - b[axis]) / h, 0.03)
  }
})

test('route changes propagate in entry order while old and new journeys coexist', () => {
  const events = streamNoteEvents([note(4, 61)])
  const route = (dot: number, beat: number) => {
    const journey = streamParticleJourney(dot, 16, beat, 1)
    return streamPatternWeights(events, journey.birthBeat, 1)
  }
  // At beat 6, these particles entered at 2, 4.5 and 5 beats respectively.
  assert.deepEqual(route(12, 6), weights(1))
  assert.deepEqual(route(7, 6), [0, 0.5, 0.5, 0, 0])
  assert.deepEqual(route(6, 6), weights(2))
  assert.deepEqual(route(7, 11), route(7, 6), 'a transitional route is also fixed for its whole flight')
  assert.deepEqual(route(7, 12.5), weights(2), 'only recycling picks a new route')
  for (let dot = 0; dot < 16; dot++) assert.deepEqual(route(dot, 13), weights(2))
})

test('journey birth is stable across speeds, negative beats, and wrap boundaries', () => {
  for (const speed of [0.1, 0.73, 1, 4]) for (const density of [2, 16, 48]) {
    for (let dot = 0; dot < density; dot++) {
      const journey = streamParticleJourney(dot, density, -3.125, speed)
      const duration = 8 / speed
      const middle = streamParticleJourney(dot, density, journey.birthBeat + duration * 0.5, speed)
      const end = streamParticleJourney(dot, density, journey.birthBeat + duration * 0.999, speed)
      assert.equal(middle.birthBeat, journey.birthBeat)
      assert.equal(end.birthBeat, journey.birthBeat)
      near(middle.fraction, 0.5)
      const next = streamParticleJourney(dot, density, journey.birthBeat + duration * 1.001, speed)
      near(next.birthBeat - journey.birthBeat, duration)
      assert.ok(next.fraction < 0.002)
    }
  }
})

test('arc-length lookup has no velocity jumps at table boundaries and wraps invisibly', () => {
  const path = buildStreamPaths(settings, weights(1))[0]
  near(sampleStreamPath(blank(), path, 0).fade, 0)
  near(sampleStreamPath(blank(), path, 1).fade, 0)
  const h = 1e-7
  for (let i = 1; i < path.distances.length - 1; i++) {
    const t = path.distances[i] / path.length
    const a = sampleStreamPath(blank(), path, t - h), b = sampleStreamPath(blank(), path, t), c = sampleStreamPath(blank(), path, t + h)
    for (const axis of ['x', 'y', 'z'] as const) near((b[axis] - a[axis]) / h, (c[axis] - b[axis]) / h, 0.01)
  }
})

test('the fixed flow reuses Particle glow and composes object fades once', () => {
  const pool = createParticlePool(STREAM_CAPACITY, true), ordinary = createParticlePool(2)
  assert.equal(pool.mesh.material.defines.PARTICLE_OBJECT_OPACITY, 1)
  assert.equal(ordinary.mesh.material.defines.PARTICLE_OBJECT_OPACITY, undefined)
  applyMaterialOpacity(new Group().add(pool.mesh), 0.25)
  assert.equal(pool.mesh.material.uniforms.uOpacity.value, 0.25)
  assert.equal(pool.mesh.material.transparent, true)
  disposeParticlePool(pool); disposeParticlePool(ordinary)
})

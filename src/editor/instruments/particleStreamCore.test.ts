import assert from 'node:assert/strict'
import test from 'node:test'
import { Group } from 'three'
import type { ResolvedNote } from '../core/visual/types'
import { applyMaterialOpacity } from '../core/visual/animatedOpacity'
import { createParticlePool, disposeParticlePool } from './particleCore'
import { particleStreamInstrument } from './ParticleStream'
import { STREAM_CAPACITY, STREAM_CROSS_AGE, STREAM_FAR_Z, STREAM_NEAR_Z, streamCount, streamDensity, streamNoteEvents, streamPatternWeights, buildStreamPaths, sampleStreamPath, streamParticleJourney, streamTrajectory, buildStreamTiming, streamFlowPhase, streamBeatAtPhase, sampleStreamJourney } from './particleStreamCore'

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
    const timing = buildStreamTiming(events, density, 1)
    const phases = Array.from({ length: density }, (_, i) => streamParticleJourney(i, density, beat, 1, timing).fraction).sort((a, b) => a - b)
    assert.equal(phases.length, density)
    assert.equal(new Set(phases).size, density)
    for (let i = 1; i < phases.length; i++) near(phases[i] - phases[i - 1], 1 / density, 1e-10)
    near(phases[0] + 1 - phases[phases.length - 1], 1 / density, 1e-10)
    const blend = streamPatternWeights(events, beat, 1)
    near(blend.reduce((a, b) => a + b), 1)
    assert.ok(blend.every(w => w >= -1e-12 && w <= 1 + 1e-12))
  }
})

test('future route blends finish exactly on each MIDI beat, including rapid changes', () => {
  const events = streamNoteEvents([note(2.33, 60), note(2.37, 61), note(2.37, 62), note(1, 80), note(1, 60.5)])
  assert.deepEqual(events, [{ beat: 2.33, pattern: 1 }, { beat: 2.37, pattern: 3 }])
  assert.deepEqual(streamPatternWeights(events, 1, 0), weights(0))
  near(streamPatternWeights(events, 1.83, 0)[1], 0.5)
  assert.deepEqual(streamPatternWeights(events, 2.33, 0), weights(1))
  near(streamPatternWeights(events, 2.35, 0)[3], 0.5)
  assert.deepEqual(streamPatternWeights(events, 2.37, 0), weights(3))
})

test('every off-grid MIDI beat has an exact arrival in its own pattern, even in dense rolls', () => {
  const events = streamNoteEvents([note(2.133, 60), note(2.163, 61), note(2.177, 62), note(2.241, 63), note(2.26, 64)])
  for (const density of [2, 3, 16, 47, 48]) for (const speed of [0.1, 1, 4]) {
    const timing = buildStreamTiming(events, density, speed)
    for (const event of events) {
      const arrivals = Array.from({ length: density }, (_, dot) => streamParticleJourney(dot, density, event.beat, speed, timing))
        .filter(journey => Math.abs(journey.fraction - 0.5) < 1e-9)
      assert.equal(arrivals.length, 1, 'one existing particle per stream reaches its intersection on every note')
      const journey = arrivals[0]
      near(journey.crossBeat, event.beat)
      const blend = streamPatternWeights(events, journey.crossBeat, 0)
      assert.deepEqual(blend, weights(event.pattern), 'rapid notes cannot blur the requested pattern at arrival')
      for (const count of [1, 5, 6, 16]) {
        const config = { ...settings, count, meetX: 1.2, meetY: -0.7 }
        const paths = buildStreamPaths(config, blend)
        for (let stream = 0; stream < count; stream++) {
          const actual = sampleStreamJourney(blank(), paths[stream], journey.fraction)
          const target = point(stream, 0.5, event.pattern, config)
          near(actual.x, target.x, 1e-8); near(actual.y, target.y, 1e-8); near(actual.z, -4, 1e-8)
          assert.equal(actual.fade, 1, 'the collision is fully visible')
        }
      }
    }
  }
})

test('each complete route is planned before its MIDI beat and stays fixed through the flight', () => {
  const events = streamNoteEvents([note(4.13, 61), note(4.16, 60), note(4.21, 63)])
  const timing = buildStreamTiming(events, 16, 1)
  const crossPhase = timing.phases[0]
  const dot = ((8 - crossPhase) % 16 + 16) % 16
  const path = buildStreamPaths(settings, weights(2))[0]
  const sample = (beat: number) => {
    const journey = streamParticleJourney(dot, 16, beat, 1, timing)
    const route = streamPatternWeights(events, journey.crossBeat, 1)
    return { journey, route, point: sampleStreamJourney(blank(), buildStreamPaths(settings, route)[0], journey.fraction) }
  }
  for (const offset of [-7.9, -6, -1, 0, 1, 6, 7.9]) {
    const beat = streamBeatAtPhase(timing, crossPhase + offset)
    const actual = sample(beat)
    near(actual.journey.crossBeat, 4.13)
    assert.deepEqual(actual.route, weights(2), 'later notes do not retarget an already planned route')
    assert.deepEqual(actual.point, sampleStreamJourney(blank(), path, actual.journey.fraction))
  }
  const approach = sample(4.12)
  assert.ok(approach.point.z > -4, 'particles approach before the note')
  assert.ok(sample(4.131).point.z < -4, 'particles continue away immediately after the note')
  sample(12); sample(-10)
  assert.deepEqual(sample(4.12), approach, 'direct, forward, and backward sampling agree')
})

test('the planned flow clock stays forward and C1 across isolated and rapidly spaced notes', () => {
  for (const density of [2, 3, 16, 48]) for (const speed of [0.1, 1, 4]) {
    const events = streamNoteEvents([note(-3.17, 60), note(2.13, 61), note(2.131, 62), note(2.2, 63), note(70, 60)])
    const timing = buildStreamTiming(events, density, speed)
    for (let i = 0; i < events.length; i++) {
      const beat = events[i].beat, h = 1e-7
      const a = streamFlowPhase(timing, beat - h), b = streamFlowPhase(timing, beat), c = streamFlowPhase(timing, beat + h)
      const leftHalf = streamFlowPhase(timing, beat - h / 2), rightHalf = streamFlowPhase(timing, beat + h / 2)
      near(b, timing.phases[i])
      const expected = timing.slopes[i]
      near((3 * b - 4 * leftHalf + a) / h, expected, Math.max(0.003, expected * 0.001))
      near((-3 * b + 4 * rightHalf - c) / h, expected, Math.max(0.003, expected * 0.001))
      if (i === 0) continue
      const start = events[i - 1].beat
      let previous = streamFlowPhase(timing, start)
      for (let step = 1; step <= 100; step++) {
        const t = start + (beat - start) * step / 100
        const phase = streamFlowPhase(timing, t)
        assert.ok(phase > previous, 'no reversals or pauses')
        near(streamBeatAtPhase(timing, phase), t, 1e-9)
        previous = phase
      }
    }
  }
})

test('mixed Open routes reach the meeting plane on schedule without a velocity kink', () => {
  for (const open of [0, 0.1, 0.5, 0.9, 1]) {
    const paths = buildStreamPaths({ ...settings, twist: 2 }, [open, 1 - open, 0, 0, 0])
    for (const path of paths) {
      const h = 1e-7
      const a = sampleStreamJourney(blank(), path, 0.5 - h), b = sampleStreamJourney(blank(), path, 0.5), c = sampleStreamJourney(blank(), path, 0.5 + h)
      near(b.z, -4, 1e-8)
      for (const axis of ['x', 'y', 'z'] as const) near((b[axis] - a[axis]) / h, (c[axis] - b[axis]) / h, 0.01)
      near(sampleStreamJourney(blank(), path, 0).fade, 0)
      near(sampleStreamJourney(blank(), path, 1).fade, 0)
    }
  }
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

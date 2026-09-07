import assert from 'node:assert/strict'
import test from 'node:test'
import { automationLaneValueBounds, buildPhysicsCurve, sampleAutomationLane, samplePhysicsLane } from './automation'

const notes = [{ beat: 1, value: 0.2 }, { beat: 1.7, value: 0.9 }, { beat: 5, value: -0.3 }]
const close = (actual: number, expected: number, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`)

test('crosses every note with prescribed continuous velocity and acceleration, including unequal gaps and endpoints', () => {
  const cfg = { velocity: -3, acceleration: 4 }
  const curve = buildPhysicsCurve(notes, cfg, 2)!
  const sample = (t: number) => samplePhysicsLane(curve, t)
  const h = 1e-5
  for (const n of notes) {
    close(sample(n.beat), n.value)
    for (const direction of [-1, 1]) {
      const d = h * direction
      close((sample(n.beat + d) - sample(n.beat)) / d, -6, 0.001)
      close((sample(n.beat + 2 * d) - 2 * sample(n.beat + d) + sample(n.beat)) / (d * d), 8, 0.02)
    }
  }
  // Finite resting tails, with zero endpoint derivatives.
  for (const t of [0, 6]) {
    close((sample(t + h) - sample(t - h)) / (2 * h), 0)
    close((sample(t + h) - 2 * sample(t) + sample(t - h)) / (h * h), 0, 0.02)
  }
})

test('large settings overshoot without clipping and have conservative structural bounds', () => {
  const physics = { velocity: 20, acceleration: -40 }
  const physicsCurve = buildPhysicsCurve(notes, physics)!
  const lane = { mode: 'linear' as const, keyframes: [], physics, physicsCurve, min: 0, max: 1 }
  const bounds = automationLaneValueBounds(lane, 0)
  let overshot = false
  for (let t = -2; t <= 8; t += 0.01) {
    const v = sampleAutomationLane(lane, t, 0)
    assert.ok(Number.isFinite(v) && v >= bounds.min && v <= bounds.max)
    overshot ||= v < 0 || v > 1
    assert.equal(v, sampleAutomationLane(lane, t, 0))
  }
  assert.ok(overshot)
})

test('empty, single and simultaneous notes are deterministic', () => {
  const cfg = { velocity: 1, acceleration: 0 }
  assert.equal(buildPhysicsCurve([], cfg), undefined)
  assert.ok(Number.isNaN(sampleAutomationLane({ mode: 'linear', keyframes: [], physics: cfg }, 0, 5)))
  const curve = buildPhysicsCurve([{ beat: 2, value: 3 }, { beat: 2, value: 7 }], cfg)!
  close(samplePhysicsLane(curve, 2), 7)
  close(samplePhysicsLane(curve, -100), 6)
  close(samplePhysicsLane(curve, 100), 8)
})

test('resolver maps MIDI pitch, range and amount into the physics curve', async () => {
  const { resolveAutomationLanes } = await import('./resolve')
  const parent: import('../../types').Track = { id: 'parent', name: 'Parent', type: 'base', instrumentId: '', color: '#fff', muted: false, solo: false, blocks: [], childIds: ['lane'] }
  const lane: import('../../types').Track = { ...parent, id: 'lane', type: 'automation', parentId: 'parent', childIds: [], targetParam: 'size', physics: { velocity: 2, acceleration: 3 }, automationAmount: 2,
    blocks: [{ id: 'block', startBar: 0, durationBars: 4, loop: false, notes: [
      { id: 'a', startBeat: 1, durationBeats: 0.5, pitch: 60, velocity: 100 },
      { id: 'b', startBeat: 4, durationBeats: 0.5, pitch: 72, velocity: 100 },
    ] }] }
  const [resolved] = resolveAutomationLanes(parent, [{ key: 'size', label: 'Size', type: 'number', min: 0, max: 10, default: 1, step: 0.1 }], { tracks: { parent, lane }, rootTrackIds: ['parent'], beatsPerBar: 4, bpm: 120 })
  assert.ok(resolved.physicsCurve)
  close(sampleAutomationLane(resolved, 1, 1), 10)
  close(sampleAutomationLane(resolved, 4, 1), 15)
  const h = 1e-5
  close((sampleAutomationLane(resolved, 1 + h, 1) - sampleAutomationLane(resolved, 1 - h, 1)) / (2 * h), 40, 0.001)
})

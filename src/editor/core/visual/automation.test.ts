import assert from 'node:assert/strict'
import test from 'node:test'
import {
  sampleAutomationLane,
  sampleBurstLane,
  type AutomationLane,
  type BurstConfig,
  type BurstGate,
} from './automation'

// A 1-beat attack to a 0.5 sustain over 1 beat of decay, 1-beat release: every
// stage is a whole beat, so expected values are readable by hand.
const BURST: BurstConfig = {
  attackBeats: 1,
  decayBeats: 1,
  sustainLevel: 0.5,
  releaseBeats: 1,
  intensity: 1,
}

function burst(beat: number, durationBeats: number, value: number, velocity = 1): BurstGate {
  return { beat, durationBeats, velocity, value }
}

function close(actual: number, expected: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg ?? `expected ${expected}, got ${actual}`)
}

test('burst: inert (NaN) before the first burst and after the last releases', () => {
  const gates = [burst(4, 1, 10)]
  assert.ok(Number.isNaN(sampleBurstLane(BURST, gates, 0, 2)))
  assert.ok(Number.isNaN(sampleBurstLane(BURST, gates, 3.9, 2)))
  // hold = max(duration, attack) = 1, so the release ends at 4 + 1 + 1.
  assert.ok(Number.isNaN(sampleBurstLane(BURST, gates, 6, 2)))
})

test('burst: travels from the base to the note pitch-value at full gain', () => {
  const gates = [burst(0, 4, 10)]
  close(sampleBurstLane(BURST, gates, 0.5, 2), 6)   // half attack: halfway there
  close(sampleBurstLane(BURST, gates, 1, 2), 10)    // peak: arrives exactly
  close(sampleBurstLane(BURST, gates, 2, 2), 6)     // decayed to sustain 0.5
  close(sampleBurstLane(BURST, gates, 3.5, 2), 6)   // sustain holds while held
})

test('burst: a negative-going burst is the same travel downward', () => {
  const gates = [burst(0, 4, 0)]
  close(sampleBurstLane(BURST, gates, 1, 8), 0)
  close(sampleBurstLane(BURST, gates, 2, 8), 4)
})

test('burst: velocity scales how far the burst gets', () => {
  const gates = [burst(0, 4, 10, 0.5)]
  close(sampleBurstLane(BURST, gates, 1, 0), 5)
  // MIDI-style velocities normalize the same way the envelope evaluator does.
  close(sampleBurstLane(BURST, [burst(0, 4, 10, 127)], 1, 0), 10)
})

test('burst: intensity scales every burst at once, 0 makes the lane a no-op', () => {
  const gates = [burst(0, 4, 10)]
  close(sampleBurstLane({ ...BURST, intensity: 0.5 }, gates, 1, 0), 5)
  close(sampleBurstLane({ ...BURST, intensity: 0 }, gates, 1, 4), 4)
})

test('burst: overlapping bursts blend toward their gain-weighted value', () => {
  // Both at full gain (peak) with equal velocity: the destination is the average
  // of the two targets, and the summed travel clamps at 1 (so it arrives).
  const gates = [burst(0, 4, 10), burst(0, 4, 20)]
  close(sampleBurstLane(BURST, gates, 1, 0), 15)
})

test('burst: a zero-length hit still reaches its peak before releasing', () => {
  const gates = [burst(0, 0, 10)]
  close(sampleBurstLane(BURST, gates, 1, 0), 10)
  close(sampleBurstLane(BURST, gates, 1.5, 0), 5) // halfway through the release
  assert.ok(Number.isNaN(sampleBurstLane(BURST, gates, 2.5, 0)))
})

test('sampleAutomationLane: dispatches on mode and reports inert lanes as NaN', () => {
  const burstLane: AutomationLane = {
    mode: 'linear',
    keyframes: [],
    burst: BURST,
    bursts: [burst(0, 4, 10)],
  }
  close(sampleAutomationLane(burstLane, 1, 2), 10)
  assert.ok(Number.isNaN(sampleAutomationLane(burstLane, 20, 2)))

  // Burst mode wins over a stray noise config, matching the resolver's order.
  const both: AutomationLane = {
    ...burstLane,
    noise: { rate: 4, smoothness: 0.5, range: 1, seed: 1 },
    gates: [{ beat: 0, endBeat: 4, center: 5, amp: 1 }],
  }
  close(sampleAutomationLane(both, 1, 2), 10)

  // A keyframe lane still interpolates, and an empty lane is inert.
  const keyframeLane: AutomationLane = {
    mode: 'linear',
    keyframes: [{ beat: 0, value: 0 }, { beat: 2, value: 10 }],
  }
  close(sampleAutomationLane(keyframeLane, 1, 99), 5)
  assert.ok(Number.isNaN(sampleAutomationLane({ mode: 'linear', keyframes: [] }, 1, 99)))
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { pitchToValue, pitchToValueRanged } from '../trackTypes'
import {
  DEFAULT_BURST_BEZIER,
  DEFAULT_BURST_SPRING,
  automationAmount,
  automationLaneValueBounds,
  extractBurstGates,
  extractKeyframes,
  extractNoiseGates,
  sampleAutomationLane,
  sampleBurstLane,
  type AutomationLane,
  type BurstConfig,
  type BurstGate,
} from './automation'
import type { Block } from '../../types'

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

// ── Amount (lane output gain) ────────────────────────────────────────────────

/** One 1-bar block with single-beat notes at the given pitches. Pitch 36..84 maps
 *  onto [min,max]: 36 = min, 60 = midpoint, 84 = max. */
function pitchBlock(...pitches: number[]): Block[] {
  return [{
    id: 'b',
    startBar: 0,
    durationBars: 1,
    loop: false,
    notes: pitches.map((pitch, i) => ({ id: `n${i}`, startBeat: i, durationBeats: 1, pitch, velocity: 100 })),
  }]
}

test('amount: scales every extractor\'s values, clamped back to the param range', () => {
  const blocks = pitchBlock(84, 60) // → max, midpoint of [0, 10]

  // Keyframes: values are true multiples of what the notes wrote…
  const half = extractKeyframes(blocks, 4, 0, 10, undefined, 0.5)
  close(half[0].value, 5)
  close(half[1].value, 2.5)
  // …and a boost clamps at the range's top instead of escaping it.
  const boosted = extractKeyframes(blocks, 4, 0, 10, undefined, 2)
  close(boosted[0].value, 10)
  close(boosted[1].value, 10)
  // Default amount is the identity.
  close(extractKeyframes(blocks, 4, 0, 10)[1].value, 5)

  // Noise gates scale their centers the same way.
  close(extractNoiseGates(blocks, 4, 0, 10, undefined, 0.5)[1].center, 2.5)
  // Burst gates scale the value each burst aims for.
  close(extractBurstGates(blocks, 4, 0, 10, undefined, 0.5)[0].value, 5)

  // A negative-min range clamps at its floor, not at zero.
  const negative = extractKeyframes(pitchBlock(36), 4, -4, 4, undefined, 2)
  close(negative[0].value, -4)
})

test('automationAmount: absent → 1, negative documents are floored at 0', () => {
  close(automationAmount({}), 1)
  close(automationAmount({ automationAmount: 0.25 }), 0.25)
  close(automationAmount({ automationAmount: -3 }), 0)
})

// ── Lane value bounds (structural pool sizing) ───────────────────────────────

function keyframeLane(values: number[]): AutomationLane {
  return {
    mode: 'linear',
    keyframes: values.map((value, i) => ({ beat: i * 4, value })),
  }
}

test('bounds: a keyframe lane reaches exactly its keyframe extremes, base excluded', () => {
  const { min, max } = automationLaneValueBounds(keyframeLane([2, 5, 3]), 8)
  close(min, 2)
  close(max, 5, 'the knob value never shows through a keyframed lane')
})

test('bounds: an empty lane is the base value alone', () => {
  assert.deepEqual(automationLaneValueBounds(keyframeLane([]), 7), { min: 7, max: 7 })
})

test('bounds: a burst lane spans the base and every target', () => {
  const lane: AutomationLane = {
    mode: 'linear',
    keyframes: [],
    burst: BURST,
    bursts: [burst(0, 1, 10), burst(4, 1, 1)],
    min: 0,
    max: 10,
  }
  // Base shows through between bursts, so it bounds both ends.
  assert.deepEqual(automationLaneValueBounds(lane, 3), { min: 1, max: 10 })
  assert.deepEqual(automationLaneValueBounds(lane, 12), { min: 1, max: 12 })
})

test('bounds: a noise lane spans each gate\'s deviation, clamped to the param range', () => {
  const lane: AutomationLane = {
    mode: 'linear',
    keyframes: [],
    noise: { rate: 4, smoothness: 0.5, range: 0.5, seed: 1 },
    gates: [{ beat: 0, endBeat: 4, center: 9, amp: 1 }],
    min: 0,
    max: 10,
  }
  // deviation = (10-0) * 0.5 * 1 * 0.5 = 2.5 → [6.5, 11.5] clamped to 11.5→10.
  const { min, max } = automationLaneValueBounds(lane, 8)
  close(min, 6.5)
  close(max, 10)
})

// ── Shaped bursts ────────────────────────────────────────────────────────────

test('adsr shape absent: sampleBurstLane behaves exactly as it always did', () => {
  const gates = [burst(0, 1, 10)]
  // Mid-attack of the classic envelope; the shaped machinery must not change it.
  const value = sampleBurstLane(BURST, gates, 0.025, 0)
  const gain = 0.025 / BURST.attackBeats
  close(value, 10 * Math.min(1, gain) * BURST.intensity)
})

test('bezier shape: expo-out default front-loads; a hot Y overshoots the target', () => {
  const cfg: BurstConfig = { ...BURST, shape: 'bezier', bezier: { ...DEFAULT_BURST_BEZIER } }
  const gates = [burst(0, 1, 10)]
  // Most of the rise lands early (expo-out): halfway through riseBeats ≥ 80%.
  const early = sampleBurstLane(cfg, gates, DEFAULT_BURST_BEZIER.riseBeats / 2, 0)
  assert.ok(early > 8, `expo-out should front-load, saw ${early}`)
  // Held past the rise: parked exactly at the target.
  close(sampleBurstLane(cfg, gates, 0.5, 0), 10)
  // Fully fallen: inert.
  assert.ok(Number.isNaN(sampleBurstLane(cfg, gates, 1 + DEFAULT_BURST_BEZIER.fallBeats + 0.01, 0)))

  // Y past 1 overshoots: the value passes the target mid-rise.
  const hot: BurstConfig = { ...cfg, bezier: { ...DEFAULT_BURST_BEZIER, y1: 1.6, y2: 1.2 } }
  let peak = -Infinity
  for (let b = 0; b <= 1; b += 0.005) {
    const v = sampleBurstLane(hot, [burst(0, 1, 10)], b, 0)
    if (!Number.isNaN(v)) peak = Math.max(peak, v)
  }
  assert.ok(peak > 10.5, `hot bezier should overshoot 10, saw ${peak}`)
})

test('spring shape: rings past the target, settles on it, releases to inert', () => {
  const cfg: BurstConfig = { ...BURST, shape: 'spring', spring: { ...DEFAULT_BURST_SPRING } }
  const gates = [burst(0, 2, 10)]
  let peak = -Infinity
  for (let b = 0; b <= 2; b += 0.005) {
    const v = sampleBurstLane(cfg, gates, b, 0)
    if (!Number.isNaN(v)) peak = Math.max(peak, v)
  }
  assert.ok(peak > 10.2, `spring should ring past the target, saw ${peak}`)
  // Long-held: settled on the target (within the ring's dying residue).
  assert.ok(Math.abs(sampleBurstLane(cfg, gates, 1.9, 0) - 10) < 1e-3)
  // Well after release: the gate has died and the lane is inert.
  assert.ok(Number.isNaN(sampleBurstLane(cfg, gates, 30, 0)))
})

test('bounds: shaped bursts include the overshoot reach, clamped to the range', () => {
  const lane: AutomationLane = {
    mode: 'linear',
    keyframes: [],
    burst: { ...BURST, shape: 'spring', spring: { ...DEFAULT_BURST_SPRING } },
    bursts: [burst(0, 1, 8)],
    min: 0,
    max: 10,
  }
  // Reach = 2 + 2*(8-2) = 14, clamped to the param max of 10.
  assert.deepEqual(automationLaneValueBounds(lane, 2), { min: 2, max: 10 })
})

// ── Per-lane row spread (automationRange) ────────────────────────────────────

test('pitchToValueRanged: absent config is the frozen historical mapping', () => {
  for (const pitch of [36, 50, 84, 20, 99]) {
    close(pitchToValueRanged(undefined, pitch, 0, 10), pitchToValue(pitch, 0, 10))
  }
})

test('ranged mapping: sub-range, row count, integer snap, spread curve', () => {
  // Sub-range: rows span 2..6 of a 0..10 param.
  close(pitchToValueRanged({ min: 2, max: 6 }, 36, 0, 10), 2)
  close(pitchToValueRanged({ min: 2, max: 6 }, 84, 0, 10), 6)

  // Row count: 5 rows sit at pitches 36..40; the top row IS the max, and
  // anything above clamps to it.
  const rows5 = { rows: 5 }
  close(pitchToValueRanged(rows5, 36, 0, 8), 0)
  close(pitchToValueRanged(rows5, 40, 0, 8), 8)
  close(pitchToValueRanged(rows5, 38, 0, 8), 4)
  close(pitchToValueRanged(rows5, 70, 0, 8), 8)

  // Integer + rows: one row per whole value.
  const ints = { rows: 5, integer: true, min: 2, max: 6 }
  assert.deepEqual([36, 37, 38, 39, 40].map((p) => pitchToValueRanged(ints, p, 0, 10)), [2, 3, 4, 5, 6])

  // fineLow: the middle row sits BELOW the linear middle (finer near the min).
  const mid = pitchToValueRanged({ curve: 'fineLow' }, 60, 0, 10)
  assert.ok(mid < 5, `fineLow midpoint should sit low, saw ${mid}`)
  close(pitchToValueRanged({ curve: 'fineLow' }, 84, 0, 10), 10) // still arrives

  // Extraction threads the config: a top-of-5-rows note lands on the max.
  const kfs = extractKeyframes(pitchBlock(40), 4, 0, 8, undefined, 1, rows5)
  close(kfs[0].value, 8)
})

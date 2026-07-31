import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import {
  PULSE_EVEN,
  PULSE_SNAP,
  PULSE_SQUASH_PITCH,
  PULSE_SWELL_PITCH,
  PULSE_TAIL,
  evaluateImpactPulse,
  impactPulseMover,
  impactPulseScale,
  pulseFalloff,
  type ImpactPulseSettings,
} from './impactPulse'
import { identityVisualCopy } from './identityVisualCopy'

const defaults: ImpactPulseSettings = {
  hit: 0.5,
  decayBeats: 1,
  stretch: 0,
  rollBeats: 0,
  falloff: PULSE_EVEN,
}

function note(beat: number, pitch: number, velocity = 1, durationBeats = 0.25): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 1024 }
}

function close(actual: number, expected: number, epsilon = 1e-10): void {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`)
}

function scaleOf(transform: Matrix4): Vector3 {
  return new Vector3().setFromMatrixScale(transform)
}

test('a hit peaks on its onset frame and decays to nothing over DECAY beats', () => {
  const notes = [note(2, PULSE_SWELL_PITCH)]
  assert.equal(evaluateImpactPulse(notes, defaults, 1.99), 0)
  assert.equal(evaluateImpactPulse(notes, defaults, 2), 1)
  close(evaluateImpactPulse(notes, defaults, 2.25), 0.75)
  assert.equal(evaluateImpactPulse(notes, defaults, 3), 0)
  assert.equal(evaluateImpactPulse(notes, defaults, 9), 0)
})

test('note length is ignored - a whole note hits exactly like a sixteenth', () => {
  const short = evaluateImpactPulse([note(0, PULSE_SWELL_PITCH, 1, 0.0625)], defaults, 0.5)
  const long = evaluateImpactPulse([note(0, PULSE_SWELL_PITCH, 1, 8)], defaults, 0.5)
  assert.equal(short, long)
  close(short, 0.5)
})

test('velocity scales the hit, and 0-127 velocities normalize like 0-1 ones', () => {
  close(evaluateImpactPulse([note(0, PULSE_SWELL_PITCH, 0.4)], defaults, 0), 0.4)
  close(evaluateImpactPulse([note(0, PULSE_SWELL_PITCH, 127)], defaults, 0), 1)
  close(evaluateImpactPulse([note(0, PULSE_SWELL_PITCH, 64)], defaults, 0), 64 / 127)
})

test('stacked hits on one row take the loudest, and the two rows oppose', () => {
  const stacked = [note(0, PULSE_SWELL_PITCH, 0.3), note(0, PULSE_SWELL_PITCH, 0.8)]
  close(evaluateImpactPulse(stacked, defaults, 0), 0.8)

  const both = [note(0, PULSE_SWELL_PITCH, 1), note(0, PULSE_SQUASH_PITCH, 1)]
  assert.equal(evaluateImpactPulse(both, defaults, 0), 0)

  const squashOnly = [note(0, PULSE_SQUASH_PITCH, 1)]
  assert.equal(evaluateImpactPulse(squashOnly, defaults, 0), -1)
})

test('swell and squash are exact reciprocals in size, so neither can cross zero', () => {
  const swell = impactPulseScale(1, 0.5, 0)
  const squash = impactPulseScale(-1, 0.5, 0)
  close(swell[1], 1.5)
  close(squash[1], 1 / 1.5)
  for (let i = 0; i < 3; i++) close(swell[i] * squash[i], 1)

  // Even a full squash at maximum HIT stays positive - no inverted winding.
  assert.ok(impactPulseScale(-1, 1, 1)[1] > 0)
  assert.ok(impactPulseScale(-1, 1, 1)[0] > 0)
})

test('STRETCH trades size for shape: at 1 the pulse is volume preserving', () => {
  const [x, y, z] = impactPulseScale(1, 0.5, 1)
  assert.ok(y > 1, 'stretch swells upward')
  assert.ok(x < 1, 'and narrows across')
  close(x * y * z, 1, 1e-12)

  // Half way, the object grows only upward.
  const half = impactPulseScale(1, 0.5, 0.5)
  close(half[0], 1)
  close(half[2], 1)
  assert.ok(half[1] > 1)

  // A squash note comes out short and wide from the same expression.
  const squashed = impactPulseScale(-1, 0.5, 1)
  assert.ok(squashed[1] < 1 && squashed[0] > 1)
})

test('HIT at zero makes the mover an exact no-op', () => {
  assert.deepEqual(impactPulseScale(1, 0, 1), [1, 1, 1])
  const resolved = impactPulseMover.resolve({
    settings: { ...defaults, hit: 0 },
    notes: [note(0, PULSE_SWELL_PITCH)],
  })
  const out = resolved.apply(identityVisualCopy(), { beat: 0, index: 0, count: 1 })
  assert.deepEqual(out[0].transform.elements, new Matrix4().elements)
})

test('the falloff curves all run 1 -> 0 and only SNAP drops off a cliff', () => {
  for (const falloff of [PULSE_SNAP, PULSE_EVEN, PULSE_TAIL]) {
    assert.equal(pulseFalloff(1, falloff), 1)
    assert.equal(pulseFalloff(0, falloff), 0)
  }
  // At the halfway point: SNAP is already mostly gone, TAIL is still most of
  // the way up, EVEN is exactly half.
  assert.ok(pulseFalloff(0.5, PULSE_SNAP) < pulseFalloff(0.5, PULSE_EVEN))
  assert.ok(pulseFalloff(0.5, PULSE_TAIL) > pulseFalloff(0.5, PULSE_EVEN))
  close(pulseFalloff(0.5, PULSE_EVEN), 0.5)
})

test('ROLL delays the hit by one step per upstream copy index', () => {
  const settings = { ...defaults, rollBeats: 0.1 }
  const notes = [note(0, PULSE_SWELL_PITCH)]
  close(evaluateImpactPulse(notes, settings, 0, 0), 1)
  assert.equal(evaluateImpactPulse(notes, settings, 0, 1), 0)
  close(evaluateImpactPulse(notes, settings, 0.1, 1), 1)
  close(evaluateImpactPulse(notes, settings, 0.2, 2), 1)
})

test('composition is LOCAL, so a placed copy pulses in place rather than toward the origin', () => {
  const resolved = impactPulseMover.resolve({
    settings: defaults,
    notes: [note(0, PULSE_SWELL_PITCH)],
  })
  const placed = {
    ...identityVisualCopy(),
    transform: new Matrix4().makeTranslation(4, 0, 0),
  }
  const out = resolved.apply(placed, { beat: 0, index: 0, count: 1 })
  const position = new Vector3().setFromMatrixPosition(out[0].transform)
  close(position.x, 4, 1e-12)
  close(scaleOf(out[0].transform).y, 1.5, 1e-12)
})

test('the stretch axis is the COPY\'s local up, not the world\'s', () => {
  const resolved = impactPulseMover.resolve({
    settings: { ...defaults, stretch: 1 },
    notes: [note(0, PULSE_SWELL_PITCH)],
  })
  // A copy rolled a quarter turn about Z: its local +Y points along world -X.
  const rolled = {
    ...identityVisualCopy(),
    transform: new Matrix4().makeRotationZ(Math.PI / 2),
  }
  const out = resolved.apply(rolled, { beat: 0, index: 0, count: 1 })
  const worldUp = new Vector3(0, 1, 0).applyMatrix4(out[0].transform)
  const worldRight = new Vector3(1, 0, 0).applyMatrix4(out[0].transform)
  // The stretched axis followed the rotation: the long one now lies along X.
  assert.ok(Math.abs(worldUp.x) > 1, 'local up stretched, and points along world X')
  assert.ok(Math.abs(worldRight.y) < 1, 'local right narrowed')
})

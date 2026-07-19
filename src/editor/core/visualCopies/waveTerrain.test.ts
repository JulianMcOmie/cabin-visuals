import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import { getMoverOrSplitterDefinition } from './registry'
import { resolveVisualCopies } from './resolveVisualCopies'
import type { VisualCopy } from './types'
import {
  WAVE_TERRAIN_AMP_DOWN_PITCH,
  WAVE_TERRAIN_AMP_UP_PITCH,
  evaluateWaveAmplitude,
  evaluateWaveHeight,
  waveTerrainMover,
  type WaveTerrainSettings,
} from './waveTerrain'

function note(beat: number, pitch: number, durationBeats = 1, velocity = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 1024 }
}

function settings(overrides: Partial<WaveTerrainSettings> = {}): WaveTerrainSettings {
  return {
    ...mergeDefinitionSettings(waveTerrainMover, undefined),
    ...overrides,
  } as unknown as WaveTerrainSettings
}

function copyAt(x: number, y: number, z: number): VisualCopy {
  const copy = identityVisualCopy()
  copy.transform.makeTranslation(x, y, z)
  return copy
}

function positionOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const round = (value: number) => Math.round(value * 1e9) / 1e9 || 0
  return [round(e[12]), round(e[13]), round(e[14])]
}

function apply(input: VisualCopy, p: WaveTerrainSettings, notes: ResolvedNote[], beat: number): VisualCopy {
  return waveTerrainMover.resolve({ settings: p, notes }).apply(input, { beat, index: 0, count: 1 })[0]
}

const SQRT_HALF = Math.SQRT1_2
/** Linear easing index in BURST_EASINGS (deterministic mid-burst values). */
const LINEAR = 5

test('wave terrain is registered as a strict two-row mover', () => {
  const definition = getMoverOrSplitterDefinition('waveTerrain')
  assert.equal(definition?.kind, 'mover')
  assert.equal(definition?.label, 'Wave Terrain')
  assert.equal(definition?.strictMidiRows, true)
  assert.deepEqual(definition!.midiRows!(settings()), [
    { pitch: WAVE_TERRAIN_AMP_UP_PITCH, label: 'Amplitude up' },
    { pitch: WAVE_TERRAIN_AMP_DOWN_PITCH, label: 'Amplitude down' },
  ])
})

test('ripple: crest sits a quarter wavelength from the center and offsets z only', () => {
  // Default wavelength 8, amplitude 1: at beat 0 the phase is k*r, so r = 2
  // gives sin(pi/2) = 1. The copy rides one unit up, x/y untouched.
  const input = copyAt(2, 0, 5)
  const output = apply(input, settings({ cyclesPerBeat: 0 }), [], 0)
  assert.deepEqual(positionOf(output), [2, 0, 6])
  assert.deepEqual(positionOf(input), [2, 0, 5], 'input copy is not mutated')
})

test('ripple: rings travel outward one wavelength per cycle', () => {
  const p = settings({ cyclesPerBeat: 1 })
  // At beat 0.25 the wave has advanced a quarter cycle: the crest that was at
  // r = 2 has moved to r = 4.
  assert.equal(evaluateWaveHeight([], p, 4, 0, 0.25), 1)
  assert.equal(evaluateWaveHeight([], p, 2, 0, 0), 1)
})

test('plane: height is constant across the wavefront and respects direction', () => {
  const p = settings({ shape: 1, cyclesPerBeat: 0 })
  // Direction 0 travels along +X, so y does not matter.
  assert.equal(evaluateWaveHeight([], p, 2, 7, 0), 1)
  assert.equal(evaluateWaveHeight([], p, 2, -3, 0), 1)
  // Direction 90 travels along +Y: the crest now lives on the y axis.
  const rotated = settings({ shape: 1, cyclesPerBeat: 0, directionDeg: 90 })
  assert.equal(evaluateWaveHeight([], rotated, -11, 2, 0), 1)
})

test('standing: nodes never move and the membrane breathes in place', () => {
  const p = settings({ shape: 2, cyclesPerBeat: 1 })
  // dx = 0 is a nodal line at every beat (the +0 flattens a signed -0).
  assert.equal(evaluateWaveHeight([], p, 0, 2, 0), 0)
  assert.equal(evaluateWaveHeight([], p, 0, 2, 3.7) + 0, 0)
  // An antinode flips sign half a cycle later instead of traveling.
  assert.equal(evaluateWaveHeight([], p, 2, 2, 0), 1)
  assert.equal(evaluateWaveHeight([], p, 2, 2, 0.5), -1)
})

test('interference: symmetric sources mirror the field and match ripple on the bisector', () => {
  const p = settings({ shape: 3, cyclesPerBeat: 0, separation: 8 })
  assert.equal(evaluateWaveHeight([], p, -2, 3, 0), evaluateWaveHeight([], p, 2, 3, 0))
  // On the perpendicular bisector both distances are equal, so the average of
  // the two sources is exactly the single-source ripple at that distance.
  const ripple = settings({ shape: 0, cyclesPerBeat: 0 })
  assert.equal(evaluateWaveHeight([], p, 0, 3, 0), evaluateWaveHeight([], ripple, 4, 3, 0))
})

test('swirl: the displacement is identical all the way around any ring', () => {
  const p = settings({ shape: 4, cyclesPerBeat: 0.5, twist: 2 })
  for (const beat of [0, 1.3, 7.25]) {
    const a = evaluateWaveHeight([], p, 3, 4, beat)
    assert.equal(evaluateWaveHeight([], p, 0, 5, beat), a, 'rotated 90°')
    assert.equal(evaluateWaveHeight([], p, -3, -4, beat), a, 'rotated 180°')
    assert.equal(evaluateWaveHeight([], p, 4, -3, beat), a, 'reflected, same radius')
  }
})

test('swirl: twist 0 reproduces the ripple; nonzero twist reshapes the rings', () => {
  const swirlOff = settings({ shape: 4, cyclesPerBeat: 1, twist: 0 })
  const ripple = settings({ shape: 0, cyclesPerBeat: 1 })
  assert.equal(evaluateWaveHeight([], swirlOff, 6, 0, 1.3), evaluateWaveHeight([], ripple, 6, 0, 1.3))

  const swirled = settings({ shape: 4, cyclesPerBeat: 0, twist: 2 })
  // At r = 8 (one full wavelength) the ripple is back at sin(2pi) ~ 0, but the
  // twist has wound the phase on by 2 * 2pi * ln(2), so the ring is lifted.
  assert.notEqual(evaluateWaveHeight([], swirled, 8, 0, 0), evaluateWaveHeight([], ripple, 8, 0, 0))
})

test('falloff length damps distant copies while the center keeps full height', () => {
  const p = settings({ cyclesPerBeat: 0, damping: 2 })
  assert.equal(evaluateWaveHeight([], p, 2, 0, 0), 0.5)
  assert.equal(evaluateWaveHeight([], p, 6, 0, 0), 1 / (1 + 6 / 2) * Math.sin((Math.PI * 2 * 6) / 8))
})

test('amplitude notes step the surface up with a burst ease-out and persist', () => {
  const p = settings({ amplitude: 1, amount: 0.5, burstBeats: 2, easing: LINEAR, sharpness: 1 })
  const up = [note(1, WAVE_TERRAIN_AMP_UP_PITCH)]
  assert.equal(evaluateWaveAmplitude([], p, 10), 1, 'base amplitude without notes')
  assert.equal(evaluateWaveAmplitude(up, p, 1), 1, 'nothing at the exact note beat')
  assert.equal(evaluateWaveAmplitude(up, p, 2), 1.25, 'halfway through a linear burst')
  assert.equal(evaluateWaveAmplitude(up, p, 10), 1.5, 'landed steps never decay')
})

test('amplitude steps accumulate, cancel, and scale with velocity', () => {
  const p = settings({ amplitude: 1, amount: 0.5, burstBeats: 2, easing: LINEAR, sharpness: 1 })
  const ups = [note(1, WAVE_TERRAIN_AMP_UP_PITCH), note(3, WAVE_TERRAIN_AMP_UP_PITCH)]
  assert.equal(evaluateWaveAmplitude(ups, p, 10), 2, 'two Up notes walk the surface up twice')
  const thereAndBack = [note(1, WAVE_TERRAIN_AMP_UP_PITCH), note(5, WAVE_TERRAIN_AMP_DOWN_PITCH)]
  assert.equal(evaluateWaveAmplitude(thereAndBack, p, 10), 1, 'a Down step cancels an Up step')
  assert.equal(evaluateWaveAmplitude([note(1, WAVE_TERRAIN_AMP_UP_PITCH, 1, 0.5)], p, 10), 1.25)
  // A net-negative amplitude is allowed: it inverts the surface.
  assert.equal(evaluateWaveAmplitude([note(1, WAVE_TERRAIN_AMP_DOWN_PITCH), note(2, WAVE_TERRAIN_AMP_DOWN_PITCH), note(3, WAVE_TERRAIN_AMP_DOWN_PITCH), note(4, WAVE_TERRAIN_AMP_DOWN_PITCH)], p, 10), -1)
})

test('amplitude rows ignore unknown pitches and future notes', () => {
  const p = settings({ amplitude: 1, amount: 0.5, burstBeats: 2 })
  assert.equal(evaluateWaveAmplitude([note(0, 30), note(5, WAVE_TERRAIN_AMP_UP_PITCH)], p, 4), 1)
})

test('a landed note raises the wave crest a zeroed surface could not reach', () => {
  // Crest point with a static wave: ambient is 1, so the height reads the
  // amplitude directly. Base amplitude 0 + one landed Up note = amount.
  const p = settings({ amplitude: 0, amount: 0.5, cyclesPerBeat: 0 })
  const up = [note(0, WAVE_TERRAIN_AMP_UP_PITCH)]
  assert.equal(evaluateWaveHeight(up, p, 2, 0, 10), 0.5)
})

test('runtime placement makes copies ride the wave at their actual position', () => {
  const mover = waveTerrainMover.resolve({ settings: settings({ cyclesPerBeat: 0 }), notes: [] })
  const placement = new Matrix4().makeTranslation(3, 0, 0)
  const output = resolveVisualCopies([mover], 0, placement)[0]
  const rendered = placement.clone().multiply(output.transform)
  // World x = 3: sin(2pi*3/8) = sin(3pi/4) = sqrt(2)/2 (rounded by positionOf).
  assert.deepEqual(positionOf({ ...output, transform: rendered }), [3, 0, Math.round(SQRT_HALF * 1e9) / 1e9])
})

test('displacement uses world z and preserves appearance', () => {
  const input = identityVisualCopy()
  input.transform = new Matrix4().makeRotationX(Math.PI / 2)
    .multiply(new Matrix4().makeTranslation(2, 0, 0))
  input.opacity = 0.4
  input.colorShift.hue = 0.2

  // The copy sits at (2, 0, 0) - a ripple crest - but its local z points along
  // world -Y. World composition lifts it to (2, 0, 1); local composition would
  // wrongly slide it to (2, -1, 0).
  const output = apply(input, settings({ cyclesPerBeat: 0 }), [], 0)
  assert.deepEqual(positionOf(output), [2, 0, 1])
  assert.equal(output.opacity, 0.4)
  assert.equal(output.colorShift.hue, 0.2)
})

test('zero amplitude preserves the copy bit-for-bit', () => {
  const input = copyAt(2, 0, 0)
  input.transform.multiply(new Matrix4().makeRotationZ(0.7))
  const output = apply(input, settings({ amplitude: 0 }), [], 1)
  assert.deepEqual([...output.transform.elements], [...input.transform.elements])
})

test('evaluation is pure when scrubbing between beats', () => {
  const resolved = waveTerrainMover.resolve({
    settings: settings(),
    notes: [note(1, WAVE_TERRAIN_AMP_UP_PITCH, 4, 0.7), note(2, WAVE_TERRAIN_AMP_DOWN_PITCH, 1, 0.3)],
  })
  const at = (beat: number) => positionOf(resolved.apply(copyAt(2, 1, 0), { beat, index: 0, count: 1 })[0])
  const first = at(2.35)
  at(0)
  at(100)
  assert.deepEqual(at(2.35), first)
})

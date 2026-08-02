// The unified Mover's one non-negotiable claim: each of the six cells it
// inherited behaves EXACTLY like the definition it retired - same notes, same
// settings, same matrices - because UPGRADES[12] rewrites saved projects onto
// it and "upgraded" must never mean "changed". Parity is pinned per cell
// against the retired definition objects, which stay exported for this reason.
// The three genuinely new cells (translate-constant, rotate-oscillate,
// orbit-oscillate) get behavioural tests instead.

import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { identityVisualCopy } from './identityVisualCopy'
import { mergeDefinitionSettings, type MoverOrSplitterDefinition } from './definitions'
import { burstMover } from './library'
import { translationOscillatorMover } from './translationOscillator'
import {
  constantOrbitMover,
  constantRotateMover,
  orbitBurstMover,
  rotateBurstMover,
} from './rotationMovers'
import {
  MOVER_MODE_BURST,
  MOVER_MODE_CONSTANT,
  MOVER_MODE_OSCILLATE,
  MOVER_MOTION_ORBIT,
  MOVER_MOTION_ROTATE,
  MOVER_MOTION_TRANSLATE,
  evaluateMoverTranslation,
  moverDefinition,
  moverMidiRows,
  type MoverSettings,
} from './mover'
import { getMoverOrSplitterDefinition } from './registry'
import type { VisualCopy } from './types'

function note(beat: number, pitch: number, velocity = 1, durationBeats = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity, durationBeats }
}

// A phrase that exercises every axis row, both signs, raw-127 and normalized
// velocities, overlapping holds, and the Return row.
const PHRASE: ResolvedNote[] = [
  note(0, 60, 1, 0.5),
  note(0.5, 62, 100, 2),
  note(1, 65, 0.6, 1.5),
  note(1.5, 61, 90, 0.25),
  note(2, 63, 1, 3),
  note(2.5, 64, 0.8, 1),
  note(4, 66, 1, 2),
  note(5.5, 60, 110, 1),
]

const BEATS = [0, 0.25, 0.9, 1.5, 2.4, 3.1, 4.2, 5, 6.5, 9.01]

function moverSettings(overrides: Partial<MoverSettings>): MoverSettings {
  return {
    ...(mergeDefinitionSettings(moverDefinition, undefined) as unknown as MoverSettings),
    ...overrides,
  }
}

function seededCopy(): VisualCopy {
  const copy = identityVisualCopy()
  // A non-trivial incoming transform, so pre- vs post-multiplication mistakes
  // cannot cancel out (they do at identity).
  copy.transform.makeRotationZ(0.4).setPosition(1.2, -0.7, 0.5)
  return copy
}

function applyAt(def: MoverOrSplitterDefinition<any>, settings: unknown, notes: ResolvedNote[], beat: number): Matrix4 {
  const chain = def.resolve({ settings: settings as any, notes })
  return chain.apply(seededCopy(), { beat, index: 0, count: 1 })[0].transform
}

function assertMatrixClose(actual: Matrix4, expected: Matrix4, context: string) {
  for (let i = 0; i < 16; i++) {
    assert.ok(
      Math.abs(actual.elements[i] - expected.elements[i]) < 1e-9,
      `${context}: element ${i} differs (${actual.elements[i]} vs ${expected.elements[i]})`,
    )
  }
}

function assertParity(
  cell: string,
  retired: MoverOrSplitterDefinition<any>,
  retiredSettings: Record<string, number>,
  unified: MoverSettings,
  notes: ResolvedNote[] = PHRASE,
) {
  const merged = mergeDefinitionSettings(retired, retiredSettings)
  for (const beat of BEATS) {
    assertMatrixClose(
      applyAt(moverDefinition, unified, notes, beat),
      applyAt(retired, merged, notes, beat),
      `${cell} at beat ${beat}`,
    )
  }
}

// A skewed (but valid) basis, to prove the basis plumbing matches where the
// retired definition had one.
const BASIS = { basisXX: 0.8, basisXY: 0.2, basisXZ: 0, basisYX: -0.3, basisYY: 0.9, basisYZ: 0.1, basisZX: 0.1, basisZY: 0, basisZZ: 1 }

test('registration: mover is in, the six retired ids are out', () => {
  assert.equal(getMoverOrSplitterDefinition('mover'), moverDefinition)
  for (const id of ['burst', 'rotateBurst', 'orbitBurst', 'constantRotate', 'constantOrbit', 'translationOscillator']) {
    assert.equal(getMoverOrSplitterDefinition(id), undefined, `${id} must stay retired`)
  }
})

test('parity: translate-burst matches the retired Burst', () => {
  const shared = { burstBeats: 0.8, easing: 3, sharpness: 1.7, distanceX: 2, distanceY: 0.5, distanceZ: 3, distance: 1.4 }
  assertParity('translate-burst', burstMover, shared, moverSettings({
    motion: MOVER_MOTION_TRANSLATE, mode: MOVER_MODE_BURST, ...shared,
  }))
})

test('parity: translate-burst with a return-family easing', () => {
  const shared = { burstBeats: 1.2, easing: 8, sharpness: 0.6, distanceX: 1, distanceY: 2, distanceZ: 0.4, distance: 1 }
  assertParity('translate-burst/return-easing', burstMover, shared, moverSettings({
    motion: MOVER_MOTION_TRANSLATE, mode: MOVER_MODE_BURST, ...shared,
  }))
})

test('parity: translate-oscillate matches the retired Translation Oscillator', () => {
  const shared = { distanceX: 1.5, distanceY: 0.7, distanceZ: 2.2, distance: 1.3, cyclesPerBeat: 1.5, returnBeats: 0.6, ...BASIS }
  assertParity('translate-oscillate', translationOscillatorMover, shared, moverSettings({
    motion: MOVER_MOTION_TRANSLATE, mode: MOVER_MODE_OSCILLATE, ...shared,
  }))
})

test('parity: rotate-burst matches the retired Rotate Burst', () => {
  // Easing indices 0-5 are the same curves in both tables (the retired def
  // read ROTATION_EASINGS; the unified cell reads the shared BURST table).
  for (const easing of [0, 3, 5]) {
    const shared = { burstBeats: 0.9, easing, sharpness: 1.4, angleX: 120, angleY: 45, angleZ: 300, angle: 1.2, ...BASIS }
    assertParity(`rotate-burst/easing-${easing}`, rotateBurstMover, shared, moverSettings({
      motion: MOVER_MOTION_ROTATE, mode: MOVER_MODE_BURST, ...shared,
    }))
  }
})

test('parity: orbit-burst matches the retired Orbit Burst', () => {
  const shared = {
    burstBeats: 0.9, easing: 1, sharpness: 1.4, angleX: 120, angleY: 45, angleZ: 300, angle: 1.2,
    pivotX: 1.5, pivotY: -2, pivotZ: 0.5, ...BASIS,
  }
  assertParity('orbit-burst', orbitBurstMover, shared, moverSettings({
    motion: MOVER_MOTION_ORBIT, mode: MOVER_MODE_BURST, ...shared,
  }))
})

test('parity: rotate-constant matches the retired Constant Rotate (speed keys renamed)', () => {
  const retired = { speedX: 120, speedY: 45, speedZ: 300, speed: 1.2, returnBeats: 0.7, ...BASIS }
  assertParity('rotate-constant', constantRotateMover, retired, moverSettings({
    motion: MOVER_MOTION_ROTATE, mode: MOVER_MODE_CONSTANT,
    angleX: 120, angleY: 45, angleZ: 300, angle: 1.2, returnBeats: 0.7, ...BASIS,
  }))
})

test('parity: orbit-constant matches the retired Constant Orbit', () => {
  const retired = {
    speedX: 120, speedY: 45, speedZ: 300, speed: 1.2, returnBeats: 0.7,
    pivotX: 1.5, pivotY: -2, pivotZ: 0.5, ...BASIS,
  }
  assertParity('orbit-constant', constantOrbitMover, retired, moverSettings({
    motion: MOVER_MOTION_ORBIT, mode: MOVER_MODE_CONSTANT,
    angleX: 120, angleY: 45, angleZ: 300, angle: 1.2, returnBeats: 0.7,
    pivotX: 1.5, pivotY: -2, pivotZ: 0.5, ...BASIS,
  }))
})

// ── The new cells ────────────────────────────────────────────────────────────

test('translate-constant: note-gated drift, kept on release, no baseline', () => {
  const settings = moverSettings({
    motion: MOVER_MOTION_TRANSLATE, mode: MOVER_MODE_CONSTANT,
    distanceX: 3, distanceY: 1, distanceZ: 1, distance: 1,
  })
  // Empty lane: parked, at any beat (unlike rotate-constant's baseline spin).
  assert.deepEqual(evaluateMoverTranslation([], settings, 7.3), [0, 0, 0])
  const held = [note(0, 60, 1, 2)]
  assert.deepEqual(evaluateMoverTranslation(held, settings, 1), [3, 0, 0])
  // Travel is KEPT once the hold ends.
  assert.deepEqual(evaluateMoverTranslation(held, settings, 5), [6, 0, 0])
  // A held Return eases the standing travel home.
  const returned = [...held, note(3, 66, 1, 2)]
  const [homeX] = evaluateMoverTranslation(returned, settings, 4.5)
  assert.ok(Math.abs(homeX) < 1e-9, `expected home after return, got ${homeX}`)
})

test('rotate-oscillate: held note swings and comes home, silent after release', () => {
  const settings = moverSettings({
    motion: MOVER_MOTION_ROTATE, mode: MOVER_MODE_OSCILLATE,
    angleX: 90, angleY: 90, angleZ: 90, angle: 1, cyclesPerBeat: 0.5,
  })
  const notes = [note(0, 60, 1, 4)]
  const seeded = seededCopy().transform

  // Half a cycle in (beat 1 at 0.5 cycles/beat): the full 90-degree swing
  // about basis X, composed LOCALLY (previous * rotation keeps the position).
  const peak = applyAt(moverDefinition, settings, notes, 1)
  const expected = seeded.clone().multiply(new Matrix4().makeRotationX(Math.PI / 2))
  assertMatrixClose(peak, expected, 'rotate-oscillate peak')

  // Full cycle (beat 2): back to rest. After release (beat 5): silent.
  assertMatrixClose(applyAt(moverDefinition, settings, notes, 2), seeded, 'rotate-oscillate full cycle')
  assertMatrixClose(applyAt(moverDefinition, settings, notes, 5), seeded, 'rotate-oscillate after release')
})

test('orbit-oscillate: pre-multiplies, so copies genuinely circle the pivot', () => {
  const settings = moverSettings({
    motion: MOVER_MOTION_ORBIT, mode: MOVER_MODE_OSCILLATE,
    angleX: 90, angleY: 90, angleZ: 90, angle: 1, cyclesPerBeat: 0.5,
    pivotX: 0, pivotY: 0, pivotZ: 0,
  })
  // Swing about +Z (pitch 64), peak at beat 1: a copy parked at (1.2, -0.7)
  // must MOVE around the origin, not just turn in place.
  const notes = [note(0, 64, 1, 4)]
  const seeded = seededCopy().transform
  const expected = new Matrix4().makeRotationZ(Math.PI / 2).multiply(seeded.clone())
  assertMatrixClose(applyAt(moverDefinition, settings, notes, 1), expected, 'orbit-oscillate peak')
})

// ── The concise MIDI vocabulary ──────────────────────────────────────────────

test('midiRows: six frozen pitches, Return only where a note can mean it', () => {
  const base = mergeDefinitionSettings(moverDefinition, undefined) as unknown as MoverSettings

  const burstRows = moverMidiRows({ ...base, motion: MOVER_MOTION_TRANSLATE, mode: MOVER_MODE_BURST })
  assert.deepEqual(burstRows.map((r) => r.pitch), [62, 63, 60, 61, 64, 65])

  for (const mode of [MOVER_MODE_CONSTANT, MOVER_MODE_OSCILLATE]) {
    const rows = moverMidiRows({ ...base, motion: MOVER_MOTION_TRANSLATE, mode })
    assert.deepEqual(rows.map((r) => r.pitch), [62, 63, 60, 61, 64, 65, 66])
    assert.equal(rows[6].label, 'Return')
  }

  // Translate speaks directions, rotate/orbit speak the turn's axis.
  assert.equal(burstRows[0].label, 'Up')
  const orbitRows = moverMidiRows({ ...base, motion: MOVER_MOTION_ORBIT, mode: MOVER_MODE_CONSTANT })
  assert.equal(orbitRows[0].label, '+Y')

  assert.equal(moverDefinition.strictMidiRows, true)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import {
  MOTION_BLOCKS,
  evaluateDriftOffset,
  evaluateMotionTranslation,
  evaluateSnapAngles,
  motionBlockNotes,
  motionMover,
  wrapToBound,
  type MotionSettings,
} from './motion'
import { getMoverOrSplitterDefinition } from './registry'
import { resolveVisualCopies } from './resolveVisualCopies'
import type { VisualCopy } from './types'

const DEFAULTS = mergeDefinitionSettings(motionMover, undefined) as unknown as MotionSettings

function settings(overrides: Partial<MotionSettings> = {}): MotionSettings {
  return { ...DEFAULTS, ...overrides }
}

function note(beat: number, pitch: number, durationBeats = 1, velocity = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity, durationBeats }
}

function applyAt(config: MotionSettings, notes: ResolvedNote[], beat: number): VisualCopy {
  return resolveVisualCopies([motionMover.resolve({ settings: config, notes })], beat)[0]
}

function positionOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const r = (n: number) => Math.round(n * 1e9) / 1e9 || 0
  return [r(e[12]), r(e[13]), r(e[14])]
}

/** The copy's local +X axis, which shows what the rotation blocks did. */
function localX(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const r = (n: number) => Math.round(n * 1e6) / 1e6 || 0
  return [r(e[0]), r(e[1]), r(e[2])]
}

const NO_WRAP = { boundX: 0, boundY: 0, boundZ: 0 }

test('motion is registered as one mover carrying all four blocks', () => {
  const def = getMoverOrSplitterDefinition('motion')
  assert.equal(def?.kind, 'mover')
  assert.equal(def?.label, 'Motion')
  assert.equal(def?.strictMidiRows, true)
  assert.equal(resolveVisualCopies([motionMover.resolve({ settings: settings(), notes: [] })], 0).length, 1)
})

test('each block owns a disjoint pitch range, six directions and its own Return', () => {
  const rows = motionMover.midiRows?.(settings()) ?? []
  assert.equal(rows.length, 26)
  const pitches = rows.map((row) => row.pitch)
  assert.equal(new Set(pitches).size, pitches.length, 'no pitch is claimed by two blocks')
  assert.deepEqual(pitches.slice(0, 7), [48, 49, 50, 51, 52, 53, 54])
  assert.deepEqual(pitches.slice(7, 13), [60, 61, 62, 63, 64, 65])
  assert.deepEqual(pitches.slice(13, 20), [72, 73, 74, 75, 76, 77, 78])
  assert.deepEqual(pitches.slice(20), [84, 85, 86, 87, 88, 89])
  assert.deepEqual(
    [rows[0].label, rows[6].label, rows[7].label, rows[13].label, rows[19].label, rows[20].label],
    ['Drift right (+X)', 'Return to origin', 'Step right (+X)', 'Spin +X', 'Return orientation', 'Snap +X'],
  )
})

test('block notes are renumbered onto the shared vocabulary, and only that block', () => {
  const notes = [note(0, 48), note(0, 53), note(0, 54), note(0, 60), note(0, 72), note(0, 84)]
  assert.deepEqual(motionBlockNotes(notes, MOTION_BLOCKS.drift, true).map((n) => n.pitch), [60, 65, 66])
  assert.deepEqual(motionBlockNotes(notes, MOTION_BLOCKS.step).map((n) => n.pitch), [60])
  assert.deepEqual(motionBlockNotes(notes, MOTION_BLOCKS.snap).map((n) => n.pitch), [60])
  // Without a Return row the block's base+6 pitch belongs to nobody.
  assert.deepEqual(motionBlockNotes([note(0, 66)], MOTION_BLOCKS.drift).map((n) => n.pitch), [])
})

test('a held drift note slides at Drift/beat and KEEPS the offset when released', () => {
  const config = settings({ ...NO_WRAP, driftX: 2, drift: 1 })
  const held = [note(0, 48, 3)] // Drift right for three beats
  assert.deepEqual(evaluateDriftOffset(motionBlockNotes(held, MOTION_BLOCKS.drift, true), config, 1), [2, 0, 0])
  assert.deepEqual(evaluateDriftOffset(motionBlockNotes(held, MOTION_BLOCKS.drift, true), config, 3), [6, 0, 0])
  assert.deepEqual(evaluateDriftOffset(motionBlockNotes(held, MOTION_BLOCKS.drift, true), config, 50), [6, 0, 0])
  // Opposing directions cancel; velocity scales the rate.
  const opposed = [note(0, 48, 2), note(0, 49, 2)]
  assert.deepEqual(evaluateDriftOffset(motionBlockNotes(opposed, MOTION_BLOCKS.drift, true), config, 2), [0, 0, 0])
  const soft = [note(0, 48, 2, 64)]
  assert.deepEqual(
    evaluateDriftOffset(motionBlockNotes(soft, MOTION_BLOCKS.drift, true), config, 2),
    [2 * 2 * (64 / 127), 0, 0],
  )
})

test('Return to origin eases the drift home without disarming the block', () => {
  const config = settings({ ...NO_WRAP, driftX: 2, drift: 1, driftReturnBeats: 2 })
  const notes = [note(0, 48, 2), note(4, 54, 2)] // drift 4 units, then return over 2 beats
  const drift = (beat: number) =>
    evaluateDriftOffset(motionBlockNotes(notes, MOTION_BLOCKS.drift, true), config, beat)[0]
  assert.equal(drift(4), 4)
  assert.equal(drift(5), 2, 'halfway through the return')
  assert.equal(drift(6), 0, 'home')
  assert.equal(drift(20), 0, 'and it stays home')
  // Drift launched AFTER the return still moves the object.
  const again = [...notes, note(8, 48, 1)]
  assert.equal(evaluateDriftOffset(motionBlockNotes(again, MOTION_BLOCKS.drift, true), config, 9)[0], 2)
})

test('wrapping folds a coordinate into [-bound, bound) and 0 disables it', () => {
  assert.equal(wrapToBound(4, 5), 4)
  assert.equal(wrapToBound(6, 5), -4, 'past the right edge, back on the left')
  assert.equal(wrapToBound(-6, 5), 4)
  assert.equal(wrapToBound(24, 5), 4, 'many laps still land in the box')
  assert.equal(wrapToBound(5, 5), -5, 'the far edge IS the near edge')
  assert.equal(wrapToBound(1000, 0), 1000, 'bound 0 = no wrapping')
})

test('a long drift note walks the object off one edge and back on the other', () => {
  const config = settings({ driftX: 2, drift: 1, boundX: 5 })
  const notes = [note(0, 48, 100)]
  const x = (beat: number) => evaluateMotionTranslation(notes, config, beat)[0]
  assert.equal(x(2), 4)
  assert.equal(x(3), -4, 'teleported to the other side')
  assert.equal(x(4), -2)
  assert.equal(x(7), 4, 'and round again')
  // The wrap is a pure function of the beat, so scrubbing agrees with playback.
  assert.equal(x(3), -4)
})

test('the wrap covers the whole translation, so steps cannot escape the box either', () => {
  const config = settings({ boundX: 5, distanceX: 4, distance: 1, easing: 5, burstBeats: 1 })
  const steps = [note(0, 60), note(1, 60)] // two +X steps of 4 = 8, past the +5 bound
  assert.equal(evaluateMotionTranslation(steps, config, 2)[0], -2)
  // Drift and steps share one wrapped offset rather than wrapping separately.
  const mixed = [note(0, 60), note(0, 48, 2)]
  assert.equal(
    evaluateMotionTranslation(mixed, settings({ boundX: 5, distanceX: 4, easing: 5, driftX: 2 }), 2)[0],
    wrapToBound(4 + 4, 5),
  )
})

test('the Step block is the Burst mover, at the Burst pitches', () => {
  const config = settings({ ...NO_WRAP, distanceX: 3, distance: 2, easing: 5, burstBeats: 2 })
  const notes = [note(0, 60)]
  assert.equal(evaluateMotionTranslation(notes, config, 1)[0], 3, 'halfway through a linear burst')
  assert.equal(evaluateMotionTranslation(notes, config, 2)[0], 6, 'landed')
  assert.equal(evaluateMotionTranslation(notes, config, 100)[0], 6, 'the step never decays')
  // A return-family easing makes the step temporary instead.
  const roundTrip = settings({ ...NO_WRAP, distanceX: 3, distance: 2, easing: 8, burstBeats: 2 })
  assert.equal(evaluateMotionTranslation(notes, roundTrip, 2)[0], 0, 'ADSR-family curve ends at home')
})

test('Snap reads the SHARED easing table, so a return curve springs the rotation back', () => {
  const linear = settings({ angleX: 90, angle: 1, easing: 5, burstBeats: 2 })
  const notes = motionBlockNotes([note(0, 84)], MOTION_BLOCKS.snap)
  const halfway = evaluateSnapAngles(notes, linear, 1)[0]
  assert.equal(Math.round(halfway * 1e6) / 1e6, Math.round((Math.PI / 4) * 1e6) / 1e6)
  assert.equal(Math.round(evaluateSnapAngles(notes, linear, 2)[0] * 1e6) / 1e6, Math.round((Math.PI / 2) * 1e6) / 1e6)
  const roundTrip = settings({ angleX: 90, angle: 1, easing: 8, burstBeats: 2 })
  assert.equal(evaluateSnapAngles(notes, roundTrip, 2)[0], 0)
})

test('Spin adds rotation on top of the always-on baseline, and Return re-syncs it', () => {
  const config = settings({ ...NO_WRAP, spinX: 0, spinY: 0, spinZ: 90, spin: 1, spinReturnBeats: 1 })
  // Baseline (90°) + one held +Z beat (90°) = half a turn: local +X on world -X.
  assert.deepEqual(localX(applyAt(config, [note(0, 76, 1)], 1)), [-1, 0, 0])
  // The Return erases the angle it met; the baseline accrued during its sweep
  // leaves the object a quarter turn on, spinning from there.
  const returned = applyAt(config, [note(0, 76, 1), note(2, 78, 1)], 3)
  assert.deepEqual(localX(returned), [0, 1, 0])
})

test('translation and rotation compose as previous * translation * rotation', () => {
  // The object spins in place at its drifted position: the drift is NOT steered
  // by the spin, and the spin is NOT displaced by the drift.
  const config = settings({ ...NO_WRAP, driftX: 2, drift: 1, spinX: 0, spinY: 0, spinZ: 90, spin: 1 })
  const copy = applyAt(config, [note(0, 48, 1), note(0, 76, 1)], 1)
  assert.deepEqual(positionOf(copy), [2, 0, 0])
  // Baseline + one held spin beat = half a turn.
  assert.deepEqual(localX(copy), [-1, 0, 0])
})

test('a pivot turns the rotation blocks into an orbit', () => {
  const config = settings({ ...NO_WRAP, spinX: 0, spinY: 0, spinZ: 90, spin: 1, pivotX: 1, pivotY: 0, pivotZ: 0 })
  // Baseline (90°) + one held beat (90°) = half a turn about a pivot one unit
  // to the +X side, landing the object at +2X.
  const copy = applyAt(config, [note(0, 76, 1)], 1)
  const [x, y, z] = positionOf(copy)
  assert.equal(Math.round(x * 1e6) / 1e6, 2)
  assert.equal(Math.round(y * 1e6) / 1e6, 0)
  assert.equal(z, 0)
})

test('the basis re-aims every block at once', () => {
  // Swap the X basis onto world Y: a +X drift now moves the object up, and the
  // spin turns about world Y.
  const config = settings({
    ...NO_WRAP,
    driftX: 2,
    drift: 1,
    basisXX: 0,
    basisXY: 1,
    basisXZ: 0,
    spinX: 90,
    spinY: 0,
    spinZ: 0,
    spin: 1,
  })
  assert.deepEqual(positionOf(applyAt(config, [note(0, 48, 1)], 1)), [0, 2, 0])
  // Baseline (90°) + one held beat (90°) = half a turn about world Y: local +X
  // now points down world -X.
  const spun = applyAt(config, [note(0, 72, 1)], 1)
  const [x, y, z] = localX(spun)
  assert.equal(Math.round(x * 1e6) / 1e6, -1)
  assert.equal(y, 0)
  assert.equal(z, 0)
})

test('blocks are independent: a note in one never leaks into another', () => {
  // Spin speeds zeroed so the always-on baseline is inert too: gap pitches
  // between blocks must leave the transform exactly alone.
  const config = settings({ ...NO_WRAP, spinX: 0, spinY: 0, spinZ: 0 })
  const identity = new Matrix4()
  for (const pitch of [48, 60, 72, 84]) {
    const others = [55, 59, 66, 71, 79, 83, 90].map((p) => note(0, p, 2))
    const copy = applyAt(config, others, 4)
    assert.deepEqual(copy.transform.elements, identity.elements, `pitch ${pitch}: gaps between blocks are inert`)
  }
})

test('every block leaves opacity and colour untouched', () => {
  const notes = [note(0, 48, 2), note(0, 60), note(0, 72, 2), note(0, 84)]
  const copy = motionMover
    .resolve({ settings: settings(), notes })
    .apply({ ...identityVisualCopy(), opacity: 0.5, colorShift: { hue: 0.25, saturation: 0, lightness: 0, tint: null, tintAmount: 0 } },
      { beat: 1, index: 0, count: 1 })[0]
  assert.equal(copy.opacity, 0.5)
  assert.equal(copy.colorShift.hue, 0.25)
})

test('all four blocks at once stay a pure function of the beat', () => {
  const config = settings()
  const notes = [note(0, 48, 8), note(1, 60), note(0, 74, 4), note(2, 86), note(6, 54, 1), note(7, 78, 1)]
  for (const beat of [0, 0.5, 1.25, 3, 6.5, 9, 40]) {
    const a = applyAt(config, notes, beat)
    const b = applyAt(config, notes, beat)
    assert.deepEqual(a.transform.elements, b.transform.elements)
    assert.equal(new Vector3().setFromMatrixPosition(a.transform).length() < 1e4, true)
  }
})

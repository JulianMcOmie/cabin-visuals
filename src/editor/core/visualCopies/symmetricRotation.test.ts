import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { identityVisualCopy } from './identityVisualCopy'
import { mergeDefinitionSettings } from './definitions'
import { getMoverOrSplitterDefinition } from './registry'
import {
  evaluateSymmetricRotationChannels,
  resolveSymmetryAxis,
  symmetricRotationMover,
  symmetricRotationWeight,
  SYMMETRIC_ROTATION_ANCHOR_SELF,
  SYMMETRIC_ROTATION_AXIS_Z,
  SYMMETRIC_ROTATION_DRIVE_MIDI,
  SYMMETRIC_ROTATION_FALLOFF_ALONG,
  SYMMETRIC_ROTATION_FALLOFF_FROM,
  SYMMETRIC_ROTATION_FALLOFF_INTO,
  SYMMETRIC_ROTATION_FALLOFF_UNIFORM,
  SYMMETRIC_ROTATION_MODE_BURST,
  SYMMETRIC_ROTATION_MODE_CONSTANT,
  SYMMETRIC_ROTATION_MODE_OSCILLATE,
  type SymmetricRotationSettings,
} from './symmetricRotation'
import type { VisualCopy } from './types'

function note(beat: number, pitch: number, velocity = 1, durationBeats = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity, durationBeats }
}

const DEFAULTS = mergeDefinitionSettings(symmetricRotationMover, undefined) as unknown as SymmetricRotationSettings

// Pin the historical geometry fixture independently of the new bow defaults.
function settings(overrides: Partial<SymmetricRotationSettings> = {}): SymmetricRotationSettings {
  return { ...DEFAULTS, axis: 1, anchor: 0, twist: 45, fold: 0,
    falloff: SYMMETRIC_ROTATION_FALLOFF_UNIFORM, ...overrides }
}

/** A copy parked at a position, as an upstream splitter would hand it over. */
function copyAt(x: number, y: number, z: number): VisualCopy {
  const copy = identityVisualCopy()
  copy.transform = new Matrix4().makeTranslation(x, y, z)
  return copy
}

function positionOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const round = (n: number) => Math.round(n * 1e6) / 1e6 || 0
  return [round(e[12]), round(e[13]), round(e[14])]
}

/** Where the copy's own local +X ends up - how its ORIENTATION turned. */
function localXOf(copy: VisualCopy): [number, number, number] {
  const dir = new Vector3(1, 0, 0).transformDirection(copy.transform)
  const round = (n: number) => Math.round(n * 1e6) / 1e6 || 0
  return [round(dir.x), round(dir.y), round(dir.z)]
}

function applyAt(
  copy: VisualCopy,
  s: SymmetricRotationSettings,
  notes: ResolvedNote[],
  beat: number,
): VisualCopy {
  return symmetricRotationMover.resolve({ settings: s, notes }).apply(copy, { beat, index: 0, count: 1 })[0]
}

function close(actual: number, expected: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg ?? `expected ${expected}, got ${actual}`)
}

test('symmetricRotation is registered as a production mover with mode-dependent rows', () => {
  const def = getMoverOrSplitterDefinition('symmetricRotation')
  assert.equal(def?.kind, 'mover')
  assert.equal(def?.label, 'Symmetric Rotation')
  assert.equal(def?.strictMidiRows, true)
  assert.deepEqual(def!.midiRows!(settings()), [], 'Amount mode promises no notes')
  const burst = def!.midiRows!(settings({ mode: SYMMETRIC_ROTATION_MODE_BURST }))
  assert.deepEqual(burst.map((r) => r.pitch), [60, 61, 62, 63, 64, 65])
  const constant = def!.midiRows!(settings({ mode: SYMMETRIC_ROTATION_MODE_CONSTANT }))
  assert.deepEqual(constant.map((r) => r.pitch), [60, 61, 62, 63, 64, 65, 66])
  assert.equal(constant[6].label, 'Return')
})

// ── The axis ────────────────────────────────────────────────────────────────

test('the axis is exactly its cardinal until aimed, and unit length after', () => {
  assert.deepEqual(resolveSymmetryAxis(settings()).toArray(), [0, 1, 0])
  assert.deepEqual(resolveSymmetryAxis(settings({ axis: SYMMETRIC_ROTATION_AXIS_Z })).toArray(), [0, 0, 1])
  const aimed = resolveSymmetryAxis(settings({ axis: SYMMETRIC_ROTATION_AXIS_Z, axisYaw: 90 }))
  close(aimed.length(), 1)
  close(aimed.x, 1, 'yaw 90° swings +Z onto +X')
  close(aimed.z, 0)
})

// ── Falloff ──────────────────────────────────────────────────────────────────

test('default Z bow rotates opposite sides around their own tangents without moving centers', () => {
  assert.equal(DEFAULTS.axis, SYMMETRIC_ROTATION_AXIS_Z)
  assert.equal(DEFAULTS.falloff, SYMMETRIC_ROTATION_FALLOFF_UNIFORM)
  assert.equal(DEFAULTS.anchor, SYMMETRIC_ROTATION_ANCHOR_SELF)
  for (const x of [-2, 2]) {
    const copy = copyAt(x, 0, 0)
    const out = applyAt(copy, DEFAULTS, [], 0)
    assert.deepEqual(positionOf(out), [x, 0, 0])
    const normal = new Vector3(0, 0, 1).transformDirection(out.transform)
    close(normal.x, -Math.sign(x) * Math.SQRT1_2)
    close(normal.z, Math.SQRT1_2)
    const reverse = applyAt(copy, { ...DEFAULTS, fold: -45 }, [], 0)
    close(new Vector3(0, 0, 1).transformDirection(reverse.transform).x, -normal.x)
    const more = applyAt(copy, { ...DEFAULTS, fold: 60 }, [], 0)
    assert.notDeepEqual(more.transform.elements, out.transform.elements)
  }
})

test('Along axis intentionally zeroes Fold for an XY formation around Z', () => {
  const copy = copyAt(2, 1, 0)
  for (const fold of [45, 120]) {
    const out = applyAt(copy, { ...DEFAULTS, falloff: SYMMETRIC_ROTATION_FALLOFF_ALONG, fold }, [], 0)
    assert.deepEqual(out.transform.elements, copy.transform.elements)
  }
})

test('uniform falloff gives every copy the whole angle', () => {
  const s = settings()
  close(symmetricRotationWeight(0, 0, s), 1)
  close(symmetricRotationWeight(5, 9, s), 1)
})

test('the along-axis falloff is SIGNED - the reversal across center is the twist', () => {
  const s = settings({ falloff: SYMMETRIC_ROTATION_FALLOFF_ALONG, span: 2 })
  close(symmetricRotationWeight(2, 0, s), 1)
  close(symmetricRotationWeight(-2, 0, s), -1)
  close(symmetricRotationWeight(0, 3, s), 0, 'the radius is irrelevant here')
})

test('from-axis grows outward, into-axis dies at span', () => {
  const from = settings({ falloff: SYMMETRIC_ROTATION_FALLOFF_FROM, span: 4 })
  close(symmetricRotationWeight(0, 2, from), 0.5)
  const into = settings({ falloff: SYMMETRIC_ROTATION_FALLOFF_INTO, span: 4 })
  close(symmetricRotationWeight(0, 0, into), 1)
  close(symmetricRotationWeight(0, 2, into), 0.5)
  close(symmetricRotationWeight(0, 9, into), 0, 'clamped, never negative')
})

test('curve bends the ramp but keeps its sign and its ends', () => {
  const s = settings({ falloff: SYMMETRIC_ROTATION_FALLOFF_ALONG, span: 2, curve: 2 })
  close(symmetricRotationWeight(1, 0, s), 0.25)
  close(symmetricRotationWeight(-1, 0, s), -0.25)
  close(symmetricRotationWeight(2, 0, s), 1, 'the full-span end is untouched')
})

// ── Twist ────────────────────────────────────────────────────────────────────

test('a uniform twist turns the whole formation rigidly about the axis', () => {
  const s = settings({ twist: 90 })
  assert.deepEqual(positionOf(applyAt(copyAt(1, 0, 0), s, [], 0)), [0, 0, -1], '90° about +Y')
  assert.deepEqual(positionOf(applyAt(copyAt(2, 5, 0), s, [], 0)), [0, 5, -2], 'height along the axis is kept')
})

test('the along-axis gradient twists: copies either side of center turn opposite ways', () => {
  const s = settings({ twist: 90, falloff: SYMMETRIC_ROTATION_FALLOFF_ALONG, span: 1 })
  assert.deepEqual(positionOf(applyAt(copyAt(1, 1, 0), s, [], 0)), [0, 1, -1], 'a full +90° one span up')
  assert.deepEqual(positionOf(applyAt(copyAt(1, -1, 0), s, [], 0)), [0, -1, 1], 'and −90° one span down')
  assert.deepEqual(positionOf(applyAt(copyAt(1, 0, 0), s, [], 0)), [1, 0, 0], 'the center ring is unmoved')
})

test('CENTER moves the axis line, so the twist happens about it', () => {
  const s = settings({ twist: 90, centerX: 1 })
  assert.deepEqual(positionOf(applyAt(copyAt(2, 0, 0), s, [], 0)), [1, 0, -1])
  assert.deepEqual(positionOf(applyAt(copyAt(1, 0, 0), s, [], 0)), [1, 0, 0], 'a copy ON the axis stays')
})

test('anchored on its OWN center a twist only re-orients: positions never move', () => {
  const s = settings({ twist: 90, anchor: SYMMETRIC_ROTATION_ANCHOR_SELF })
  const out = applyAt(copyAt(2, 0, 0), s, [], 0)
  assert.deepEqual(positionOf(out), [2, 0, 0])
  assert.deepEqual(localXOf(out), [0, 0, -1], 'but it spun in place about the axis direction')
})

// ── Fold ─────────────────────────────────────────────────────────────────────

test('a +90° fold closes the ring onto the axis, in the +axis direction', () => {
  const s = settings({ twist: 0, fold: 90 })
  assert.deepEqual(positionOf(applyAt(copyAt(2, 0, 0), s, [], 0)), [0, 2, 0], '+X arm lifts to +Y')
  assert.deepEqual(positionOf(applyAt(copyAt(0, 0, 2), s, [], 0)), [0, 2, 0], 'and so does the +Z arm')
  assert.deepEqual(positionOf(applyAt(copyAt(-2, 0, 0), s, [], 0)), [0, 2, 0], 'symmetric: every arm folds up')
})

test('a −90° fold closes the same ring the other way', () => {
  const s = settings({ twist: 0, fold: -90 })
  assert.deepEqual(positionOf(applyAt(copyAt(2, 0, 0), s, [], 0)), [0, -2, 0])
})

test('a self-anchored fold is the petals turning to face in or out, in place', () => {
  const s = settings({ twist: 0, fold: 90, anchor: SYMMETRIC_ROTATION_ANCHOR_SELF })
  const out = applyAt(copyAt(2, 0, 0), s, [], 0)
  assert.deepEqual(positionOf(out), [2, 0, 0])
  assert.deepEqual(localXOf(out), [0, 1, 0], 'its outward face now points up the axis')
})

test('a copy ON the axis has no radial, so fold and roll leave it alone', () => {
  const s = settings({ twist: 0, fold: 90, roll: 90 })
  const out = applyAt(copyAt(0, 3, 0), s, [], 0)
  assert.deepEqual(positionOf(out), [0, 3, 0])
  assert.deepEqual(localXOf(out), [1, 0, 0])
})

// ── Roll ─────────────────────────────────────────────────────────────────────

test('roll spins each copy about its own outward radial - the anchor cannot move it', () => {
  const s = settings({ twist: 0, roll: 90 })
  const axisAnchored = applyAt(copyAt(2, 0, 0), s, [], 0)
  const selfAnchored = applyAt(copyAt(2, 0, 0), settings({ twist: 0, roll: 90, anchor: SYMMETRIC_ROTATION_ANCHOR_SELF }), [], 0)
  assert.deepEqual(positionOf(axisAnchored), [2, 0, 0])
  assert.deepEqual(positionOf(selfAnchored), [2, 0, 0])
  assert.deepEqual(
    [...axisAnchored.transform.elements].map((n) => Math.round(n * 1e6) / 1e6 || 0),
    [...selfAnchored.transform.elements].map((n) => Math.round(n * 1e6) / 1e6 || 0),
  )
})

// ── Time shapes ──────────────────────────────────────────────────────────────

test('Amount mode ignores notes entirely and holds its knobs', () => {
  const s = settings({ twist: 90 })
  const channels = evaluateSymmetricRotationChannels([note(0, 60), note(0, 63)], s, 7)
  close(channels[0], Math.PI / 2)
  close(channels[1], 0)
})

test('Burst fires one eased excursion per note, on the signed channel rows', () => {
  const s = settings({ mode: SYMMETRIC_ROTATION_MODE_BURST, easing: 5, burstBeats: 2, twist: 90, fold: 60 })
  close(evaluateSymmetricRotationChannels([note(0, 60)], s, 1)[0], Math.PI / 4, 'halfway through a linear burst')
  close(evaluateSymmetricRotationChannels([note(0, 60)], s, 9)[0], Math.PI / 2, 'a step easing lands and stays')
  close(evaluateSymmetricRotationChannels([note(0, 61)], s, 9)[0], -Math.PI / 2, 'the − row turns the other way')
  close(evaluateSymmetricRotationChannels([note(0, 63)], s, 9)[1], -Math.PI / 3, 'fold has its own rows and knob')
  close(evaluateSymmetricRotationChannels([note(0, 60, 0.5)], s, 9)[0], Math.PI / 4, 'velocity scales it')
})

test('Constant runs an always-on baseline that MIDI-only drive turns off', () => {
  const auto = settings({ mode: SYMMETRIC_ROTATION_MODE_CONSTANT, twist: 90, fold: 0, roll: 0 })
  close(evaluateSymmetricRotationChannels([], auto, 2)[0], Math.PI, '90°/beat for two beats')
  const midi = settings({ ...auto, drive: SYMMETRIC_ROTATION_DRIVE_MIDI })
  close(evaluateSymmetricRotationChannels([], midi, 2)[0], 0, 'parked until a note')
  close(evaluateSymmetricRotationChannels([note(0, 60, 1, 2)], midi, 2)[0], Math.PI, 'held notes still drive it')
})

test('Oscillate swings home → angle → home while held and stops on release', () => {
  const s = settings({ mode: SYMMETRIC_ROTATION_MODE_OSCILLATE, cyclesPerBeat: 0.5, twist: 90 })
  close(evaluateSymmetricRotationChannels([note(0, 60, 1, 4)], s, 0)[0], 0)
  close(evaluateSymmetricRotationChannels([note(0, 60, 1, 4)], s, 1)[0], Math.PI / 2, 'peak at half a cycle')
  close(evaluateSymmetricRotationChannels([note(0, 60, 1, 4)], s, 2)[0], 0, 'home at the full cycle')
  close(evaluateSymmetricRotationChannels([note(0, 60, 1, 1)], s, 3)[0], 0, 'silent after release')
})

test('a burst note drives the geometry through the same falloff as the knobs', () => {
  const s = settings({
    mode: SYMMETRIC_ROTATION_MODE_BURST,
    easing: 5,
    burstBeats: 1,
    twist: 90,
    falloff: SYMMETRIC_ROTATION_FALLOFF_ALONG,
    span: 1,
  })
  assert.deepEqual(positionOf(applyAt(copyAt(1, 1, 0), s, [note(0, 60)], 1)), [0, 1, -1])
  assert.deepEqual(positionOf(applyAt(copyAt(1, -1, 0), s, [note(0, 60)], 1)), [0, -1, 1])
})

// ── Contract details ─────────────────────────────────────────────────────────

test('the delta pre-multiplies: a copy\'s own rotated frame does not re-aim the axis', () => {
  const s = settings({ twist: 90 })
  const copy = identityVisualCopy()
  // At +X but spun 90° about Z, so its LOCAL up points at world −X.
  copy.transform = new Matrix4().makeTranslation(1, 0, 0).multiply(new Matrix4().makeRotationZ(Math.PI / 2))
  assert.deepEqual(positionOf(applyAt(copy, s, [], 0)), [0, 0, -1], 'still turns about the world axis')
})

test('it declares chainRoot composition so a splitter child chain keeps its axes', () => {
  const resolved = symmetricRotationMover.resolve({ settings: settings(), notes: [] })
  assert.equal(resolved.composition, 'chainRoot')
})

test('always exactly one copy, and the incoming copy is left untouched', () => {
  const copy = copyAt(1, 0, 0)
  const before = [...copy.transform.elements]
  const out = symmetricRotationMover.resolve({ settings: settings({ twist: 90 }), notes: [] })
    .apply(copy, { beat: 1, index: 0, count: 1 })
  assert.equal(out.length, 1)
  assert.deepEqual([...copy.transform.elements], before)
  assert.notEqual(out[0].transform, copy.transform)
})

test('a zero angle is a clean pass-through, opacity and color shift intact', () => {
  const copy = copyAt(1, 2, 3)
  copy.opacity = 0.5
  copy.colorShift.hue = 0.25
  const out = applyAt(copy, settings({ twist: 0 }), [], 0)
  assert.deepEqual([...out.transform.elements], [...copy.transform.elements])
  assert.equal(out.opacity, 0.5)
  assert.equal(out.colorShift.hue, 0.25)
  assert.notEqual(out.colorShift, copy.colorShift)
})

test('evaluation is pure: scrubbing reproduces the transform exactly', () => {
  const resolved = symmetricRotationMover.resolve({
    settings: settings({
      mode: SYMMETRIC_ROTATION_MODE_OSCILLATE,
      cyclesPerBeat: 0.37,
      twist: 120,
      fold: 45,
      roll: 30,
      falloff: SYMMETRIC_ROTATION_FALLOFF_FROM,
      span: 3,
      curve: 1.6,
    }),
    notes: [note(0, 60, 1, 8), note(1, 62, 0.7, 4), note(2, 65, 1, 2)],
  })
  const at = (beat: number) =>
    [...resolved.apply(copyAt(1.5, -0.5, 0.75), { beat, index: 0, count: 1 })[0].transform.elements]
  const first = at(2.35)
  at(0)
  at(50)
  assert.deepEqual(at(2.35), first)
})

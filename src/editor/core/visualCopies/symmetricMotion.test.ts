import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { identityVisualCopy } from './identityVisualCopy'
import { mergeDefinitionSettings } from './definitions'
import { getMoverOrSplitterDefinition } from './registry'
import {
  evaluateSymmetricMotionChannels,
  symmetricMotionEnvelope,
  symmetricMotionMover,
  type SymmetricMotionSettings,
} from './symmetricMotion'
import type { VisualCopy } from './types'

function note(beat: number, pitch: number, velocity = 1, durationBeats = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity, durationBeats }
}

const DEFAULTS = mergeDefinitionSettings(symmetricMotionMover, undefined) as unknown as SymmetricMotionSettings

function settings(overrides: Partial<SymmetricMotionSettings> = {}): SymmetricMotionSettings {
  // easing 5 = Linear (a step curve): most tests want travel that lands and
  // stays, so the arithmetic is exact.
  return { ...DEFAULTS, easing: 5, ...overrides }
}

/** A copy parked at a position, as an upstream splitter would hand it over. */
function copyAt(x: number, y: number, z: number): VisualCopy {
  const copy = identityVisualCopy()
  copy.transform = new Matrix4().makeTranslation(x, y, z)
  return copy
}

function positionOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const round = (n: number) => Math.round(n * 1e9) / 1e9 || 0
  return [round(e[12]), round(e[13]), round(e[14])]
}

function applyAt(copy: VisualCopy, s: SymmetricMotionSettings, notes: ResolvedNote[], beat: number): VisualCopy {
  return symmetricMotionMover.resolve({ settings: s, notes }).apply(copy, { beat, index: 0, count: 1 })[0]
}

function close(actual: number, expected: number, msg?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, msg ?? `expected ${expected}, got ${actual}`)
}

test('symmetricMotion is registered as a production mover with mode-dependent rows', () => {
  const def = getMoverOrSplitterDefinition('symmetricMotion')
  assert.equal(def?.kind, 'mover')
  assert.equal(def?.label, 'Symmetric Motion')
  assert.equal(def?.strictMidiRows, true)
  const radialRows = def!.midiRows!(settings({ symmetry: 0 }))
  assert.deepEqual(radialRows.map((r) => r.pitch), [60, 61, 62, 63])
  const mirrorRows = def!.midiRows!(settings({ symmetry: 1 }))
  assert.deepEqual(mirrorRows.map((r) => r.pitch), [60, 61, 62, 63, 64, 65])
  assert.ok(mirrorRows.every((r) => /Apart|Together/.test(r.label)))
})

// ── The shared time shapes ───────────────────────────────────────────────────

test('burst motion eases over `beats`; step easings land and stay, return easings come home', () => {
  const linear = settings({ motion: 0, easing: 5, beats: 2 })
  close(symmetricMotionEnvelope(note(0, 60), linear, -1), 0, 'nothing before the note')
  close(symmetricMotionEnvelope(note(0, 60), linear, 1), 0.5, 'halfway through a linear burst')
  close(symmetricMotionEnvelope(note(0, 60), linear, 2), 1, 'landed')
  close(symmetricMotionEnvelope(note(0, 60), linear, 100), 1, 'a step easing never decays')
  const adsr = settings({ motion: 0, easing: 6, beats: 2 })
  close(symmetricMotionEnvelope(note(0, 60), adsr, 2), 0, 'a return easing comes home')
})

test('constant motion accumulates while held and freezes on release', () => {
  const s = settings({ motion: 1, beats: 1 })
  close(symmetricMotionEnvelope(note(0, 60, 1, 2), s, 0.5), 0.5)
  close(symmetricMotionEnvelope(note(0, 60, 1, 2), s, 2), 2, 'two beats held = two units of travel')
  close(symmetricMotionEnvelope(note(0, 60, 1, 2), s, 10), 2, 'release freezes the travel')
  const slow = settings({ motion: 1, beats: 4 })
  close(symmetricMotionEnvelope(note(0, 60, 1, 2), slow, 2), 0.5, 'beats sets the rate')
})

test('oscillating motion waves home-extent-home while held and stops on release', () => {
  const s = settings({ motion: 2, beats: 2 })
  close(symmetricMotionEnvelope(note(0, 60, 1, 4), s, 0), 0)
  close(symmetricMotionEnvelope(note(0, 60, 1, 4), s, 1), 1, 'peak at half the cycle')
  close(symmetricMotionEnvelope(note(0, 60, 1, 4), s, 2), 0, 'home at the full cycle')
  close(symmetricMotionEnvelope(note(0, 60, 1, 4), s, 5), 0, 'silent after release')
})

// ── Radial mode ──────────────────────────────────────────────────────────────

test('Out moves every copy along its own outward direction - equal and opposite for a mirrored pair', () => {
  const s = settings({ symmetry: 0, motion: 0, beats: 1, distance: 2 })
  const notes = [note(0, 60)]
  assert.deepEqual(positionOf(applyAt(copyAt(1, 0, 0), s, notes, 1)), [3, 0, 0])
  assert.deepEqual(positionOf(applyAt(copyAt(-1, 0, 0), s, notes, 1)), [-3, 0, 0])
  assert.deepEqual(positionOf(applyAt(copyAt(0, -1, 0), s, notes, 1)), [0, -3, 0])
})

test('a copy at the exact center has no outward direction and stays put', () => {
  const s = settings({ symmetry: 0, distance: 2 })
  assert.deepEqual(positionOf(applyAt(copyAt(0, 0, 0), s, [note(0, 60)], 1)), [0, 0, 0])
})

test('In collapses copies onto the center and holds - never out the far side', () => {
  const s = settings({ symmetry: 0, motion: 0, beats: 1, distance: 5 })
  const notes = [note(0, 61)]
  assert.deepEqual(positionOf(applyAt(copyAt(2, 0, 0), s, notes, 1)), [0, 0, 0], 'clamped at the center')
  assert.deepEqual(positionOf(applyAt(copyAt(0, 3, 0), s, notes, 50)), [0, 0, 0], 'and held there')
})

test('the radial plane picks which components move: XY mode never touches Z', () => {
  const s = settings({ symmetry: 0, plane: 0, distance: 1 })
  assert.deepEqual(positionOf(applyAt(copyAt(1, 0, 4), s, [note(0, 60)], 1)), [2, 0, 4])
  const sphere = settings({ symmetry: 0, plane: 3, distance: 5 })
  assert.deepEqual(positionOf(applyAt(copyAt(3, 0, 4), sphere, [note(0, 60)], 1)), [6, 0, 8], 'sphere blooms fully 3D')
})

test('Turn revolves the whole formation about the plane normal, opposite rows cancelling', () => {
  const s = settings({ symmetry: 0, plane: 0, angle: 90 })
  const turned = applyAt(copyAt(1, 0, 0), s, [note(0, 62)], 1)
  assert.deepEqual(positionOf(turned), [0, 1, 0], '90° left about +Z')
  const back = applyAt(copyAt(1, 0, 0), s, [note(0, 62), note(0, 63)], 1)
  assert.deepEqual(positionOf(back), [1, 0, 0], 'left + right cancel')
})

test('Turn carries the radial travel with it: out-then-turn keeps copies on their ring', () => {
  const s = settings({ symmetry: 0, plane: 0, distance: 1, angle: 90 })
  const moved = applyAt(copyAt(1, 0, 0), s, [note(0, 60), note(0, 62)], 1)
  assert.deepEqual(positionOf(moved), [0, 2, 0], 'bloomed to radius 2, then revolved 90°')
})

// ── Mirror mode ──────────────────────────────────────────────────────────────

test('Apart moves each copy along its own side of the axis plane; other axes are untouched', () => {
  const s = settings({ symmetry: 1, distance: 2 })
  const notes = [note(0, 60)] // Apart X
  assert.deepEqual(positionOf(applyAt(copyAt(1, 5, 0), s, notes, 1)), [3, 5, 0])
  assert.deepEqual(positionOf(applyAt(copyAt(-1, 5, 0), s, notes, 1)), [-3, 5, 0])
  assert.deepEqual(positionOf(applyAt(copyAt(0, 5, 0), s, notes, 1)), [0, 5, 0], 'a copy ON the plane has no side')
})

test('Together clamps at the axis plane instead of crossing it', () => {
  const s = settings({ symmetry: 1, distance: 10 })
  assert.deepEqual(positionOf(applyAt(copyAt(2, -3, 0), s, [note(0, 61)], 1)), [0, -3, 0])
  assert.deepEqual(positionOf(applyAt(copyAt(2, -3, 0), s, [note(0, 61), note(0, 63)], 1)), [0, 0, 0])
})

test('the Y and Z pairs drive their own axes', () => {
  const s = settings({ symmetry: 1, distance: 1 })
  assert.deepEqual(positionOf(applyAt(copyAt(0, -2, 3), s, [note(0, 62)], 1)), [0, -3, 3])
  assert.deepEqual(positionOf(applyAt(copyAt(0, -2, 3), s, [note(0, 65)], 1)), [0, -2, 2])
})

// ── Contract details ─────────────────────────────────────────────────────────

test('velocity scales the travel', () => {
  const s = settings({ symmetry: 0, distance: 2 })
  assert.deepEqual(positionOf(applyAt(copyAt(1, 0, 0), s, [note(0, 60, 0.5)], 1)), [2, 0, 0])
})

test('rows of the other mode are ignored', () => {
  const radial = settings({ symmetry: 0 })
  const channels = evaluateSymmetricMotionChannels([note(0, 64), note(0, 65)], radial, 1)
  assert.deepEqual(channels, { out: 0, turn: 0, axes: [0, 0, 0] })
})

test('the delta pre-multiplies: a copy\'s own rotated frame does not re-aim its motion', () => {
  const s = settings({ symmetry: 0, distance: 1 })
  const copy = identityVisualCopy()
  // Positioned at +X but spun 90° about Z - LOCAL +X now points at world +Y.
  copy.transform = new Matrix4().makeTranslation(1, 0, 0).multiply(new Matrix4().makeRotationZ(Math.PI / 2))
  assert.deepEqual(positionOf(applyAt(copy, s, [note(0, 60)], 1)), [2, 0, 0], 'still moves along world outward')
})

test('always exactly one copy, and the incoming copy is left untouched', () => {
  const s = settings({ symmetry: 0, distance: 2 })
  const copy = copyAt(1, 0, 0)
  const before = [...copy.transform.elements]
  const out = symmetricMotionMover.resolve({ settings: s, notes: [note(0, 60)] })
    .apply(copy, { beat: 1, index: 0, count: 1 })
  assert.equal(out.length, 1)
  assert.deepEqual([...copy.transform.elements], before)
  assert.notEqual(out[0].transform, copy.transform)
})

test('evaluation is pure: scrubbing reproduces positions exactly', () => {
  const resolved = symmetricMotionMover.resolve({
    settings: settings({ symmetry: 0, motion: 2, beats: 3, distance: 2, angle: 30 }),
    notes: [note(0, 60, 1, 8), note(1, 62, 0.7, 4), note(2, 61, 1, 2)],
  })
  const at = (beat: number) =>
    [...resolved.apply(copyAt(1.5, -0.5, 0), { beat, index: 0, count: 1 })[0].transform.elements]
  const first = at(2.35)
  at(0)
  at(50)
  assert.deepEqual(at(2.35), first)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { lineSplitter, type LineSettings } from './library'
import { resolveVisualCopies } from './resolveVisualCopies'

const settings = (overrides: Partial<LineSettings> = {}): LineSettings => ({
  copies: 5,
  spacing: 1,
  growth: 1,
  size: 1,
  angle: 0,
  tilt: 0,
  ...overrides,
})

function note(pitch: number, durationBeats = 1): ResolvedNote {
  return { beat: 0, blockStartBeat: 0, blockEndBeat: 16, pitch, velocity: 1, durationBeats }
}

function resolveLine(overrides: Partial<LineSettings> = {}, notes: ResolvedNote[] = [], beat = 0) {
  return resolveVisualCopies([lineSplitter.resolve({ settings: settings(overrides), notes })], beat)
}

function position(copy: ReturnType<typeof resolveLine>[number]): [number, number, number] {
  const e = copy.transform.elements
  return [e[12], e[13], e[14]]
}

/** Basis column lengths = the copy's per-axis scale, rotation-independent. */
function scaleOf(copy: ReturnType<typeof resolveLine>[number]): number {
  const e = copy.transform.elements
  return Math.hypot(e[0], e[1], e[2])
}

function rounded(values: [number, number, number][]): [number, number, number][] {
  return values.map((v) => v.map((n) => Number(n.toFixed(10)) || 0) as [number, number, number])
}

test('line marches copies backward along -Z, base copy untouched', () => {
  const copies = resolveLine()
  assert.equal(copies.length, 5)
  assert.deepEqual(rounded(copies.map(position)), [
    [0, 0, 0],
    [0, 0, -1],
    [0, 0, -2],
    [0, 0, -3],
    [0, 0, -4],
  ])
  // The default aim is the identity frame: the base copy is EXACTLY the
  // incoming copy, and the rest are unrotated pure translations.
  assert.ok(new Matrix4().equals(copies[0].transform))
  for (const copy of copies) assert.ok(Math.abs(scaleOf(copy) - 1) < 1e-10)
})

test('growth is a per-step ratio anchored at the base copy', () => {
  const copies = resolveLine({ copies: 3, growth: 2 })
  assert.deepEqual(copies.map((c) => Number(scaleOf(c).toFixed(10))), [1, 2, 4])
  // Scale composes AFTER the translation: positions stay on the spacing grid.
  assert.deepEqual(rounded(copies.map(position)), [
    [0, 0, 0],
    [0, 0, -1],
    [0, 0, -2],
  ])
})

test('size scales the whole run, with growth riding on top of it', () => {
  const copies = resolveLine({ copies: 3, size: 0.5 })
  // Every copy INCLUDING the base, unlike growth, which anchors at 1.
  assert.deepEqual(copies.map((c) => Number(scaleOf(c).toFixed(10))), [0.5, 0.5, 0.5])
  // Spacing is untouched: the scale still composes after the translation.
  assert.deepEqual(rounded(copies.map(position)), [
    [0, 0, 0],
    [0, 0, -1],
    [0, 0, -2],
  ])
  // The two multiply - size · growth^i - so the ramp keeps its shape.
  const ramped = resolveLine({ copies: 3, size: 0.5, growth: 2 })
  assert.deepEqual(ramped.map((c) => Number(scaleOf(c).toFixed(10))), [0.5, 1, 2])
})

test('angle swings the aim about +Y; tilt lifts it toward +Y', () => {
  const right = resolveLine({ copies: 3, angle: 90 })
  assert.deepEqual(rounded(right.map(position)), [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
  ])
  const up = resolveLine({ copies: 3, tilt: 90 })
  assert.deepEqual(rounded(up.map(position)), [
    [0, 0, 0],
    [0, 1, 0],
    [0, 2, 0],
  ])
  // Composed aim: unit direction (cos t sin a, sin t, -cos t cos a).
  const aimed = resolveLine({ copies: 3, angle: 30, tilt: 45 })
  const expected = new Vector3(
    Math.cos(Math.PI / 4) * Math.sin(Math.PI / 6),
    Math.sin(Math.PI / 4),
    -Math.cos(Math.PI / 4) * Math.cos(Math.PI / 6),
  )
  const end = new Vector3(...position(aimed[1]))
  assert.ok(end.distanceTo(expected) < 1e-10)
})

test('a non-zero aim rotates each copy frame with the axis', () => {
  const copies = resolveLine({ copies: 2, angle: 90 })
  const e = copies[0].transform.elements
  // Basis column 2 (the copy's local +Z) turns to world -X, so the local -Z
  // step direction is world +X.
  assert.ok(Math.abs(e[8] + 1) < 1e-10)
  assert.ok(Math.abs(e[9]) < 1e-10)
  assert.ok(Math.abs(e[10]) < 1e-10)
})

test('notes latch the copy count at their onset - a step function resting at the knob', () => {
  // Pitch 38 = 3 copies (36 + k names count 1 + k); duration is ignored.
  const during = resolveLine({ copies: 5 }, [note(38)], 0.5)
  assert.equal(during.length, 3)
  assert.deepEqual(rounded(during.map(position)), [[0, 0, 0], [0, 0, -1], [0, 0, -2]])
  const after = resolveLine({ copies: 5 }, [note(38)], 1.5)
  assert.equal(after.length, 3, 'the latch holds past the note end')
})

test('the count lane rows match an integer automation lane: 32 rows, bottom = 1 copy', () => {
  const rows = lineSplitter.midiRows!(settings({ copies: 3 }))
  assert.equal(rows.length, 32)
  assert.deepEqual(rows[0], { pitch: 67, label: '32 copies' })
  assert.deepEqual(rows[rows.length - 1], { pitch: 36, label: '1 copy' })
})

test('an empty lane keeps the knob count at every beat; retired mute pitches no-op', () => {
  for (const beat of [0, 0.25, 3, 17.5]) {
    assert.equal(resolveLine({ copies: 7 }, [], beat).length, 7)
    // The retired mute map's 96+ pitches fall out of the count span.
    assert.equal(resolveLine({ copies: 7 }, [note(127), note(124)], beat).length, 7)
  }
})

test('the structural bracket sizes the pool at the lane\'s full reach', () => {
  const resolved = lineSplitter.resolve({ settings: settings({ copies: 2 }), notes: [note(39)] })
  assert.equal(resolveVisualCopies([resolved.structuralVariants![0]], 0).length, 4)
  assert.equal(resolveVisualCopies([resolved.structuralVariants![1]], 0).length, 2)
})

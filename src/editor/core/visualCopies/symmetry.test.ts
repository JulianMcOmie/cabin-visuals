import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { identityVisualCopy } from './identityVisualCopy'
import { resolveVisualCopies } from './resolveVisualCopies'
import { symmetrySplitter, symmetryTransforms, type SymmetrySettings } from './symmetry'
import { getMoverOrSplitterDefinition } from './registry'
import { mergeDefinitionSettings } from './definitions'
import type { VisualCopy } from './types'

const DEFAULTS = mergeDefinitionSettings(symmetrySplitter, undefined) as unknown as SymmetrySettings

function settings(overrides: Partial<SymmetrySettings> = {}): SymmetrySettings {
  return { ...DEFAULTS, ...overrides }
}

function note(beat: number, pitch: number): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity: 1, durationBeats: 1 }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6 || 0

function positionOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  return [round(e[12]), round(e[13]), round(e[14])]
}

function copiesFor(overrides: Partial<SymmetrySettings>, notes: ResolvedNote[] = [], beat = 0) {
  return resolveVisualCopies(
    [symmetrySplitter.resolve({ settings: settings(overrides), notes })],
    beat,
  )
}

test('symmetry is registered as a splitter that adds one mirrored copy by default', () => {
  const def = getMoverOrSplitterDefinition('symmetry')
  assert.equal(def?.kind, 'splitter')
  assert.equal(def?.label, 'Symmetry')
  assert.equal(DEFAULTS.mirrors, 1)
  assert.equal(DEFAULTS.tilt, 0)
  assert.equal(DEFAULTS.plane, 0)
  assert.ok(DEFAULTS.spread > 0, 'a zero default spread would stack the copies invisibly')

  const copies = copiesFor({})
  assert.equal(copies.length, 2)
  const [original, mirrored] = copies.map(positionOf)
  assert.deepEqual(original, [DEFAULTS.spread, 0, 0])
  assert.deepEqual(mirrored, [-DEFAULTS.spread, 0, 0], 'the upright mirror line swaps left for right')
})

test('the copy count is 2 per mirror line, structural and beat-independent', () => {
  for (const mirrors of [1, 2, 3, 6, 12]) {
    assert.equal(copiesFor({ mirrors }).length, mirrors * 2)
  }
  const chain = [symmetrySplitter.resolve({ settings: settings({ mirrors: 4 }), notes: [] })]
  for (const beat of [0, 1.5, 97]) assert.equal(resolveVisualCopies(chain, beat).length, 8)
  // Out-of-range values clamp rather than emitting a degenerate slot list.
  assert.equal(copiesFor({ mirrors: 0 }).length, 2)
  assert.equal(copiesFor({ mirrors: 99 }).length, 24)
})

test('two mirror lines put the four copies on the corners of a square', () => {
  const positions = copiesFor({ mirrors: 2, spread: Math.SQRT2 }).map(positionOf)
  // Wedge center for two lines is the 45° diagonal, so a √2 spread lands on ±1.
  assert.deepEqual(positions, [
    [1, 1, 0],
    [-1, 1, 0],
    [-1, -1, 0],
    [1, -1, 0],
  ])
})

test('reflected slots are genuine mirror images and rotated slots are not', () => {
  const transforms = symmetryTransforms(settings({ mirrors: 3, spread: 2 }))
  assert.equal(transforms.length, 6)
  transforms.forEach((transform, slot) => {
    const determinant = round(transform.determinant())
    // Even slots are the rotations of the dihedral group, odd slots the mirrors.
    assert.equal(determinant, slot % 2 === 0 ? 1 : -1, `slot ${slot} handedness`)
  })
})

test('tilt turns the mirror line, so 90° mirrors up/down instead of left/right', () => {
  const positions = copiesFor({ tilt: 90, spread: 2 }).map(positionOf)
  assert.deepEqual(positions, [[0, -2, 0], [0, 2, 0]])

  // 45° is the diagonal mirror: reflecting across it swaps the two in-plane axes.
  const d = round(Math.SQRT2)
  assert.deepEqual(copiesFor({ tilt: 45, spread: 2 }).map(positionOf), [[d, -d, 0], [-d, d, 0]])
})

test('the plane select moves the whole arrangement onto the floor or the side wall', () => {
  assert.deepEqual(copiesFor({ plane: 1, spread: 3 }).map(positionOf), [[3, 0, 0], [-3, 0, 0]])
  assert.deepEqual(copiesFor({ plane: 2, spread: 3 }).map(positionOf), [[0, 0, 3], [0, 0, -3]])
  // Both depth planes still lay their copies flat in the chosen plane.
  for (const plane of [0, 1, 2]) {
    const off = copiesFor({ plane, mirrors: 4, spread: 2 }).map(positionOf)
    const constantAxis = [0, 1, 2].filter((axis) => off.every((p) => p[axis] === 0))
    assert.deepEqual(constantAxis, [[2], [1], [0]][plane], `plane ${plane} leaves one axis untouched`)
  }
})

test('size scales each copy about its own center, independent of spread', () => {
  const plain = copiesFor({ mirrors: 2, spread: Math.SQRT2 })
  const scaled = copiesFor({ mirrors: 2, spread: Math.SQRT2, size: 0.5 })
  // The arrangement keeps its footprint...
  assert.deepEqual(scaled.map(positionOf), plain.map(positionOf))
  // ...while every copy halves (basis column length, since the slots turn and
  // flip), and the mirrors stay genuine mirrors: a positive uniform scale must
  // not undo the reflections' negative determinant.
  scaled.forEach((copy, slot) => {
    const e = copy.transform.elements
    assert.equal(round(Math.hypot(e[0], e[1], e[2])), 0.5, `slot ${slot} scale`)
    assert.equal(Math.sign(round(copy.transform.determinant())), slot % 2 === 0 ? 1 : -1)
  })
  // Default 1 is neutral - old saves resolve to the untouched group math.
  for (const copy of plain) {
    const e = copy.transform.elements
    assert.equal(round(Math.hypot(e[0], e[1], e[2])), 1)
  }
})

test('spread 0 stacks the copies on the center, leaving movers below to part them', () => {
  const positions = copiesFor({ mirrors: 3, spread: 0 }).map(positionOf)
  for (const position of positions) assert.deepEqual(position, [0, 0, 0])
  // The transforms still differ - each copy carries its own reflected frame.
  const transforms = symmetryTransforms(settings({ mirrors: 3, spread: 0 }))
  assert.notDeepEqual(transforms[0].elements, transforms[1].elements)
})

test('slot transforms compose LOCALLY onto the incoming copy', () => {
  const input = identityVisualCopy()
  input.transform = new Matrix4().makeTranslation(10, 0, 0)
  input.opacity = 0.5
  input.colorShift.hue = 0.25
  const resolved = symmetrySplitter.resolve({ settings: settings({ spread: 2 }), notes: [] })
  const copies = resolved.apply(input, { beat: 0, index: 0, count: 1 })

  // previous * delta: the symmetry is centered on the object's own placement,
  // so both copies straddle x = 10 rather than the world origin.
  assert.deepEqual(copies.map(positionOf), [[12, 0, 0], [8, 0, 0]])
  for (const copy of copies) {
    assert.equal(copy.opacity, 0.5)
    assert.equal(copy.colorShift.hue, 0.25)
  }
  assert.equal(input.opacity, 0.5, 'input copy is not mutated')
  assert.deepEqual(
    new Vector3().setFromMatrixPosition(input.transform).toArray(),
    [10, 0, 0],
    'input transform is not mutated',
  )
})

test('a mirrored copy hands its reflected axes to the movers below it', () => {
  // The reflection's local +X points back toward the center, which is what
  // keeps a downstream translation symmetric instead of sliding the pair.
  const [, mirrored] = symmetryTransforms(settings({ spread: 1 }))
  const localX = new Vector3(1, 0, 0).transformDirection(mirrored)
  assert.deepEqual(localX.toArray().map(round), [-1, 0, 0])
})

test('the MIDI lane is the count lane on MIRRORS: notes latch a mirror count at their onset', () => {
  // One integer row per mirror count, matching an automation lane on MIRRORS.
  const rows = symmetrySplitter.midiRows?.(settings({ mirrors: 3 })) ?? []
  assert.equal(rows.length, 12)
  assert.deepEqual(rows[0], { pitch: 47, label: '12 mirrors' })
  assert.deepEqual(rows[rows.length - 1], { pitch: 36, label: '1 mirror' })

  // Pitch 38 = 3 mirror lines = the 6 slots of D_3, from the onset on
  // (duration ignored); the knob's single mirror holds before it.
  assert.equal(copiesFor({ mirrors: 1 }, [note(1, 38)], 0.5).length, 2)
  assert.equal(copiesFor({ mirrors: 1 }, [note(1, 38)], 0.5 + 1).length, 6)
  assert.equal(copiesFor({ mirrors: 1 }, [note(1, 38)], 20).length, 6, 'the latch holds')

  // The retired mute map's 96+ pitches fall out of the count span and no-op.
  const legacy = copiesFor({ mirrors: 3 }, [note(0, 126)], 0.5)
  assert.equal(legacy.length, 6)
  for (const copy of legacy) assert.equal(copy.opacity, 1)
})

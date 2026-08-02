import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import { getMoverOrSplitterDefinition } from './registry'
import { resolveVisualCopies } from './resolveVisualCopies'
import type { VisualCopy } from './types'
import {
  CONTOUR_SHAPE_CONE,
  contourHeight,
  contourMover,
  type ContourSettings,
} from './contour'

function settings(overrides: Partial<ContourSettings> = {}): ContourSettings {
  return {
    ...mergeDefinitionSettings(contourMover, undefined),
    ...overrides,
  } as unknown as ContourSettings
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

function apply(input: VisualCopy, p: ContourSettings, beat = 0): VisualCopy {
  return contourMover.resolve({ settings: p, notes: [] }).apply(input, { beat, index: 0, count: 1 })[0]
}

test('contour is registered as a passive mover with no MIDI vocabulary', () => {
  const definition = getMoverOrSplitterDefinition('contour')
  assert.equal(definition?.kind, 'mover')
  assert.equal(definition?.label, 'Contour')
  assert.equal(definition?.strictMidiRows, true)
  assert.deepEqual(definition!.midiRows!(settings()), [])
})

test('cone: depth is slope times radial distance from the center', () => {
  const p = settings({ shape: CONTOUR_SHAPE_CONE, slope: 0.5 })
  assert.equal(contourHeight(p, 0, 0), 0, 'the apex sits on the surface')
  assert.equal(contourHeight(p, 4, 0), 2)
  assert.equal(contourHeight(p, 3, 4), 2.5, 'radius is the euclidean distance')
  assert.equal(contourHeight(settings({ slope: -0.5 }), 4, 0), -2, 'negative slope recedes')
})

test('cone: the center moves the apex, not the formation', () => {
  const p = settings({ slope: 1, centerX: 3, centerY: -4 })
  assert.equal(contourHeight(p, 3, -4), 0)
  assert.equal(contourHeight(p, 6, 0), 5)
})

test('a copy is displaced along z only, at its own x/y', () => {
  const input = copyAt(4, 0, 5)
  const output = apply(input, settings({ slope: 0.5 }))
  assert.deepEqual(positionOf(output), [4, 0, 7])
  assert.deepEqual(positionOf(input), [4, 0, 5], 'input copy is not mutated')
})

test('displacement uses world z and preserves appearance', () => {
  const input = identityVisualCopy()
  input.transform = new Matrix4().makeRotationX(Math.PI / 2)
    .multiply(new Matrix4().makeTranslation(4, 0, 0))
  input.opacity = 0.4
  input.colorShift.hue = 0.2

  // The copy sits at world (4, 0, 0) but its local z points along world -Y.
  // World composition lifts it to (4, 0, 2); local composition would wrongly
  // slide it to (4, -2, 0).
  const output = apply(input, settings({ slope: 0.5 }))
  assert.deepEqual(positionOf(output), [4, 0, 2])
  assert.equal(output.opacity, 0.4)
  assert.equal(output.colorShift.hue, 0.2)
})

test('runtime placement makes copies read the surface at their actual position', () => {
  const mover = contourMover.resolve({ settings: settings({ slope: 0.5 }), notes: [] })
  const placement = new Matrix4().makeTranslation(3, 0, 0)
  const output = resolveVisualCopies([mover], 0, placement)[0]
  const rendered = placement.clone().multiply(output.transform)
  assert.deepEqual(positionOf({ ...output, transform: rendered }), [3, 0, 1.5])
})

test('zero slope preserves the copy bit-for-bit', () => {
  const input = copyAt(2, 3, 0)
  input.transform.multiply(new Matrix4().makeRotationZ(0.7))
  const output = apply(input, settings({ slope: 0 }))
  assert.deepEqual([...output.transform.elements], [...input.transform.elements])
})

test('the surface is beat-independent: scrubbing never moves it', () => {
  const p = settings({ slope: 0.7, centerX: 1 })
  const at = (beat: number) => positionOf(apply(copyAt(5, 2, 0), p, beat))
  const first = at(0)
  assert.deepEqual(at(3.7), first)
  assert.deepEqual(at(100), first)
})

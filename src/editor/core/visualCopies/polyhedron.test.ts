import assert from 'node:assert/strict'
import test from 'node:test'
import { Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { identityVisualCopy } from './identityVisualCopy'
import { resolveVisualCopies } from './resolveVisualCopies'
import { burstMover } from './library'
import {
  POLYHEDRON_SHAPES,
  polyhedronDirections,
  polyhedronSplitter,
  type PolyhedronSettings,
} from './polyhedron'
import { getMoverOrSplitterDefinition } from './registry'
import { mergeDefinitionSettings } from './definitions'
import type { VisualCopy } from './types'

const DEFAULTS = mergeDefinitionSettings(polyhedronSplitter, undefined) as unknown as PolyhedronSettings

function settings(overrides: Partial<PolyhedronSettings> = {}): PolyhedronSettings {
  return { ...DEFAULTS, ...overrides }
}

function note(beat: number, pitch: number, velocity = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity, durationBeats: 1 }
}

function positionOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const r = (n: number) => Math.round(n * 1e9) / 1e9 || 0
  return [r(e[12]), r(e[13]), r(e[14])]
}

const BURST_FORWARD = {
  settings: { burstBeats: 1, easing: 5, sharpness: 1, distanceX: 1, distanceY: 1, distanceZ: 1, distance: 1 },
  notes: [note(0, 64)], // Forward (+Z)
}

test('polyhedron is registered as a production splitter defaulting to icosahedron vertices', () => {
  const def = getMoverOrSplitterDefinition('polyhedron')
  assert.equal(def?.kind, 'splitter')
  assert.equal(def?.label, 'Polyhedron')
  assert.equal(POLYHEDRON_SHAPES[DEFAULTS.shape].label, 'Icosahedron')
  assert.equal(DEFAULTS.placement, 0)
  assert.equal(DEFAULTS.radius, 2)
  const copies = resolveVisualCopies([polyhedronSplitter.resolve({ settings: settings(), notes: [] })], 0)
  assert.equal(copies.length, 12)
})

test('every shape/placement pair yields the right structural, beat-independent count', () => {
  const counts: Record<string, [number, number]> = {
    Tetrahedron: [4, 4],
    Octahedron: [6, 8],
    Cube: [8, 6],
    Icosahedron: [12, 20],
    Dodecahedron: [20, 12],
  }
  POLYHEDRON_SHAPES.forEach((entry, shape) => {
    const [vertexCount, faceCount] = counts[entry.label]
    for (const [placement, expected] of [[0, vertexCount], [1, faceCount]] as const) {
      const chain = [polyhedronSplitter.resolve({ settings: settings({ shape, placement }), notes: [] })]
      for (const beat of [0, 1.5, 97]) assert.equal(resolveVisualCopies(chain, beat).length, expected)
    }
  })
})

test('all directions are unit length and copies sit on the radius shell', () => {
  POLYHEDRON_SHAPES.forEach((_, shape) => {
    for (const placement of [0, 1]) {
      for (const direction of polyhedronDirections(shape, placement)) {
        assert.ok(Math.abs(direction.length() - 1) < 1e-9)
      }
    }
  })
  const copies = resolveVisualCopies([
    polyhedronSplitter.resolve({ settings: settings({ radius: 3 }), notes: [] }),
  ], 0)
  for (const copy of copies) {
    assert.ok(Math.abs(new Vector3(...positionOf(copy)).length() - 3) < 1e-9)
  }
})

test('octahedron vertices land on the axes; cube face centers are its dual', () => {
  const copies = resolveVisualCopies([
    polyhedronSplitter.resolve({ settings: settings({ shape: 1, radius: 2 }), notes: [] }),
  ], 0)
  assert.deepEqual(copies.map(positionOf), [
    [2, 0, 0],
    [-2, 0, 0],
    [0, 2, 0],
    [0, -2, 0],
    [0, 0, 2],
    [0, 0, -2],
  ])
  const cubeFaces = resolveVisualCopies([
    polyhedronSplitter.resolve({ settings: settings({ shape: 2, placement: 1, radius: 2 }), notes: [] }),
  ], 0)
  assert.deepEqual(cubeFaces.map(positionOf), copies.map(positionOf))
})

test('copies preserve opacity and color shift and do not mutate the input', () => {
  const resolved = polyhedronSplitter.resolve({ settings: settings(), notes: [] })
  const input = identityVisualCopy()
  input.opacity = 0.5
  input.colorShift.hue = 0.25
  const copies = resolved.apply(input, { beat: 0, index: 0, count: 1 })
  for (const copy of copies) {
    assert.equal(copy.opacity, 0.5)
    assert.equal(copy.colorShift.hue, 0.25)
  }
  assert.equal(input.opacity, 0.5, 'input copy is not mutated')
})

test('each copy aims −Z at the center: a burst Forward (+Z) blooms the shell outward', () => {
  const chain = [
    polyhedronSplitter.resolve({ settings: settings({ shape: 1, radius: 2 }), notes: [] }),
    burstMover.resolve(BURST_FORWARD),
  ]
  // Landed +Z step of 1 in each copy's LOCAL frame pushes it from radius 2 to 3
  // along its own outward direction - including the −Z vertex, the antiparallel
  // lookAt case.
  const copies = resolveVisualCopies(chain, 5)
  assert.deepEqual(copies.map(positionOf), [
    [3, 0, 0],
    [-3, 0, 0],
    [0, 3, 0],
    [0, -3, 0],
    [0, 0, 3],
    [0, 0, -3],
  ])
})

test('the bloom holds for every icosahedron vertex direction', () => {
  const directions = polyhedronDirections(3, 0)
  const chain = [
    polyhedronSplitter.resolve({ settings: settings({ shape: 3, radius: 2 }), notes: [] }),
    burstMover.resolve(BURST_FORWARD),
  ]
  const copies = resolveVisualCopies(chain, 5)
  copies.forEach((copy, slot) => {
    const expected = directions[slot].clone().multiplyScalar(3)
    const actual = new Vector3(...positionOf(copy))
    assert.ok(actual.distanceTo(expected) < 1e-9, `slot ${slot}`)
  })
})

test('polyhedron MIDI rows disable copies only while their notes are held', () => {
  const tetra = settings({ shape: 0 })
  const rows = polyhedronSplitter.midiRows!(tetra)
  assert.deepEqual(rows.map((row) => row.label), [
    'Disable copy 1',
    'Disable copy 2',
    'Disable copy 3',
    'Disable copy 4',
  ])
  assert.equal(polyhedronSplitter.strictMidiRows, true)

  const resolved = polyhedronSplitter.resolve({ settings: tetra, notes: [note(0, rows[2].pitch)] })
  assert.deepEqual(resolveVisualCopies([resolved], 0.5).map((copy) => copy.opacity), [1, 1, 0, 1])
  assert.deepEqual(resolveVisualCopies([resolved], 1).map((copy) => copy.opacity), [1, 1, 1, 1])
})

test('a downstream index-aware mover sees the polyhedron indices', () => {
  const chain = [
    polyhedronSplitter.resolve({ settings: settings({ shape: 0 }), notes: [] }),
    {
      apply(visualCopy: VisualCopy, context: { beat: number; index: number; count: number }) {
        assert.equal(context.count, 4)
        return [{
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity * (context.index === 1 ? 0 : 1),
          colorShift: { ...visualCopy.colorShift },
        }]
      },
    },
  ]
  const copies = resolveVisualCopies(chain, 0)
  assert.deepEqual(copies.map((c) => c.opacity), [1, 0, 1, 1])
})

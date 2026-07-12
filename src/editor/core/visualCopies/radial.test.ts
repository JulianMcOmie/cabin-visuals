import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import { identityVisualCopy } from './identityVisualCopy'
import { resolveVisualCopies } from './resolveVisualCopies'
import { burstMover, radialSplitter, type RadialSettings } from './library'
import { getMoverOrSplitterDefinition } from './registry'
import { mergeDefinitionSettings } from './definitions'
import type { VisualCopy } from './types'

const DEFAULTS = mergeDefinitionSettings(radialSplitter, undefined) as unknown as RadialSettings

function settings(overrides: Partial<RadialSettings> = {}): RadialSettings {
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

test('radial is registered as a production splitter defaulting to 6 XY copies', () => {
  const def = getMoverOrSplitterDefinition('radial')
  assert.equal(def?.kind, 'splitter')
  assert.equal(def?.label, 'Radial')
  assert.equal(DEFAULTS.copies, 6)
  assert.equal(DEFAULTS.plane, 0)
  const copies = resolveVisualCopies([radialSplitter.resolve({ settings: settings(), notes: [] })], 0)
  assert.equal(copies.length, 6)
})

test('the copies param is structural and beat-independent', () => {
  const chain = [radialSplitter.resolve({ settings: settings({ copies: 4 }), notes: [] })]
  for (const beat of [0, 1.5, 97]) assert.equal(resolveVisualCopies(chain, beat).length, 4)
  assert.equal(resolveVisualCopies([radialSplitter.resolve({ settings: settings({ copies: 1 }), notes: [] })], 0).length, 1)
})

test('slot 0 is unrotated and copies preserve opacity and color shift', () => {
  const resolved = radialSplitter.resolve({ settings: settings({ copies: 3 }), notes: [] })
  const input = identityVisualCopy()
  input.opacity = 0.5
  input.colorShift.hue = 0.25
  const copies = resolved.apply(input, { beat: 0, index: 0, count: 1 })
  assert.deepEqual(copies[0].transform.elements, identityVisualCopy().transform.elements)
  for (const copy of copies) {
    assert.equal(copy.opacity, 0.5)
    assert.equal(copy.colorShift.hue, 0.25)
  }
  assert.equal(input.opacity, 0.5, 'input copy is not mutated')
})

test('a burst above the radial spreads its translation radially (XY plane)', () => {
  // Burst +X by 1 (landed), then split 4 ways about Z: slots at 0/90/180/270 deg.
  const chain = [
    burstMover.resolve({
      settings: { burstBeats: 1, easing: 5, sharpness: 1, distanceX: 1, distanceY: 1, distanceZ: 1, distance: 1 },
      notes: [note(0, 60)], // Right (+X)
    }),
    radialSplitter.resolve({ settings: settings({ copies: 4 }), notes: [] }),
  ]
  const copies = resolveVisualCopies(chain, 5)
  assert.deepEqual(copies.map(positionOf), [
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
    [0, -1, 0],
  ])
})

test('radial above the burst is different: all copies translate identically', () => {
  const chain = [
    radialSplitter.resolve({ settings: settings({ copies: 4 }), notes: [] }),
    burstMover.resolve({
      settings: { burstBeats: 1, easing: 5, sharpness: 1, distanceX: 1, distanceY: 1, distanceZ: 1, distance: 1 },
      notes: [note(0, 60)],
    }),
  ]
  const copies = resolveVisualCopies(chain, 5)
  assert.equal(copies.length, 4)
  for (const copy of copies) assert.deepEqual(positionOf(copy), [1, 0, 0])
})

test('the plane select changes the spread plane', () => {
  const chain = (plane: number) => [
    burstMover.resolve({
      settings: { burstBeats: 1, easing: 5, sharpness: 1, distanceX: 1, distanceY: 1, distanceZ: 1, distance: 1 },
      notes: [note(0, 60)],
    }),
    radialSplitter.resolve({ settings: settings({ copies: 4, plane }), notes: [] }),
  ]
  // XZ (about Y): +X spreads through -Z ... (right-handed: R_y(90deg) maps +X to -Z).
  assert.deepEqual(resolveVisualCopies(chain(1), 5).map(positionOf), [
    [1, 0, 0],
    [0, 0, -1],
    [-1, 0, 0],
    [0, 0, 1],
  ])
  // YZ (about X): a +Y burst spreads through +Z.
  const yChain = [
    burstMover.resolve({
      settings: { burstBeats: 1, easing: 5, sharpness: 1, distanceX: 1, distanceY: 1, distanceZ: 1, distance: 1 },
      notes: [note(0, 62)], // Up (+Y)
    }),
    radialSplitter.resolve({ settings: settings({ copies: 4, plane: 2 }), notes: [] }),
  ]
  assert.deepEqual(resolveVisualCopies(yChain, 5).map(positionOf), [
    [0, 1, 0],
    [0, 0, 1],
    [0, -1, 0],
    [0, 0, -1],
  ])
})

test('a downstream index-aware mover sees the radial indices', () => {
  const chain = [
    radialSplitter.resolve({ settings: settings({ copies: 3 }), notes: [] }),
    {
      apply(visualCopy: VisualCopy, context: { beat: number; index: number; count: number }) {
        assert.equal(context.count, 3)
        const next = {
          transform: visualCopy.transform.clone(),
          opacity: visualCopy.opacity * (context.index === 1 ? 0 : 1),
          colorShift: { ...visualCopy.colorShift },
        }
        return [next]
      },
    },
  ]
  const copies = resolveVisualCopies(chain, 0)
  assert.deepEqual(copies.map((c) => c.opacity), [1, 0, 1])
})

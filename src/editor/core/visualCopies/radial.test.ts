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

/** Per-axis scale: the lengths of the matrix's three basis columns. */
function scaleOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const len = (i: number) => Math.round(Math.hypot(e[i], e[i + 1], e[i + 2]) * 1e9) / 1e9
  return [len(0), len(4), len(8)]
}

test('radial is registered as a production splitter defaulting to 6 XY copies', () => {
  const def = getMoverOrSplitterDefinition('radial')
  assert.equal(def?.kind, 'splitter')
  assert.equal(def?.label, 'Radial')
  assert.equal(DEFAULTS.copies, 6)
  assert.equal(DEFAULTS.radius, 0)
  assert.equal(DEFAULTS.size, 1)
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

test('radius spaces copies around the selected radial plane', () => {
  const copies = resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 4, radius: 2 }), notes: [] }),
  ], 0)
  assert.deepEqual(copies.map(positionOf), [
    [2, 0, 0],
    [0, 2, 0],
    [-2, 0, 0],
    [0, -2, 0],
  ])

  const yz = resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 4, radius: 1, plane: 2 }), notes: [] }),
  ], 0)
  assert.deepEqual(yz.map(positionOf), [
    [0, 1, 0],
    [0, 0, 1],
    [0, -1, 0],
    [0, 0, -1],
  ])
})

test('size scales each copy about its own center, independent of radius', () => {
  const copies = resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 4, radius: 2, size: 0.5 }), notes: [] }),
  ], 0)
  // The ring stays exactly at the radius knob...
  assert.deepEqual(copies.map(positionOf), [
    [2, 0, 0],
    [0, 2, 0],
    [-2, 0, 0],
    [0, -2, 0],
  ])
  // ...while every copy is uniformly half size.
  for (const copy of copies) assert.deepEqual(scaleOf(copy), [0.5, 0.5, 0.5])

  // The default size of 1 leaves the transforms untouched.
  const unscaled = resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 4, radius: 2 }), notes: [] }),
  ], 0)
  for (const copy of unscaled) assert.deepEqual(scaleOf(copy), [1, 1, 1])
})

test('the MIDI lane is a value lane: automation-encoded radius rows, top = max', () => {
  const rows = radialSplitter.midiRows!(settings())
  assert.equal(rows.length, 49) // the automation pitch span, 36..84
  assert.deepEqual(rows[0], { pitch: 84, label: 'R 10.0' })
  assert.deepEqual(rows[rows.length - 1], { pitch: 36, label: 'R 0.0' })
  assert.equal(radialSplitter.strictMidiRows, true)
})

test('between onsets the radius swells 0 → r → 0; outside the span it rests at the knob', () => {
  // Two onsets at beats 1 and 3, both at pitch 84 (r = 10); knob radius 3.
  const resolved = radialSplitter.resolve({
    settings: settings({ copies: 1, radius: 3 }),
    notes: [note(1, 84), note(3, 84)],
  })
  const radiusAtBeat = (beat: number) => positionOf(resolveVisualCopies([resolved], beat)[0])[0]
  assert.equal(radiusAtBeat(0.5), 3, 'rests at the knob before the first onset')
  assert.equal(radiusAtBeat(1), 0, 'collapsed on the onset')
  assert.equal(radiusAtBeat(2), 10, 'peaks at the note value mid-cycle')
  assert.equal(radiusAtBeat(1.5), 7.5, 'the symmetric swell: 4u(1-u) at u = 0.25')
  assert.equal(radiusAtBeat(2.5), 7.5, '...and its mirror at u = 0.75')
  assert.equal(radiusAtBeat(3), 3, 'rests again from the last onset on')

  // Pitch encodes the peak: pitch 60 maps to r = 5 over the 36-84 span.
  const half = radialSplitter.resolve({
    settings: settings({ copies: 1, radius: 0 }),
    notes: [note(0, 60), note(2, 60)],
  })
  assert.equal(positionOf(resolveVisualCopies([half], 1)[0])[0], 5)
})

test('a lone onset is inert, chords keep the largest radius, out-of-span pitches are no-ops', () => {
  const lone = radialSplitter.resolve({ settings: settings({ copies: 1, radius: 2 }), notes: [note(1, 84)] })
  assert.equal(positionOf(resolveVisualCopies([lone], 1.5)[0])[0], 2, 'nothing to stretch to')

  // A chord at beat 0 (pitches 60 and 84) collapses to one boundary keeping r = 10.
  const chord = radialSplitter.resolve({
    settings: settings({ copies: 1, radius: 0 }),
    notes: [note(0, 60), note(0, 84), note(2, 60)],
  })
  assert.equal(positionOf(resolveVisualCopies([chord], 1)[0])[0], 10)

  // The retired mute rows (pitch 127 downward) fall outside the value span:
  // old saves degrade to the knob radius instead of misreading.
  const legacy = radialSplitter.resolve({
    settings: settings({ copies: 2, radius: 1.5 }),
    notes: [note(0, 127), note(2, 126)],
  })
  const copies = resolveVisualCopies([legacy], 1)
  assert.equal(positionOf(copies[0])[0], 1.5)
  assert.deepEqual(copies.map((copy) => copy.opacity), [1, 1], 'no mute gating either')
})

test('radial above the burst re-frames it: the translation spreads radially (XY plane)', () => {
  // Split 4 ways about Z, then burst +X by 1 (landed): each copy translates
  // along its OWN rotated axes - slots at 0/90/180/270 deg.
  const chain = [
    radialSplitter.resolve({ settings: settings({ copies: 4 }), notes: [] }),
    burstMover.resolve({
      settings: { burstBeats: 1, easing: 5, sharpness: 1, distanceX: 1, distanceY: 1, distanceZ: 1, distance: 1 },
      notes: [note(0, 60)], // Right (+X)
    }),
  ]
  const copies = resolveVisualCopies(chain, 5)
  assert.deepEqual(copies.map(positionOf), [
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
    [0, -1, 0],
  ])
})

test('a burst above the radial is different: copies rotate in place at the moved position', () => {
  const chain = [
    burstMover.resolve({
      settings: { burstBeats: 1, easing: 5, sharpness: 1, distanceX: 1, distanceY: 1, distanceZ: 1, distance: 1 },
      notes: [note(0, 60)],
    }),
    radialSplitter.resolve({ settings: settings({ copies: 4 }), notes: [] }),
  ]
  const copies = resolveVisualCopies(chain, 5)
  assert.equal(copies.length, 4)
  for (const copy of copies) assert.deepEqual(positionOf(copy), [1, 0, 0])
})

test('the plane select changes the spread plane', () => {
  const chain = (plane: number) => [
    radialSplitter.resolve({ settings: settings({ copies: 4, plane }), notes: [] }),
    burstMover.resolve({
      settings: { burstBeats: 1, easing: 5, sharpness: 1, distanceX: 1, distanceY: 1, distanceZ: 1, distance: 1 },
      notes: [note(0, 60)],
    }),
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
    radialSplitter.resolve({ settings: settings({ copies: 4, plane: 2 }), notes: [] }),
    burstMover.resolve({
      settings: { burstBeats: 1, easing: 5, sharpness: 1, distanceX: 1, distanceY: 1, distanceZ: 1, distance: 1 },
      notes: [note(0, 62)], // Up (+Y)
    }),
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

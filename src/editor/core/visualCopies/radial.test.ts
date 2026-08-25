import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { identityVisualCopy } from './identityVisualCopy'
import { resolveVisualCopies } from './resolveVisualCopies'
import { burstMover, radialSplitter, radialSweepFraction, type RadialSettings } from './library'
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

/** The copy's own +X direction in world axes - what FACING re-aims, and the
 *  axis a mover below the splitter reads as "right". */
function localXOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const len = Math.hypot(e[0], e[1], e[2]) || 1
  const r = (n: number) => Math.round((n / len) * 1e9) / 1e9 || 0
  return [r(e[0]), r(e[1]), r(e[2])]
}

/** The copy's own +Z direction in world axes - three's FORWARD, the one
 *  `lookAt` aims and therefore the one "facing the center" is about. */
function localZOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const len = Math.hypot(e[8], e[9], e[10]) || 1
  const r = (n: number) => Math.round((n / len) * 1e9) / 1e9 || 0
  return [r(e[8]), r(e[9]), r(e[10])]
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

// ── The polar options ────────────────────────────────────────────────────────

test('the polar options all default to the plain ring, and an old save merges to it', () => {
  assert.equal(DEFAULTS.sweep, 360)
  assert.equal(DEFAULTS.shape, 0)
  assert.equal(DEFAULTS.growth, 1)
  assert.equal(DEFAULTS.rise, 0)
  assert.equal(DEFAULTS.tilt, 0)
  assert.equal(DEFAULTS.facing, 0)

  // A save written before the options existed carries none of the keys; it
  // must resolve matrix-identical to the ring, which is what lets the four
  // knobs ship with no persistence upgrade.
  const legacy = { copies: 5, radius: 2, size: 1, plane: 0 } as RadialSettings
  const before = resolveVisualCopies([radialSplitter.resolve({ settings: legacy, notes: [] })], 0)
  const after = resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 5, radius: 2 }), notes: [] }),
  ], 0)
  assert.equal(before.length, 5)
  before.forEach((copy, index) => {
    assert.deepEqual(Array.from(copy.transform.elements), Array.from(after[index].transform.elements))
  })
})

test('rings default to 1, which makes all four per-ring amounts inert', () => {
  assert.equal(DEFAULTS.rings, 1)
  assert.equal(DEFAULTS.ringTwist, 0)

  // A save written before RINGS existed carries none of the keys - and
  // because ring 0 anchors all four amounts, it stays matrix-identical even
  // though SPACING merges to a non-zero default. That is what let the family
  // ship with no persistence upgrade.
  const legacy = { copies: 4, radius: 2, size: 1, plane: 0, sweep: 360 } as RadialSettings
  const before = resolveVisualCopies([radialSplitter.resolve({ settings: legacy, notes: [] })], 0)
  const after = resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 4, radius: 2 }), notes: [] }),
  ], 0)
  assert.equal(before.length, 4)
  assert.equal(after.length, 4)
  before.forEach((copy, index) => {
    assert.deepEqual(Array.from(copy.transform.elements), Array.from(after[index].transform.elements))
  })

  // Explicitly stacking the amounts on a single ring is still the plain ring.
  const inert = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({
        copies: 4, radius: 2, rings: 1, ringSpacing: 3, ringSize: 0.5, ringDepth: 2, ringTwist: 45,
      }),
      notes: [],
    }),
  ], 0)
  assert.deepEqual(inert.map(positionOf), after.map(positionOf))
  assert.deepEqual(inert.map(scaleOf), after.map(scaleOf))
})

test('rings repeat the ring outward, ring-major, spaced ADDITIVELY from the radius', () => {
  const copies = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({ copies: 2, radius: 1, rings: 3, ringSpacing: 2 }),
      notes: [],
    }),
  ], 0)
  // Ring 0's whole slot set first, then ring 1's, then ring 2's - so a ring is
  // a contiguous RUN of copy indices (what copy targeting's `runs` rule cuts).
  assert.deepEqual(copies.map(positionOf), [
    [1, 0, 0], [-1, 0, 0],
    [3, 0, 0], [-3, 0, 0],
    [5, 0, 0], [-5, 0, 0],
  ])
  assert.equal(copies.length, 6)

  // Negative spacing marches inward and CLAMPS at the center rather than
  // re-emerging on the far side.
  const inward = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({ copies: 2, radius: 2, rings: 3, ringSpacing: -1.5 }),
      notes: [],
    }),
  ], 0)
  assert.deepEqual(inward.map(positionOf), [
    [2, 0, 0], [-2, 0, 0],
    [0.5, 0, 0], [-0.5, 0, 0],
    [0, 0, 0], [0, 0, 0],
  ])
})

test('ring size and ring depth are independent of spacing and of each other', () => {
  const copies = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({ copies: 1, radius: 1, size: 2, rings: 3, ringSpacing: 0, ringSize: 0.5, ringDepth: -1 }),
      notes: [],
    }),
  ], 0)
  // SIZE is a ratio ON the shared knob, anchored at ring 0: 2, 1, 0.5.
  assert.deepEqual(copies.map(scaleOf), [[2, 2, 2], [1, 1, 1], [0.5, 0.5, 0.5]])
  // Zero spacing leaves every ring at the same radius - shrinking copies do
  // not pull the ring in - while DEPTH steps along the ring's own axis (Z in
  // the XY plane), exactly as RISE does per copy.
  assert.deepEqual(copies.map(positionOf), [[1, 0, 0], [1, 0, -1], [1, 0, -2]])

  // And the two really are separable: spacing alone moves nothing but radius.
  const spread = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({ copies: 1, radius: 1, rings: 2, ringSpacing: 1 }),
      notes: [],
    }),
  ], 0)
  assert.deepEqual(spread.map(scaleOf), [[1, 1, 1], [1, 1, 1]])
  assert.deepEqual(spread.map(positionOf), [[1, 0, 0], [2, 0, 0]])
})

test('ring twist turns each ring about the axis, changing bearing and nothing else', () => {
  // Degrees PER RING, anchored at ring 0: half a slot (180°/copies) is the
  // interleave that makes a stack read as one denser formation.
  const copies = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({ copies: 2, radius: 1, rings: 2, ringSpacing: 0, ringTwist: 90 }),
      notes: [],
    }),
  ], 0)
  assert.deepEqual(copies.map(positionOf), [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
  ])

  // It rides the slot ANGLE, so it leaves the radius, the axial steps (RISE
  // and RING DEPTH) and the size alone - only the bearing moves.
  const stacked = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({
        copies: 2, radius: 2, rings: 2, ringSpacing: 1, ringSize: 0.5, ringDepth: -1, rise: 0.5, ringTwist: 90,
      }),
      notes: [],
    }),
  ], 0)
  const plain = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({
        copies: 2, radius: 2, rings: 2, ringSpacing: 1, ringSize: 0.5, ringDepth: -1, rise: 0.5, ringTwist: 0,
      }),
      notes: [],
    }),
  ], 0)
  // Same radii, same axial positions, same scales - the twisted ring's copies
  // are the untwisted ones turned about the axis (Z, in the XY plane).
  assert.deepEqual(
    stacked.map((copy) => positionOf(copy).map((n) => Math.round(Math.abs(n) * 1e6) / 1e6).sort()),
    plain.map((copy) => positionOf(copy).map((n) => Math.round(Math.abs(n) * 1e6) / 1e6).sort()),
  )
  assert.deepEqual(stacked.map((copy) => positionOf(copy)[2]), plain.map((copy) => positionOf(copy)[2]))
  assert.deepEqual(stacked.map(scaleOf), plain.map(scaleOf))

  // UPRIGHT cancels the FULL bearing, twist included, so a twisted stack still
  // hands every mover below it the object's own unrotated axes.
  const upright = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({ copies: 2, radius: 1, rings: 2, ringTwist: 37, facing: 1 }),
      notes: [],
    }),
  ], 0)
  upright.forEach((copy) => assert.deepEqual(localXOf(copy), [1, 0, 0]))
})

test('every ring rides the MIDI radius lane, and the spiral anchors per ring', () => {
  // The lane samples ONE radius; the ring offsets ride on top of it, so a
  // swelling lane moves the whole stack and keeps its spacing.
  const swelling = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({ copies: 1, radius: 0, rings: 2, ringSpacing: 1 }),
      notes: [note(0, 84), note(4, 84)],
    }),
  ], 2)
  // Mid-interval the swell is at its peak (4u(1-u) at u = 0.5 = 1) -> radius 10.
  assert.deepEqual(swelling.map(positionOf), [[10, 0, 0], [11, 0, 0]])

  // Spiral GROWTH stays per COPY, anchored at each ring's own first slot.
  const spiral = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({ copies: 2, radius: 1, sweep: 0, shape: 1, growth: 2, rings: 2, ringSpacing: 1 }),
      notes: [],
    }),
  ], 0)
  assert.deepEqual(spiral.map(positionOf), [[1, 0, 0], [2, 0, 0], [2, 0, 0], [4, 0, 0]])
})

test('sweep under a full turn is an OPEN arc with a copy on each end', () => {
  const copies = resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 3, radius: 2, sweep: 180 }), notes: [] }),
  ], 0)
  assert.deepEqual(copies.map(positionOf), [
    [2, 0, 0],
    [0, 2, 0],
    [-2, 0, 0],
  ])

  // A quarter sweep with two copies is the degenerate open case: both ends.
  const quarter = resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 2, radius: 1, sweep: 90 }), notes: [] }),
  ], 0)
  assert.deepEqual(quarter.map(positionOf), [[1, 0, 0], [0, 1, 0]])
})

test('a whole number of turns is CLOSED - nothing doubles up at the seam', () => {
  // 360 divides i/count (the shipped behavior), and so does 720: four copies
  // over two turns land 180 deg apart, not 0/240/480/720 with the ends stacked.
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => radialSweepFraction(index, 4, 720)),
    [0, 0.25, 0.5, 0.75],
  )
  assert.deepEqual(
    [0, 1, 2].map((index) => radialSweepFraction(index, 3, 200)),
    [0, 0.5, 1],
  )
  // A sweep of 0 is open (every copy at angle 0) - a straight column when RISE
  // is on, not a divide-by-zero.
  assert.equal(radialSweepFraction(1, 4, 0), 1 / 3)
  const stacked = resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 3, radius: 1, sweep: 0 }), notes: [] }),
  ], 0)
  for (const copy of stacked) assert.deepEqual(positionOf(copy), [1, 0, 0])
})

test('spiral growth is a per-copy RADIUS ratio anchored at copy 0, and only in spiral mode', () => {
  const spiral = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({ copies: 3, radius: 2, sweep: 0, shape: 1, growth: 1.5 }),
      notes: [],
    }),
  ], 0)
  // Sweep 0 lines them up so the radii read straight off the X column.
  assert.deepEqual(spiral.map(positionOf), [[2, 0, 0], [3, 0, 0], [4.5, 0, 0]])

  // The same growth in circular mode is ignored: the mode select is what turns
  // the knob on, so a stored value can't act until it is asked for.
  const circular = resolveVisualCopies([
    radialSplitter.resolve({
      settings: settings({ copies: 3, radius: 2, sweep: 0, shape: 0, growth: 1.5 }),
      notes: [],
    }),
  ], 0)
  for (const copy of circular) assert.deepEqual(positionOf(copy), [2, 0, 0])

  // Growth rides on the MIDI-sampled radius, not on the knob: the lane still
  // owns the ring's size and the spiral keeps its proportions while it swells.
  const midi = radialSplitter.resolve({
    settings: settings({ copies: 2, radius: 0, sweep: 0, shape: 1, growth: 2 }),
    notes: [note(0, 84), note(2, 84)],
  })
  assert.deepEqual(resolveVisualCopies([midi], 1).map(positionOf), [[10, 0, 0], [20, 0, 0]])
})

test('rise steps each copy along the ring axis, per copy, without moving the radius', () => {
  const helix = resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 4, radius: 2, rise: 0.5 }), notes: [] }),
  ], 0)
  assert.deepEqual(helix.map(positionOf), [
    [2, 0, 0],
    [0, 2, 0.5],
    [-2, 0, 1],
    [0, -2, 1.5],
  ])

  // The axis follows the plane select - XZ turns about Y, so the rise is Y.
  const xz = resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 2, radius: 1, plane: 1, rise: -1 }), notes: [] }),
  ], 0)
  assert.deepEqual(xz.map(positionOf), [[1, 0, 0], [-1, -1, 0]])
})

test('facing re-aims each copy without moving it, and picks the frame movers below inherit', () => {
  const aim = (facing: number) => resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 4, radius: 2, facing }), notes: [] }),
  ], 0)

  // Outward (the shipped behavior): local +X points away from the center.
  assert.deepEqual(aim(0).map(localXOf), [[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]])
  // Upright: the slot rotation is cancelled, so every copy keeps the object's
  // own orientation - the whole matrix is a pure translation.
  const upright = aim(1)
  assert.deepEqual(upright.map(localXOf), [[1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0]])
  // Along path: a quarter turn on, so local +X is the ring's tangent.
  assert.deepEqual(aim(2).map(localXOf), [[0, 1, 0], [-1, 0, 0], [0, -1, 0], [1, 0, 0]])

  // None of it disturbs where the copies actually sit.
  for (const facing of [0, 1, 2]) {
    assert.deepEqual(aim(facing).map(positionOf), [[2, 0, 0], [0, 2, 0], [-2, 0, 0], [0, -2, 0]])
  }

  // The frame is what a mover below reads: an upright ring sends every copy
  // the SAME way on a +X burst, where the outward ring blooms.
  const burst = () => burstMover.resolve({
    settings: { burstBeats: 1, easing: 5, sharpness: 1, distanceX: 1, distanceY: 1, distanceZ: 1, distance: 1 },
    notes: [note(0, 60)],
  })
  assert.deepEqual(resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 4, radius: 2, facing: 1 }), notes: [] }),
    burst(),
  ], 5).map(positionOf), [
    [3, 0, 0],
    [1, 2, 0],
    [-1, 0, 0],
    [1, -2, 0],
  ])
})


test('tilt nods every copy about its OWN tangent - the ring closes, it does not lean', () => {
  const tilted = (overrides: Partial<RadialSettings>) => resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 4, radius: 2, ...overrides }), notes: [] }),
  ], 0)

  // A quarter turn tips every copy's outward +X onto the ring's OWN axis: the
  // umbrella fully closed. That the four copies agree in world space is the
  // whole point - a uniform world-axis rotation would send them four ways.
  assert.deepEqual(tilted({ tilt: 90 }).map(localXOf), [
    [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1],
  ])
  // The opposite sign opens it the other way, so the knob is genuinely bipolar.
  assert.deepEqual(tilted({ tilt: -90 }).map(localXOf), [
    [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1],
  ])
  // Half way is half way, per copy: the outward radial lifted 45 deg toward +Z.
  const h = Math.SQRT1_2
  const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9)
  const diagonal = tilted({ tilt: 45 }).map(localXOf)
  assert.ok(near(diagonal[0], [h, 0, h]))
  assert.ok(near(diagonal[1], [0, h, h]))
  assert.ok(near(diagonal[2], [-h, 0, h]))
  assert.ok(near(diagonal[3], [0, -h, h]))

  // Like FACING, it rides inside the slot: nothing moves.
  for (const tilt of [30, 90, 180, -120]) {
    assert.deepEqual(tilted({ tilt }).map(positionOf), [[2, 0, 0], [0, 2, 0], [-2, 0, 0], [0, -2, 0]])
  }
})

test('the tilt is a turn about the tangent LINE through each copy, in every plane and facing mode', () => {
  // The invariant the composition order exists to protect: whatever FACING
  // does, a tilted copy is the untilted copy turned about the ring's tangent
  // where it SITS - anchored on its own center, so it never moves. Upright is
  // the case that would break under the other order (it cancels the slot
  // rotation, so a tilt applied after it would lean all the copies the same
  // way in world space instead of closing the ring).
  const AXES = [new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)]
  const DIRS = [new Vector3(1, 0, 0), new Vector3(1, 0, 0), new Vector3(0, 1, 0)]
  const tilt = 37

  // RINGS is in the sweep because it is the one thing that can change which
  // bearing a slot wears - ring-major indices plus RING TWIST added to the
  // angle - and the tilt has to follow the bearing, not the copy's ordinal.
  const rings = 2
  const ringTwist = 25

  for (const plane of [0, 1, 2]) {
    const base = settings({
      copies: 5, radius: 2, plane, sweep: 360, rings, ringSpacing: 1, ringDepth: 0.4, ringTwist,
    })
    for (const facing of [0, 1, 2, 3]) {
      const flat = resolveVisualCopies([
        radialSplitter.resolve({ settings: { ...base, facing }, notes: [] }),
      ], 0)
      const nodded = resolveVisualCopies([
        radialSplitter.resolve({ settings: { ...base, facing, tilt }, notes: [] }),
      ], 0)
      assert.equal(flat.length, rings * 5)
      flat.forEach((copy, index) => {
        const angle = ((index % 5) / 5) * Math.PI * 2
          + (Math.floor(index / 5) * ringTwist * Math.PI) / 180
        // The tangent where this copy sits: the slot's own local tangent
        // carried around the ring by the slot rotation.
        const tangent = DIRS[plane].clone().cross(AXES[plane])
          .applyMatrix4(new Matrix4().makeRotationAxis(AXES[plane], angle))
        const [x, y, z] = positionOf(copy)
        const home = new Matrix4().makeTranslation(x, y, z)
        const expected = home.clone()
          .multiply(new Matrix4().makeRotationAxis(tangent, (tilt * Math.PI) / 180))
          .multiply(home.clone().invert())
          .multiply(copy.transform)
        nodded[index].transform.elements.forEach((value, i) => {
          assert.ok(
            Math.abs(value - expected.elements[i]) < 1e-9,
            `plane ${plane} facing ${facing} copy ${index} element ${i}: ${value} vs ${expected.elements[i]}`,
          )
        })
      })
    }
  }
})

test('facing the center aims each copy\'s forward axis at the ring center, in every plane', () => {
  for (const plane of [0, 1, 2]) {
    const copies = resolveVisualCopies([
      radialSplitter.resolve({
        settings: settings({ copies: 5, radius: 2, plane, facing: 3 }),
        notes: [],
      }),
    ], 0)
    copies.forEach((copy) => {
      // "Faces the center" IS this: local +Z along the inward radial, which
      // for a centered ring is the copy's own position negated.
      const position = positionOf(copy)
      const length = Math.hypot(...position) || 1
      const inward = position.map((v) => -v / length)
      localZOf(copy).forEach((value, i) => {
        assert.ok(Math.abs(value - inward[i]) < 1e-9, `plane ${plane}: ${value} vs ${inward[i]}`)
      })
    })

    // And it re-aims without moving anything - the same rule the other three
    // facing modes follow.
    const outward = resolveVisualCopies([
      radialSplitter.resolve({ settings: settings({ copies: 5, radius: 2, plane }), notes: [] }),
    ], 0)
    assert.deepEqual(copies.map(positionOf), outward.map(positionOf))
  }

  // What the fix costs differs by plane, and only because of where local +Z
  // starts. On a ring seen EDGE-ON the fix turns about the ring's own axis, so
  // the copies just swivel and the axis-aligned basis vector is untouched...
  const swivel = (plane: number, column: number) => {
    const copy = resolveVisualCopies([
      radialSplitter.resolve({ settings: settings({ copies: 3, radius: 2, plane, facing: 3 }), notes: [] }),
    ], 0)[1]
    return [copy.transform.elements[column], copy.transform.elements[column + 1], copy.transform.elements[column + 2]]
  }
  // XZ turns about +Y, so the copy's own UP survives: it stands and swivels.
  swivel(1, 4).forEach((value, i) => assert.ok(Math.abs(value - [0, 1, 0][i]) < 1e-9))
  // YZ turns about +X, so the copy's own +X survives.
  swivel(2, 0).forEach((value, i) => assert.ok(Math.abs(value - [1, 0, 0][i]) < 1e-9))
  // ...but a ring seen FACE-ON (XY) has local +Z pointing at the camera, so
  // the only way to aim it inward is to pitch OUT of the ring plane: the
  // copies go edge-on, their up swung onto the tangent. Stated, not an
  // oversight - TILT is the knob that dials that back.
  const faceOn = resolveVisualCopies([
    radialSplitter.resolve({ settings: settings({ copies: 4, radius: 2, facing: 3 }), notes: [] }),
  ], 0)
  const upOf = (copy: VisualCopy) => {
    const e = copy.transform.elements
    const r = (n: number) => Math.round(n * 1e9) / 1e9 || 0
    return [r(e[4]), r(e[5]), r(e[6])]
  }
  assert.deepEqual(faceOn.map(upOf), [[0, 1, 0], [-1, 0, 0], [0, -1, 0], [1, 0, 0]])
})

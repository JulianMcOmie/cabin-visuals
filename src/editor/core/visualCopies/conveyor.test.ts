import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import {
  GROUP_LOOP,
  conveyorMover,
  edgeFade,
  evaluateConveyorTravel,
  fadeWidth,
  latticeAlong,
  rampArea,
  type ConveyorSettings,
} from './conveyor'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import { getMoverOrSplitterDefinition } from './registry'
import type { VisualCopy } from './types'

const DEFAULTS = mergeDefinitionSettings(conveyorMover, undefined) as unknown as ConveyorSettings

function settings(overrides: Partial<ConveyorSettings> = {}): ConveyorSettings {
  return { ...DEFAULTS, ...overrides }
}

function note(beat: number, pitch: number, durationBeats = 4, velocity = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity, durationBeats }
}

/** One copy placed at `position` by the entries above this mover. */
function copyAt(position: [number, number, number]): VisualCopy {
  return {
    ...identityVisualCopy(),
    transform: new Matrix4().makeTranslation(position[0], position[1], position[2]),
  }
}

function applyAt(
  config: ConveyorSettings,
  notes: ResolvedNote[],
  beat: number,
  copy: VisualCopy = identityVisualCopy(),
): VisualCopy {
  const [out] = conveyorMover.resolve({ settings: config, notes })
    .apply(copy, { beat, index: 0, count: 1 })
  return out
}

function positionOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const r = (n: number) => Math.round(n * 1e9) / 1e9 || 0
  return [r(e[12]), r(e[13]), r(e[14])]
}

const RIGHT = 60
const LEFT = 61
const UP = 62
const NO_LOOP = { spanX: 0, spanY: 0, spanZ: 0 }
const INSTANT = { glide: 0, fadeBeats: 0 }

/** Applies to a whole formation at once, the way the resolver does. */
function applyFormation(
  config: ConveyorSettings,
  notes: ResolvedNote[],
  beat: number,
  formation: VisualCopy[],
): VisualCopy[] {
  const resolved = conveyorMover.resolve({ settings: config, notes })
  return formation.flatMap((copy, index) =>
    resolved.apply(copy, { beat, index, count: formation.length, formation }),
  )
}

/** A row of copies, evenly spaced along X — what a Grid splitter hands over. */
function lattice(count: number, spacing: number): VisualCopy[] {
  return Array.from({ length: count }, (_, index) =>
    copyAt([(index - (count - 1) / 2) * spacing, 0, 0]),
  )
}

const xs = (copies: VisualCopy[]) => copies.map((copy) => positionOf(copy)[0])

/** Gaps between adjacent positions once sorted — the shape of the formation,
 *  independent of which copy currently sits where. */
const spacings = (copies: VisualCopy[]) => {
  const sorted = xs(copies).slice().sort((a, b) => a - b)
  return sorted.slice(1).map((value, index) => Math.round((value - sorted[index]) * 1e6) / 1e6)
}

test('registered as a mover with the six-direction vocabulary at Burst pitches', () => {
  const def = getMoverOrSplitterDefinition('conveyor')
  assert.equal(def?.kind, 'mover')
  assert.equal(def?.label, 'Conveyor')
  assert.equal(def?.strictMidiRows, true)
  assert.deepEqual(
    (def?.midiRows?.(settings()) ?? []).map((row) => row.pitch).sort((a, b) => a - b),
    [60, 61, 62, 63, 64, 65],
  )
})

test('one copy in, one copy out, and no motion without notes', () => {
  const out = conveyorMover.resolve({ settings: settings(), notes: [] })
    .apply(identityVisualCopy(), { beat: 12, index: 0, count: 1 })
  assert.equal(out.length, 1)
  assert.deepEqual(positionOf(out[0]), [0, 0, 0])
  assert.equal(out[0].opacity, 1)
})

test('a held note moves at Speed per beat, and only while it is held', () => {
  const config = settings({ ...NO_LOOP, ...INSTANT, speed: 2 })
  const notes = [note(1, RIGHT, 3)]
  assert.deepEqual(positionOf(applyAt(config, notes, 0.5)), [0, 0, 0], 'not yet started')
  assert.deepEqual(positionOf(applyAt(config, notes, 2)), [2, 0, 0], 'one beat held')
  assert.deepEqual(positionOf(applyAt(config, notes, 4)), [6, 0, 0], 'three beats held')
  // The offset is KEPT after the note ends: the belt stops where it stopped.
  assert.deepEqual(positionOf(applyAt(config, notes, 40)), [6, 0, 0], 'stopped, not sprung home')
})

test('different notes pick orthogonal directions, and a chord runs diagonally', () => {
  const config = settings({ ...NO_LOOP, ...INSTANT, speed: 1 })
  assert.deepEqual(positionOf(applyAt(config, [note(0, LEFT, 2)], 2)), [-2, 0, 0])
  assert.deepEqual(positionOf(applyAt(config, [note(0, UP, 2)], 2)), [0, 2, 0])
  assert.deepEqual(
    positionOf(applyAt(config, [note(0, RIGHT, 2), note(0, UP, 2)], 2)),
    [2, 2, 0],
    'held together',
  )
  // Sequential notes turn the belt: right for two beats, then up for two.
  assert.deepEqual(
    positionOf(applyAt(config, [note(0, RIGHT, 2), note(2, UP, 2)], 4)),
    [2, 2, 0],
  )
})

test('velocity scales the speed', () => {
  const config = settings({ ...NO_LOOP, ...INSTANT, speed: 4 })
  assert.deepEqual(positionOf(applyAt(config, [note(0, RIGHT, 1, 0.5)], 1)), [2, 0, 0])
  assert.deepEqual(positionOf(applyAt(config, [note(0, RIGHT, 1, 64)], 1)), [2.015748031, 0, 0])
})

test('glide eases the belt up to speed without costing distance', () => {
  const glided = settings({ ...NO_LOOP, fadeBeats: 0, glide: 1, speed: 1 })
  const instant = settings({ ...NO_LOOP, ...INSTANT, speed: 1 })
  const notes = [note(0, RIGHT, 4)]
  const half = positionOf(applyAt(glided, notes, 0.5))[0]
  assert.ok(half > 0 && half < positionOf(applyAt(instant, notes, 0.5))[0], 'still spinning up')
  // Ramping up then down is symmetric, so the total travel is exactly the held
  // beats × speed once both ramps have finished.
  assert.deepEqual(positionOf(applyAt(glided, notes, 8)), [4, 0, 0])
  assert.equal(rampArea(0), 0)
  assert.equal(rampArea(3), 2.5)
})

test('a belt loops each copy at the FORMATION\'s period, never tearing it', () => {
  // The bug this replaces: with a loop box of its own choosing, a copy hit the
  // face while its neighbours were mid-frame and teleported ten units out of its
  // own row. The period comes from the formation, so the lattice maps onto
  // itself and the gaps are the same at every beat.
  const config = settings({ ...INSTANT, speed: 1 })
  const notes = [note(0, RIGHT, 64)]
  const formation = lattice(4, 2.2)
  for (const beat of [0, 0.5, 1.1, 2.7, 4.4, 9.9, 40]) {
    const out = applyFormation(config, notes, beat, formation)
    assert.deepEqual(spacings(out), [2.2, 2.2, 2.2], `beat ${beat}`)
  }
  // And the whole picture repeats every spacing of travel, which is what makes
  // the wrap invisible: one spacing later it is the same set of positions.
  const start = xs(applyFormation(config, notes, 1, formation)).slice().sort()
  const later = xs(applyFormation(config, notes, 3.2, formation)).slice().sort()
  start.forEach((value, index) => assert.ok(Math.abs(value - later[index]) < 1e-9))
})

test('a belt needs no fade, because the copy that leaves IS the one that arrives', () => {
  const config = settings({ glide: 0, speed: 3 })
  const formation = lattice(5, 1.5)
  const out = applyFormation(config, [note(0, RIGHT, 32)], 7.3, formation)
  assert.deepEqual(out.map((copy) => copy.opacity), [1, 1, 1, 1, 1])
})

test('an uneven formation falls back to moving as a group rather than guessing', () => {
  const config = settings({ spanX: 5, spanY: 0, spanZ: 0, ...INSTANT, speed: 1 })
  const uneven = [copyAt([-3, 0, 0]), copyAt([-0.5, 0, 0]), copyAt([2.5, 0, 0])]
  const out = applyFormation(config, [note(0, RIGHT, 64)], 7, uneven)
  // Same displacement for everyone: the arrangement is preserved exactly. Seven
  // units of travel in a ±5 loop leaves the group three units BEHIND home.
  assert.deepEqual(xs(out), [-6, -3.5, -0.5])
  assert.equal(latticeAlong(uneven, 0).period, 0, 'no period is claimed')
})

test('a group loops out and back as one rigid body, dissolving through the turn', () => {
  const config = settings({
    loopStyle: GROUP_LOOP, spanX: 5, spanY: 0, spanZ: 0, glide: 0, speed: 1, fadeBeats: 2,
  })
  const notes = [note(0, RIGHT, 64)]
  const formation = lattice(3, 1)
  const shape = spacings(formation)
  for (const beat of [1, 4.9, 5.05, 9, 12]) {
    const out = applyFormation(config, notes, beat, formation)
    assert.deepEqual(spacings(out), shape, `beat ${beat}`)
    // Every copy carries the same offset, so the group never distorts.
    const offsets = out.map((copy, index) => positionOf(copy)[0] - positionOf(formation[index])[0])
    assert.ok(offsets.every((offset) => Math.abs(offset - offsets[0]) < 1e-9), `beat ${beat}`)
  }
  // It is invisible AT the turn and back to full in the middle.
  assert.equal(applyFormation(config, notes, 5, formation)[0].opacity, 0)
  assert.equal(applyFormation(config, notes, 1, formation)[0].opacity, 1)
})

test('the fade lasts a fixed number of BEATS, so speed cannot outrun it', () => {
  // The reported jump: a fraction-of-span band is crossed in two frames at speed,
  // so the copy was still ~40% visible when it teleported. Tie the band to the
  // speed and the dissolve always takes fadeBeats, whatever the speed.
  const at = (speed: number, beat: number) => applyAt(
    settings({ loopStyle: GROUP_LOOP, spanX: 5, spanY: 0, spanZ: 0, glide: 0, speed }),
    [note(0, RIGHT, 64)],
    beat,
  ).opacity
  // One 24th of a beat before the turn, at any speed, it is essentially gone.
  for (const speed of [1, 3, 12]) {
    assert.ok(at(speed, 5 / speed - 1 / 24) < 0.05, `speed ${speed}`)
  }
  assert.equal(fadeWidth(settings({ speed: 4, fadeBeats: 0.5 }), 5), 2)
  assert.equal(fadeWidth(settings({ speed: 4, fadeBeats: 4 }), 5), 5, 'never wider than the span')
  assert.equal(edgeFade(0, 0, 1), 1, 'no looping on the axis, no fade')
  assert.equal(edgeFade(4.9, 5, 0), 1, 'fade off')
})

test('an axis with no travel is left completely alone', () => {
  // Adding the mover must not rearrange a splitter's layout in the axes it is
  // not running along - it used to fold all three into a box.
  const config = settings({ speed: 3, spanX: 1, spanY: 1, spanZ: 1, fadeBeats: 4 })
  const tall = [copyAt([0, 9, -14]), copyAt([0, -9, 14])]
  const out = applyFormation(config, [], 4, tall)
  assert.deepEqual(positionOf(out[0]), [0, 9, -14])
  assert.deepEqual(positionOf(out[1]), [0, -9, 14])
  assert.deepEqual(out.map((copy) => copy.opacity), [1, 1])
})

test('the fade multiplies whatever opacity arrives, and never colours anything', () => {
  const config = settings({ loopStyle: GROUP_LOOP, spanX: 5, spanY: 0, spanZ: 0, glide: 0, speed: 1 })
  const incoming: VisualCopy = { ...copyAt([1, 0, 0]), opacity: 0.5 }
  const out = applyAt(config, [note(0, RIGHT, 64)], 4.9, incoming)
  assert.ok(out.opacity > 0 && out.opacity < 0.5)
  assert.deepEqual(out.colorShift, incoming.colorShift)
});

test('travel is measured in the field box frame, not the incoming copy frame', () => {
  // Chain-root composition: a rotation above the mover re-frames the copy but
  // must not turn the belt, or the fixed loop planes stop meaning anything.
  const config = settings({ ...NO_LOOP, ...INSTANT, speed: 1 })
  const turned: VisualCopy = {
    ...identityVisualCopy(),
    transform: new Matrix4().makeRotationZ(Math.PI / 2),
  }
  assert.deepEqual(positionOf(applyAt(config, [note(0, RIGHT, 2)], 2, turned)), [2, 0, 0])
})

test('travel is a pure function of the beat, and closed form over a long belt', () => {
  const config = settings({ spanX: 5, spanY: 3, spanZ: 8 })
  const notes = [note(0, RIGHT, 64), note(8, UP, 16)]
  for (const beat of [0, 3.5, 12, 61.25]) {
    assert.deepEqual(
      evaluateConveyorTravel(notes, config, beat),
      evaluateConveyorTravel(notes, config, beat),
    )
  }
  // 64 beats of held note is 64 × speed of travel regardless of how many times
  // the copy has looped through the box (read after the glide has coasted out).
  assert.equal(evaluateConveyorTravel(notes, config, 66)[0], 64 * config.speed)
})

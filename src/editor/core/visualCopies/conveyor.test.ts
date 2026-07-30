import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import {
  conveyorMover,
  edgeFade,
  evaluateConveyorTravel,
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
const INSTANT = { glide: 0, fade: 0 }

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
  const glided = settings({ ...NO_LOOP, fade: 0, glide: 1, speed: 1 })
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

test('each copy loops on its OWN position, so a formation streams as a belt', () => {
  // Three copies laid out by a splitter above, all carried 4 units right in a
  // box 5 wide: the leading copy wraps to the far side, the others do not.
  const config = settings({ spanX: 5, spanY: 0, spanZ: 0, ...INSTANT, speed: 1 })
  const notes = [note(0, RIGHT, 4)]
  const at = (x: number) => positionOf(applyAt(config, notes, 4, copyAt([x, 0, 0])))[0]
  assert.equal(at(-4), 0)
  assert.equal(at(0), 4)
  assert.equal(at(2), -4, 'past the leading face, reappeared at the trailing one')
  // Spacing survives the wrap: the belt stays evenly spread, which is what makes
  // it read as endless rather than as copies jumping.
  assert.equal(at(3) - at(2), 1)
})

test('a copy fades out into the face it leaves and in through the one it enters', () => {
  const config = settings({ spanX: 5, spanY: 0, spanZ: 0, glide: 0, fade: 0.4, speed: 1 })
  const fadeAt = (x: number) => applyAt(config, [], 0, copyAt([x, 0, 0])).opacity
  assert.equal(fadeAt(0), 1, 'full in the middle')
  assert.equal(fadeAt(3), 1, 'full up to the fade band')
  assert.ok(fadeAt(4) > 0 && fadeAt(4) < 1, 'dissolving into the face')
  assert.equal(fadeAt(5), 0, 'gone at the face')
  // Symmetric, so the copy that vanished at +5 reappears at −5 equally invisible
  // and comes back at the same rate: no seam.
  assert.equal(fadeAt(-4), fadeAt(4))
  assert.equal(fadeAt(-5), 0)
  assert.equal(edgeFade(0, 0, 0.4), 1, 'no looping on the axis, no fade')
  assert.equal(edgeFade(4.9, 5, 0), 1, 'fade off')
})

test('the fade multiplies whatever opacity arrives, and never colours anything', () => {
  const config = settings({ spanX: 5, spanY: 0, spanZ: 0, fade: 0.4 })
  const incoming: VisualCopy = { ...copyAt([4.5, 0, 0]), opacity: 0.5 }
  const out = applyAt(config, [], 0, incoming)
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

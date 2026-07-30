import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import { getMoverOrSplitterDefinition } from './registry'
import { resolveVisualCopies } from './resolveVisualCopies'
import {
  DUPLICATE_PITCH,
  DUPLICATE_SPAWN_INTERVALS,
  duplicateSpawnInterval,
  duplicateSpawnTimeline,
  duplicateStateAt,
  duplicateTrailGeometry,
  duplicateTrailSplitter,
  lastSpawnIndex,
  type DuplicateTrailSettings,
} from './duplicateTrail'
import type { VisualCopy } from './types'

const DEFAULTS = mergeDefinitionSettings(duplicateTrailSplitter, undefined) as unknown as DuplicateTrailSettings

function settings(overrides: Partial<DuplicateTrailSettings> = {}): DuplicateTrailSettings {
  return { ...DEFAULTS, ...overrides }
}

function note(beat: number, durationBeats = 0, pitch = DUPLICATE_PITCH): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity: 1, durationBeats }
}

function copiesAt(config: DuplicateTrailSettings, beat: number, notes: ResolvedNote[] = []): VisualCopy[] {
  return resolveVisualCopies([duplicateTrailSplitter.resolve({ settings: config, notes })], beat)
}

/** Z offset and uniform scale of a copy's transform. */
function placementOf(copy: VisualCopy): { z: number; scale: number } {
  const e = copy.transform.elements
  return { z: Math.round(e[14] * 1e9) / 1e9 || 0, scale: Math.hypot(e[0], e[1], e[2]) }
}

test('registered as a splitter with exactly three knobs plus the rainbow switch', () => {
  const def = getMoverOrSplitterDefinition('duplicateTrail')
  assert.equal(def?.kind, 'splitter')
  assert.equal(def?.label, 'Duplicate')
  assert.deepEqual(def?.params.map((p) => p.key), ['size', 'speed', 'density', 'rainbow'])
  // The three dials are the numeric ones; rainbow is a switch, not a dial.
  assert.equal(def?.params.filter((p) => p.type === undefined || p.type === 'number').length, 2)
  assert.equal(def?.params.find((p) => p.key === 'density')?.type, 'select')
  assert.equal(def?.params.find((p) => p.key === 'rainbow')?.type, 'boolean')
})

test('one MIDI row: the note either duplicates or it does nothing', () => {
  const rows = duplicateTrailSplitter.midiRows?.(DEFAULTS) ?? []
  assert.deepEqual(rows, [{ pitch: DUPLICATE_PITCH, label: 'Duplicate' }])
  assert.equal(duplicateTrailSplitter.strictMidiRows, true)
})

test('every density option is a division of the beat', () => {
  for (const interval of DUPLICATE_SPAWN_INTERVALS) {
    const perBeat = 1 / interval
    const divides = Number.isInteger(interval) || Number.isInteger(Math.round(perBeat * 1e9) / 1e9)
    assert.equal(divides, true, `${interval} is not a beat division`)
  }
  assert.equal(duplicateSpawnInterval(settings({ density: 2 })), 1)
})

test('copy count is structural: neither the beat nor the notes change it', () => {
  const config = settings()
  const notes = [note(0, 4), note(6, 1)]
  const expected = duplicateTrailGeometry(config).duplicates + 1
  for (const beat of [-3, 0, 0.5, 2, 6.25, 40, 400]) {
    assert.equal(copiesAt(config, beat, notes).length, expected)
    assert.equal(copiesAt(config, beat).length, expected)
  }
})

test('slot count fills the trail and stays inside the copy budget', () => {
  // Every copy is a whole instrument, so the budget is a hard ceiling.
  const dense = duplicateTrailGeometry(settings({ speed: 0.5, density: 5 }))
  assert.equal(dense.duplicates, 64)
  // Truncated by the budget, so the far end is where the slots run out.
  assert.ok(dense.reach < 50)
  const sparse = duplicateTrailGeometry(settings({ speed: 40, density: 0 }))
  assert.equal(sparse.duplicates, 1)
})

test('the original is always there, untouched, even with no notes', () => {
  const copies = copiesAt(settings(), 12)
  assert.equal(copies[0].opacity, 1)
  assert.deepEqual(placementOf(copies[0]), { z: 0, scale: 1 })
  assert.equal(copies[0].colorShift.hue, 0)
  // Silence is opacity, never a missing slot.
  for (const copy of copies.slice(1)) assert.equal(copy.opacity, 0)
})

test('a duplicate is born exactly on top of the original, then retreats', () => {
  const config = settings({ speed: 6 })
  const onset = placementOf(copiesAt(config, 4, [note(4)])[1])
  // Same place, same size: nothing pops into existence, it peels off.
  assert.equal(onset.z, 0)
  assert.equal(Math.round(onset.scale * 1e6) / 1e6, 1)

  const later = placementOf(copiesAt(config, 5.5, [note(4)])[1])
  assert.equal(later.z, -9) // 1.5 beats * 6 units
})

test('a held note keeps spawning on the grid; a short note spawns once', () => {
  // Two beats held at 8ths: onset, +0.5, +1, +1.5 - and nothing on the note-off.
  assert.deepEqual(duplicateSpawnTimeline([note(1, 2)], 0.5), [1, 1.5, 2, 2.5])
  assert.deepEqual(duplicateSpawnTimeline([note(1)], 0.5), [1])
  assert.deepEqual(duplicateSpawnTimeline([note(1, 0.25)], 1), [1])
  // Other pitches are not this definition's business.
  assert.deepEqual(duplicateSpawnTimeline([note(1, 4, DUPLICATE_PITCH + 1)], 1), [])
  // Overlapping notes asking for the same instant are one copy, not two.
  assert.deepEqual(duplicateSpawnTimeline([note(0, 2), note(0, 1)], 1), [0, 1])
})

test('slots hold the most recent spawns, newest first', () => {
  const spawns = duplicateSpawnTimeline([note(0, 4)], 1)
  assert.deepEqual(spawns, [0, 1, 2, 3])
  assert.equal(lastSpawnIndex(spawns, -0.5), -1)
  assert.equal(lastSpawnIndex(spawns, 2), 2)
  assert.equal(lastSpawnIndex(spawns, 2.9), 2)
  assert.equal(lastSpawnIndex(spawns, 99), 3)

  const copies = copiesAt(settings({ speed: 6, density: 2 }), 3, [note(0, 4)])
  // Newest at the front, each a beat (6 units) further back than the last.
  assert.deepEqual([1, 2, 3, 4].map((slot) => placementOf(copies[slot]).z), [0, -6, -12, -18])
})

/** What a copy covers on screen, up to a constant: world scale over its
 *  distance from the default camera at z = 5. */
function apparentSize(distance: number, reach: number, size: number): number {
  return duplicateStateAt(distance, reach, size).scale / (5 + distance)
}

test('size is APPARENT size at the far end, and the ladder is geometric', () => {
  const config = settings({ size: 4, speed: 6, density: 2 })
  const { reach } = duplicateTrailGeometry(config)
  const original = apparentSize(0, reach, 4)
  assert.equal(duplicateStateAt(0, reach, 4).scale, 1)
  assert.equal(Math.round((apparentSize(reach, reach, 4) / original) * 1e6) / 1e6, 4)
  // Equal spacing, constant ratio - the compounding look, bounded by the knob.
  const ratios = [1, 2, 3].map((step) =>
    apparentSize(step * 6, reach, 4) / apparentSize((step - 1) * 6, reach, 4),
  )
  for (const ratio of ratios) assert.ok(Math.abs(ratio - ratios[0]) < 1e-9)
  // Below 1 the trail collapses toward a vanishing point instead.
  assert.ok(apparentSize(reach, reach, 0.25) < original)
  // At 1 it holds its apparent size, which means it hides behind the original.
  assert.ok(Math.abs(apparentSize(reach * 0.6, reach, 1) - original) < 1e-12)
})

test('the default actually shows: copies beat perspective and clear the original', () => {
  // A world-scale knob cannot do this - perspective shrinks faster than any
  // sane value grows - and a trail hidden behind the object is no trail.
  const { reach } = duplicateTrailGeometry(DEFAULTS)
  assert.ok(DEFAULTS.size > 1)
  assert.ok(apparentSize(reach * 0.5, reach, DEFAULTS.size) > apparentSize(0, reach, DEFAULTS.size))
})

test('a copy has faded out before its slot is recycled, so nothing pops', () => {
  for (const speed of [0.5, 6, 17.5, 40]) {
    for (let density = 0; density < DUPLICATE_SPAWN_INTERVALS.length; density++) {
      const config = settings({ speed, density })
      const { duplicates, reach } = duplicateTrailGeometry(config)
      const perStep = speed * duplicateSpawnInterval(config)
      // The oldest slot sits at least a full reach back when the trail is full.
      assert.ok(duplicates * perStep >= reach - 1e-9, `${speed}/${density}`)
      assert.equal(duplicateStateAt(duplicates * perStep, reach, config.size).opacity, 0)
    }
  }
})

test('opacity multiplies into whatever the chain already dimmed', () => {
  const config = settings({ speed: 6, density: 2 })
  const copies = copiesAt(config, 0.5, [note(0, 4)])
  const near = copies[1].opacity
  const far = copies[3].opacity
  assert.ok(near > 0 && near <= 1)
  assert.ok(far < near || far === 0)
})

test('rainbow walks the hue down the trail and leaves the original alone', () => {
  const plain = copiesAt(settings({ rainbow: 0, speed: 6, density: 2 }), 3, [note(0, 4)])
  for (const copy of plain) assert.equal(copy.colorShift.hue, 0)

  const config = settings({ rainbow: 1, speed: 6, density: 2 })
  const lit = copiesAt(config, 3, [note(0, 4)])
  assert.equal(lit[0].colorShift.hue, 0)
  const hues = [1, 2, 3, 4].map((slot) => lit[slot].colorShift.hue)
  assert.equal(hues[0], 0)
  for (let i = 1; i < hues.length; i++) assert.ok(hues[i] > hues[i - 1])
  // At most one full turn, so the trail never repeats a colour.
  assert.ok(hues[hues.length - 1] <= 1)
})

test('scrubbing agrees with playback: same beat, same copies', () => {
  const config = settings({ rainbow: 1 })
  const notes = [note(0, 3), note(5.25, 0.1)]
  const first = copiesAt(config, 6.75, notes)
  const second = copiesAt(config, 6.75, notes)
  assert.deepEqual(
    first.map((c) => [placementOf(c), c.opacity, c.colorShift.hue]),
    second.map((c) => [placementOf(c), c.opacity, c.colorShift.hue]),
  )
  for (const copy of first) {
    assert.equal(Number.isFinite(copy.opacity), true)
    assert.equal(Number.isFinite(placementOf(copy).scale), true)
  }
})

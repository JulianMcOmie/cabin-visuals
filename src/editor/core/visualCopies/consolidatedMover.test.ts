import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import {
  CONSOLIDATED_MOVER_BANKS,
  consolidatedMover,
  consolidatedMoverPitch,
} from './consolidatedMover'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import { getMoverOrSplitterDefinition } from './registry'

const MODULE_IDS = Object.keys(CONSOLIDATED_MOVER_BANKS)
// Consolidated has no string params, so its merged settings are all numeric.
const DEFAULTS = mergeDefinitionSettings(consolidatedMover, undefined) as Record<string, number>

function settings(
  enabled: string[],
  overrides: Record<string, number> = {},
): Record<string, number> {
  return {
    ...DEFAULTS,
    ...Object.fromEntries(MODULE_IDS.map((id) => [`enable__${id}`, enabled.includes(id) ? 1 : 0])),
    ...overrides,
  }
}

function note(pitch: number, beat = 0, durationBeats = 1): ResolvedNote {
  return {
    beat,
    blockStartBeat: 0,
    blockEndBeat: 1024,
    pitch,
    velocity: 1,
    durationBeats,
  }
}

function position(copy: ReturnType<typeof identityVisualCopy>): [number, number, number] {
  const e = copy.transform.elements
  const round = (value: number) => Math.round(value * 1e8) / 1e8 || 0
  return [round(e[12]), round(e[13]), round(e[14])]
}

test('All Movers is registered as a strict consolidated mover', () => {
  const definition = getMoverOrSplitterDefinition('allMovers')
  assert.equal(definition?.label, 'All Movers')
  assert.equal(definition?.kind, 'mover')
  assert.equal(definition?.strictMidiRows, true)
})

test('every enabled capability owns one collision-free bank inside MIDI 0..127', () => {
  const rows = consolidatedMover.midiRows!(settings(MODULE_IDS), { priorCount: 50 })
  const pitches = rows.map((row) => row.pitch)

  assert.equal(rows.length, 123)
  assert.equal(new Set(pitches).size, pitches.length)
  assert.ok(pitches.every((pitch) => pitch >= 0 && pitch <= 127))
  assert.equal(Math.min(...pitches), 0)
  assert.equal(Math.max(...pitches), 122)
  assert.deepEqual(
    MODULE_IDS.map((id) => CONSOLIDATED_MOVER_BANKS[id].start),
    [0, 26, 95, 101, 108, 115, 120, 122],
  )

  const eachVisibilityRow = consolidatedMover.midiRows!(
    settings(MODULE_IDS, { visibility__grouping: 0 }),
    { priorCount: 50 },
  )
  assert.equal(eachVisibilityRow.length, 128, 'Each Index uses every remaining MIDI pitch')
  assert.equal(new Set(eachVisibilityRow.map((row) => row.pitch)).size, 128)
  assert.equal(Math.max(...eachVisibilityRow.map((row) => row.pitch)), 127)
})

test('module switches control both the settings surface and MIDI vocabulary', () => {
  const motionOnly = settings(['motion'])
  const rows = consolidatedMover.midiRows!(motionOnly)
  assert.equal(rows.length, 26)
  assert.ok(rows.every((row) => row.label.startsWith('Motion · ')))
  assert.deepEqual(rows.map((row) => row.pitch), Array.from({ length: 26 }, (_, index) => index))

  const radialOnly = settings(['radialMotion'], { radialMotion__layers: 1 })
  const radialRows = consolidatedMover.midiRows!(radialOnly)
  assert.equal(radialRows.length, 23)
  assert.deepEqual(radialRows.map((row) => row.pitch), Array.from({ length: 23 }, (_, index) => 26 + index))

  const moduleParam = consolidatedMover.params.find((param) => param.key === 'radialMotion__layers')
  assert.equal(moduleParam?.showIf, 'enable__radialMotion')
})

test('bank notes are translated back into the selected mover vocabulary', () => {
  const config = settings(['motion'], {
    motion__spinX: 0,
    motion__spinY: 0,
    motion__spinZ: 0,
    motion__distanceX: 3,
    motion__distance: 1,
    motion__easing: 5,
    motion__burstBeats: 1,
  })
  // Motion row 7 is its Step right (+X) row, remapped into consolidated pitch 7.
  const resolved = consolidatedMover.resolve({
    settings: config,
    notes: [note(consolidatedMoverPitch('motion', 7))],
  })
  const copy = resolved.apply(identityVisualCopy(), { beat: 1, index: 0, count: 1 })[0]
  assert.deepEqual(position(copy), [3, 0, 0])
})

test('structural Radial Motion output composes inside the same mover', () => {
  const config = settings(['radialMotion'], {
    radialMotion__layers: 2,
    radialMotion__outerCopies: 2,
    radialMotion__innerCopies: 3,
  })
  const resolved = consolidatedMover.resolve({ settings: config, notes: [] })
  const copies = resolved.apply(identityVisualCopy(), { beat: 4, index: 0, count: 1 })

  assert.equal(copies.length, 12)
  assert.deepEqual([...new Set(copies.map((copy) => copy.colorShift.hue))], [0, 0.33])
})

test('Visibility can gate the result from the consolidated top bank', () => {
  const config = settings(['visibility'], {
    visibility__attackBeats: 0,
    visibility__releaseBeats: 0,
  })
  const pitch = consolidatedMoverPitch('visibility', 0)
  const visible = consolidatedMover
    .resolve({ settings: config, notes: [note(pitch, 0, 2)] })
    .apply(identityVisualCopy(), { beat: 1, index: 0, count: 1 })[0]
  const silent = consolidatedMover
    .resolve({ settings: config, notes: [] })
    .apply(identityVisualCopy(), { beat: 1, index: 0, count: 1 })[0]

  assert.equal(pitch, 122)
  assert.equal(visible.opacity, 1)
  assert.equal(silent.opacity, 0)
})

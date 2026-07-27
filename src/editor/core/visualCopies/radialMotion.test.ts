import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import {
  evaluateRadialMotionDegrees,
  evaluateRadialMotionRadius,
  radialMotionMover,
  radialMotionRadiusPitch,
  radialMotionSpinPitch,
  type RadialMotionSettings,
} from './radialMotion'
import { getMoverOrSplitterDefinition } from './registry'
import { resolveVisualCopies } from './resolveVisualCopies'
import type { VisualCopy } from './types'

const DEFAULTS = mergeDefinitionSettings(radialMotionMover, undefined) as unknown as RadialMotionSettings

function settings(overrides: Partial<RadialMotionSettings> = {}): RadialMotionSettings {
  return { ...DEFAULTS, ...overrides }
}

function note(beat: number, pitch: number): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity: 1, durationBeats: 0.25 }
}

function positionOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const rounded = (value: number) => Math.round(value * 1e8) / 1e8 || 0
  return [rounded(e[12]), rounded(e[13]), rounded(e[14])]
}

test('Radial Motion is one registered mover with 24 radius and 45 spin rows', () => {
  const def = getMoverOrSplitterDefinition('radialMotion')
  assert.equal(def?.kind, 'mover')
  assert.equal(def?.label, 'Radial Motion')
  assert.equal(radialMotionMover.strictMidiRows, true)
  const rows = radialMotionMover.midiRows!(settings())
  assert.equal(rows.length, 69)
  assert.equal(rows.filter((row) => row.pitch < 60).length, 24)
  assert.equal(rows.filter((row) => row.pitch >= 60).length, 45)
  assert.equal(new Set(rows.map((row) => row.pitch)).size, 69)
})

test('reducing the color-layer count also reduces the mover MIDI vocabulary', () => {
  const rows = radialMotionMover.midiRows!(settings({ layers: 1 }))
  assert.equal(rows.length, 23)
  assert.ok(rows.every((row) => row.label.startsWith('Layer 1')))
})

test('radius notes latch per layer and stage, gliding exponentially to the selected value', () => {
  const s = settings({
    outerRadius0: 0,
    outerRadius1: 2,
    outerRadius2: 4,
    outerRadius3: 8,
    transitionBeats: 1,
    curve: 6,
  })
  const notes = [note(0, radialMotionRadiusPitch(0, 0, 3))]
  assert.equal(evaluateRadialMotionRadius(notes, s, 0, 0, 0), 0)
  const halfway = evaluateRadialMotionRadius(notes, s, 0.5, 0, 0)
  assert.ok(halfway > 4 && halfway < 8, 'positive exponential curve eases out')
  assert.equal(evaluateRadialMotionRadius(notes, s, 1, 0, 0), 8)
  assert.equal(evaluateRadialMotionRadius(notes, s, 20, 0, 0), 8, 'the option remains latched')
  assert.equal(evaluateRadialMotionRadius(notes, s, 20, 1, 0), 0, 'another layer is independent')
  assert.equal(evaluateRadialMotionRadius(notes, s, 20, 0, 1), 0, 'the inner stage is independent')
})

test('a rapid radius retrigger begins from the exact in-flight value without jumping', () => {
  const s = settings({ outerRadius1: 2, outerRadius3: 8, transitionBeats: 1, curve: 5 })
  const far = note(0, radialMotionRadiusPitch(0, 0, 3))
  const near = note(0.25, radialMotionRadiusPitch(0, 0, 1))
  const beforeRetrigger = evaluateRadialMotionRadius([far], s, 0.25)
  const atRetrigger = evaluateRadialMotionRadius([far, near], s, 0.25)
  assert.equal(atRetrigger, beforeRetrigger)
  assert.equal(evaluateRadialMotionRadius([far, near], s, 1.25), 2)
})

test('shape, outer-stage, and inner-stage spin integrate independently and continuously', () => {
  const s = settings({ spinDegreesPerBeat: 60 })
  const notes = [
    note(0, radialMotionSpinPitch(1, 1, 4)), // layer 2 outer: forward full
    note(2, radialMotionSpinPitch(1, 1, 1)), // then reverse half
    note(4, radialMotionSpinPitch(1, 1, 2)), // then hold
  ]
  assert.equal(evaluateRadialMotionDegrees(notes, s, 2, 1, 1), 120)
  assert.equal(evaluateRadialMotionDegrees(notes, s, 4, 1, 1), 60)
  assert.equal(evaluateRadialMotionDegrees(notes, s, 20, 1, 1), 60)
  assert.equal(evaluateRadialMotionDegrees(notes, s, 20, 1, 0), 0)
  assert.equal(evaluateRadialMotionDegrees(notes, s, 20, 1, 2), 0)
  assert.equal(evaluateRadialMotionDegrees(notes, s, 20, 0, 1), 0)
})

test('one mover creates all three color layers and both nested radial stages', () => {
  const resolved = radialMotionMover.resolve({
    settings: settings({
      layers: 3,
      outerCopies: 4,
      innerCopies: 2,
      transitionBeats: 0,
      layer1Hue: 0,
      layer2Hue: 0.25,
      layer3Hue: -0.25,
      layer1Phase: 0,
      layer2Phase: 0,
      layer3Phase: 0,
    }),
    notes: [
      ...Array.from({ length: 3 }, (_, layer) => [
        note(0, radialMotionRadiusPitch(layer, 0, 2)),
        note(0, radialMotionRadiusPitch(layer, 1, 1)),
      ]).flat(),
    ],
  })
  const copies = resolveVisualCopies([resolved], 0)
  assert.equal(copies.length, 3 * 4 * 2)
  assert.deepEqual(copies.slice(0, 2).map(positionOf), [[3.9, 0, 0.001], [2.3, 0, 0.001]])
  assert.deepEqual(
    [copies[0], copies[8], copies[16]].map((copy) => copy.colorShift.hue),
    [0, 0.25, -0.25],
  )
})

test('color layers have a centered, unambiguous front-to-back Z order', () => {
  const resolved = radialMotionMover.resolve({
    settings: settings({
      layers: 3,
      outerCopies: 1,
      innerCopies: 1,
      outerRadius0: 0,
      innerRadius0: 0,
    }),
    notes: [],
  })
  const copies = resolveVisualCopies([resolved], 0)
  assert.deepEqual(copies.map(positionOf), [
    [0, 0, 0.001],
    [0, 0, 0],
    [0, 0, -0.001],
  ])
})

test('structural output count comes only from settings and stays fixed across MIDI and beat', () => {
  const s = settings({ layers: 2, outerCopies: 3, innerCopies: 4 })
  const notes = [
    note(2, radialMotionRadiusPitch(0, 0, 3)),
    note(4, radialMotionSpinPitch(1, 2, 4)),
  ]
  const empty = radialMotionMover.resolve({ settings: s, notes: [] })
  const active = radialMotionMover.resolve({ settings: s, notes })
  for (const beat of [0, 3, 100]) {
    assert.equal(resolveVisualCopies([empty], beat).length, 24)
    assert.equal(resolveVisualCopies([active], beat).length, 24)
  }
})

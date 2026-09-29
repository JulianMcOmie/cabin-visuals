import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { entryMaxOutputCount } from './maxOutputCount'
import { identityVisualCopy } from './identityVisualCopy'
import { MOVER_OR_SPLITTER_DEFINITIONS, radialSplitter } from './library'
import { mergeDefinitionSettings } from './definitions'
import { radialMotionMover } from './radialMotion'
import { consolidatedMover } from './consolidatedMover'
import { sharedLocalLayout } from './sharedLocalLayout'
import { gatedMoverOrSplitter } from './copyTargets'
import { bypassGated } from './bypass'
import { framedMoverOrSplitter } from './moverFrame'
import { switchGated, switcherVariantsFor, SWITCHER_SOLO } from './switcher'
import type { MoverOrSplitter } from './types'

const neverApply = (): never => { throw new Error('a count proof must not evaluate copies or sample a beat') }
const bounded = (maxOutputCount: number): MoverOrSplitter => ({ maxOutputCount, apply: neverApply })

test('count proofs read only exact metadata, reject unknown arity, clocks and invalid bounds', () => {
  const entries: [MoverOrSplitter, number | undefined][] = [
    [{ apply: neverApply }, undefined],
    [bounded(0), 0], [bounded(4096), 4096],
    ...[-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(value => [bounded(value), undefined] as [MoverOrSplitter, undefined]),
    [{ apply: neverApply, localTransforms: [new Matrix4(), new Matrix4()] }, 2],
    [{ apply: neverApply, localTransformsAtBeat: neverApply, localTransformCount: 3 }, 3],
    [{ apply: neverApply, localTransformsAtBeat: neverApply }, undefined],
    [{ apply: neverApply, localLayout: { transforms: [new Matrix4()] } }, 1],
    [{ apply: neverApply, localLayoutAtBeat: neverApply, localLayoutCount: 4, localLayoutUsesPlacement: true }, 4],
    [{ apply: neverApply, localLayoutAtBeat: neverApply }, undefined],
    [{ apply: neverApply, rootTransformAtBeat: neverApply }, 1],
    [{ apply: neverApply, gpuOperationAtBeat: neverApply }, 1],
    [{ apply: neverApply, localSlotMotion: true }, 1],
    [{ apply: neverApply, rootTransformAtBeat: neverApply, localTransforms: [new Matrix4()] }, undefined],
    [{ apply: neverApply, framedLocalTransformsAtBeat: neverApply, applyFramed: neverApply }, undefined],
    [{ ...bounded(3), framedLocalTransformsAtBeat: neverApply, applyFramed: neverApply }, 3],
    [{ ...bounded(1), emitsCopyClocks: true }, undefined],
  ]
  for (const [entry, expected] of entries) assert.equal(entryMaxOutputCount(entry), expected)
})

test('variant brackets prove dynamic bounds recursively and unknown or cyclic variants reject', () => {
  const small = bounded(2), large = bounded(32)
  const bracket: MoverOrSplitter = { apply: neverApply, structuralVariants: [small, large] }
  assert.equal(entryMaxOutputCount(bracket), 32)
  assert.equal(entryMaxOutputCount({ ...bounded(1), structuralVariants: [bracket] }), 32)
  assert.equal(entryMaxOutputCount({ ...bounded(1), structuralVariants: [{ apply: neverApply }] }), undefined)
  const cycle: MoverOrSplitter = { ...bounded(1) }
  cycle.structuralVariants = [cycle]
  assert.equal(entryMaxOutputCount(cycle), undefined)
  assert.equal(entryMaxOutputCount({ apply: neverApply, structuralVariants: [bracket, bracket] }), 32)
})

// The declarations are justified by each definition's return branches, not by
// these samples. The inventory catches new movers and regressions in either the
// declaration or inactive/live/singular/seek paths without inferring kind at runtime.
for (const def of MOVER_OR_SPLITTER_DEFINITIONS.filter(def => def.kind !== 'splitter'
  && def.id !== 'radialMotion' && def.id !== 'allMovers')) {
  test(`${def.id} declares one output through note, placement and formation contexts`, () => {
    const settings = mergeDefinitionSettings(def, undefined)
    const rows = def.midiRows?.(settings, { priorCount: 3 }) ?? []
    const pitches = [...new Set([rows[0]?.pitch ?? 60, rows[Math.floor(rows.length / 2)]?.pitch ?? 61, rows.at(-1)?.pitch ?? 62])]
    const notes = pitches.map((pitch, index) => ({ beat: index * .5, pitch, durationBeats: .5,
      velocity: .8, blockStartBeat: 0, blockEndBeat: 8 }))
    const formation = Array.from({ length: 3 }, (_, index) => {
      const copy = identityVisualCopy()
      copy.transform.makeRotationX(.2 * index).setPosition(index - 1, .3, -.2)
      copy.opacity = .6; copy.colorShift.hue = .2; copy.colorShift.tint = '#bb6633'
      return copy
    })
    for (const lane of [[], notes]) {
      const entry = def.resolve({ settings, notes: lane })
      assert.equal(entry.maxOutputCount, 1)
      assert.equal(entryMaxOutputCount(entry), 1)
      for (const beat of [-1, 0, .75, 4, .75]) for (let index = 0; index < 3; index++) {
        const placementTransform = index === 0 ? undefined : new Matrix4().makeScale(index === 1 ? 0 : -2, 1, 1)
        assert.equal(entry.apply(formation[index], { beat, index, count: 3, placementTransform,
          formation, birthBeat: index === 2 ? 0 : undefined }).length, 1)
      }
    }
  })
}

test('Radial Motion and the legacy modular rack prove fanout instead of claiming one output', () => {
  const radial = radialMotionMover.resolve({ settings: mergeDefinitionSettings(radialMotionMover,
    { copies0: 3, copies1: 2, copies2: 4 }) as never, notes: [] })
  assert.equal(entryMaxOutputCount(radial), 24)
  assert.equal(radial.apply(identityVisualCopy(), { beat: 2, index: 0, count: 1 }).length, 24)
  const rack = consolidatedMover.resolve({ settings: mergeDefinitionSettings(consolidatedMover,
    { enable__radialMotion: 1, radialMotion__copies0: 3, radialMotion__copies1: 2, radialMotion__copies2: 4 }) as never, notes: [] })
  assert.equal(entryMaxOutputCount(rack), 24)
  assert.equal(rack.apply(identityVisualCopy(), { beat: 2, index: 0, count: 1 }).length, 24)
})

test('target, bypass, switch and mover-frame wrappers retain bounds including identity arms', () => {
  for (const count of [0, 1, 3]) {
    const source: MoverOrSplitter = { maxOutputCount: count,
      apply: copy => Array.from({ length: count }, () => ({ ...copy, transform: copy.transform.clone() })) }
    const wrappers = [
      gatedMoverOrSplitter(source, { rule: 'every', slices: 2, on: [0] }),
      bypassGated(source, [beat => beat < 0]),
      switchGated(source, beat => beat >= 0, switcherVariantsFor(source, SWITCHER_SOLO, 0, 2)),
    ]
    for (const entry of wrappers) {
      assert.equal(entryMaxOutputCount(entry), Math.max(1, count))
      for (const beat of [-1, 1]) for (const index of [0, 1]) {
        assert.ok(entry.apply(identityVisualCopy(), { beat, index, count: 2 }).length <= Math.max(1, count))
      }
    }
    const frame = framedMoverOrSplitter(source, [sharedLocalLayout({ transforms: [new Matrix4()] })])
    assert.equal(entryMaxOutputCount(frame), count)
    assert.equal(frame.apply(identityVisualCopy(), { beat: 1, index: 0, count: 1 }).length, count)
  }
  const unknown: MoverOrSplitter = { apply: neverApply }
  assert.equal(entryMaxOutputCount(gatedMoverOrSplitter(unknown, { rule: 'every', slices: 2, on: [0] })), undefined)
  assert.equal(entryMaxOutputCount(bypassGated(unknown, [() => false])), undefined)
  assert.equal(entryMaxOutputCount(switchGated(unknown, () => true, [unknown])), undefined)
  assert.equal(entryMaxOutputCount(framedMoverOrSplitter(unknown, [bounded(1)])), undefined)
})

test('a count lane proves its whole MIDI range without sampling its current count', () => {
  const settings = mergeDefinitionSettings(radialSplitter, { copies: 2 })
  const rows = radialSplitter.midiRows!(settings as never)
  const highest = Math.max(...rows.map(row => row.pitch))
  const entry = radialSplitter.resolve({ settings: settings as never, notes: [{ pitch: highest,
    beat: 5, durationBeats: .5, velocity: 1, blockStartBeat: 0, blockEndBeat: 8 }] })
  const bound = entryMaxOutputCount(entry)!
  assert.ok(bound > 2)
  for (const beat of [0, 6, 0]) assert.ok(entry.apply(identityVisualCopy(), { beat, index: 0, count: 1 }).length <= bound)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import { isNumberParam } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings, type MoverOrSplitterDefinition } from './definitions'
import { MOVER_OR_SPLITTER_DEFINITIONS } from './library'
import { compileParticlePlan, particlePlanCopy, particlePlanEntryKind } from './particlePlan'
import { resolveVisualCopies } from './resolveVisualCopies'
import { sharedLocalLayout } from './sharedLocalLayout'
import type { MoverOrSplitter, VisualCopy } from './types'

const definitions = MOVER_OR_SPLITTER_DEFINITIONS
const expectedCompact = definitions.filter(definition => !definition.particleExecution)
const fallbackKinds = new Set(['formation', 'copy-clocks', 'unported', 'variable-fanout', 'device-control'])

function notesFor(definition: MoverOrSplitterDefinition<any>, settings: Record<string, string | number>): ResolvedNote[] {
  const rows = definition.midiRows?.(settings) ?? []
  return rows.map((row, index) => ({ pitch: row.pitch, beat: index % 3 * .3,
    velocity: .4 + index % 4 * .15, durationBeats: .4 + index % 3,
    blockStartBeat: 0, blockEndBeat: 8 }))
}

function resolve(definition: MoverOrSplitterDefinition<any>, overlay: Record<string, number> = {}): MoverOrSplitter {
  const settings = mergeDefinitionSettings(definition, overlay)
  return definition.resolve({ settings, notes: notesFor(definition, settings) })
}

function forbiddenApply(entry: MoverOrSplitter): MoverOrSplitter {
  const forbidden = () => { throw new Error('Compact compilation invoked per-copy apply') }
  return { ...entry, apply: forbidden,
    ...(entry.applyFramed ? { applyFramed: forbidden } : {}),
    ...(entry.structuralVariants ? { structuralVariants: entry.structuralVariants.map(forbiddenApply) } : {}),
  }
}

function near(a: number, b: number, message: string) {
  assert.ok(Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b)), `${message}: ${a} != ${b}`)
}

function copyNear(actual: VisualCopy, expected: VisualCopy, message: string) {
  actual.transform.elements.forEach((value, index) => near(value, expected.transform.elements[index], `${message} matrix ${index}`))
  near(actual.opacity, expected.opacity, `${message} opacity`)
  for (const channel of ['hue', 'saturation', 'lightness', 'tintAmount'] as const) {
    near(actual.colorShift[channel], expected.colorShift[channel], `${message} ${channel}`)
  }
  assert.equal(actual.colorShift.tint, expected.colorShift.tint, `${message} tint`)
  assert.equal(actual.colorShift.tintPerceptual ?? false, expected.colorShift.tintPerceptual ?? false, `${message} tint space`)
  assert.equal(actual.colorShift.huePerceptual ?? false, expected.colorShift.huePerceptual ?? false, `${message} hue space`)
}

test('every registered definition either requires compact execution or documents its concrete existing fallback', () => {
  for (const definition of definitions) {
    const fallback = definition.particleExecution
    const entry = resolve(definition)
    if (!fallback) {
      assert.notEqual(particlePlanEntryKind(entry), undefined,
        `${definition.id} must return a shared operation/layout proof or declare its concrete existing limitation`)
      continue
    }
    assert.ok(fallbackKinds.has(fallback.fallback), `${definition.id}: unknown fallback category`)
    assert.ok(fallback.reason.trim().length >= 40, `${definition.id}: explain the missing dependency or operation`)
    if (fallback.fallback === 'copy-clocks') assert.ok(entry.emitsCopyClocks, `${definition.id}: copy clocks must be real`)
    if (fallback.fallback === 'device-control') {
      assert.ok(entry.warpBeat || entry.bypassAt || definition.parentGate, `${definition.id}: a control must expose its control channel`)
    } else {
      assert.equal(particlePlanEntryKind(entry), undefined,
        `${definition.id} now provides compact execution; remove or narrow its obsolete fallback declaration`)
    }
  }
})

test('required compact definitions never expand a million-copy prefix, including inactive notes and repeated seeks', () => {
  const level = sharedLocalLayout({ transforms: Array.from({ length: 32 }, (_, index) =>
    new Matrix4().makeTranslation(index / 32, index % 5 / 11, index % 3 / 7)) })
  const prefix = [level, level, level, level].map(forbiddenApply)
  const placement = new Matrix4().makeRotationZ(.31).setPosition(.3, -.4, .7)
  for (const definition of expectedCompact) {
    const entry = forbiddenApply(resolve(definition))
    const seen = new Map<number, Float64Array>()
    for (const beat of [-.5, .2, 1.1, 4, .2]) {
      const plan = compileParticlePlan([...prefix, entry], 0, beat, placement)
      assert.ok(plan, `${definition.id} at ${beat} must keep its compact proof after the million-copy prefix`)
      assert.equal(plan.cpuPrefix, undefined, `${definition.id} must not evaluate a CPU prefix`)
      assert.ok(plan.count >= 32 ** 4, `${definition.id}: the submitted population must remain complete`)
      assert.ok(plan.matrices.length < 1000000, `${definition.id}: data must remain smaller than the population`)
      if (seen.has(beat)) assert.deepEqual(plan.matrices, seen.get(beat), `${definition.id}: seeking must reproduce the data`)
      seen.set(beat, plan.matrices.slice())
    }
  }
})

test('all required select modes and numeric bounds retain a compilable data contract', () => {
  for (const definition of expectedCompact) {
    const overlays: { name: string; value: Record<string, number> }[] = [{ name: 'defaults', value: {} }]
    for (const parameter of definition.params) {
      if (parameter.type === 'select') {
        for (const option of parameter.options) overlays.push({ name: `${parameter.key}=${option.value}`, value: { [parameter.key]: option.value } })
      } else if (isNumberParam(parameter)) {
        for (const value of [parameter.min, parameter.max]) overlays.push({ name: `${parameter.key}=${value}`, value: { [parameter.key]: value } })
      }
    }
    for (const overlay of overlays) {
      const entry = forbiddenApply(resolve(definition, overlay.value))
      for (const beat of [-.5, .7, 3]) {
        assert.ok(compileParticlePlan([entry], 0, beat), `${definition.id} ${overlay.name} at ${beat} lost its compact contract`)
      }
    }
  }
})

test('required definitions match the reference evaluator with placement, upstream appearance and later fanout', () => {
  const seed = sharedLocalLayout({ transforms: [
    new Matrix4().makeRotationY(.23).scale(new Vector3(-.8, 1.2, .9)).setPosition(-1.1, .4, -.3),
    new Matrix4().makeRotationZ(-.37).setPosition(.7, -.2, .9),
  ], opacities: [.6, .3], hueShifts: [.13, -.21] })
  const suffix = sharedLocalLayout({ transforms: [new Matrix4(), new Matrix4().makeTranslation(.41, -.13, .27)],
    opacities: [.7, .9], hueShifts: [.11, -.17] })
  const placement = new Matrix4().makeRotationZ(.19).scale(new Vector3(1.3, .8, 1.1)).setPosition(.31, -.47, .2)
  for (const definition of expectedCompact) {
    const chain = [seed, resolve(definition), suffix]
    for (const beat of [-.5, .2, 1.1, 4, .2]) {
      const plan = compileParticlePlan(chain, 0, beat, placement)
      assert.ok(plan, `${definition.id}: mixed-chain compilation`)
      assert.equal(plan.cpuPrefix, undefined, `${definition.id}: required data proofs must not hide a small CPU fallback`)
      const copies = resolveVisualCopies(chain, beat, placement)
      assert.equal(plan.count, copies.length, `${definition.id}: count`)
      copies.forEach((copy, index) => copyNear(particlePlanCopy(plan, index)!, copy, `${definition.id} at ${beat} copy ${index}`))
    }
  }
})

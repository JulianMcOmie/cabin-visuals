import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import { fluidImpactMover, type FluidImpactSettings } from './fluidImpact'
import { applyGpuOperation, isGpuOperationSupported } from './gpuOperations'
import { identityVisualCopy } from './identityVisualCopy'
import { getMoverOrSplitterDefinition } from './registry'
import { compileParticlePlan, particlePlanCopy } from './particlePlan'
import { resolveVisualCopies } from './resolveVisualCopies'
import { sharedLocalLayout } from './sharedLocalLayout'
import { splitterWithChildChain } from './splitterChildChain'
import type { MoverOrSplitter, VisualCopy } from './types'

const note = (beat = 0, velocity = 1, pitch = 60, durationBeats = 1): ResolvedNote =>
  ({ beat, velocity, pitch, durationBeats, blockStartBeat: 0, blockEndBeat: 64 })
const settings = (changes: Partial<FluidImpactSettings> = {}): FluidImpactSettings =>
  ({ ...mergeDefinitionSettings(fluidImpactMover, undefined), ...changes }) as unknown as FluidImpactSettings
const copyAt = (x: number, y = 0, z = 0): VisualCopy =>
  ({ ...identityVisualCopy(), transform: new Matrix4().makeTranslation(x, y, z) })
const position = (copy: VisualCopy) => new Vector3().setFromMatrixPosition(copy.transform)
const resolve = (changes: Partial<FluidImpactSettings> = {}, notes: ResolvedNote[] = [note()]) =>
  fluidImpactMover.resolve({ settings: settings(changes), notes })
const apply = (entry: MoverOrSplitter, input: VisualCopy, beat: number) => entry.apply(input, { beat, index: 0, count: 1 })[0]
function near(actual: number, expected: number, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`)
}
function copyNear(actual: VisualCopy, expected: VisualCopy) {
  actual.transform.elements.forEach((value, i) => near(value, expected.transform.elements[i]))
  assert.equal(actual.opacity, expected.opacity)
  assert.deepEqual(actual.colorShift, expected.colorShift)
}

test('Fluid Impact is a supported production mover with one impact trigger and explicit GPU proof', () => {
  const definition = getMoverOrSplitterDefinition('fluidImpact')
  assert.equal(definition, fluidImpactMover)
  assert.equal(definition.kind, 'mover')
  assert.equal(definition.label, 'Fluid Impact')
  assert.equal(definition.strictMidiRows, true)
  assert.deepEqual(definition.midiRows!(settings()).map(row => row.pitch), [60])
  assert.ok(!definition.legacy && !definition.extras)
  const entry = resolve()
  assert.equal(entry.maxOutputCount, 1)
  assert.equal(entry.composition, 'chainRoot')
  assert.ok(entry.gpuOperationAtBeat)
  assert.ok(!entry.gpuOperationUsesPlacement)
  assert.ok(isGpuOperationSupported(entry.gpuOperationAtBeat(.2)))
})

test('an impact strikes outward, rebounds inward, and returns exactly home without note-length dependence', () => {
  const s = settings({ curl: 0, turbulence: 0, rebound: .45, decay: 2 })
  const short = fluidImpactMover.resolve({ settings: s, notes: [note(1, 1, 60, .01)] })
  const long = fluidImpactMover.resolve({ settings: s, notes: [note(1, 1, 60, 100)] })
  const input = copyAt(1, .4, .2), start = position(input)
  for (const beat of [-1, .99, 1, 3, 100]) copyNear(apply(short, input, beat), input)
  assert.ok(position(apply(short, input, 1.2)).dot(start) > start.lengthSq(), 'fast outward displacement at the strike')
  assert.ok(position(apply(short, input, 2.4)).dot(start) < start.lengthSq(), 'the decaying wake pulls gently back inward')
  for (const beat of [1.2, 1.7, 2.4, 2.999]) copyNear(apply(short, input, beat), apply(long, input, beat))
  assert.ok(position(apply(short, input, 1 + 1e-7)).distanceTo(start) < 1e-4)
  assert.ok(position(apply(short, input, 3 - 1e-7)).distanceTo(start) < 1e-8)
})

test('velocity and overlapping notes superpose instead of replacing an earlier impact', () => {
  const input = copyAt(1, .3, -.2), base = position(input)
  const one = position(apply(resolve({}, [note(0)]), input, .5)).sub(base)
  const quarter = position(apply(resolve({}, [note(0, .25)]), input, .5)).sub(base)
  quarter.toArray().forEach((value, i) => near(value, one.getComponent(i) * .25))
  const two = position(apply(resolve({}, [note(0), note(0)]), input, .5)).sub(base)
  two.toArray().forEach((value, i) => near(value, one.getComponent(i) * 2))
  const earlier = position(apply(resolve({}, [note(0)]), input, .8)).sub(base)
  const later = position(apply(resolve({}, [note(.5)]), input, .8)).sub(base)
  const overlap = position(apply(resolve({}, [note(0), note(.5)]), input, .8)).sub(base)
  overlap.toArray().forEach((value, i) => near(value, earlier.getComponent(i) + later.getComponent(i)))
  const silence = resolve({}, [note(0, 0), note(0, 1, 59), note(0, 1, 61), note(5)])
  copyNear(apply(silence, input, .5), input)
})

test('fluid displacement varies coherently across neighboring copies while preserving their complete basis and appearance', () => {
  const entry = resolve(), input = copyAt(1, .3, -.2)
  const first = position(apply(entry, input, .5)).sub(position(input))
  const neighbor = copyAt(1.0001, .3001, -.1999)
  const second = position(apply(entry, neighbor, .5)).sub(position(neighbor))
  assert.ok(first.length() > .01, 'the default effect measurably displaces particles')
  assert.ok(first.distanceTo(second) < .01, 'nearby particles share a smooth field rather than independent random offsets')
  const other = copyAt(-1, -.3, .2), otherDelta = position(apply(entry, other, .5)).sub(position(other))
  assert.ok(first.distanceTo(otherDelta) > .01, 'the field is spatially varying rather than a uniform translation')
  for (const scale of [0, 1e-13, -2]) {
    const copy = copyAt(1, -.2, .4)
    copy.transform.set(1, .3, -.2, 1, .4, scale, .1, -.2, .2, -.3, 2, .4, 0, 0, 0, 1)
    copy.opacity = .37
    copy.colorShift = { hue: .2, saturation: -.1, lightness: .3, tint: '#123456', tintAmount: .7,
      tintPerceptual: true, huePerceptual: true }
    const before = copy.transform.elements.slice(), color = structuredClone(copy.colorShift)
    const result = entry.apply(copy, { beat: .5, index: 53421, count: 1048576, formation: [copy] })
    assert.equal(result.length, 1)
    assert.notEqual(result[0].transform, copy.transform)
    assert.deepEqual(copy.transform.elements, before)
    assert.deepEqual(result[0].transform.elements.slice(0, 12), before.slice(0, 12))
    near(result[0].transform.determinant(), copy.transform.determinant())
    assert.equal(result[0].opacity, .37)
    assert.deepEqual(result[0].colorShift, color)
    assert.ok(result[0].transform.elements.every(Number.isFinite))
  }
})

test('Fluid Impact has no playback history, copy-index dependence or hidden object-placement dependency', () => {
  const entry = resolve({}, [note(0, .7), note(.5), note(1, .2)])
  const input = copyAt(1, .3, -.2), seen = new Map<number, ReturnType<typeof structuredClone>>()
  for (const beat of [.2, .7, 1.3, -1, 9, .7, .2]) {
    const operation = entry.gpuOperationAtBeat!(beat)
    assert.equal(entry.gpuOperationAtBeat!(beat), operation, 'one shared field sample per beat')
    assert.ok(isGpuOperationSupported(operation))
    const serializable = structuredClone(operation)
    if (seen.has(beat)) assert.deepEqual(serializable, seen.get(beat))
    seen.set(beat, serializable)
    for (const placement of [new Matrix4(), new Matrix4().makeScale(0, 0, 0), new Matrix4().makeRotationZ(1).setPosition(4, 3, 2)]) {
      const actual = entry.apply(input, { beat, index: 998, count: 1024, placementTransform: placement })[0]
      const expected = apply(entry, input, beat)
      copyNear(actual, expected)
      assert.deepEqual(actual.transform, applyGpuOperation(operation, input.transform, new Matrix4()))
    }
  }
})

test('GPU compilation preserves Fluid Impact between correlated frames, appearance stages and singular copies', () => {
  const layouts = sharedLocalLayout({ transforms: [new Matrix4().makeTranslation(-1, .3, .2),
    new Matrix4().makeRotationY(.3).setPosition(1, -.3, .2)] })
  const child = sharedLocalLayout({ transforms: [new Matrix4().makeRotationZ(.7)] })
  const nested = splitterWithChildChain(layouts, [child])
  const mixed = sharedLocalLayout({ transforms: [new Matrix4(), new Matrix4().makeScale(0, 1, 1),
    new Matrix4().makeScale(1e-13, 1, 1), new Matrix4().makeScale(-.7, 1.2, .8)],
    opacities: [.7, .3, .6, .8], hueShifts: [.1, -.2, .3, -.4] })
  const chain = [nested, mixed, resolve(), nested]
  for (const beat of [.2, .9, 1.5, -.5, .9]) {
    const plan = compileParticlePlan(chain, 0, beat)!
    assert.ok(plan)
    assert.equal(plan.cpuPrefix, undefined)
    const expected = resolveVisualCopies(chain, beat)
    assert.equal(plan.count, expected.length)
    expected.forEach((copy, index) => copyNear(particlePlanCopy(plan, index)!, copy))
  }
})

test('compact support is quiet outside the field and remains finite at its center, boundary and tiny reach', () => {
  for (const radius of [.00001, .25, 6, 20]) {
    const center = new Vector3(.3, -.2, .7)
    const entry = resolve({ radius, centerX: center.x, centerY: center.y, centerZ: center.z })
    for (const distance of [0, radius * .5, radius * (1 - 1e-7), radius, radius * 2, 1e200]) {
      const input = copyAt(center.x + distance, center.y, center.z)
      const output = apply(entry, input, .5)
      assert.ok(output.transform.elements.every(Number.isFinite), `reach ${radius}, distance ${distance}`)
      // Settings outside the visible knob range may be sanitized, so exact
      // support assertions use valid radii; tiny direct inputs still stay finite.
      if (radius >= .25 && distance >= radius) copyNear(output, input)
    }
  }
})

test('serialized Fluid Impact operations support aliased matrices and conservative displacement bounds', () => {
  for (const axis of [0, 1, 2]) for (const beat of [.01, .2, .7, 1.499, 2]) {
    const entry = resolve({ axis, curl: -2, turbulence: 2, strength: 10, rebound: 1,
      eddySize: .1, flow: -2, centerX: .3, centerY: -.2, centerZ: .7 }, [note(), note(.2, .7)])
    const operation = entry.gpuOperationAtBeat!(beat), saved = structuredClone(operation)
    assert.ok(isGpuOperationSupported(operation))
    assert.equal(operation.scaleBound, 1)
    assert.equal(operation.positionScaleBound ?? 1, 1)
    assert.equal(operation.determinantPreserving, true)
    for (const point of [[0, 0, 0], [.3, -.2, .7], [1, .4, -.2], [-2, 3, 1], [100, -50, 0]]) {
      const input = new Matrix4().makeRotationX(.3).scale(new Vector3(-.7, 2, 1.3))
        .setPosition(...point as [number, number, number])
      const expected = applyGpuOperation(operation, input, new Matrix4()), original = input.clone()
      assert.equal(applyGpuOperation(operation, input, input), input)
      assert.deepEqual(input.elements, expected.elements)
      const shift = new Vector3().setFromMatrixPosition(input).sub(new Vector3().setFromMatrixPosition(original)).length()
      assert.ok(shift <= operation.translationBound + 1e-9, `${shift} exceeds displacement bound ${operation.translationBound}`)
    }
    assert.deepEqual(operation, saved, 'an operation record remains immutable during evaluation')
  }
})


test('unsorted notes and large timelines sample the same active impacts without depending on visit order', () => {
  const notes = [note(8, .2), note(.4, .7), note(3, .5), note(0), note(.4, .3)]
  const before = structuredClone(notes)
  const unsorted = resolve({}, notes), sorted = resolve({}, [...notes].sort((a, b) => a.beat - b.beat))
  const input = copyAt(1, .3, -.2)
  for (const beat of [.7, 8.2, -.5, 3.5, 1000000, .7]) copyNear(apply(unsorted, input, beat), apply(sorted, input, beat))
  assert.deepEqual(notes, before, 'resolving a field never sorts its caller-owned note array in place')
  const farTimeline = resolve({}, [note(1000000, .7)])
  assert.ok(apply(farTimeline, input, 1000000.2).transform.elements.every(Number.isFinite))
})

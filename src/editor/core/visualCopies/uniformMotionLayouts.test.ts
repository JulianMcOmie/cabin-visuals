import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import { physicsMover, buildPhysicsPieces, evaluatePhysicsValue, physicsTransform, type PhysicsSettings } from './physicsInterp'
import { waypointsMover, buildWaypointSegments, evaluateWaypointOffset, type WaypointsSettings } from './waypoints'
import { compileParticlePlan, particlePlanMatrix } from './particlePlan'
import { sharedLocalLayout } from './sharedLocalLayout'
import type { MoverOrSplitter } from './types'

const notes = [
  { beat: 0, pitch: 60, durationBeats: .5, velocity: .8, blockStartBeat: 0, blockEndBeat: 8 },
  { beat: .7, pitch: 63, durationBeats: .5, velocity: .6, blockStartBeat: 0, blockEndBeat: 8 },
  { beat: 2, pitch: 61, durationBeats: .5, velocity: .9, blockStartBeat: 0, blockEndBeat: 8 },
]

function check(entry: MoverOrSplitter, reference: (beat: number) => Matrix4) {
  const copy = identityVisualCopy()
  copy.transform.makeRotationX(.37).setPosition(2, -1, .3)
  copy.opacity = .43; copy.colorShift.hue = .17; copy.colorShift.tint = '#aa8844'
  assert.equal(entry.localTransformCount, 1)
  for (const beat of [-1, 0, .4, 1.3, 3, .4]) {
    const table = entry.localTransformsAtBeat!(beat)
    assert.deepEqual(table[0].elements, reference(beat).elements)
    const saved = table[0].elements.slice()
    const [out] = entry.apply(copy, { beat, index: 4, count: 9, placementTransform: new Matrix4().makeScale(0, 0, 0) })
    assert.deepEqual(out.transform.elements, copy.transform.clone().multiply(reference(beat)).elements)
    assert.equal(out.opacity, copy.opacity); assert.deepEqual(out.colorShift, copy.colorShift)
    assert.deepEqual(table[0].elements, saved)
    assert.equal(entry.localTransformsAtBeat!(beat), table)
    const plan = compileParticlePlan([sharedLocalLayout({ transforms: [copy.transform] }), entry], 0, beat)!
    assert.ok(plan)
    assert.deepEqual(particlePlanMatrix(plan, 0, new Matrix4()).elements, out.transform.elements)
  }
}

test('Physics publishes the same uniform local delta for every target and physical law', () => {
  for (const law of [0, 1, 2]) for (const target of [0, 1, 2, 3, 4, 5, 6]) {
    const settings = mergeDefinitionSettings(physicsMover, { law, target, amount: 3 }) as unknown as PhysicsSettings
    const pieces = buildPhysicsPieces(notes, settings)
    check(physicsMover.resolve({ settings, notes }), beat => physicsTransform(evaluatePhysicsValue(pieces, beat), settings))
  }
})

test('Waypoints publishes its original closed-form local displacement through seeks', () => {
  for (const layout of [0, 1, 2, 3]) for (const curve of [0, 1, 2, 3, 4]) {
    const settings = mergeDefinitionSettings(waypointsMover, { layout, curve }) as unknown as WaypointsSettings
    const segments = buildWaypointSegments(notes, settings)
    check(waypointsMover.resolve({ settings, notes }), beat => {
      const [x, y] = evaluateWaypointOffset(segments, settings, beat)
      return new Matrix4().makeTranslation(x, y, 0)
    })
  }
})

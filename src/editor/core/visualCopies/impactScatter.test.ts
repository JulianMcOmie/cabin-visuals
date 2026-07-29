import assert from 'node:assert/strict'
import test from 'node:test'
import { Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import {
  SCATTER_IMPACT_PITCH,
  SCATTER_IMPLODE_PITCH,
  SCATTER_SETTLE_PITCH,
  impactScatterMover,
  type ImpactScatterSettings,
} from './impactScatter'
import { getMoverOrSplitterDefinition } from './registry'
import type { VisualCopy } from './types'

function note(beat: number, pitch = SCATTER_IMPACT_PITCH, velocity = 1): ResolvedNote {
  return { beat, pitch, durationBeats: 0.25, velocity, blockStartBeat: 0, blockEndBeat: 1024 }
}

function settings(overrides: Partial<ImpactScatterSettings> = {}): ImpactScatterSettings {
  return {
    ...mergeDefinitionSettings(impactScatterMover, undefined),
    ...overrides,
  } as unknown as ImpactScatterSettings
}

function copyAt(x: number, y: number, z: number): VisualCopy {
  const copy = identityVisualCopy()
  copy.transform.makeTranslation(x, y, z)
  return copy
}

/** Distance the copy has been thrown from where it was placed. */
function throwDistance(
  config: ImpactScatterSettings,
  notes: ResolvedNote[],
  beat: number,
  home: [number, number, number] = [3, 0, 0],
): number {
  const resolved = impactScatterMover.resolve({ settings: config, notes })
  const [result] = resolved.apply(copyAt(...home), { beat, index: 0, count: 1 })
  const moved = new Vector3().setFromMatrixPosition(result.transform)
  return moved.sub(new Vector3(...home)).length()
}

test('impact scatter is registered under its definition id', () => {
  assert.equal(getMoverOrSplitterDefinition('impactScatter'), impactScatterMover)
})

test('with no notes every copy is left exactly where it was placed', () => {
  const resolved = impactScatterMover.resolve({ settings: settings(), notes: [] })
  const [result] = resolved.apply(copyAt(2, -1, 4), { beat: 12, index: 0, count: 1 })
  assert.deepEqual(
    new Vector3().setFromMatrixPosition(result.transform).toArray(),
    [2, -1, 4],
  )
  assert.equal(result.opacity, 1)
  assert.equal(result.colorShift.lightness, 0)
})

test('the field is at rest before the impact and thrown after it', () => {
  const config = settings()
  const notes = [note(4)]
  assert.equal(throwDistance(config, notes, 3.5), 0)
  assert.ok(throwDistance(config, notes, 4.3) > 0.5)
})

test('a copy returns home once the spring has run out', () => {
  const config = settings({ settleBeats: 1.5, bounce: 0.2 })
  const notes = [note(0)]
  assert.ok(throwDistance(config, notes, 0.5) > 0.5)
  // Well past the tail the table window has closed, so rest is exact.
  assert.equal(throwDistance(config, notes, 400), 0)
})

test('the blast front reaches a near copy before a far one', () => {
  const config = settings({ waveSpeed: 4, reach: 40 })
  const notes = [note(0)]
  // The front covers 4 units per beat: at beat 0.8 it has passed the near copy
  // (arrival 0.5) and is nowhere near the far one (arrival 3).
  const near = throwDistance(config, notes, 0.8, [2, 0, 0])
  const far = throwDistance(config, notes, 0.8, [12, 0, 0])
  assert.ok(near > 0.2, `near copy should be flying, got ${near}`)
  assert.equal(far, 0)
})

test('power falls off with distance from the impact center', () => {
  const config = settings({ waveSpeed: 400, reach: 4 })
  const notes = [note(0)]
  const near = throwDistance(config, notes, 0.25, [1, 0, 0])
  const far = throwDistance(config, notes, 0.25, [9, 0, 0])
  assert.ok(near > far * 2, `expected strong falloff, got near ${near} far ${far}`)
})

test('rapid fire compounds: four hits throw further than one', () => {
  const config = settings({ pileup: 0, drag: 0.2, leash: 40 })
  const single = [note(0)]
  const roll = [note(0), note(0.25), note(0.5), note(0.75)]
  const singlePeak = Math.max(
    ...Array.from({ length: 40 }, (_, i) => throwDistance(config, single, i * 0.1)),
  )
  const rollPeak = Math.max(
    ...Array.from({ length: 40 }, (_, i) => throwDistance(config, roll, i * 0.1)),
  )
  assert.ok(
    rollPeak > singlePeak * 1.5,
    `a roll should stack well past one hit: single ${singlePeak}, roll ${rollPeak}`,
  )
})

test('compounding is nonlinear, not superposition', () => {
  // Two hits an eighth apart, against one hit of twice the impulse. A linear
  // superposition model would make these agree at the second onset; drag and
  // the leash mean they cannot.
  const config = settings({ drag: 1.2, leash: 3, pileup: 0 })
  const stacked = Math.max(
    ...Array.from({ length: 30 }, (_, i) => throwDistance(config, [note(0), note(0.5)], i * 0.1)),
  )
  const doubled = Math.max(
    ...Array.from({ length: 30 }, (_, i) => throwDistance(
      settings({ drag: 1.2, leash: 3, pileup: 0, blastSpeed: 28 }),
      [note(0)],
      i * 0.1,
    )),
  )
  assert.ok(Math.abs(stacked - doubled) > 0.05, 'nonlinear terms must break superposition')
})

test('pileup makes a second hit land harder than the first', () => {
  const notes = [note(0), note(0.4)]
  const calm = Math.max(
    ...Array.from({ length: 30 }, (_, i) => throwDistance(settings({ pileup: 0 }), notes, i * 0.1)),
  )
  const wild = Math.max(
    ...Array.from({ length: 30 }, (_, i) => throwDistance(settings({ pileup: 1.5 }), notes, i * 0.1)),
  )
  assert.ok(wild > calm * 1.1, `pileup should escalate: ${calm} → ${wild}`)
})

test('the leash bounds a long roll instead of letting it exit the scene', () => {
  const config = settings({ leash: 2, blastSpeed: 60, pileup: 2 })
  const roll = Array.from({ length: 24 }, (_, i) => note(i * 0.125))
  const peak = Math.max(
    ...Array.from({ length: 80 }, (_, i) => throwDistance(config, roll, i * 0.05)),
  )
  assert.ok(Number.isFinite(peak) && peak < 2 * 12, `containment failed: ${peak}`)
})

test('implode pulls inward while impact pushes outward', () => {
  const config = settings({ scatter: 0, swirl: 0, lift: 0, spinKick: 0, waveSpeed: 400 })
  const home = new Vector3(4, 0, 0)
  const radialAt = (pitch: number) => {
    const resolved = impactScatterMover.resolve({ settings: config, notes: [note(0, pitch)] })
    const [result] = resolved.apply(copyAt(4, 0, 0), { beat: 0.2, index: 0, count: 1 })
    return new Vector3().setFromMatrixPosition(result.transform).sub(home).x
  }
  assert.ok(radialAt(SCATTER_IMPACT_PITCH) > 0.2)
  assert.ok(radialAt(SCATTER_IMPLODE_PITCH) < -0.2)
})

test('a settle note damps the field mid-flight', () => {
  const config = settings({ settleBeats: 6, waveSpeed: 400 })
  const flying = [note(0)]
  const damped = [note(0), note(0.5, SCATTER_SETTLE_PITCH)]
  assert.ok(
    throwDistance(config, damped, 0.75) < throwDistance(config, flying, 0.75) * 0.5,
    'the snap-home note should collapse most of the displacement',
  )
})

test('two copies at the same distance scatter in different directions', () => {
  const config = settings({ scatter: 1 })
  const resolved = impactScatterMover.resolve({ settings: config, notes: [note(0)] })
  const context = { beat: 0.3, count: 2 }
  const [a] = resolved.apply(copyAt(3, 0, 0), { ...context, index: 0 })
  const [b] = resolved.apply(copyAt(0, 0, 3), { ...context, index: 1 })
  const aOffset = new Vector3().setFromMatrixPosition(a.transform).sub(new Vector3(3, 0, 0))
  const bOffset = new Vector3().setFromMatrixPosition(b.transform).sub(new Vector3(0, 0, 3))
  // Same radial magnitude, but their lateral axes are seeded independently.
  assert.ok(Math.abs(aOffset.length() - bOffset.length()) > 1e-4)
})

test('evaluation is a pure function of the beat', () => {
  const config = settings()
  const notes = [note(0), note(0.3), note(1.1, SCATTER_IMPLODE_PITCH)]
  const resolved = impactScatterMover.resolve({ settings: config, notes })
  const sample = () => resolved
    .apply(copyAt(2, 1, -1), { beat: 0.77, index: 3, count: 8 })[0]
    .transform.elements.join(',')
  const first = sample()
  // Out-of-order reads must not change what a beat looks like.
  resolved.apply(copyAt(2, 1, -1), { beat: 9.5, index: 3, count: 8 })
  resolved.apply(copyAt(-5, 2, 7), { beat: 0.1, index: 4, count: 8 })
  assert.equal(sample(), first)
  assert.equal(impactScatterMover.resolve({ settings: config, notes })
    .apply(copyAt(2, 1, -1), { beat: 0.77, index: 3, count: 8 })[0]
    .transform.elements.join(','), first)
})

test('hits far apart in time are independent clusters, not one long table', () => {
  const config = settings({ settleBeats: 0.6, bounce: 0 })
  const lone = throwDistance(config, [note(0)], 0.3)
  const withDistantSibling = throwDistance(config, [note(0), note(300)], 0.3)
  assert.equal(lone, withDistantSibling)
  // …and the distant one still fires, with the same trajectory as the first.
  assert.ok(Math.abs(throwDistance(config, [note(0), note(300)], 300.3) - lone) < 1e-6)
})

test('flight heats the copy and settling cools it', () => {
  const resolved = impactScatterMover.resolve({ settings: settings(), notes: [note(0)] })
  const heatAt = (beat: number) => resolved
    .apply(copyAt(2, 0, 0), { beat, index: 0, count: 1 })[0].colorShift.lightness
  assert.ok(heatAt(0.15) > 0.01, 'should glow while flying')
  assert.ok(heatAt(0.15) > heatAt(2.2), 'should cool as it settles')
})

test('one copy in, one copy out', () => {
  const resolved = impactScatterMover.resolve({ settings: settings(), notes: [note(0)] })
  assert.equal(resolved.apply(copyAt(1, 1, 1), { beat: 0.2, index: 0, count: 1 }).length, 1)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import {
  IMPACT_DETENT,
  IMPACT_MAX,
  SCATTER_IMPACT_PITCH,
  SCATTER_IMPLODE_PITCH,
  SCATTER_SETTLE_PITCH,
  impactScatterMover,
  tune,
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

/** Furthest the copy gets over a window, so comparisons do not depend on phase. */
function peakThrow(
  config: ImpactScatterSettings,
  notes: ResolvedNote[],
  untilBeat = 12,
  home: [number, number, number] = [3, 0, 0],
): number {
  let peak = 0
  const steps = Math.round(untilBeat / 0.05)
  for (let i = 0; i <= steps; i++) {
    peak = Math.max(peak, throwDistance(config, notes, i * 0.05, home))
  }
  return peak
}

test('impact scatter is registered under its definition id', () => {
  assert.equal(getMoverOrSplitterDefinition('impactScatter'), impactScatterMover)
})

test('the definition exposes four feel knobs plus placement', () => {
  const keys = impactScatterMover.params.map((p) => p.key)
  assert.deepEqual(keys, ['impact', 'recoverBeats', 'chaos', 'curve', 'centerX', 'centerY', 'centerZ'])
  const impact = impactScatterMover.params.find((p) => p.key === 'impact')
  assert.equal(impact && 'max' in impact ? impact.max : null, IMPACT_MAX, 'the knob travels into overdrive')
})

// ── The macro mapping ────────────────────────────────────────────────────────

test('IMPACT scales the throw, and what the throw needs to look intentional', () => {
  const soft = tune(settings({ impact: 0.1 }))
  const hard = tune(settings({ impact: 1 }))
  assert.ok(hard.blastSpeed > soft.blastSpeed * 3, 'the top of the knob must be a different event')
  assert.ok(hard.leash > soft.leash, 'a harder hit is allowed to travel further')
  assert.ok(hard.reach > soft.reach, 'a harder hit reaches more of the field')
  // The front always crosses the affected field in about the same musical time.
  assert.ok(Math.abs(hard.waveSpeed / hard.reach - soft.waveSpeed / soft.reach) < 1e-9)
})

test('CHAOS trades an orderly pulse for shrapnel', () => {
  const clean = tune(settings({ chaos: 0 }))
  const wild = tune(settings({ chaos: 1 }))
  assert.equal(clean.scatter, 0, 'zero chaos is a pure radial pulse')
  assert.ok(wild.scatter > 1)
  assert.ok(wild.spinKick > clean.spinKick * 5)
  assert.ok(wild.pileup > clean.pileup)
  assert.ok(wild.bounce > clean.bounce)
  // Absorption belongs to CURVE now, so the two knobs stay orthogonal: CHAOS
  // must not quietly reshape the return.
  assert.equal(wild.drag, clean.drag)
  assert.equal(wild.settleBeats, clean.settleBeats)
})

test('overdrive past the detent is its own escalation, not more of the curve', () => {
  const atLimit = tune(settings({ impact: IMPACT_DETENT }))
  const overdriven = tune(settings({ impact: IMPACT_MAX }))
  assert.ok(
    overdriven.blastSpeed > atLimit.blastSpeed * 1.7,
    `the last tenth must nearly double the throw: ${atLimit.blastSpeed} → ${overdriven.blastSpeed}`,
  )
  assert.ok(overdriven.leash > atLimit.leash, 'and let it travel')
  // The step up has to be steeper than the same span below the detent.
  const belowSpan = atLimit.blastSpeed - tune(settings({ impact: 0.9 })).blastSpeed
  assert.ok(overdriven.blastSpeed - atLimit.blastSpeed > belowSpan)
})

test('100% already hits hard: the top of the knob is not a gentle ramp', () => {
  const quarter = peakThrow(settings({ impact: 0.25 }), [note(0)])
  const half = peakThrow(settings({ impact: 0.5 }), [note(0)])
  const full = peakThrow(settings({ impact: 1 }), [note(0)])
  const over = peakThrow(settings({ impact: IMPACT_MAX }), [note(0)])
  assert.ok(full > half * 3, `100% must dwarf 50%: ${half} → ${full}`)
  assert.ok(half > quarter * 2, `and 50% must dwarf 25%: ${quarter} → ${half}`)
  assert.ok(over > full * 1.7, `110% must land past 100%: ${full} → ${over}`)
})

test('RECOVER scales both springs and nothing else', () => {
  const quick = tune(settings({ recoverBeats: 1 }))
  const slow = tune(settings({ recoverBeats: 4 }))
  assert.ok(Math.abs(slow.settleBeats / quick.settleBeats - 4) < 1e-9)
  assert.ok(Math.abs(slow.unwindBeats / quick.unwindBeats - 4) < 1e-9)
  assert.ok(slow.unwindBeats > slow.settleBeats, 'orientation resolves after position')
  assert.equal(slow.blastSpeed, quick.blastSpeed)
  assert.equal(slow.scatter, quick.scatter)
})

// ── CURVE: the shape of the return ───────────────────────────────────────────

test('CURVE changes the SHAPE of the return, not the distance', () => {
  const shapeOf = (curve: number) => {
    const config = settings({ curve, recoverBeats: 2 })
    const peak = peakThrow(config, [note(0)], 5)
    // How much of the excursion is still there at each quarter of the recovery.
    const remaining = (fraction: number) =>
      throwDistance(config, [note(0)], 2 * fraction) / peak
    return { peak, half: remaining(0.5), threeQuarters: remaining(0.75) }
  }
  const gentle = shapeOf(-1)
  const even = shapeOf(0)
  const percussive = shapeOf(1)

  // Gentle hangs out: most of the displacement is still there halfway home.
  assert.ok(gentle.half > 0.6, `gentle should still be out: ${gentle.half}`)
  // Percussive gets most of the way back almost at once, then trails.
  assert.ok(percussive.half < 0.3, `percussive should be nearly back: ${percussive.half}`)
  assert.ok(gentle.half > even.half && even.half > percussive.half, 'monotonic across the knob')
  assert.ok(gentle.threeQuarters > percussive.threeQuarters * 4)

  // …and none of that is allowed to read as a volume knob.
  for (const shape of [gentle, percussive]) {
    assert.ok(
      shape.peak > even.peak * 0.7 && shape.peak < even.peak * 1.3,
      `peak throw must hold across CURVE: ${even.peak} vs ${shape.peak}`,
    )
  }
})

test('the percussive tail is quiet, not absent', () => {
  const config = settings({ curve: 1, recoverBeats: 2 })
  const peak = peakThrow(config, [note(0)], 5)
  const tail = throwDistance(config, [note(0)], 1.2)
  assert.ok(tail > 0, 'something should still be settling')
  assert.ok(tail < peak * 0.15, `but quietly: ${tail} of ${peak}`)
})

test('RECOVER reads in real beats: the field is home when it says it is', () => {
  for (const recoverBeats of [1, 2, 6]) {
    const config = settings({ recoverBeats })
    const notes = [note(0)]
    const peak = peakThrow(config, notes, recoverBeats * 2)
    const atHalf = throwDistance(config, notes, recoverBeats * 0.5)
    const atRecover = throwDistance(config, notes, recoverBeats * 1.05)
    assert.ok(atHalf > peak * 0.25, `still visibly moving halfway there (recover ${recoverBeats})`)
    assert.ok(
      atRecover < peak * 0.05,
      `should be home by ${recoverBeats} beats: ${atRecover.toFixed(3)} of peak ${peak.toFixed(3)}`,
    )
  }
})

test('RECOVER keeps its promise at every CURVE shape', () => {
  // The shape knob changes how the settling time falls out of the physics, so
  // the spring period compensates for it. Whatever the shape, nothing much is
  // still moving once RECOVER has elapsed.
  for (const curve of [-1, -0.5, 0, 0.5, 1]) {
    const config = settings({ curve, recoverBeats: 2 })
    const notes = [note(0)]
    const peak = peakThrow(config, notes, 4)
    let worstAfter = 0
    for (let beat = 2; beat <= 8; beat += 0.05) {
      worstAfter = Math.max(worstAfter, throwDistance(config, notes, beat))
    }
    assert.ok(
      worstAfter < peak * 0.12,
      `curve ${curve}: ${(worstAfter / peak * 100).toFixed(1)}% of the throw survives past RECOVER`,
    )
  }
})

// ── Behaviour ────────────────────────────────────────────────────────────────

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

test('a copy returns home exactly, once the spring has run out', () => {
  const config = settings({ recoverBeats: 1.5, chaos: 0.1 })
  const notes = [note(0)]
  assert.ok(throwDistance(config, notes, 0.5) > 0.5)
  // Well past the tail the table window has closed, so rest is exact.
  assert.equal(throwDistance(config, notes, 400), 0)
})

test('the blast front reaches a near copy before a far one', () => {
  const config = settings({ impact: 1 })
  const front = tune(config).waveSpeed
  const notes = [note(0)]
  // Sample between the two arrival times, so only the near copy has been told.
  const beat = (2 / front + 30 / front) / 2
  assert.ok(throwDistance(config, notes, beat, [2, 0, 0]) > 0.1, 'near copy should be flying')
  assert.equal(throwDistance(config, notes, beat, [30, 0, 0]), 0, 'far copy has not been reached')
})

test('power falls off with distance from the impact center', () => {
  const config = settings({ impact: 0.4 })
  const notes = [note(0)]
  const near = peakThrow(config, notes, 6, [1, 0, 0])
  const far = peakThrow(config, notes, 6, [14, 0, 0])
  assert.ok(near > far * 2, `expected strong falloff, got near ${near} far ${far}`)
})

test('rapid fire compounds: four hits throw further than one', () => {
  const config = settings()
  const single = peakThrow(config, [note(0)])
  const roll = peakThrow(config, [note(0), note(0.25), note(0.5), note(0.75)])
  assert.ok(roll > single * 1.5, `a roll should stack well past one hit: ${single} → ${roll}`)
})

test('compounding is nonlinear: stacked hits escalate but saturate', () => {
  // Superposition would make two hits exactly twice one hit. Momentum makes
  // them more than one; drag and the leash keep them under two.
  const config = settings()
  const single = peakThrow(config, [note(0)])
  const doubled = peakThrow(config, [note(0), note(0.4)])
  assert.ok(doubled > single * 1.15, `momentum should carry: ${single} → ${doubled}`)
  assert.ok(doubled < single * 2, `the material must bite back: ${single} → ${doubled}`)
})

test('chaos escalates a roll harder than a clean pulse does', () => {
  const roll = [note(0), note(0.25), note(0.5), note(0.75)]
  const clean = peakThrow(settings({ chaos: 0 }), roll)
  const wild = peakThrow(settings({ chaos: 1 }), roll)
  assert.ok(wild > clean * 1.2, `chaos should pile up harder: ${clean} → ${wild}`)
})

test('the leash bounds even an overdriven machine-gun roll', () => {
  // Overdrive plus max chaos plus 24 hits in three beats is the worst case a
  // user can build. It is allowed to be enormous - it is not allowed to be
  // unbounded, or to produce a non-finite matrix.
  const config = settings({ impact: IMPACT_MAX, chaos: 1 })
  const roll = Array.from({ length: 24 }, (_, i) => note(i * 0.125))
  const peak = peakThrow(config, roll, 8)
  const leash = tune(config).leash
  assert.ok(Number.isFinite(peak), 'must stay finite')
  assert.ok(peak < leash * 6, `cubic containment failed: ${peak} against a leash of ${leash}`)
})

test('implode pulls inward while impact pushes outward', () => {
  const config = settings({ chaos: 0 })
  const home = new Vector3(4, 0, 0)
  const radialAt = (pitch: number) => {
    const resolved = impactScatterMover.resolve({ settings: config, notes: [note(0, pitch)] })
    const [result] = resolved.apply(copyAt(4, 0, 0), { beat: 0.35, index: 0, count: 1 })
    return new Vector3().setFromMatrixPosition(result.transform).sub(home).x
  }
  assert.ok(radialAt(SCATTER_IMPACT_PITCH) > 0.2)
  assert.ok(radialAt(SCATTER_IMPLODE_PITCH) < -0.2)
})

test('a settle note damps the field mid-flight', () => {
  const config = settings({ recoverBeats: 8 })
  const flying = [note(0)]
  const damped = [note(0), note(0.5, SCATTER_SETTLE_PITCH)]
  assert.ok(
    throwDistance(config, damped, 0.75) < throwDistance(config, flying, 0.75) * 0.5,
    'the snap-home note should collapse most of the displacement',
  )
})

test('two copies at the same distance scatter in different directions', () => {
  const config = settings({ chaos: 1 })
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
  const config = settings({ recoverBeats: 0.5, chaos: 0 })
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

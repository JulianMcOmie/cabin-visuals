import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { valueToPitch } from '../trackTypes'
import { identityVisualCopy } from './identityVisualCopy'
import { mergeDefinitionSettings } from './definitions'
import {
  PHYSICS_LAW_DRAG,
  PHYSICS_LAW_GRAVITY,
  PHYSICS_LAW_SPRING,
  PHYSICS_REST_VALUE,
  PHYSICS_SOLVE_APEX,
  PHYSICS_SOLVE_ARRIVE,
  PHYSICS_SOLVE_IMPULSE,
  PHYSICS_TARGET_ROT_Z,
  PHYSICS_TARGET_SIZE,
  PHYSICS_TARGET_X,
  PHYSICS_TUNE_SMOOTH,
  PHYSICS_TUNE_STRIKE,
  buildPhysicsPieces,
  evaluatePhysicsValue,
  physicsGates,
  physicsMidiRows,
  physicsMover,
  physicsTransform,
  type PhysicsSettings,
} from './physicsInterp'

const note = (beat: number, pitch: number, durationBeats = 0.25): ResolvedNote => ({
  beat,
  blockStartBeat: 0,
  blockEndBeat: 1024,
  pitch,
  velocity: 1,
  durationBeats,
})

/** A note whose pitch encodes `value` (0..1) on the automation span. */
const valueNote = (beat: number, value: number): ResolvedNote => note(beat, valueToPitch(value, 0, 1))

function settings(overrides: Partial<PhysicsSettings> = {}): PhysicsSettings {
  return {
    ...(mergeDefinitionSettings(physicsMover, undefined) as unknown as PhysicsSettings),
    ...overrides,
  }
}

/** A phrase with deliberately uneven intervals - an even one hides timing bugs. */
const PHRASE: [number, number][] = [[0, 0.2], [1, 0.8], [2, 0.45], [3.5, 0.95], [4, 0.1], [5.5, 0.6]]
const phraseNotes = () => PHRASE.map(([beat, value]) => valueNote(beat, value))

/** What the lane's pitch encoding actually round-trips to - the assertions
 *  below compare against this, not against the authored value, so a coarse
 *  pitch grid can't be mistaken for a physics error. */
const gateValues = () => physicsGates(phraseNotes()).map((gate) => gate.value)

// Tight on purpose: gravity is metres per beat SQUARED, so a central
// difference taken a few thousandths of a beat away from the onset measures
// the interval's acceleration and reads as a velocity jump that isn't there.
const sampleVelocity = (pieces: ReturnType<typeof buildPhysicsPieces>, beat: number, h = 1e-6): number =>
  (evaluatePhysicsValue(pieces, beat + h) - evaluatePhysicsValue(pieces, beat - h)) / (2 * h)

test('an empty lane rests at home, so adding the mover changes nothing', () => {
  const pieces = buildPhysicsPieces([], settings())
  assert.equal(evaluatePhysicsValue(pieces, 0), PHYSICS_REST_VALUE)
  assert.equal(evaluatePhysicsValue(pieces, 97.3), PHYSICS_REST_VALUE)
  const [copy] = physicsMover.resolve({ settings: settings(), notes: [] })
    .apply(identityVisualCopy(), { beat: 12, index: 0, count: 1 })
  assert.ok(copy.transform.equals(identityVisualCopy().transform), 'no notes must mean no transform')
})

test('before the first onset the lane holds its first value', () => {
  const pieces = buildPhysicsPieces(phraseNotes(), settings())
  assert.ok(Math.abs(evaluatePhysicsValue(pieces, -8) - gateValues()[0]) < 1e-9)
})

test('a chord collapses to one gate - two values cannot both be true at one instant', () => {
  const gates = physicsGates([valueNote(2, 0.3), valueNote(2, 0.9), valueNote(4, 0.5)])
  assert.equal(gates.length, 2)
  assert.equal(gates[0].beat, 2)
  assert.ok(gates[0].value > 0.8, 'the highest pitch wins the instant')
})

test('notes outside the automation span are ignored, so old/foreign notes are inert', () => {
  assert.deepEqual(physicsGates([note(0, 12), note(1, 127)]), [])
})

// ── ARRIVE: the whole promise of the mover ───────────────────────────────────

for (const [name, law] of [['gravity', PHYSICS_LAW_GRAVITY], ['spring', PHYSICS_LAW_SPRING], ['drag', PHYSICS_LAW_DRAG]] as const) {
  for (const [tuneName, tune] of [['strike', PHYSICS_TUNE_STRIKE], ['smooth', PHYSICS_TUNE_SMOOTH]] as const) {
    test(`${name}/arrive/${tuneName} passes through every note value at its own onset`, () => {
      const config = settings({ law, tune, solve: PHYSICS_SOLVE_ARRIVE })
      const pieces = buildPhysicsPieces(phraseNotes(), config)
      const values = gateValues()
      PHRASE.forEach(([beat], index) => {
        // Sampled a hair BEFORE the onset: every piece starts on its own value
        // by construction, so only the arriving end of the previous interval
        // can prove the solve worked.
        const arriving = evaluatePhysicsValue(pieces, beat - 1e-6)
        assert.ok(
          Math.abs(arriving - values[index]) < 5e-3,
          `${name}/${tuneName} arrived at ${arriving.toFixed(4)} instead of ${values[index].toFixed(4)} on beat ${beat}`,
        )
      })
    })
  }
}

test('arrive/smooth is C1 - velocity carries through every onset', () => {
  const pieces = buildPhysicsPieces(phraseNotes(), settings({ tune: PHYSICS_TUNE_SMOOTH }))
  for (const [beat] of PHRASE.slice(1, -1)) {
    const before = sampleVelocity(pieces, beat - 1e-5)
    const after = sampleVelocity(pieces, beat + 1e-5)
    assert.ok(Math.abs(before - after) < 1e-3, `velocity jumped ${before.toFixed(4)} → ${after.toFixed(4)} at beat ${beat}`)
  }
})

test('arrive/strike jumps velocity at onsets - that discontinuity IS the hit', () => {
  const pieces = buildPhysicsPieces(phraseNotes(), settings({ tune: PHYSICS_TUNE_STRIKE }))
  const jumps = PHRASE.slice(1, -1).map(([beat]) =>
    Math.abs(sampleVelocity(pieces, beat + 2e-3) - sampleVelocity(pieces, beat - 2e-3)))
  assert.ok(Math.max(...jumps) > 0.2, 'strike should visibly restrike the object')
})

test('arrive/strike keeps gravity fixed while arrive/smooth varies it', () => {
  const curvature = (tune: number): number[] => {
    const pieces = buildPhysicsPieces(phraseNotes(), settings({ tune }))
    return pieces.filter((p): p is Extract<typeof p, { kind: 'poly' }> => p.kind === 'poly').map((p) => p.a)
  }
  const strike = curvature(PHYSICS_TUNE_STRIKE)
  assert.ok(strike.length > 1)
  assert.ok(strike.every((a) => Math.abs(a - strike[0]) < 1e-9), 'strike holds one gravity for the whole lane')
  const smooth = curvature(PHYSICS_TUNE_SMOOTH)
  assert.ok(new Set(smooth.map((a) => a.toFixed(3))).size > 1, 'smooth pays for C1 with a gravity that breathes')
})

// ── APEX ─────────────────────────────────────────────────────────────────────

test('gravity/apex crests exactly on each note: the value peaks there, at rest', () => {
  // SMOOTH solves gravity per interval, so it always makes the crest; STRIKE
  // holds gravity fixed and needs enough of it (see the clamp test below).
  for (const config of [
    settings({ solve: PHYSICS_SOLVE_APEX, tune: PHYSICS_TUNE_SMOOTH }),
    settings({ solve: PHYSICS_SOLVE_APEX, tune: PHYSICS_TUNE_STRIKE, force: 6 }),
  ]) {
    const pieces = buildPhysicsPieces(phraseNotes(), config)
    const values = gateValues()
    PHRASE.slice(1).forEach(([beat], index) => {
      const at = evaluatePhysicsValue(pieces, beat - 1e-6)
      assert.ok(Math.abs(at - values[index + 1]) < 5e-3, `apex missed its crest at beat ${beat}`)
      assert.ok(Math.abs(sampleVelocity(pieces, beat - 1e-5)) < 0.02, 'a crest has no velocity')
      // Just before the crest the value is lower: it is a maximum, not a waypoint.
      assert.ok(evaluatePhysicsValue(pieces, beat - 0.05) < at + 1e-6)
    })
  }
})

test('apex/strike misses a crest gravity cannot reach, rather than faking it', () => {
  // Falling 0.85 of the lane in half a beat needs g >= 6.8; the default FORCE
  // gives 2.56. Fixed gravity is fixed - the bounce clamps to the interval's
  // edge and the crest is missed, which is the honest answer and exactly what
  // the SMOOTH tune (which solves gravity instead) exists to fix.
  const notes = [valueNote(3.5, 0.95), valueNote(4, 0.1)]
  const strike = buildPhysicsPieces(notes, settings({ solve: PHYSICS_SOLVE_APEX, tune: PHYSICS_TUNE_STRIKE }))
  const smooth = buildPhysicsPieces(notes, settings({ solve: PHYSICS_SOLVE_APEX, tune: PHYSICS_TUNE_SMOOTH }))
  const target = physicsGates(notes)[1].value
  assert.ok(Math.abs(evaluatePhysicsValue(strike, 4 - 1e-6) - target) > 0.05, 'a clamped solve should visibly miss')
  assert.ok(isFinite(evaluatePhysicsValue(strike, 4 - 1e-6)), 'but it must never blow up')
  assert.ok(Math.abs(evaluatePhysicsValue(smooth, 4 - 1e-6) - target) < 5e-3, 'smooth solves gravity and lands it')
})

test('gravity/apex/smooth bounces on the floor, and never below it', () => {
  const pieces = buildPhysicsPieces(phraseNotes(), settings({ solve: PHYSICS_SOLVE_APEX, tune: PHYSICS_TUNE_SMOOTH }))
  let low = Infinity
  for (let beat = 0; beat <= 5.5; beat += 0.005) low = Math.min(low, evaluatePhysicsValue(pieces, beat))
  assert.ok(low > -1e-6, `dipped through the floor to ${low}`)
  assert.ok(low < 0.01, 'the floor is where the bounce happens - it should be reached')
})

test('spring/apex arrives at the value with zero velocity', () => {
  const pieces = buildPhysicsPieces(phraseNotes(), settings({ law: PHYSICS_LAW_SPRING, solve: PHYSICS_SOLVE_APEX }))
  const values = gateValues()
  PHRASE.slice(1).forEach(([beat], index) => {
    assert.ok(Math.abs(evaluatePhysicsValue(pieces, beat - 1e-6) - values[index + 1]) < 5e-3)
    assert.ok(Math.abs(sampleVelocity(pieces, beat - 3e-3)) < 0.05)
  })
})

test('drag/apex is a critically damped arrival - it never overshoots', () => {
  const pieces = buildPhysicsPieces(
    [valueNote(0, 0.2), valueNote(2, 0.9)],
    settings({ law: PHYSICS_LAW_DRAG, solve: PHYSICS_SOLVE_APEX }),
  )
  let peak = -Infinity
  for (let beat = 0; beat <= 2; beat += 0.005) peak = Math.max(peak, evaluatePhysicsValue(pieces, beat))
  assert.ok(peak <= evaluatePhysicsValue(pieces, 2 - 1e-6) + 1e-3, `overshot to ${peak}`)
})

// ── IMPULSE ──────────────────────────────────────────────────────────────────

test('gravity/impulse kicks exactly the energy to crest at the note, and stays above the floor', () => {
  const config = settings({ solve: PHYSICS_SOLVE_IMPULSE })
  const pieces = buildPhysicsPieces([valueNote(0, 0), valueNote(1, 0.8)], config)
  let peak = -Infinity
  let low = Infinity
  for (let beat = 1; beat <= 3; beat += 0.002) {
    const value = evaluatePhysicsValue(pieces, beat)
    peak = Math.max(peak, value)
    low = Math.min(low, value)
  }
  assert.ok(Math.abs(peak - physicsGates([valueNote(1, 0.8)])[0].value) < 0.02, `crested at ${peak.toFixed(3)}`)
  assert.ok(low > -1e-6, 'the bounce floor is hard')
})

test('gravity/impulse rebounds by the BOUNCE knob and comes to rest', () => {
  const dead = buildPhysicsPieces([valueNote(0, 0.9)], settings({ solve: PHYSICS_SOLVE_IMPULSE, bounce: 0 }))
  const lively = buildPhysicsPieces([valueNote(0, 0.9)], settings({ solve: PHYSICS_SOLVE_IMPULSE, bounce: 0.9 }))
  const peakAfter = (pieces: typeof dead, from: number): number => {
    let peak = -Infinity
    for (let beat = from; beat <= from + 4; beat += 0.002) peak = Math.max(peak, evaluatePhysicsValue(pieces, beat))
    return peak
  }
  assert.ok(peakAfter(dead, 2) < 0.01, 'a dead floor absorbs the ball')
  assert.ok(peakAfter(lively, 2) > 0.05, 'a lively floor keeps it going')
  // However elastic, the trajectory must terminate rather than fall forever.
  assert.ok(Math.abs(evaluatePhysicsValue(lively, 5000)) < 1, 'a runaway lane must still settle')
})

test('impulse free-runs: it does not promise to hit the values', () => {
  const pieces = buildPhysicsPieces(phraseNotes(), settings({ solve: PHYSICS_SOLVE_IMPULSE }))
  const values = gateValues()
  const misses = PHRASE.filter(([beat], index) => Math.abs(evaluatePhysicsValue(pieces, beat) - values[index]) > 0.02)
  assert.ok(misses.length > 0, 'impulse is energy, not interception - accuracy here would mean the kick is fake')
})

// ── The channel ──────────────────────────────────────────────────────────────

test('the middle row is home: value 0.5 is the identity transform on every channel', () => {
  for (const target of [PHYSICS_TARGET_X, PHYSICS_TARGET_SIZE, PHYSICS_TARGET_ROT_Z]) {
    const m = physicsTransform(PHYSICS_REST_VALUE, settings({ target }))
    assert.ok(m.equals(identityVisualCopy().transform), `target ${target} is not neutral at rest`)
  }
})

test('size is an exponent, so a swell and its squash are exact reciprocals', () => {
  const config = settings({ target: PHYSICS_TARGET_SIZE, amount: 2 })
  const up = new Vector3().setFromMatrixScale(physicsTransform(1, config)).x
  const down = new Vector3().setFromMatrixScale(physicsTransform(0, config)).x
  assert.ok(Math.abs(up * down - 1) < 1e-9, `${up} and ${down} are not reciprocal`)
  assert.ok(up > 1 && down > 0, 'scale can never cross zero and invert the winding')
})

test('AMOUNT scales the channel and its sign flips it', () => {
  const at = (amount: number): number =>
    new Vector3().setFromMatrixPosition(physicsTransform(1, settings({ target: PHYSICS_TARGET_X, amount }))).x
  assert.ok(Math.abs(at(4) - 2) < 1e-9)
  assert.ok(Math.abs(at(-4) + 2) < 1e-9)
})

test('the mover composes LOCAL, leaving the incoming placement intact', () => {
  const resolved = physicsMover.resolve({ settings: settings(), notes: [valueNote(0, 1)] })
  const copy = identityVisualCopy()
  copy.transform.makeTranslation(10, 0, 0)
  const [out] = resolved.apply(copy, { beat: 0, index: 0, count: 1 })
  const position = new Vector3().setFromMatrixPosition(out.transform)
  assert.ok(Math.abs(position.x - 10) < 1e-9, 'the placement must be re-framed, not replaced')
  assert.ok(position.y > 0.5, 'and the value must ride on top of it')
  assert.equal(out.opacity, copy.opacity)
})

test('one copy in, one copy out - this is a mover, not a splitter', () => {
  const resolved = physicsMover.resolve({ settings: settings(), notes: phraseNotes() })
  for (const beat of [0, 1.5, 3.2, 200]) {
    assert.equal(resolved.apply(identityVisualCopy(), { beat, index: 0, count: 1 }).length, 1)
  }
})

// ── Rows, and the purity the engine depends on ───────────────────────────────

test('the MIDI rows span the automation range and are labelled in real units', () => {
  const rows = physicsMidiRows(settings({ amount: 4 }))
  assert.equal(rows.length, 49)
  assert.equal(rows[0].label, '+2.0', 'the top row is the full positive displacement')
  assert.equal(rows[rows.length - 1].label, '-2.0')
  const home = rows.filter((row) => row.emphasized)
  assert.equal(home.length, 1)
  assert.equal(home[0].pitch, 60, 'home is the automation encoding\'s middle pitch')
  assert.equal(physicsMidiRows(settings({ amount: 8 }))[0].label, '+4.0', 'AMOUNT relabels the roll')
})

test('evaluation is a pure function of the beat, in any order', () => {
  for (const solve of [PHYSICS_SOLVE_ARRIVE, PHYSICS_SOLVE_APEX, PHYSICS_SOLVE_IMPULSE]) {
    for (const law of [PHYSICS_LAW_GRAVITY, PHYSICS_LAW_SPRING, PHYSICS_LAW_DRAG]) {
      const pieces = buildPhysicsPieces(phraseNotes(), settings({ law, solve }))
      const forward: number[] = []
      for (let beat = 0; beat <= 6; beat += 0.25) forward.push(evaluatePhysicsValue(pieces, beat))
      const backward: number[] = []
      for (let beat = 6; beat >= 0; beat -= 0.25) backward.push(evaluatePhysicsValue(pieces, beat))
      assert.deepEqual(forward, [...backward].reverse(), `law ${law} / solve ${solve} is not scrub-stable`)
      assert.ok(forward.every((v) => isFinite(v)), `law ${law} / solve ${solve} produced a non-finite value`)
    }
  }
})

test('every cell stays finite through degenerate settings', () => {
  const nasty = [
    [valueNote(0, 0), valueNote(0.01, 1), valueNote(0.02, 0)],
    [valueNote(0, 0.5), valueNote(64, 0.5)],
    [valueNote(0, 0)],
  ]
  for (const notes of nasty) {
    for (const force of [0.05, 6]) {
      for (const damp of [0.02, 1]) {
        for (const solve of [PHYSICS_SOLVE_ARRIVE, PHYSICS_SOLVE_APEX, PHYSICS_SOLVE_IMPULSE]) {
          for (const law of [PHYSICS_LAW_GRAVITY, PHYSICS_LAW_SPRING, PHYSICS_LAW_DRAG]) {
            for (const tune of [PHYSICS_TUNE_STRIKE, PHYSICS_TUNE_SMOOTH]) {
              const pieces = buildPhysicsPieces(notes, settings({ law, solve, tune, force, damp }))
              for (const beat of [-1, 0, 0.005, 1, 64, 1e4]) {
                const value = evaluatePhysicsValue(pieces, beat)
                assert.ok(isFinite(value), `law ${law} solve ${solve} tune ${tune} force ${force} → ${value} at ${beat}`)
              }
            }
          }
        }
      }
    }
  }
})

test('the piece list is onset-sorted, which is what makes the lookup a binary search', () => {
  for (const solve of [PHYSICS_SOLVE_ARRIVE, PHYSICS_SOLVE_APEX, PHYSICS_SOLVE_IMPULSE]) {
    const pieces = buildPhysicsPieces(phraseNotes(), settings({ solve }))
    for (let i = 1; i < pieces.length; i++) {
      assert.ok(pieces[i].onset >= pieces[i - 1].onset, `piece ${i} (${pieces[i].onset}) precedes its predecessor`)
    }
  }
})

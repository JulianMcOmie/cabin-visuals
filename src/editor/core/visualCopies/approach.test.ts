import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import { resolveVisualCopies } from './resolveVisualCopies'
import {
  APPROACH_CAMERA_Z,
  APPROACH_SPAWN_PITCH,
  approachCount,
  approachDirectionSign,
  approachExitProgress,
  approachFlightTransform,
  approachFlightsAt,
  approachHomeProgress,
  approachNoteFlights,
  approachRunBeats,
  allocateApproachFlights,
  approachSplitter,
  approachStreamFlight,
  type ApproachSettings,
} from './approach'
import type { VisualCopy } from './types'

const DEFAULTS = mergeDefinitionSettings(approachSplitter, undefined) as unknown as ApproachSettings

function settings(overrides: Partial<ApproachSettings> = {}): ApproachSettings {
  return { ...DEFAULTS, ...overrides }
}

function note(beat: number, pitch = APPROACH_SPAWN_PITCH, durationBeats = 1, velocity = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity, durationBeats }
}

function copiesAt(config: ApproachSettings, beat: number, notes: ResolvedNote[] = []): VisualCopy[] {
  return resolveVisualCopies([approachSplitter.resolve({ settings: config, notes })], beat)
}

/** Uniform scale of a copy (the splitter only ever writes uniform scale). */
function scaleOf(copy: VisualCopy): number {
  const e = copy.transform.elements
  return Math.hypot(e[0], e[1], e[2])
}

function zOf(copy: VisualCopy): number {
  return copy.transform.elements[14]
}

const IDENTITY_SCALE: [number, number, number] = [1, 1, 1]

test('copy count is structural - never a function of beat or notes', () => {
  const config = settings({ density: 9 })
  assert.equal(approachCount(config), 9)
  for (const beat of [0, 0.5, 3, 17.25, 100]) {
    assert.equal(copiesAt(config, beat).length, 9)
  }
  // NOTES mode with no notes at all still yields the full structural slot list.
  const noteMode = settings({ density: 9, spawnMode: 1 })
  assert.equal(copiesAt(noteMode, 4).length, 9)
  assert.equal(copiesAt(noteMode, 4, [note(0), note(1)]).length, 9)
})

test('a flight is born at scale zero and grows across the run', () => {
  const config = settings({ depth: 40, size: 2, density: 1 })
  const far = approachFlightTransform({ progress: 0, sizeScale: 1, active: true }, config, IDENTITY_SCALE)
  const mid = approachFlightTransform({ progress: 0.5, sizeScale: 1, active: true }, config, IDENTITY_SCALE)
  const near = approachFlightTransform({ progress: 1, sizeScale: 1, active: true }, config, IDENTITY_SCALE)

  // Effectively zero at birth (a hair above, so the matrix stays invertible).
  assert.ok(scaleOf({ transform: far.transform } as VisualCopy) < 1e-3)
  assert.ok(Math.abs(scaleOf({ transform: mid.transform } as VisualCopy) - 1) < 1e-9)
  assert.ok(Math.abs(scaleOf({ transform: near.transform } as VisualCopy) - 2) < 1e-9)
})

test('the run starts behind the far end and finishes at the near end', () => {
  const config = settings({ depth: 40, nearEnd: 12 })
  const far = approachFlightTransform({ progress: 0, sizeScale: 1, active: true }, config, IDENTITY_SCALE)
  const near = approachFlightTransform({ progress: 1, sizeScale: 1, active: true }, config, IDENTITY_SCALE)
  assert.ok(Math.abs(far.transform.elements[14] - (12 - 40)) < 1e-9)
  assert.ok(Math.abs(near.transform.elements[14] - 12) < 1e-9)
})

test('the near end sits behind the default camera by default', () => {
  // The whole illusion depends on the recycle happening off-screen; if this
  // default ever moves in front of z = 5, copies blink out mid-frame.
  assert.ok(DEFAULTS.nearEnd > 5)
})

test('stream mode phase-offsets the copies evenly around the run', () => {
  const config = settings({ density: 4, depth: 40, speed: 0, spawnMode: 0 })
  const progresses = [0, 1, 2, 3].map((slot) => approachStreamFlight(slot, config, 0).progress)
  assert.deepEqual(progresses.map((p) => Math.round(p * 1000) / 1000), [0, 0.25, 0.5, 0.75])
})

test('stream mode recycles: a copy passing the near end reappears at the far end', () => {
  const config = settings({ density: 1, depth: 40, speed: 4, spawnMode: 0 })
  // 40 units at 4/beat = one full run every 10 beats.
  const justBefore = approachStreamFlight(0, config, 9.99).progress
  const justAfter = approachStreamFlight(0, config, 10.01).progress
  assert.ok(justBefore > 0.99, `expected near end, got ${justBefore}`)
  assert.ok(justAfter < 0.01, `expected far end, got ${justAfter}`)
  // Exactly one period later the state repeats - the wrap is mod, not drift.
  assert.ok(Math.abs(approachStreamFlight(0, config, 3).progress - approachStreamFlight(0, config, 13).progress) < 1e-9)
})

test('direction reverses the travel', () => {
  assert.equal(approachDirectionSign({ direction: 0 }), 1)
  assert.equal(approachDirectionSign({ direction: 1 }), -1)

  const toward = settings({ density: 1, depth: 40, speed: 4, direction: 0 })
  const away = settings({ density: 1, depth: 40, speed: 4, direction: 1 })
  // Toward the camera, progress climbs; away from it, progress falls.
  assert.ok(approachStreamFlight(0, toward, 2).progress > approachStreamFlight(0, toward, 1).progress)
  assert.ok(approachStreamFlight(0, away, 2).progress < approachStreamFlight(0, away, 1).progress)
})

test('receding copies shrink toward nothing as they leave', () => {
  const config = settings({ density: 1, depth: 40, speed: 4, size: 2, direction: 1, spawnMode: 0 })
  const early = copiesAt(config, 0.5)[0]
  const later = copiesAt(config, 4)[0]
  assert.ok(scaleOf(later) < scaleOf(early))
  assert.ok(zOf(later) < zOf(early))
})

test('notes mode: nothing flies with no notes at all', () => {
  const config = settings({ density: 3, spawnMode: 1 })
  for (const copy of copiesAt(config, 8)) assert.equal(copy.opacity, 0)
})

test('notes mode: the copy is at the object\'s normal position ON the onset', () => {
  // This is the mode's contract: the note is the impact, not the launch.
  for (const config of [
    settings({ density: 3, spawnMode: 1 }),
    settings({ density: 3, depth: 40, speed: 4, nearEnd: 12, spawnMode: 1 }),
    settings({ density: 3, depth: 30, speed: 7, nearEnd: 6, spawnMode: 1 }),
    settings({ density: 3, depth: 30, speed: 7, nearEnd: 6, spawnMode: 1, direction: 1 }),
  ]) {
    const flight = approachNoteFlights(config, [note(4)], 4)[0]
    const { transform } = approachFlightTransform(flight, config, IDENTITY_SCALE)
    // Axial 0 IS the placement the object would have with no Approach in the chain.
    assert.ok(Math.abs(transform.elements[14]) < 1e-9, `onset off home by ${transform.elements[14]}`)
  }
})

test('notes mode leads the flight in: the copy is already approaching before the onset', () => {
  // 24 at 5/beat = a 4.8-beat run; home at (24-12)/24 = 0.5, so 2.4 beats of lead.
  const config = settings({ density: 3, depth: 24, speed: 5, nearEnd: 12, spawnMode: 1 })
  assert.ok(Math.abs(approachHomeProgress(config) - 0.5) < 1e-9)

  const before = approachNoteFlights(config, [note(4)], 3).filter((f) => f.active)
  assert.equal(before.length, 1, 'a note 1 beat away should already be in the air')
  assert.ok(before[0].progress < 0.5 && before[0].progress > 0)

  // ...but not before the lead window opens, nor after it has flown past.
  assert.equal(approachNoteFlights(config, [note(4)], 1.5).filter((f) => f.active).length, 0)
  assert.equal(approachNoteFlights(config, [note(4)], 6.5).filter((f) => f.active).length, 0)
})

test('a slot is released at the lens, not at the end of the run', () => {
  // The stretch from the camera plane to the near end is travelled behind the
  // viewer. Holding a slot across it spends the Density budget on copies nobody
  // can see, which is most of what made Density feel smaller than it is.
  const config = settings({ depth: 24, speed: 5, nearEnd: 12, spawnMode: 1 })
  const [claim] = allocateApproachFlights(config, [note(4)])
  const runBeats = approachRunBeats(config)
  const home = approachHomeProgress(config)
  const exit = approachExitProgress(config)

  assert.ok(exit < 1, 'the run should continue past the lens')
  assert.ok(Math.abs(claim.endBeat - (4 + runBeats * (exit - home))) < 1e-9)
  // Strictly earlier than releasing at the end of the run would be.
  assert.ok(claim.endBeat < 4 + runBeats * (1 - home))
})

test('a note keeps one slot for its whole visible flight', () => {
  const config = settings({ density: 4, depth: 24, speed: 5, nearEnd: 12, spawnMode: 1 })
  const notes = [note(4), note(4.5), note(5), note(5.5)]
  const allocation = allocateApproachFlights(config, notes)
  assert.equal(new Set(allocation.map((a) => a.slot)).size, 4, 'concurrent notes must not share a slot')

  // Each note's slot is the same at every beat of its own flight.
  for (const claim of allocation) {
    for (const beat of [claim.startBeat + 0.01, (claim.startBeat + claim.endBeat) / 2, claim.endBeat - 0.01]) {
      const flights = approachFlightsAt(config, allocation, beat)
      assert.ok(flights[claim.slot].active, `slot ${claim.slot} went idle mid-flight at ${beat}`)
    }
  }
})

test('notes mode: velocity scales arrival size', () => {
  const config = settings({ density: 4, depth: 24, speed: 5, nearEnd: 12, spawnMode: 1 })
  const soft = approachNoteFlights(config, [note(4, APPROACH_SPAWN_PITCH, 1, 0.5)], 4)
  const loud = approachNoteFlights(config, [note(4, APPROACH_SPAWN_PITCH, 1, 1)], 4)
  assert.ok(soft[0].sizeScale < loud[0].sizeScale)
})

/** Peak number of flights genuinely on screen at once, from untruncated windows. */
function peakConcurrent(config: ApproachSettings, beats: number[]): number {
  const runBeats = approachRunBeats(config)
  const home = approachHomeProgress(config)
  const exit = approachExitProgress(config)
  const receding = approachDirectionSign(config) < 0
  const lead = runBeats * (receding ? exit - home : home)
  const tail = runBeats * (receding ? home : exit - home)
  const events = beats.flatMap((b) => [[b - lead, 1], [b + tail, -1]])
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let current = 0
  let peak = 0
  for (const [, delta] of events) { current += delta; peak = Math.max(peak, current) }
  return peak
}

test('no note is dropped or truncated while the budget genuinely covers the phrase', () => {
  // The guarantee that matters: Density caps how many copies can be ON SCREEN at
  // once, and nothing else. If the phrase never exceeds that, every note flies
  // its full course - no matter how the onsets are spaced.
  const config = settings({ density: 8, depth: 24, speed: 5, nearEnd: 12, spawnMode: 1 })
  const rhythms: Record<string, number[]> = {
    // Tyler's case: 4 sets of 8 eighth-notes.
    'four sets of eight': Array.from({ length: 32 }, (_, i) => i * 0.5),
    // Uneven phrasing with rests - the case blind round-robin wasted slots on.
    'bursts with gaps': [0, 0.25, 0.5, 6, 6.25, 6.5, 6.75, 12, 13, 14],
    'swung and sparse': [0, 0.66, 1.5, 2.33, 4, 7.1, 7.9, 11],
  }

  for (const [name, beats] of Object.entries(rhythms)) {
    assert.ok(peakConcurrent(config, beats) <= config.density, `${name}: test premise`)
    const notes = beats.map((b) => note(b))
    const allocation = allocateApproachFlights(config, notes)
    assert.equal(allocation.length, beats.length, `${name}: a note was dropped`)

    const runBeats = approachRunBeats(config)
    const home = approachHomeProgress(config)
    const full = runBeats * approachExitProgress(config)
    for (const claim of allocation) {
      assert.ok(
        Math.abs((claim.endBeat - claim.startBeat) - full) < 1e-9,
        `${name}: flight at beat ${claim.noteBeat} was cut short`,
      )
      // ...and it really does reach the lens before its slot is released.
      const atExit = approachFlightsAt(config, allocation, claim.endBeat - 1e-6)
      const passCamera = (APPROACH_CAMERA_Z + config.depth - config.nearEnd) / config.depth
      assert.ok(
        atExit[claim.slot].active && atExit[claim.slot].progress > passCamera,
        `${name}: note at beat ${claim.noteBeat} never reached the camera`,
      )
      assert.ok(home < passCamera)
    }
  }
})

test('notes mode honors direction: an away note sweeps back out through home', () => {
  const toward = settings({ density: 2, depth: 24, speed: 5, nearEnd: 12, spawnMode: 1, direction: 0 })
  const away = settings({ density: 2, depth: 24, speed: 5, nearEnd: 12, spawnMode: 1, direction: 1 })
  // 1.2 beats past the onset = a quarter of the 4.8-beat run, either side of home.
  const t = approachNoteFlights(toward, [note(4)], 5.2)[0]
  const a = approachNoteFlights(away, [note(4)], 5.2)[0]
  assert.ok(Math.abs(t.progress - 0.75) < 1e-9)
  assert.ok(Math.abs(a.progress - 0.25) < 1e-9)
  // The receding flight keeps shrinking as its note ages.
  assert.ok(approachNoteFlights(away, [note(4)], 6)[0].progress < a.progress)
})

test('notes mode: a degenerate run still lands the note at home', () => {
  // nearEnd past the far end: the flight never crosses the origin, so home
  // clamps to the near end rather than producing an out-of-range progress.
  const config = settings({ density: 2, depth: 10, speed: 5, nearEnd: 20, spawnMode: 1 })
  assert.equal(approachHomeProgress(config), 0)
  const flight = approachNoteFlights(config, [note(3)], 3)[0]
  assert.ok(flight.active && flight.progress === 0)
})

test('notes mode never exceeds the structural slot count', () => {
  const config = settings({ density: 2, depth: 40, speed: 4, spawnMode: 1 })
  const many = [note(0), note(1), note(2), note(3), note(4)]
  assert.equal(approachNoteFlights(config, many, 5).length, 2)
  assert.equal(copiesAt(config, 5, many).length, 2)
})

test('offsets are world-metric: a scaled placement does not shrink the run', () => {
  const config = settings({ depth: 40, nearEnd: 12 })
  const half = approachFlightTransform({ progress: 1, sizeScale: 1, active: true }, config, [0.5, 0.5, 0.5])
  // The placement will multiply this back up by 0.5, landing the copy at 12.
  assert.ok(Math.abs(half.transform.elements[14] - 24) < 1e-9)
})

test('evaluation is a pure function of the beat', () => {
  const config = settings({ density: 5, spawnMode: 1 })
  const notes = [note(1), note(3)]
  const first = copiesAt(config, 6.5, notes).map((copy) => [scaleOf(copy), zOf(copy), copy.opacity])
  const second = copiesAt(config, 6.5, notes).map((copy) => [scaleOf(copy), zOf(copy), copy.opacity])
  assert.deepEqual(first, second)
})

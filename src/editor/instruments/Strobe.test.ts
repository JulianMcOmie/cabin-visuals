import assert from 'node:assert/strict'
import test from 'node:test'
import type { ResolvedNote } from '../core/visual/types'
import {
  STROBE_RATE_ROWS,
  STROBE_STYLE_BLACKOUT,
  STROBE_STYLE_FLASH,
  STROBE_STYLE_INVERT,
  STROBE_STYLE_MODES,
  resolveActiveStrobe,
  strobeCycleBeats,
  strobeGate,
} from './Strobe'

/** Look a row up by its EXACT division token. `startsWith` would be ambiguous now
 *  that triplets exist - '1/16' is a prefix of '1/16T', and '1/4' of '1/4T'. */
const rate = (division: string) =>
  STROBE_RATE_ROWS.find((row) => row.label.split(' · ')[0] === division)!

const RATE_16TH = rate('1/16')
const RATE_QUARTER = rate('1/4')
const RATE_8T = rate('1/8T')
const RATE_QUARTER_T = rate('1/4T')

function note(beat: number, durationBeats = 4, pitch = RATE_16TH.pitch, velocity = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 64 }
}

/** Default 0.5 s/beat = 120bpm, so a frame row's Hz is easy to reason about. */
function stateAt(beat: number, notes: ResolvedNote[], params: Record<string, number> = {}, secPerBeat = 0.5) {
  return {
    beat,
    secPerBeat,
    activeNotes: notes.filter((n) => beat >= n.beat && beat < n.beat + (n.durationBeats || 0.05)),
    params,
    opacity: 1,
    blackedOut: false,
  }
}

test('the gate is a hard square wave whose lit fraction is the width', () => {
  // One cycle per beat, lit for the first half of it.
  assert.equal(strobeGate(0, 1, 0.5), 1)
  assert.equal(strobeGate(0.49, 1, 0.5), 1)
  assert.equal(strobeGate(0.5, 1, 0.5), 0)
  assert.equal(strobeGate(0.99, 1, 0.5), 0)
  // ...and it repeats on the next beat rather than drifting.
  assert.equal(strobeGate(1, 1, 0.5), 1)
  assert.equal(strobeGate(64.25, 1, 0.5), 1)
  assert.equal(strobeGate(64.75, 1, 0.5), 0)
})

test('a narrow width is a stab and a wide one is barely dark', () => {
  assert.equal(strobeGate(0.05, 1, 0.1), 1)
  assert.equal(strobeGate(0.15, 1, 0.1), 0)
  assert.equal(strobeGate(0.85, 1, 0.9), 1)
  assert.equal(strobeGate(0.95, 1, 0.9), 0)
})

test('the gate stays in phase before beat zero', () => {
  // `% 1` would keep the sign here and light the dark half instead.
  assert.equal(strobeGate(-1, 1, 0.5), 1)
  assert.equal(strobeGate(-0.75, 1, 0.5), 1)
  assert.equal(strobeGate(-0.25, 1, 0.5), 0)
})

test('the held row picks the rate, so faster rows flash more often per beat', () => {
  const params = { width: 0.5 }
  const sixteenths = [note(0, 4, RATE_16TH.pitch)]
  const quarters = [note(0, 4, RATE_QUARTER.pitch)]
  // A 1/16 cycle is a quarter of a beat: lit at 0, dark by 0.125, lit again at 0.25.
  assert.ok(resolveActiveStrobe(stateAt(0, sixteenths, params)))
  assert.equal(resolveActiveStrobe(stateAt(0.15, sixteenths, params)), null)
  assert.ok(resolveActiveStrobe(stateAt(0.25, sixteenths, params)))
  // The same beats on the 1/4 row are all inside one long lit half.
  assert.ok(resolveActiveStrobe(stateAt(0, quarters, params)))
  assert.ok(resolveActiveStrobe(stateAt(0.15, quarters, params)))
  assert.ok(resolveActiveStrobe(stateAt(0.25, quarters, params)))
})

test('phase comes from the absolute beat, not from where the note starts', () => {
  const params = { width: 0.5 }
  // An off-grid note still flashes on the grid: at beat 2.6 the 1/4 cycle is in
  // its dark half whether the note began at 0 or at the ragged 2.1.
  assert.equal(resolveActiveStrobe(stateAt(2.6, [note(0, 8, RATE_QUARTER.pitch)], params)), null)
  assert.equal(resolveActiveStrobe(stateAt(2.6, [note(2.1, 8, RATE_QUARTER.pitch)], params)), null)
})

test('style chooses the compositor mode, and an unknown style falls back to invert', () => {
  const notes = [note(0)]
  const modeAt = (style: number) => resolveActiveStrobe(stateAt(0, notes, { width: 0.5, style }))?.mode
  assert.equal(modeAt(STROBE_STYLE_INVERT), STROBE_STYLE_MODES[STROBE_STYLE_INVERT])
  assert.equal(modeAt(STROBE_STYLE_BLACKOUT), STROBE_STYLE_MODES[STROBE_STYLE_BLACKOUT])
  assert.equal(modeAt(STROBE_STYLE_FLASH), STROBE_STYLE_MODES[STROBE_STYLE_FLASH])
  assert.equal(modeAt(99), STROBE_STYLE_MODES[STROBE_STYLE_INVERT])
  // No style stored at all (a track saved before the param existed) also inverts.
  assert.equal(resolveActiveStrobe(stateAt(0, notes, { width: 0.5 }))?.mode, STROBE_STYLE_MODES[STROBE_STYLE_INVERT])
})

test('velocity and depth compound into the flash amount', () => {
  const params = { width: 0.5, depth: 0.5 }
  assert.equal(resolveActiveStrobe(stateAt(0, [note(0)], params))?.amount, 0.5)
  // Velocity arrives either normalized or as 0-127; both scale the same way.
  assert.equal(resolveActiveStrobe(stateAt(0, [note(0, 4, RATE_16TH.pitch, 0.5)], params))?.amount, 0.25)
  assert.equal(resolveActiveStrobe(stateAt(0, [note(0, 4, RATE_16TH.pitch, 127)], params))?.amount, 0.5)
})

test('a zero depth stops flashing rather than running a no-op pass', () => {
  assert.equal(resolveActiveStrobe(stateAt(0, [note(0)], { width: 0.5, depth: 0 })), null)
})

test('the latest-started held row wins when rates overlap', () => {
  const notes = [note(0, 8, RATE_QUARTER.pitch), note(1, 8, RATE_16TH.pitch)]
  // At 1.15 the 1/4 row would still be lit; the newer 1/16 row is dark.
  assert.equal(resolveActiveStrobe(stateAt(1.15, notes, { width: 0.5 })), null)
})

test('a triplet eighth divides the beat in three, not in two', () => {
  const notes = [note(0, 8, RATE_8T.pitch)]
  const params = { width: 0.5 }
  assert.equal(RATE_8T.beatsPerCycle, 1 / 3)
  // Lit at the top of each of the three cycles inside beat 0..1.
  for (const beat of [0.01, 0.34, 0.67]) {
    assert.ok(resolveActiveStrobe(stateAt(beat, notes, params)), `expected lit at ${beat}`)
  }
  // Dark in the back half of each of those same three cycles.
  for (const beat of [0.2, 0.54, 0.87]) {
    assert.equal(resolveActiveStrobe(stateAt(beat, notes, params)), null, `expected dark at ${beat}`)
  }
})

test('a triplet quarter fits three cycles into two beats', () => {
  const notes = [note(0, 8, RATE_QUARTER_T.pitch)]
  const params = { width: 0.5 }
  assert.equal(RATE_QUARTER_T.beatsPerCycle, 2 / 3)
  for (const beat of [0.01, 0.68, 1.35]) {
    assert.ok(resolveActiveStrobe(stateAt(beat, notes, params)), `expected lit at ${beat}`)
  }
  for (const beat of [0.4, 1.05, 1.72]) {
    assert.equal(resolveActiveStrobe(stateAt(beat, notes, params)), null, `expected dark at ${beat}`)
  }
})

test('a triplet row and its straight neighbour land on different grids', () => {
  // The point of the whole feature: at beat 0.2 the straight eighth is still
  // lit while the triplet eighth has already gone dark.
  const params = { width: 0.5 }
  const straight = rate('1/8')
  assert.ok(resolveActiveStrobe(stateAt(0.2, [note(0, 8, straight.pitch)], params)))
  assert.equal(resolveActiveStrobe(stateAt(0.2, [note(0, 8, RATE_8T.pitch)], params)), null)
})

test('the shipped straight pitches keep their rates - saved projects store PITCH', () => {
  // Renumbering these would silently re-time every strobe already in a project.
  const byPitch = new Map(STROBE_RATE_ROWS.map((row) => [row.pitch, row.beatsPerCycle]))
  assert.equal(byPitch.get(68), 1)
  assert.equal(byPitch.get(69), 1 / 2)
  assert.equal(byPitch.get(70), 1 / 4)
  assert.equal(byPitch.get(71), 1 / 8)
  assert.equal(byPitch.get(72), 1 / 16)
  assert.equal(new Set(STROBE_RATE_ROWS.map((row) => row.pitch)).size, STROBE_RATE_ROWS.length)
})

test('every triplet row is exactly two thirds of a straight row', () => {
  const triplets = STROBE_RATE_ROWS.filter((row) => row.triplet)
  assert.deepEqual(triplets.map((row) => row.pitch), [67, 66, 65])
  for (const row of triplets) {
    // Triplets are musical rows, so they always carry a beat length.
    assert.ok(row.beatsPerCycle !== undefined, `${row.label} must be a beat row`)
    // That relationship IS what "triplet" means: three in the space of two.
    const straightEquivalent = (row.beatsPerCycle * 3) / 2
    assert.ok(
      STROBE_RATE_ROWS.some((other) => (
        !other.triplet
        && other.beatsPerCycle !== undefined
        && Math.abs(other.beatsPerCycle - straightEquivalent) < 1e-12
      )),
      `${row.label} has no straight counterpart at ${straightEquivalent}`,
    )
  }
})

test('a frame row is a fixed cycle of 60ths of a second, whatever the tempo', () => {
  const twoFrame = rate('2f')
  assert.equal(twoFrame.framesPerCycle, 2)
  // 2 frames = 1/30 s. At 120bpm that is 1/15 beat; at 60bpm, 1/30 beat.
  assert.ok(Math.abs(strobeCycleBeats(twoFrame, 0.5) - 1 / 15) < 1e-12)
  assert.ok(Math.abs(strobeCycleBeats(twoFrame, 1.0) - 1 / 30) < 1e-12)
  // Same wall-clock instant, same phase, at either tempo - that is the point.
  const at = (seconds: number, secPerBeat: number) =>
    strobeGate(seconds / secPerBeat, strobeCycleBeats(twoFrame, secPerBeat), 0.5)
  for (const seconds of [0.004, 0.02, 0.037, 0.05]) {
    assert.equal(at(seconds, 0.5), at(seconds, 1.0), `tempo changed the flicker at ${seconds}s`)
  }
})

test('musical rows DO scale with tempo, unlike frame rows', () => {
  const quarter = rate('1/4')
  assert.equal(strobeCycleBeats(quarter, 0.5), 1)
  assert.equal(strobeCycleBeats(quarter, 1.0), 1)
  // One beat is one cycle at any tempo - so in seconds it stretches, which is
  // exactly the opposite of the frame rows' guarantee.
})

test('a 2-frame row alternates on the 60fps grid', () => {
  const notes = [note(0, 8, rate('2f').pitch)]
  const params = { width: 0.5 }
  // At 120bpm one frame is 1/30 beat. Lit on even frames, dark on odd.
  const frame = (n: number) => stateAt(n / 30, notes, params)
  assert.ok(resolveActiveStrobe(frame(0)))
  assert.equal(resolveActiveStrobe(frame(1.5)), null)
  assert.ok(resolveActiveStrobe(frame(2)))
  assert.equal(resolveActiveStrobe(frame(3.5)), null)
  assert.ok(resolveActiveStrobe(frame(4)))
})

test('frame rows sit on their own pitches and declare no beat length', () => {
  const frames = STROBE_RATE_ROWS.filter((row) => row.framesPerCycle !== undefined)
  assert.deepEqual(frames.map((row) => row.pitch), [64, 63, 62, 61])
  assert.deepEqual(frames.map((row) => row.framesPerCycle), [2, 3, 4, 6])
  // Exactly one axis per row, or strobeCycleBeats would be ambiguous.
  for (const row of STROBE_RATE_ROWS) {
    const axes = Number(row.beatsPerCycle !== undefined) + Number(row.framesPerCycle !== undefined)
    assert.equal(axes, 1, `${row.label} must declare exactly one cycle axis`)
  }
})

test('a frame row still freezes when the playhead does', () => {
  // The pause invariant: same beat in, same answer out, every time. A real
  // frame counter would tick here and the paused frame would keep flickering.
  const notes = [note(0, 8, rate('3f').pitch)]
  const first = resolveActiveStrobe(stateAt(1.234, notes, { width: 0.5 }))
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(resolveActiveStrobe(stateAt(1.234, notes, { width: 0.5 })), first)
  }
})

test('a track with no stored params runs at the schema defaults', () => {
  // width 0.5, depth 1, style Invert - read from PARAMS via paramDefault, so the
  // runtime cannot drift from what the panel shows.
  const notes = [note(0, 4, RATE_QUARTER.pitch)]
  assert.equal(resolveActiveStrobe(stateAt(0.1, notes, {}))?.amount, 1)
  assert.equal(resolveActiveStrobe(stateAt(0.1, notes, {}))?.mode, STROBE_STYLE_MODES[STROBE_STYLE_INVERT])
  assert.equal(resolveActiveStrobe(stateAt(0.6, notes, {})), null)
})

test('unrecognized pitches, muted tracks and empty state never flash', () => {
  assert.equal(resolveActiveStrobe(stateAt(0, [note(0, 4, 40)], { width: 0.5 })), null)
  assert.equal(resolveActiveStrobe({ ...stateAt(0, [note(0)], { width: 0.5 }), blackedOut: true }), null)
  assert.equal(resolveActiveStrobe({ ...stateAt(0, [note(0)], { width: 0.5 }), opacity: 0 }), null)
  assert.equal(resolveActiveStrobe(undefined), null)
})

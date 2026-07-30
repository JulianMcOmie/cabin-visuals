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
  strobeGate,
} from './Strobe'

const RATE_16TH = STROBE_RATE_ROWS.find((row) => row.label.startsWith('1/16'))!
const RATE_QUARTER = STROBE_RATE_ROWS.find((row) => row.label.startsWith('1/4'))!

function note(beat: number, durationBeats = 4, pitch = RATE_16TH.pitch, velocity = 1): ResolvedNote {
  return { beat, pitch, durationBeats, velocity, blockStartBeat: 0, blockEndBeat: 64 }
}

function stateAt(beat: number, notes: ResolvedNote[], params: Record<string, number> = {}) {
  return {
    beat,
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

test('unrecognized pitches, muted tracks and empty state never flash', () => {
  assert.equal(resolveActiveStrobe(stateAt(0, [note(0, 4, 40)], { width: 0.5 })), null)
  assert.equal(resolveActiveStrobe({ ...stateAt(0, [note(0)], { width: 0.5 }), blackedOut: true }), null)
  assert.equal(resolveActiveStrobe({ ...stateAt(0, [note(0)], { width: 0.5 }), opacity: 0 }), null)
  assert.equal(resolveActiveStrobe(undefined), null)
})

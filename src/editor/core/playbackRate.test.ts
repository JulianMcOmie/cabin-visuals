import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveBpm, PLAYBACK_RATES } from './playbackRate'
import { blockPlacement, delayAtRate } from './audio/placement'

// The contract slow monitoring has to keep: an audio clip stays glued to the
// beat window it occupies at PROJECT tempo, at every rate. Placement is always
// computed at the project bpm (so the document's meaning never changes) and the
// rate is spent in exactly two places - the wall-clock delay, and the player's
// own playbackRate, which stretches the clip by the same factor. Get either one
// wrong and audio drifts against the playhead a little more with every bar.

const BPM = 120
const BEATS_PER_BAR = 4
/** Wall-clock seconds one musical beat takes while monitoring at `rate`. */
const secPerBeat = (rate: number) => 60 / effectiveBpm(BPM, rate)

// Four source-seconds of audio parked at bar 2. At 120bpm that is 8 beats long,
// so it occupies beats 8..16 whatever the monitoring speed.
const block = { startBar: 2, trimStart: 0, trimEnd: 4 }
const START_BEAT = 8
const END_BEAT = 16

test('the gear lever only scales tempo; the project bpm is untouched', () => {
  assert.equal(effectiveBpm(120, 1), 120)
  assert.equal(effectiveBpm(120, 0.5), 60)
  assert.equal(effectiveBpm(120, 0.25), 30)
})

test('1x is the identity - nothing about normal playback moves', () => {
  const p = blockPlacement(block, 0, BPM, BEATS_PER_BAR)
  assert.ok(p)
  assert.equal(delayAtRate(p.delaySec, 1), p.delaySec)
})

test('a pending clip starts exactly when its beat arrives, at every rate', () => {
  for (const rate of PLAYBACK_RATES) {
    const p = blockPlacement(block, 0, BPM, BEATS_PER_BAR)
    assert.ok(p, `placement at ${rate}x`)
    // Beats until the block starts, measured on the slowed wall clock.
    const expected = START_BEAT * secPerBeat(rate)
    assert.equal(delayAtRate(p.delaySec, rate), expected, `delay at ${rate}x`)
  }
})

test('a slowed clip fills exactly the beat window it occupies', () => {
  for (const rate of PLAYBACK_RATES) {
    const p = blockPlacement(block, 0, BPM, BEATS_PER_BAR)
    assert.ok(p)
    // `duration` is SOURCE seconds; the player consumes them at `rate`, so the
    // clip sounds for duration/rate wall seconds - which must be the wall-clock
    // length of beats 8..16 at this gear.
    const sounding = p.duration / rate
    assert.equal(sounding, (END_BEAT - START_BEAT) * secPerBeat(rate), `duration at ${rate}x`)
  }
})

test('joining mid-clip keeps its in-clip offset - that is source seconds, not wall seconds', () => {
  // Enter at beat 12: four beats (two source seconds at 120bpm) into the clip.
  for (const rate of PLAYBACK_RATES) {
    const p = blockPlacement(block, 12, BPM, BEATS_PER_BAR)
    assert.ok(p)
    assert.equal(p.offset, 2, `offset at ${rate}x`)
    assert.equal(delayAtRate(p.delaySec, rate), 0, `mid-clip starts now at ${rate}x`)
    // The remaining half still lands on the remaining four beats.
    assert.equal(p.duration / rate, (END_BEAT - 12) * secPerBeat(rate), `tail at ${rate}x`)
  }
})

test('a block already past is silent at every rate', () => {
  for (const rate of PLAYBACK_RATES) {
    assert.equal(blockPlacement(block, END_BEAT, BPM, BEATS_PER_BAR), null, `past at ${rate}x`)
  }
})

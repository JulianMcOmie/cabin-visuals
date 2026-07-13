import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultBitrate, makeTimebase, RESOLUTIONS, resolveExportRange, videoCodec } from './types'

// 120 bpm, 4/4, 4 bars, 60 fps: the arithmetic stays exact in these cases.
const BPM = 120
const BPB = 4
const BARS = 4
const FPS = 60

test('export resolutions include 4K UHD', () => {
  assert.deepEqual(RESOLUTIONS[0], { label: '4K', width: 3840, height: 2160 })
})

test('4K uses appropriate H.264 levels and bitrates', () => {
  assert.equal(videoCodec(3840, 30), 'avc1.640033')
  assert.equal(videoCodec(3840, 60), 'avc1.640034')
  assert.equal(defaultBitrate(3840, 30), 35_000_000)
  assert.equal(defaultBitrate(3840, 60), 50_000_000)
  assert.equal(videoCodec(1920, 60), 'avc1.64002a')
  assert.equal(defaultBitrate(1920, 60), 12_000_000)
})

test('whole-project timebase is unchanged by the range parameter being absent', () => {
  const tb = makeTimebase(BPM, BPB, BARS, FPS)
  assert.equal(tb.startBeat, 0)
  assert.equal(tb.totalBeats, 16)
  assert.equal(tb.durationSec, 8)
  assert.equal(tb.frameCount, 480)
})

test('ranged timebase starts elsewhere and only spans the range', () => {
  // Bars 2..4 inclusive = beats [4, 16)
  const tb = makeTimebase(BPM, BPB, BARS, FPS, { startBeat: 4, endBeat: 16 })
  assert.equal(tb.startBeat, 4)
  assert.equal(tb.totalBeats, 12)
  assert.equal(tb.durationSec, 6)
  assert.equal(tb.frameCount, 360)
})

test('frame 0 beat equals startBeat; beat(i) walks at one frame per step', () => {
  const tb = makeTimebase(BPM, BPB, BARS, FPS, { startBeat: 4, endBeat: 16 })
  const beatAt = (i: number) => tb.startBeat + (i * tb.bpm) / (60 * FPS)
  assert.equal(beatAt(0), 4)
  // One bar in (2s at 120 bpm 4/4 = 120 frames) lands exactly on beat 8.
  assert.equal(beatAt(120), 8)
})

test('range clamps to the project bounds', () => {
  const tb = makeTimebase(BPM, BPB, BARS, FPS, { startBeat: -3, endBeat: 99 })
  assert.equal(tb.startBeat, 0)
  assert.equal(tb.totalBeats, 16)
})

test('inverted range collapses to zero frames instead of going negative', () => {
  const tb = makeTimebase(BPM, BPB, BARS, FPS, { startBeat: 12, endBeat: 4 })
  assert.equal(tb.startBeat, 12)
  assert.equal(tb.totalBeats, 0)
  assert.equal(tb.frameCount, 0)
})

test('whole mode resolves to null', () => {
  assert.equal(resolveExportRange({ rangeMode: 'whole', rangeFromBar: 2, rangeToBar: 3 }, BPB, BARS, null), null)
})

test('custom bars are 1-indexed and inclusive on both ends', () => {
  const r = resolveExportRange({ rangeMode: 'custom', rangeFromBar: 2, rangeToBar: 4 }, BPB, BARS, null)
  assert.deepEqual(r, { startBeat: 4, endBeat: 16 })
})

test('a single custom bar is a valid range', () => {
  const r = resolveExportRange({ rangeMode: 'custom', rangeFromBar: 3, rangeToBar: 3 }, BPB, BARS, null)
  assert.deepEqual(r, { startBeat: 8, endBeat: 12 })
})

test('custom bars clamp to [1, totalBars] and toBar >= fromBar', () => {
  const low = resolveExportRange({ rangeMode: 'custom', rangeFromBar: -5, rangeToBar: 99 }, BPB, BARS, null)
  assert.deepEqual(low, { startBeat: 0, endBeat: 16 })
  const inverted = resolveExportRange({ rangeMode: 'custom', rangeFromBar: 3, rangeToBar: 1 }, BPB, BARS, null)
  assert.deepEqual(inverted, { startBeat: 8, endBeat: 12 })
})

test('loop mode passes the region beats through without bar rounding', () => {
  const r = resolveExportRange({ rangeMode: 'loop', rangeFromBar: 1, rangeToBar: 1 }, BPB, BARS, { startBeat: 2.5, endBeat: 9.25 })
  assert.deepEqual(r, { startBeat: 2.5, endBeat: 9.25 })
})

test('loop mode clamps the region to the project', () => {
  const r = resolveExportRange({ rangeMode: 'loop', rangeFromBar: 1, rangeToBar: 1 }, BPB, BARS, { startBeat: -2, endBeat: 50 })
  assert.deepEqual(r, { startBeat: 0, endBeat: 16 })
})

test('missing or degenerate loop region falls back to whole project (null)', () => {
  assert.equal(resolveExportRange({ rangeMode: 'loop', rangeFromBar: 1, rangeToBar: 1 }, BPB, BARS, null), null)
  assert.equal(resolveExportRange({ rangeMode: 'loop', rangeFromBar: 1, rangeToBar: 1 }, BPB, BARS, { startBeat: 6, endBeat: 6 }), null)
  assert.equal(resolveExportRange({ rangeMode: 'loop', rangeFromBar: 1, rangeToBar: 1 }, BPB, BARS, { startBeat: 9, endBeat: 6 }), null)
})

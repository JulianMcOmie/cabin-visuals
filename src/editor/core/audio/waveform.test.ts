import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractPeaks, peakLevelFor, reducePeaks, type PeakSource } from './peaks'

// A deterministic two-channel source: a slow sine on the left, a few sharp
// transients on the right, so min/max differ per bucket and a transient must
// survive every reduction level.
function makeSource(frames: number): PeakSource {
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let i = 0; i < frames; i++) left[i] = Math.sin(i * 0.013) * 0.5
  for (const at of [17, 4096, 20000, frames - 3]) right[at] = 0.95
  right[9000] = -0.9
  return { length: frames, numberOfChannels: 2, getChannelData: (c) => (c === 0 ? left : right) }
}

test('reducePeaks keeps the [min,max]-interleaved shape and bucket count', () => {
  const fine = extractPeaks(makeSource(65536), 4096)
  const coarse = reducePeaks(fine, 300)
  assert.equal(coarse.buckets, 300)
  assert.equal(coarse.data.length, 600)
  for (let b = 0; b < coarse.buckets; b++) {
    assert.ok(coarse.data[b * 2] <= coarse.data[b * 2 + 1], `bucket ${b} min <= max`)
  }
})

test('a reduced level is the min-of-mins / max-of-maxes over its fine bucket group', () => {
  const fine = extractPeaks(makeSource(65536), 4096)
  const n = 512 // exact 8:1 grouping, so the expected values are unambiguous
  const coarse = reducePeaks(fine, n)
  for (let b = 0; b < n; b++) {
    let min = 1, max = -1
    for (let i = b * 8; i < (b + 1) * 8; i++) {
      min = Math.min(min, fine.data[i * 2])
      max = Math.max(max, fine.data[i * 2 + 1])
    }
    assert.equal(coarse.data[b * 2], min)
    assert.equal(coarse.data[b * 2 + 1], max)
  }
})

test('transients survive every reduction level (never averaged away)', () => {
  const src = makeSource(65536)
  const fine = extractPeaks(src, 4096)
  for (const n of [2048, 1000, 256, 37, 1]) {
    const level = reducePeaks(fine, n)
    let max = -1, min = 1
    for (let b = 0; b < level.buckets; b++) {
      max = Math.max(max, level.data[b * 2 + 1])
      min = Math.min(min, level.data[b * 2])
    }
    assert.equal(max, Math.fround(0.95), `level ${n} keeps the +0.95 transient`)
    assert.equal(min, Math.fround(-0.9), `level ${n} keeps the -0.9 transient`)
  }
})

test('reducing to an exact divisor equals extracting directly at that resolution', () => {
  // With frames a multiple of both bucket counts, sample and bucket boundaries
  // coincide, so the two routes must agree bit for bit.
  const src = makeSource(65536)
  const fine = extractPeaks(src, 4096)
  const direct = extractPeaks(src, 256)
  const derived = reducePeaks(fine, 256)
  assert.deepEqual(Array.from(derived.data), Array.from(direct.data))
})

test('asking for the fine resolution or finer hands back the fine array itself', () => {
  const fine = extractPeaks(makeSource(4096), 1024)
  assert.equal(reducePeaks(fine, 1024), fine)
  assert.equal(reducePeaks(fine, 100000), fine)
})

test('peakLevelFor quantizes requests up to a power of two', () => {
  assert.equal(peakLevelFor(1000), 1024)
  assert.equal(peakLevelFor(1024), 1024)
  assert.equal(peakLevelFor(1025), 2048)
  assert.equal(peakLevelFor(20000), 32768)
  assert.equal(peakLevelFor(0), 1)
})

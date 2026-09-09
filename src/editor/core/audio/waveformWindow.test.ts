import test from 'node:test'
import assert from 'node:assert/strict'
import { mixWaveformWindow, WAVEFORM_SAMPLES, type WaveformInput } from './waveformWindow'

const left = Float32Array.from({ length: 8000 }, (_, i) => Math.sin(i * .17))
const right = Float32Array.from(left, value => value * .5)
const input: WaveformInput = {
  block: { id: 'clip', clipRef: 'audio', startBar: 1, trimStart: .125, trimEnd: 2 },
  audible: true, volume: .6,
  buffer: { length: left.length, numberOfChannels: 2, sampleRate: 2000, getChannelData: (channel: number) => channel ? right : left },
}
test('bounded stereo waveform agrees with independent beat/trim/gain reference', () => {
  const actual = mixWaveformWindow([input], { beat: 4.25, bpm: 120, beatsPerBar: 4 })
  assert.equal(actual.length, WAVEFORM_SAMPLES)
  assert.equal(actual.byteLength, 4096)
  for (let i = 0; i < actual.length; i++) {
    const frame = Math.floor((.125 + .125 + i / 1023 / 50) * 2000)
    const expected = Math.fround((left[frame] + right[frame]) / 2 * .85 * .6)
    assert.equal(actual[i], expected)
  }
})
test('seeking backward is deterministic, with silence outside trims and for muted clips', () => {
  const q = { beat: 4.25, bpm: 120, beatsPerBar: 4 }
  const first = mixWaveformWindow([input], q)
  mixWaveformWindow([input], { ...q, beat: 6 })
  assert.deepEqual(mixWaveformWindow([input], q), first)
  for (const beat of [0, 9]) assert.ok(mixWaveformWindow([input], { ...q, beat }).every(v => v === 0))
  assert.ok(mixWaveformWindow([{ ...input, audible: false }], q).every(v => v === 0))
})
test('overlapping blocks sum with track gain, independent of request sample count', () => {
  const q = { beat: 4.25, bpm: 120, beatsPerBar: 4 }
  const one = mixWaveformWindow([input], q, 64)
  const sum = mixWaveformWindow([input, input], q, 64)
  for (let i = 0; i < one.length; i++) assert.equal(sum[i], Math.fround(one[i] * 2))
})

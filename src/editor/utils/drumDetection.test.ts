import assert from 'node:assert/strict'
import test from 'node:test'
import { detectDrums } from './drumDetection'

const rate = 44100
function fixture() {
  const samples = new Float32Array(rate * 4)
  // Deterministic tonal bursts with drum-like envelopes. Frequencies sit in
  // distinct bands; these pin timing/classification, not real-world accuracy.
  for (const [time, hz, decay] of [[0.2, 75, 0.06], [0.7, 1500, 0.035], [1.2, 9000, 0.018], [2, 75, 0.06], [2, 1500, 0.035], [3.1, 9000, 0.018]]) {
    for (let i = 0; i < rate * 0.3; i++) {
      const at = Math.round(time * rate) + i
      samples[at] += 0.7 * Math.sin(2 * Math.PI * hz * i / rate) * Math.exp(-i / rate / decay)
    }
  }
  return samples
}

test('silence produces no MIDI hits', () => {
  assert.deepEqual(detectDrums(new Float32Array(rate), rate), { kick: [], snare: [], hihat: [] })
})
test('band attacks preserve timing, simultaneous kick/snare, and velocities', () => {
  const result = detectDrums(fixture(), rate)
  for (const [part, times] of Object.entries({ kick: [0.2, 2], snare: [0.7, 2], hihat: [1.2, 3.1] })) {
    const hits = result[part as keyof typeof result]
    assert.equal(hits.length, times.length, `${part}: ${JSON.stringify(hits)}`)
    hits.forEach((h, i) => {
      assert.ok(Math.abs(h.time - times[i]) < 0.02, `${part} timing: ${h.time}`)
      assert.ok(h.velocity >= 1 && h.velocity <= 127)
    })
  }
})
test('a sustained tone does not become repeated drum hits', () => {
  const samples = Float32Array.from({ length: rate * 2 }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 75 * i / rate))
  assert.ok(detectDrums(samples, rate).kick.length <= 1)
})
test('unsupported sample rate fails clearly', () => {
  assert.throws(() => detectDrums(new Float32Array(10), 8000), /sample rate/)
})

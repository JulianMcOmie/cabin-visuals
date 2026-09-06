import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
// The frame hook reads the registry; initialize it before its particle helper.
import './index'
import { createParticleCloud, disposeParticleCloud, updateParticleCloud, updateParticleField, MAX_PARTICLES } from './particleWordCloud'

const prevTargets = Float32Array.from({ length: MAX_PARTICLES * 3 }, (_, i) => Math.sin(i * 0.13))
const curTargets = Float32Array.from(prevTargets, (v) => -v * 0.7)
const cases = [
  { count: 17, progress: 0, morphSeed: 14, stagger: 0.8, color: '#65aaff', variation: 0.4 },
  { count: 8000, progress: 0.3, morphSeed: 14, stagger: 0.8, color: '#65aaff', variation: 0.4 },
  { count: MAX_PARTICLES, progress: 0.7, morphSeed: 14, stagger: 0.2, color: '#ff65aa', variation: 0.7 },
  { count: 8000, progress: 1, morphSeed: 28, stagger: 0.8, color: '#65aaff', variation: 0 },
  { count: MAX_PARTICLES, progress: 0.5, morphSeed: 42, stagger: 0.8, color: '#65aaff', variation: 0 },
  { count: MAX_PARTICLES, progress: 0.2, morphSeed: 14, stagger: 0.8, color: '#65aaff', variation: 0.4 },
]

// Captured from the original full calculation. Hash the actual float buffers:
// any rounding change to a cached random value changes the rendered vertices.
const expected: string[] = [
  "3b06884e2562ba4fd4777add4f1174851edf385074c4e9fc00be48f99d455c96",
  "0f65fd0738bdd1a9b438f910752f01fa2fc75c79ca051ae864dda5de76392457",
  "ed48e47e1351bda5f68c72ed7459ba172433e581a18a76bea728759a2b05c98f",
  "72b8a7e4bbc88ada1521c55f17e455a2ab3725bb5256b803b4c133c2c9d18584",
  "3c1d1d2151b9871c130acb3ff67f566d06ff5e1ea81817b840b01b3fd5df1819",
  "c4565bae75b54e6462f78be3148954644f236f97fe9337865c9b8f44edc97477",
  "ff0c1384db516aae908602540044aa71374b99af93c4811caa13d22f7641803a",
  "cdeeb838794fdf2ab6c1d68fda79cd61bb354308fec807e1fc5318431bfe8e60",
  "eab019ee69e3f189c318a16daa95dea4211c3364dca739fa516b96d16b5447a1",
  "e5ddcd9ae9621de26bd5bde3eac64bcfa2b696bbf5febea225a4262917436f60",
  "4ea4eca188786eb3e957d2a314b1028b07b0dcd83d3463e40f63e693063335f7",
  "acbf0d889665ff6edeab5286ff5f43ece9b8e7072d600b748cde048c676a5645",
  "f1fd9b83571b7940ae6a6e8365bc2987e7eb3fed90743b1b40bfb9d57ba263bd",
  "0f65fd0738bdd1a9b438f910752f01fa2fc75c79ca051ae864dda5de76392457",
  "835d381d1b96549eff3ccd8643653b0490d90d4bcbbbbcc03dc1d27404326ab6",
  "72b8a7e4bbc88ada1521c55f17e455a2ab3725bb5256b803b4c133c2c9d18584",
  "ff727ee0d0d3a64a9c6cc3678aa207cb586d2dfb7453dc6ef8355dcb31aa8252",
  "c4565bae75b54e6462f78be3148954644f236f97fe9337865c9b8f44edc97477",
  "9576868811c1d4fd6f53140b0da3aa532f1e241b1d1dd3c8a04deb9c538b4254",
  "cdeeb838794fdf2ab6c1d68fda79cd61bb354308fec807e1fc5318431bfe8e60",
  "d12ba4276e76eb50a95aa7c3bdaaf07ca6fa9364bb936e7058e055ac98fa3313",
  "e5ddcd9ae9621de26bd5bde3eac64bcfa2b696bbf5febea225a4262917436f60",
  "777e2dd087febc085df6a86945e78b39b05053f70767f751e403e3f4667d0482",
  "acbf0d889665ff6edeab5286ff5f43ece9b8e7072d600b748cde048c676a5645"
]
const digest = (values: Float32Array, count: number) => createHash('sha256')
  .update(new Uint8Array(values.buffer, values.byteOffset, count * 3 * 4)).digest('hex')

test('particle cloud and field preserve frames across count/color edits and backward scrubs', () => {
  const handles = createParticleCloud()
  const actual: string[] = []
  try {
    for (const c of cases) {
      updateParticleCloud(handles, { ...c, dotSize: 0.025, glow: 0.6, opaque: false, prevTargets, curTargets, pulseScale: 1.13, stackComp: 0.01 })
      actual.push(digest(handles.positionAttr.array as Float32Array, c.count), digest(handles.colorAttr.array as Float32Array, c.count))
      assert.equal(handles.points.geometry.drawRange.count, c.count)
    }
    for (const c of cases) {
      const formation = { shape: { targets: curTargets, fill: 500 }, map: Uint32Array.from({ length: 13 }, (_, i) => i * 2), anchorX: 0.4, anchorY: -0.3, scale: 0.8, progress: c.progress, release: 0.15, seed: c.morphSeed }
      updateParticleField(handles, { ...c, beat: c.progress * 10, dotSize: 0.025, glow: 0.6, opaque: false, drift: 0.4, driftScale: 3, ambient: prevTargets, cur: formation, prev: { ...formation, seed: 97, anchorX: -0.4, release: 0.6 } })
      actual.push(digest(handles.positionAttr.array as Float32Array, c.count), digest(handles.colorAttr.array as Float32Array, c.count))
    }
    assert.deepEqual(actual, expected)
    // No renderer consumed these writes: hidden clouds still keep pending
    // uploads bounded, retaining the full prefix dirtied by earlier frames.
    assert.deepEqual(handles.positionAttr.updateRanges, [{ start: 0, count: MAX_PARTICLES * 3 }])
    assert.deepEqual(handles.colorAttr.updateRanges, [{ start: 0, count: MAX_PARTICLES * 3 }])
  } finally {
    disposeParticleCloud(handles)
  }
})

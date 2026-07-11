// Empirical container-timing tests: feed mp4-muxer EXACTLY the chunk stream
// the export pipeline produces (video PTS from videoEncode's formula, audio at
// the AAC 1024-sample cadence) and parse the finished file's boxes to assert
// what a player will actually see. mp4-muxer is pure JS, so this runs in node
// and is deterministic - the box math here is the ground truth A/V sync rests
// on. These tests exist because of a 2026-07-10 regression: a +44ms "AAC
// priming compensation" on video PTS shipped unverified and pushed audio
// audibly early; the second test pins down what such an offset really does to
// the container so nobody re-ships it on theory alone.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

const FPS = 60
const SAMPLE_RATE = 48_000
const AAC_FRAME = 1024 // samples per encoded AAC chunk
const FRAME_COUNT = 300 // 5s at 60fps
const AAC_COUNT = Math.floor((5 * SAMPLE_RATE) / AAC_FRAME)

/** Mux synthetic chunks mirroring exportEngine's stream; the video PTS for
 *  frame i comes from the provided function so tests can probe offsets. */
function muxFile(videoPts: (i: number) => number): ArrayBuffer {
  // Same options as Mp4Writer (mux.ts).
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: 1280, height: 720 },
    audio: { codec: 'aac', sampleRate: SAMPLE_RATE, numberOfChannels: 2 },
    fastStart: 'in-memory',
  })
  const vBytes = new Uint8Array(64)
  for (let i = 0; i < FRAME_COUNT; i++) {
    // WebCodecs delivers decoderConfig meta with the first chunk.
    const meta = i === 0 ? { decoderConfig: { codec: 'avc1.64002a', description: new Uint8Array([1, 100, 0, 42, 255]) } } : undefined
    muxer.addVideoChunkRaw(vBytes, i % (FPS * 2) === 0 ? 'key' : 'delta', videoPts(i), Math.round(1e6 / FPS), meta)
  }
  const aBytes = new Uint8Array(32)
  for (let k = 0; k < AAC_COUNT; k++) {
    muxer.addAudioChunkRaw(aBytes, 'key', Math.round(((k * AAC_FRAME) / SAMPLE_RATE) * 1e6), Math.round((AAC_FRAME / SAMPLE_RATE) * 1e6))
  }
  muxer.finalize()
  return muxer.target.buffer
}

// ---- minimal ISO-BMFF box walker (containers only as deep as we assert) ----

interface BoxInfo { type: string; start: number; size: number; payload: number }

function* boxes(dv: DataView, start: number, end: number): Generator<BoxInfo> {
  let p = start
  while (p + 8 <= end) {
    let size = dv.getUint32(p)
    const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7))
    let payload = p + 8
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); payload = p + 16 }
    if (size === 0) size = end - p
    yield { type, start: p, size, payload }
    p += size
  }
}

function find(dv: DataView, start: number, end: number, path: string[]): BoxInfo[] {
  const out: BoxInfo[] = []
  for (const b of boxes(dv, start, end)) {
    if (b.type !== path[0]) continue
    if (path.length === 1) out.push(b)
    else out.push(...find(dv, b.payload, b.start + b.size, path.slice(1)))
  }
  return out
}

interface TrackTiming {
  kind: string // 'vide' | 'soun'
  timescale: number
  /** stts as [count, delta] runs, decode order. */
  stts: Array<[number, number]>
  hasEdits: boolean
  hasCtts: boolean
}

function parseTracks(buf: ArrayBuffer): TrackTiming[] {
  const dv = new DataView(buf)
  return find(dv, 0, buf.byteLength, ['moov', 'trak']).map((trak) => {
    const end = trak.start + trak.size
    const mdhd = find(dv, trak.payload, end, ['mdia', 'mdhd'])[0]
    const hdlr = find(dv, trak.payload, end, ['mdia', 'hdlr'])[0]
    const stts = find(dv, trak.payload, end, ['mdia', 'minf', 'stbl', 'stts'])[0]
    const version = dv.getUint8(mdhd.payload)
    const timescale = dv.getUint32(mdhd.payload + (version === 1 ? 20 : 12))
    const kind = String.fromCharCode(...new Uint8Array(buf, hdlr.payload + 8, 4))
    const n = dv.getUint32(stts.payload + 4)
    const runs: Array<[number, number]> = []
    for (let i = 0; i < n; i++) {
      runs.push([dv.getUint32(stts.payload + 8 + i * 8), dv.getUint32(stts.payload + 12 + i * 8)])
    }
    return {
      kind,
      timescale,
      stts: runs,
      hasEdits: find(dv, trak.payload, end, ['edts', 'elst']).length > 0,
      hasCtts: find(dv, trak.payload, end, ['mdia', 'minf', 'stbl', 'ctts']).length > 0,
    }
  })
}

/** Presentation start time (s) of sample `index` per the stts runs (no ctts). */
function sampleTime(t: TrackTiming, index: number): number {
  let units = 0
  let i = 0
  for (const [count, delta] of t.stts) {
    for (let k = 0; k < count; k++) {
      if (i === index) return units / t.timescale
      units += delta
      i++
    }
  }
  throw new Error(`sample ${index} out of range`)
}

test('shipped stream: both tracks start at 0 with uniform sample durations and no edit lists', () => {
  // Exactly videoEncode.ts's PTS formula.
  const tracks = parseTracks(muxFile((i) => Math.round((i * 1e6) / FPS)))
  assert.equal(tracks.length, 2)

  const video = tracks.find((t) => t.kind === 'vide')!
  const audio = tracks.find((t) => t.kind === 'soun')!

  // mp4-muxer writes no elst; alignment must therefore live in the samples.
  assert.equal(video.hasEdits, false)
  assert.equal(audio.hasEdits, false)
  assert.equal(video.hasCtts, false)

  // One uniform run each: every video frame exactly 1/fps, every audio sample
  // exactly 1024 samples. Any extra run means the muxer saw jitter we fed it.
  assert.deepEqual(video.stts, [[FRAME_COUNT, video.timescale / FPS]])
  assert.deepEqual(audio.stts, [[AAC_COUNT, AAC_FRAME]])
  assert.equal(audio.timescale, SAMPLE_RATE)

  // Frame i presented at exactly i/fps - the same arithmetic the beat walk and
  // the offline audio render share, so A/V sync is exact at the container level.
  assert.equal(sampleTime(video, 0), 0)
  assert.equal(sampleTime(video, FPS), 1)
  assert.equal(sampleTime(audio, 0), 0)
})

test('regression guard: a PTS offset after frame 0 lands as a pure video-late shift', () => {
  // The 2026-07-10 "priming compensation": frame 0 at 0, later frames +44ms.
  // The muxer does NOT amplify or mangle it - it derives stts from timestamp
  // deltas, so the whole cost lands on frame 0's duration and every later
  // frame plays exactly 44ms late. That is precisely "audio early by 44ms",
  // the regression users heard; keep video PTS uniform instead.
  const OFFSET_US = Math.round((2112 / SAMPLE_RATE) * 1e6) // 44000
  const tracks = parseTracks(muxFile((i) => (i === 0 ? 0 : Math.round((i * 1e6) / FPS) + OFFSET_US)))
  const video = tracks.find((t) => t.kind === 'vide')!

  const unit = video.timescale / FPS // 960 at timescale 57600
  const offsetUnits = Math.round((OFFSET_US / 1e6) * video.timescale) // 2534
  // First frame held one frame + the offset; the rest uniform.
  assert.deepEqual(video.stts, [[1, unit + offsetUnits], [FRAME_COUNT - 1, unit]])
  // Frame 60 (content t = 1.0s) is presented 44ms late (quantized to the
  // 57600 timescale) - the amplitude of the shift equals the offset, nothing more.
  assert.equal(sampleTime(video, FPS), (unit * FPS + offsetUnits) / video.timescale)
  assert.ok(Math.abs(sampleTime(video, FPS) - (1 + OFFSET_US / 1e6)) < 1 / video.timescale)
})

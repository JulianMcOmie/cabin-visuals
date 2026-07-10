// ─── ENGINE SPIKE round 3 (throwaway) ────────────────────────────────────────
// The PAD model: a clip is (source video, in-point) — a moment chosen from the
// middle of a source. A trigger (note hit / pad press) plays it FROM ITS OWN
// START, instantly, re-triggerable, back-to-back. This matches the product's
// actual interaction (video clips as drum samples on the beat grid).
//
// Why this is architecturally golden: trigger points are FIXED AND KNOWN, so
// each pad keeps a permanently-warm "head cache" — its first ~0.4s decoded to
// stage-resolution ImageBitmaps. Every hit paints from cache on the very next
// display tick (~0ms), while a live decoder spins up behind it to continue the
// clip. Cold-landing latency (the 258ms freezes of round 2) is structurally
// impossible on a pad hit.
//
// Ownership rules: VideoSamples are close()d exactly once (drawn, skipped, or
// disposed); head-cache ImageBitmaps live until the pad is disposed.

import {
  Input,
  ALL_FORMATS,
  BlobSource,
  VideoSampleSink,
  type InputVideoTrack,
  type VideoSample,
} from 'mediabunny'

export interface SpikeClip {
  name: string
  duration: number
  width: number
  height: number
  codec: string | null
  track: InputVideoTrack
}

export async function openClip(file: File): Promise<SpikeClip> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  const track = await input.getPrimaryVideoTrack()
  if (!track) throw new Error(`${file.name}: no video track`)
  const duration = await input.computeDuration()
  return {
    name: file.name,
    duration,
    width: track.displayWidth,
    height: track.displayHeight,
    codec: track.codec,
    track,
  }
}

const HEAD_SPAN_S = 0.4 // decoded-ahead-of-time window every trigger lands in
const HEAD_MAX_FRAMES = 14
const LIVE_START_S = HEAD_SPAN_S - 0.12 // live decode overlaps the cache tail
const LIVE_BUFFER_CAP = 16
const FREEZE_THRESHOLD_MS = 80

export interface Pad {
  clip: SpikeClip
  inPoint: number
  /** Stage-resolution, cover-fitted, permanently decoded first frames. */
  head: { bitmaps: ImageBitmap[]; timestamps: number[] }
  /** Dedicated sink: one decoder per pad, reused across triggers. */
  sink: VideoSampleSink
  dispose(): void
}

function coverDraw(
  sample: VideoSample,
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  const sw = sample.displayWidth
  const sh = sample.displayHeight
  const scale = Math.max(w / sw, h / sh)
  sample.draw(
    ctx as CanvasRenderingContext2D,
    (w - sw * scale) / 2,
    (h - sh * scale) / 2,
    sw * scale,
    sh * scale,
  )
}

/** Build a pad: capture its head cache (the instant-trigger guarantee). */
export async function createPad(clip: SpikeClip, inPoint: number, stageW: number, stageH: number): Promise<Pad> {
  const sink = new VideoSampleSink(clip.track)
  const bitmaps: ImageBitmap[] = []
  const timestamps: number[] = []
  const canvas = new OffscreenCanvas(stageW, stageH)
  const ctx = canvas.getContext('2d')!
  const headSink = new VideoSampleSink(clip.track)
  for await (const sample of headSink.samples(inPoint, inPoint + HEAD_SPAN_S)) {
    coverDraw(sample, ctx, stageW, stageH)
    timestamps.push(sample.timestamp)
    sample.close()
    bitmaps.push(canvas.transferToImageBitmap())
    if (bitmaps.length >= HEAD_MAX_FRAMES) break
  }
  if (bitmaps.length === 0) throw new Error('No frames at that position')
  return {
    clip,
    inPoint,
    head: { bitmaps, timestamps },
    sink,
    dispose() {
      for (const b of bitmaps) b.close()
    },
  }
}

/** Rolling decoded window continuing a pad past its head cache. */
class LiveBuffer {
  private samples: VideoSample[] = []
  private iter: AsyncGenerator<VideoSample, void, unknown>
  private exhausted = false
  private pulling = false

  constructor(sink: VideoSampleSink, startAt: number, private onDecoded: () => void) {
    this.iter = sink.samples(startAt)
  }

  get size(): number {
    return this.samples.length
  }

  topUp(target: number): void {
    if (this.pulling || this.exhausted) return
    this.pulling = true
    void (async () => {
      try {
        while (this.samples.length < target && !this.exhausted) {
          const { value, done } = await this.iter.next()
          if (done || !value) {
            this.exhausted = true
            break
          }
          this.samples.push(value)
          this.onDecoded()
        }
      } catch (err) {
        console.error('spike: decode pull failed', err)
        this.exhausted = true
      } finally {
        this.pulling = false
      }
    })()
  }

  take(mediaTime: number): VideoSample | null {
    let winner = -1
    for (let i = 0; i < this.samples.length; i++) {
      if (this.samples[i].timestamp <= mediaTime) winner = i
      else break
    }
    if (winner < 0) return null
    for (let i = 0; i < winner; i++) this.samples[i].close()
    const sample = this.samples[winner]
    this.samples = this.samples.slice(winner + 1)
    return sample
  }

  dispose(): void {
    for (const s of this.samples) s.close()
    this.samples = []
    this.exhausted = true
    void this.iter.return()
  }
}

export interface FreezeEvent {
  durationMs: number
  /** Seconds into the pad's clip when the freeze began (0 ≈ at the trigger). */
  secondsIn: number
}

export interface PadStats {
  decoded: number
  starvedTicks: number
  freezes: FreezeEvent[]
  /** Wall ms from trigger() to its first drawn frame. THE number: the head
   *  cache should make this one display tick, every time, forever. */
  triggerLatencies: number[]
  activePad: number
  buffered: number
  headHits: number
  liveHits: number
}

export class PadPlayer {
  readonly stats: PadStats = {
    decoded: 0,
    starvedTicks: 0,
    freezes: [],
    triggerLatencies: [],
    activePad: -1,
    buffered: 0,
    headHits: 0,
    liveHits: 0,
  }

  private live: LiveBuffer | null = null
  private active: { pad: Pad; padIndex: number; triggerBeat: number } | null = null
  private pendingTriggerWall: number | null = null
  private lastDrawnMediaTime = -1
  private behindSince: number | null = null
  private behindSecondsIn = 0

  constructor(private pads: Pad[], private secPerBeat: number) {}

  /** A note hit. Restarts the pad from its in-point — including re-triggering
   *  the pad that is already playing. */
  trigger(padIndex: number, beat: number): void {
    const pad = this.pads[padIndex]
    if (!pad) return
    this.live?.dispose()
    this.live = new LiveBuffer(pad.sink, pad.inPoint + LIVE_START_S, () => {
      this.stats.decoded++
    })
    this.active = { pad, padIndex, triggerBeat: beat }
    this.stats.activePad = padIndex
    this.pendingTriggerWall = performance.now()
    this.lastDrawnMediaTime = -1
    this.behindSince = null
  }

  frameInto(beat: number, ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
    const a = this.active
    if (!a) return false
    const now = performance.now()
    const secondsIn = Math.max(0, (beat - a.triggerBeat) * this.secPerBeat)
    const target = a.pad.inPoint + secondsIn

    this.live?.topUp(LIVE_BUFFER_CAP)
    this.stats.buffered = this.live?.size ?? 0

    // ── Head-cache window: every trigger's first frames come from here.
    if (secondsIn <= HEAD_SPAN_S) {
      const { bitmaps, timestamps } = a.pad.head
      let idx = -1
      for (let i = 0; i < timestamps.length; i++) {
        if (timestamps[i] <= target) idx = i
        else break
      }
      if (idx >= 0) {
        if (timestamps[idx] > this.lastDrawnMediaTime) {
          ctx.drawImage(bitmaps[idx], 0, 0)
          this.lastDrawnMediaTime = timestamps[idx]
          this.settle(now)
          this.stats.headHits++
          return true
        }
        return false // current cached frame still correct
      }
    }

    // ── Past the head: serve from the live decoder.
    const sample = this.live?.take(target) ?? null
    if (!sample) {
      const newFrameDue =
        this.pendingTriggerWall !== null || target - this.lastDrawnMediaTime > 0.05
      if (newFrameDue) {
        this.stats.starvedTicks++
        if (this.behindSince === null) {
          this.behindSince = this.pendingTriggerWall ?? now
          this.behindSecondsIn = secondsIn
        }
      }
      return false
    }
    coverDraw(sample, ctx, w, h)
    this.lastDrawnMediaTime = sample.timestamp
    sample.close()
    this.settle(now)
    this.stats.liveHits++
    return true
  }

  private settle(now: number): void {
    if (this.behindSince !== null) {
      const durationMs = now - this.behindSince
      if (durationMs > FREEZE_THRESHOLD_MS) {
        this.stats.freezes.push({ durationMs, secondsIn: this.behindSecondsIn })
        if (this.stats.freezes.length > 40) this.stats.freezes.shift()
      }
      this.behindSince = null
    }
    if (this.pendingTriggerWall !== null) {
      this.stats.triggerLatencies.push(now - this.pendingTriggerWall)
      if (this.stats.triggerLatencies.length > 60) this.stats.triggerLatencies.shift()
      this.pendingTriggerWall = null
    }
  }

  dispose(): void {
    this.live?.dispose()
    this.live = null
    this.active = null
  }
}

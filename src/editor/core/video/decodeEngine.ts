// The Video instrument's decode engine (proven in the /spike prototype, now the
// real thing). NO <video> elements and NO element seeking - that approach could
// not do instant, re-triggerable cuts. Instead: mediabunny decodes each source,
// every clip keeps a permanently-warm HEAD CACHE (its first ~0.4s at the source
// resolution, as ImageBitmaps), and a rolling live buffer continues past it. A
// note-triggered clip restart lands on a cached frame the very next display
// tick; the live decoder catches up behind it.
//
// Pause-invariant by construction: the instrument derives (which clip, what
// source-time) purely from (beat, notes) each frame and asks the engine to draw
// exactly that. The engine holds decoders as an optimization, never as truth -
// scrub, pause, and export ask for the same (clip, time) and get the same frame.
//
// Ownership: VideoSamples are close()d exactly once (drawn, skipped, disposed);
// head-cache ImageBitmaps live until their clip is dropped.

import { Input, ALL_FORMATS, VideoSampleSink, type InputVideoTrack, type VideoSample } from 'mediabunny'
import { getVideoSource } from './videoSource'

const HEAD_SPAN_S = 0.4 // pre-decoded window every (re)trigger lands inside
const HEAD_MAX_FRAMES = 16
const LIVE_START_LEAD_S = 0.12 // live decode overlaps the head-cache tail
const LIVE_BUFFER_CAP = 16
const MAX_DIM = 1920 // cap decode/cache resolution (memory bound)

/** One clip the engine can draw: a source + an in-point (seconds into it). For
 *  now every clip is whole-source (inPoint 0); the pad model sets real
 *  in-points without any engine change. */
export interface EngineClip {
  ref: string
  inPoint: number
}

interface ClipRuntime {
  ref: string
  inPoint: number
  track: InputVideoTrack | null
  sink: VideoSampleSink | null
  input: Input | null
  /** Native frame size after the MAX_DIM cap (even numbers). */
  w: number
  h: number
  head: { bitmaps: ImageBitmap[]; timestamps: number[] }
  ready: boolean
  failed: boolean
}

/** Rolling decoded window pulled from a sink iterator (past the head cache). */
class LiveBuffer {
  private samples: VideoSample[] = []
  private iter: AsyncGenerator<VideoSample, void, unknown>
  private exhausted = false
  private pulling = false
  /** Highest timestamp pulled so far - lets the engine tell "ahead of me" from
   *  "behind me" for reseat decisions. */
  reach = -1

  constructor(sink: VideoSampleSink, startAt: number) {
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
          if (done || !value) { this.exhausted = true; break }
          this.samples.push(value)
          this.reach = value.timestamp
        }
      } catch {
        this.exhausted = true
      } finally {
        this.pulling = false
      }
    })()
  }

  /** Latest buffered sample with timestamp <= t; older ones are closed and
   *  dropped, and ownership of the winner passes to the caller. */
  take(t: number): VideoSample | null {
    let winner = -1
    for (let i = 0; i < this.samples.length; i++) {
      if (this.samples[i].timestamp <= t) winner = i
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

function cappedDims(track: InputVideoTrack): { w: number; h: number } {
  const scale = Math.min(1, MAX_DIM / Math.max(track.displayWidth, track.displayHeight))
  const even = (v: number) => Math.max(2, Math.round((v * scale) / 2) * 2)
  return { w: even(track.displayWidth), h: even(track.displayHeight) }
}

export interface DrawResult {
  /** A frame is on the canvas (this tick or a still-correct earlier one). */
  visible: boolean
  /** A NEW frame was drawn this tick (texture needs re-upload). */
  updated: boolean
  /** Native aspect of the drawn clip, for the instrument's cover/fit mesh. */
  aspect: number
}

const HIDDEN: DrawResult = { visible: false, updated: false, aspect: 16 / 9 }

export class VideoDecodeEngine {
  private clips = new Map<string, ClipRuntime>()
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  // Single live playhead: one clip plays at a time (activeVideoAt latches one).
  private liveRef: string | null = null
  private live: LiveBuffer | null = null
  private liveStart = -1
  private lastDrawnRef: string | null = null
  private lastDrawnTime = -1
  // Set by drawExact (export): draw() trusts an exact frame for the same
  // request instead of overwriting it with a best-effort one.
  private exactRef: string | null = null
  private exactTime = -1

  /** Fired when an async decode makes a new frame available while paused, so
   *  the instrument can redraw its last request (the frame callback is skip-
   *  gated and won't re-run on its own at a static beat). */
  constructor(private onFrameReady: () => void) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = 16
    this.canvas.height = 16
    this.ctx = this.canvas.getContext('2d')!
  }

  /** The canvas the instrument wraps in a CanvasTexture. */
  get canvasSource(): HTMLCanvasElement {
    return this.canvas
  }

  /** Reconcile the open clips with `want`. New clips open + build a head cache
   *  (async); dropped clips are torn down. Cheap to call every render. */
  syncClips(want: EngineClip[]): void {
    const wanted = new Set(want.map((c) => c.ref))
    for (const [ref, rt] of this.clips) {
      if (wanted.has(ref)) continue
      this.disposeClip(rt)
      this.clips.delete(ref)
    }
    for (const clip of want) {
      const existing = this.clips.get(clip.ref)
      if (existing) {
        existing.inPoint = clip.inPoint
        continue
      }
      const rt: ClipRuntime = {
        ref: clip.ref, inPoint: clip.inPoint, track: null, sink: null, input: null,
        w: 16, h: 16, head: { bitmaps: [], timestamps: [] }, ready: false, failed: false,
      }
      this.clips.set(clip.ref, rt)
      void this.arm(rt)
    }
  }

  private async arm(rt: ClipRuntime): Promise<void> {
    try {
      const input = new Input({ formats: ALL_FORMATS, source: await getVideoSource(rt.ref) })
      const track = await input.getPrimaryVideoTrack()
      if (!track) throw new Error('no video track')
      const { w, h } = cappedDims(track)
      rt.input = input
      rt.track = track
      rt.sink = new VideoSampleSink(track)
      rt.w = w
      rt.h = h

      // Head cache: first HEAD_SPAN_S from the in-point, at native size.
      const off = new OffscreenCanvas(w, h)
      const octx = off.getContext('2d')!
      const headSink = new VideoSampleSink(track)
      for await (const sample of headSink.samples(rt.inPoint, rt.inPoint + HEAD_SPAN_S)) {
        octx.drawImage(sample.toCanvasImageSource() as CanvasImageSource, 0, 0, w, h)
        rt.head.timestamps.push(sample.timestamp)
        sample.close()
        rt.head.bitmaps.push(off.transferToImageBitmap())
        if (rt.head.bitmaps.length >= HEAD_MAX_FRAMES) break
      }
      rt.ready = rt.head.bitmaps.length > 0
      if (!rt.ready) rt.failed = true
      this.onFrameReady()
    } catch (err) {
      console.error('Video clip failed to arm', rt.ref, err)
      rt.failed = true
    }
  }

  private disposeClip(rt: ClipRuntime): void {
    for (const b of rt.head.bitmaps) b.close()
    rt.head = { bitmaps: [], timestamps: [] }
    if (this.liveRef === rt.ref) {
      this.live?.dispose()
      this.live = null
      this.liveRef = null
    }
    void rt.input?.dispose()
  }

  private ensureCanvasSize(rt: ClipRuntime): void {
    if (this.canvas.width !== rt.w || this.canvas.height !== rt.h) {
      this.canvas.width = rt.w
      this.canvas.height = rt.h
    }
  }

  /** (Re)seat the live decoder for `rt` so it will serve frames from `fromTime`
   *  onward. Called on a clip change or a scrub discontinuity. */
  private reseat(rt: ClipRuntime, fromTime: number): void {
    this.live?.dispose()
    this.live = rt.sink ? new LiveBuffer(rt.sink, fromTime) : null
    this.liveRef = rt.ref
    this.liveStart = fromTime
  }

  /**
   * Draw the frame for clip `ref` at absolute source time `sourceTime`. Sync,
   * best-effort from head cache / live buffer - the live path for playback and
   * light scrub. Returns whether anything is showing and if it changed.
   */
  draw(ref: string | null, sourceTime: number): DrawResult {
    if (!ref) return HIDDEN
    const rt = this.clips.get(ref)
    if (!rt || rt.failed) return HIDDEN
    if (!rt.ready) return { visible: false, updated: false, aspect: rt.w / rt.h }

    this.ensureCanvasSize(rt)
    const aspect = rt.w / rt.h

    // Export drew this exact (ref, time) already - don't overwrite it.
    if (ref === this.exactRef && Math.abs(sourceTime - this.exactTime) < 1e-4) {
      return { visible: true, updated: false, aspect }
    }
    this.exactRef = null

    const withinHead = sourceTime <= rt.inPoint + HEAD_SPAN_S

    // A clip change, or a jump outside what the live buffer can serve, is a
    // (re)trigger: seed the live decoder to overlap the head-cache tail.
    const isDiscontinuity =
      ref !== this.liveRef ||
      sourceTime < this.liveStart - 0.01 ||
      (this.live !== null && sourceTime > this.live.reach + 1.0 && !withinHead)
    if (isDiscontinuity) {
      this.reseat(rt, Math.max(rt.inPoint + HEAD_SPAN_S - LIVE_START_LEAD_S, sourceTime))
    }

    this.live?.topUp(LIVE_BUFFER_CAP)

    // Head-cache window: every (re)trigger's first frames come from here, free.
    if (withinHead && rt.head.timestamps.length > 0) {
      let idx = -1
      for (let i = 0; i < rt.head.timestamps.length; i++) {
        if (rt.head.timestamps[i] <= sourceTime) idx = i
        else break
      }
      if (idx >= 0) {
        const changed = ref !== this.lastDrawnRef || rt.head.timestamps[idx] !== this.lastDrawnTime
        if (changed) {
          this.ctx.drawImage(rt.head.bitmaps[idx], 0, 0, rt.w, rt.h)
          this.lastDrawnRef = ref
          this.lastDrawnTime = rt.head.timestamps[idx]
        }
        return { visible: true, updated: changed, aspect }
      }
    }

    // Past the head: serve from the live buffer.
    const sample = this.live?.take(sourceTime) ?? null
    if (!sample) {
      // Nothing new ready yet; the last drawn frame (if this same clip) stays
      // on canvas - no black flash. Hidden only if we've drawn nothing for it.
      return { visible: this.lastDrawnRef === ref, updated: false, aspect }
    }
    this.ctx.drawImage(sample.toCanvasImageSource() as CanvasImageSource, 0, 0, rt.w, rt.h)
    this.lastDrawnRef = ref
    this.lastDrawnTime = sample.timestamp
    sample.close()
    return { visible: true, updated: true, aspect }
  }

  /**
   * Frame-EXACT draw for export: awaits the precise frame at `sourceTime`.
   * Slower than draw() but deterministic - each exported beat gets its true
   * frame. Returns the clip aspect, or null if nothing could be drawn.
   */
  async drawExact(ref: string | null, sourceTime: number): Promise<number | null> {
    if (!ref) return null
    const rt = this.clips.get(ref)
    if (!rt || rt.failed || !rt.sink) {
      // Give a just-added clip a moment to arm.
      if (rt && !rt.ready && !rt.failed) await new Promise((r) => setTimeout(r, 50))
      if (!rt?.sink) return null
    }
    this.ensureCanvasSize(rt!)
    const sample = await rt!.sink!.getSample(sourceTime)
    if (!sample) return rt!.w / rt!.h
    this.ctx.drawImage(sample.toCanvasImageSource() as CanvasImageSource, 0, 0, rt!.w, rt!.h)
    sample.close()
    this.exactRef = ref
    this.exactTime = sourceTime
    this.lastDrawnRef = ref
    this.lastDrawnTime = sourceTime
    return rt!.w / rt!.h
  }

  dispose(): void {
    for (const rt of this.clips.values()) this.disposeClip(rt)
    this.clips.clear()
    this.live = null
    this.liveRef = null
  }
}

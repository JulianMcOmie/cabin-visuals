// The frame loop - the one place export timing lives. Walks the beat across
// the export range at exactly one frame per step: beat(i) = startBeat +
// i·bpm/(60·fps), pure arithmetic, no wall clock. Each step renders through the FrameDriver
// (the same path scrubbing takes) and hands the frame to a sink; the sink is
// where encoding plugs in, and its awaits are the loop's backpressure.

import type { Track } from '../../types'
import { makeTimebase, type BeatRange, type ExportSettings, type ExportTimebase } from './types'
import { getFrameDriver, type FrameDriver } from './frameDriver'
import { Mp4Writer } from './mux'
import { createVideoEncodeSession, createParallelVideoEncodeSession, ParallelVideoEncodingError, exportEncoderConfig, exportEncodeOptions, type VideoEncodeSession } from './videoEncode'
import { encoderProducesMuxableChunks } from './support'
import { renderAudioTrack, encodeAudioIntoWriter, willRenderAudio, EXPORT_AUDIO_SAMPLE_RATE } from './audioRender'
import { createWatermarkCompositor } from './watermark'
import { framePreparers } from './framePreparers'
import { whenInstrumentsSettled } from '../../instruments/lazyInstrument'
import { assertExportSize } from './exportSurface'

export interface WalkHooks {
  /** Called about once a second of output (every `fps` frames) and once at the end. */
  onProgress?: (frame: number, total: number) => void
  signal?: AbortSignal
}

// Frame preparers live in their own tiny module: instruments (Photo, Video)
// register them, and importing THIS file for that would drag the encoder,
// muxer and audio renderer into the instrument bundle.
export { registerFramePreparer, type FramePreparer } from './framePreparers'

// The loop's once-a-second yield must NOT be setTimeout: hidden tabs throttle
// timers to >=1s wakeups (and ~1/minute once "intensive" throttling kicks in
// after 5 minutes), which would grind a backgrounded export to a near-stall.
// MessageChannel tasks are exempt from background timer throttling, so the
// export keeps walking frames off-screen - slower if the GPU deprioritizes,
// but never stalled, and (frames being pure functions of beat) never wrong.
function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      ch.port2.close()
      resolve()
    }
    ch.port2.postMessage(null)
  })
}

/**
 * Walk every frame of the export range through the driver and the sink.
 * Returns true if it completed, false if aborted. The driver must already be
 * pinned by the caller - pin/unpin bracket the whole export (including audio),
 * not each walk.
 */
export async function walkFrames(
  timebase: ExportTimebase,
  fps: number,
  sink: (frameIndex: number, beat: number, driver: FrameDriver) => void | Promise<void>,
  hooks: WalkHooks = {},
  frameIndexAt?: (step: number, totalFrames: number) => number,
): Promise<boolean> {
  const driver = getFrameDriver()
  if (!driver) throw new Error('Export driver is not mounted')

  for (let step = 0; step < timebase.frameCount; step++) {
    if (hooks.signal?.aborted) return false
    // Only submission order changes; beat, timestamp and poster keep the real
    // frame index. Async media stays chronological to avoid repeated seeks.
    if (frameIndexAt && framePreparers.size > 0) {
      throw new ParallelVideoEncodingError('Async frame inputs require sequential export')
    }
    const i = frameIndexAt ? frameIndexAt(step, timebase.frameCount) : step
    if (!Number.isSafeInteger(i) || i < 0 || i >= timebase.frameCount) throw new Error('Invalid export frame index')
    // Range shift lives here and only here: media timestamps stay index-based.
    const beat = timebase.startBeat + (i * timebase.bpm) / (60 * fps)
    // Let async per-frame inputs (video seeks) settle before the render
    // samples them. No preparers → no await at all.
    if (framePreparers.size > 0) {
      driver.prepareFrame?.(beat)
      await Promise.all([...framePreparers].map((fn) => fn(beat)))
    }
    driver.renderFrame(beat, (i * 1000) / fps)
    await sink(i, beat, driver)
    if (step % fps === 0) {
      hooks.onProgress?.(step, timebase.frameCount)
      // Yield a macrotask so the progress UI paints and aborts can land even
      // when the sink never truly waits (fast encoders, or the no-op sink).
      await yieldMacrotask()
    }
  }
  hooks.onProgress?.(timebase.frameCount, timebase.frameCount)
  return true
}

export interface ProjectTime {
  bpm: number
  beatsPerBar: number
  totalBars: number
  /** The project's audio tracks - rendered offline when settings.includeAudio. */
  audioTracks?: Track[]
  /** Slice to export, absolute beats; absent or null = whole project. */
  range?: BeatRange | null
}

export interface ExportResult {
  /** null = aborted (no file). */
  blob: Blob | null
  frameCount: number
  /** A still of a real encoded frame (data URL) for the completion screen;
   *  null when the export was aborted before reaching it, or capture failed. */
  poster: string | null
}

/** Execution policy is independent of the saved document and output quality.
 * Explicit concurrency supports reproducible performance comparisons. */
export interface ExportExecutionOptions {
  videoConcurrency?: 1 | 2 | 4
}

function defaultVideoConcurrency(settings: ExportSettings, frameCount: number): 1 | 2 | 4 {
  // The measured win is high-resolution constant-quality encoding. Leave
  // short clips, lower tiers, other rate controls and small devices alone.
  if (settings.rateControl !== 'quality' || Math.min(settings.width, settings.height) < 2160
    || frameCount < settings.fps * 4 || typeof navigator === 'undefined') return 1
  return navigator.hardwareConcurrency >= 8 && frameCount >= settings.fps * 8
    ? 4 : navigator.hardwareConcurrency >= 4 ? 2 : 1
}

// The completion screen's still. Grabbed INSIDE the frame sink - the same task
// as the render, where the GL surface still holds the frame (exactly the
// property encodeFrame relies on), and from the same source that gets encoded,
// so the receipt shows the output including its watermark. Downscaled onto a
// 2d canvas first: the receipt shows it at ~700px, and a full-resolution PNG
// data URL would be megabytes of string held in React state.
const POSTER_MAX_EDGE = 960

function captureStill(src: HTMLCanvasElement): string | null {
  try {
    const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(src.width, src.height))
    const still = document.createElement('canvas')
    still.width = Math.max(1, Math.round(src.width * scale))
    still.height = Math.max(1, Math.round(src.height * scale))
    const ctx = still.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(src, 0, 0, still.width, still.height)
    return still.toDataURL('image/jpeg', 0.86)
  } catch {
    return null // a still is a nicety - never fail an export over it
  }
}

/**
 * The whole export: pin the canvas, walk every frame through the encoder with
 * backpressure, flush, finalize the MP4. The pin/unpin bracket lives in a
 * finally - an error or cancel can never leave the editor wedged at export size.
 */
export async function runExport(
  settings: ExportSettings,
  project: ProjectTime,
  hooks: WalkHooks = {},
  execution: ExportExecutionOptions = {},
): Promise<ExportResult> {
  try {
    try {
      return await runExportAttempt(settings, project, hooks, execution)
    } catch (error) {
      // A fresh writer preserves the chosen quality on devices that cannot
      // keep compatible encoders alive. Cancellation must never restart.
      if (!(error instanceof ParallelVideoEncodingError) || hooks.signal?.aborted) throw error
      return await runExportAttempt(settings, project, hooks, { videoConcurrency: 1 })
    }
  } catch (error) {
    if (!hooks.signal?.aborted) throw error
    const timebase = makeTimebase(project.bpm, project.beatsPerBar, project.totalBars, settings.fps, project.range)
    return { blob: null, frameCount: timebase.frameCount, poster: null }
  }
}

async function runExportAttempt(
  settings: ExportSettings,
  project: ProjectTime,
  hooks: WalkHooks,
  execution: ExportExecutionOptions,
): Promise<ExportResult> {
  const driver = getFrameDriver()
  if (!driver) throw new Error('Export driver is not mounted')

  // Fail BEFORE the render, not at mux-finalize: browsers can pick a different
  // encoder per resolution, so the only trustworthy check is a probe encode at
  // the exact chosen config (see encoderProducesMuxableChunks for what
  // "muxable" requires and how Firefox's encoders fall short of it).
  if (!(await encoderProducesMuxableChunks(exportEncoderConfig(settings), exportEncodeOptions(settings)))) {
    throw new Error(
      settings.rateControl !== 'bitrate'
        ? "this browser's encoder doesn't support constant-quality mode. Switch Quality back to Standard, or export in Chrome."
        : "this browser's video encoder doesn't produce the chunk data MP4 files need. Please export in Chrome.",
    )
  }

  const timebase = makeTimebase(project.bpm, project.beatsPerBar, project.totalBars, settings.fps, project.range)

  // Instrument visuals are lazy chunks; an object whose chunk is still on the
  // wire renders its Suspense fallback, i.e. nothing. Every mounted object must
  // be drawing before frame 0 is captured. (Bounded: it resolves regardless
  // after a few seconds rather than wedge the export.)
  await whenInstrumentsSettled()

  // Audio renders CONCURRENTLY with the frame walk. The muxer only needs to
  // know at construction whether the file has an audio track and at what
  // rate - both are known up front (willRenderAudio is the same mute/solo test
  // the render applies; the rate is fixed) - so the offline pass, which runs
  // on the audio thread anyway, no longer sits serially in front of the first
  // frame. The range's startBeat anchors the audio the same way as the walk.
  const wantAudio = !!(settings.includeAudio && project.audioTracks?.length)
    && willRenderAudio(project.audioTracks!, timebase.durationSec)
  const audioPromise = wantAudio
    ? renderAudioTrack(project.audioTracks!, project.bpm, project.beatsPerBar, timebase.durationSec, timebase.startBeat)
    : Promise.resolve(null)
  // Awaited after the walk; this keeps an early failure from surfacing as an
  // unhandled rejection in the meantime (it rethrows at the await below).
  audioPromise.catch(() => {})
  if (hooks.signal?.aborted) return { blob: null, frameCount: timebase.frameCount, poster: null }

  const writer = new Mp4Writer({
    width: settings.width,
    height: settings.height,
    audio: wantAudio ? { sampleRate: EXPORT_AUDIO_SAMPLE_RATE, numberOfChannels: 2 } : undefined,
  })

  // Both tracks start at PTS 0, using the same beat arithmetic. Adding an AAC
  // priming offset to video breaks that alignment (see mux.test.ts).
  let video: VideoEncodeSession | undefined

  const watermark = settings.watermark ? createWatermarkCompositor(settings.width, settings.height) : null

  // The still comes from the MIDDLE of the range: a first or last frame lands
  // on whatever silence brackets the music and is often an empty scene.
  const posterFrame = Math.floor(timebase.frameCount / 2)
  let poster: string | null = null

  let pinned = false
  try {
    driver.pin(settings.width, settings.height)
    pinned = true
    await driver.prepare?.(timebase.startBeat)
    if (hooks.signal?.aborted) return { blob: null, frameCount: timebase.frameCount, poster: null }
    // prepare() may mount media and register async inputs. Check eligibility
    // after the exact export tree has settled, including worker handoff.
    const concurrency = execution.videoConcurrency ?? defaultVideoConcurrency(settings, timebase.frameCount)
    video = concurrency > 1 && framePreparers.size === 0
      ? await createParallelVideoEncodeSession(settings, writer, { concurrency, signal: hooks.signal })
      : createVideoEncodeSession(settings, writer, { signal: hooks.signal })
    const session = video
    const completed = await walkFrames(
      timebase,
      settings.fps,
      (i, _beat, d) => {
        const canvas = d.getCanvas()
        assertExportSize(canvas, settings.width, settings.height)
        const source = watermark ? watermark.compose(canvas) : canvas
        if (i === posterFrame) poster = captureStill(source)
        return session.encodeFrame(source, i, settings.fps)
      },
      hooks,
      video.frameIndexAt,
    )
    if (!completed) {
      video.dispose()
      return { blob: null, frameCount: timebase.frameCount, poster: null }
    }
    await video.flush()
    const audioBuffer = await audioPromise
    if (hooks.signal?.aborted) return { blob: null, frameCount: timebase.frameCount, poster: null }
    if (audioBuffer) await encodeAudioIntoWriter(audioBuffer, writer)
    if (hooks.signal?.aborted) return { blob: null, frameCount: timebase.frameCount, poster: null }
    return { blob: writer.finalize(), frameCount: timebase.frameCount, poster }
  } catch (err) {
    video?.dispose()
    throw err
  } finally {
    // Also clears the beat override - the next live frame recomputes the scene
    // at the untouched store beat, exactly where the user left it.
    if (pinned) driver.unpin()
  }
}

// The frame loop - the one place export timing lives. Walks the beat from 0 to
// the end of the project at exactly one frame per step: beat(i) = i·bpm/(60·fps),
// pure arithmetic, no wall clock. Each step renders through the FrameDriver
// (the same path scrubbing takes) and hands the frame to a sink; the sink is
// where encoding plugs in, and its awaits are the loop's backpressure.

import type { Track } from '../../types'
import { makeTimebase, type ExportSettings, type ExportTimebase } from './types'
import { getFrameDriver, type FrameDriver } from './frameDriver'
import { Mp4Writer } from './mux'
import { createVideoEncodeSession } from './videoEncode'
import { renderAudioTrack, encodeAudioIntoWriter } from './audioRender'
import { createWatermarkCompositor } from './watermark'

export interface WalkHooks {
  /** Called about once a second of output (every `fps` frames) and once at the end. */
  onProgress?: (frame: number, total: number) => void
  signal?: AbortSignal
}

/**
 * Frame preparers: async work that must COMPLETE before a frame is rendered.
 * The Video instrument registers one that seeks its <video> element to the
 * exact beat-derived time and resolves on `seeked` - that is what makes
 * exported video frame-exact where live playback merely drift-corrects.
 * Zero registered preparers costs the loop nothing. Returns an unregister fn.
 */
export type FramePreparer = (beat: number) => Promise<void> | void

const framePreparers = new Set<FramePreparer>()

export function registerFramePreparer(fn: FramePreparer): () => void {
  framePreparers.add(fn)
  return () => framePreparers.delete(fn)
}

/**
 * Walk every frame of the project through the driver and the sink.
 * Returns true if it completed, false if aborted. The driver must already be
 * pinned by the caller - pin/unpin bracket the whole export (including audio),
 * not each walk.
 */
export async function walkFrames(
  timebase: ExportTimebase,
  fps: number,
  sink: (frameIndex: number, beat: number, driver: FrameDriver) => void | Promise<void>,
  hooks: WalkHooks = {},
): Promise<boolean> {
  const driver = getFrameDriver()
  if (!driver) throw new Error('Export driver is not mounted')

  for (let i = 0; i < timebase.frameCount; i++) {
    if (hooks.signal?.aborted) return false
    const beat = (i * timebase.bpm) / (60 * fps)
    // Let async per-frame inputs (video seeks) settle before the render
    // samples them. No preparers → no await at all.
    if (framePreparers.size > 0) {
      await Promise.all([...framePreparers].map((fn) => fn(beat)))
    }
    driver.renderFrame(beat, (i * 1000) / fps)
    await sink(i, beat, driver)
    if (i % fps === 0) {
      hooks.onProgress?.(i, timebase.frameCount)
      // Yield a macrotask so the progress UI paints and aborts can land even
      // when the sink never truly waits (fast encoders, or the no-op sink).
      await new Promise((r) => setTimeout(r, 0))
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
}

export interface ExportResult {
  /** null = aborted (no file). */
  blob: Blob | null
  frameCount: number
}

/**
 * The whole export: pin the canvas, walk every frame through the encoder with
 * backpressure, flush, finalize the MP4. The pin/unpin bracket lives in a
 * finally - an error or cancel can never leave the editor wedged at export size.
 * Video-only for now; the audio track joins the writer in the next phase.
 */
export async function runExport(
  settings: ExportSettings,
  project: ProjectTime,
  hooks: WalkHooks = {},
): Promise<ExportResult> {
  const driver = getFrameDriver()
  if (!driver) throw new Error('Export driver is not mounted')

  const timebase = makeTimebase(project.bpm, project.beatsPerBar, project.totalBars, settings.fps)

  // Audio first: the muxer must know at construction whether the file has an
  // audio track. One offline pass, off the frame loop's critical path.
  const audioBuffer =
    settings.includeAudio && project.audioTracks?.length
      ? await renderAudioTrack(project.audioTracks, project.bpm, project.beatsPerBar, timebase.durationSec)
      : null
  if (hooks.signal?.aborted) return { blob: null, frameCount: timebase.frameCount }

  const writer = new Mp4Writer({
    width: settings.width,
    height: settings.height,
    audio: audioBuffer ? { sampleRate: audioBuffer.sampleRate, numberOfChannels: 2 } : undefined,
  })
  const video = createVideoEncodeSession(settings, writer)

  const watermark = settings.watermark ? createWatermarkCompositor(settings.width, settings.height) : null

  driver.pin(settings.width, settings.height)
  try {
    const completed = await walkFrames(
      timebase,
      settings.fps,
      (i, _beat, d) =>
        video.encodeFrame(watermark ? watermark.compose(d.getCanvas()) : d.getCanvas(), i, settings.fps),
      hooks,
    )
    if (!completed) {
      video.dispose()
      return { blob: null, frameCount: timebase.frameCount }
    }
    await video.flush()
    if (audioBuffer) await encodeAudioIntoWriter(audioBuffer, writer)
    return { blob: writer.finalize(), frameCount: timebase.frameCount }
  } catch (err) {
    video.dispose()
    throw err
  } finally {
    // Also clears the beat override - the next live frame recomputes the scene
    // at the untouched store beat, exactly where the user left it.
    driver.unpin()
  }
}

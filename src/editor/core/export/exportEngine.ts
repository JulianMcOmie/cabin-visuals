// The frame loop - the one place export timing lives. Walks the beat across
// the export range at exactly one frame per step: beat(i) = startBeat +
// i·bpm/(60·fps), pure arithmetic, no wall clock. Each step renders through the FrameDriver
// (the same path scrubbing takes) and hands the frame to a sink; the sink is
// where encoding plugs in, and its awaits are the loop's backpressure.

import type { Track } from '../../types'
import { makeTimebase, type BeatRange, type ExportSettings, type ExportTimebase } from './types'
import { getFrameDriver, type FrameDriver } from './frameDriver'
import { Mp4Writer } from './mux'
import { createVideoEncodeSession, exportEncoderConfig } from './videoEncode'
import { encoderProvidesMp4Metadata } from './support'
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

// The loop's once-a-second yield must NOT be setTimeout: hidden tabs throttle
// timers to >=1s wakeups (and ~1/minute once "intensive" throttling kicks in
// after 5 minutes), which would grind a backgrounded export to a near-stall.
// MessageChannel tasks are exempt from background timer throttling, so the
// export keeps walking frames off-screen - slower if the GPU deprioritizes,
// but never stalled, and (frames being pure functions of beat) never wrong.
function yieldMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => resolve()
    ch.port2.postMessage(null)
  })
}

export function registerFramePreparer(fn: FramePreparer): () => void {
  framePreparers.add(fn)
  return () => framePreparers.delete(fn)
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
): Promise<boolean> {
  const driver = getFrameDriver()
  if (!driver) throw new Error('Export driver is not mounted')

  for (let i = 0; i < timebase.frameCount; i++) {
    if (hooks.signal?.aborted) return false
    // Range shift lives here and only here: media timestamps stay index-based.
    const beat = timebase.startBeat + (i * timebase.bpm) / (60 * fps)
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

  // Fail BEFORE the render, not at mux-finalize: browsers can pick a different
  // encoder per resolution (Firefox: software at small sizes provides the avcC
  // metadata mp4-muxer needs, hardware at real sizes does not), so the only
  // trustworthy check is one probe frame at the exact chosen config.
  if (!(await encoderProvidesMp4Metadata(exportEncoderConfig(settings)))) {
    throw new Error(
      "this browser's video encoder doesn't provide the codec data MP4 files need. Please export in Chrome.",
    )
  }

  const timebase = makeTimebase(project.bpm, project.beatsPerBar, project.totalBars, settings.fps, project.range)

  // Audio first: the muxer must know at construction whether the file has an
  // audio track. One offline pass, off the frame loop's critical path. The
  // range's startBeat anchors the audio the same way it anchors the walk.
  const audioBuffer =
    settings.includeAudio && project.audioTracks?.length
      ? await renderAudioTrack(project.audioTracks, project.bpm, project.beatsPerBar, timebase.durationSec, timebase.startBeat)
      : null
  if (hooks.signal?.aborted) return { blob: null, frameCount: timebase.frameCount }

  const writer = new Mp4Writer({
    width: settings.width,
    height: settings.height,
    audio: audioBuffer ? { sampleRate: audioBuffer.sampleRate, numberOfChannels: 2 } : undefined,
  })

  // A/V alignment is arithmetic and UNCOMPENSATED, on purpose. History: on
  // 2026-07-10 an "AAC priming compensation" delayed every video frame after
  // the first by AAC_PRIMING_US (2112 samples / 48k ≈ 44ms), on the theory
  // that players render the encoder's priming samples as leading silence and
  // the audio therefore lands ~44ms late. Empirically muxing the shifted
  // timestamps through mp4-muxer (see mux.test.ts) showed the container
  // faithfully encodes the shift - first video sample held 60.7ms, everything
  // after +44ms - i.e. the mechanism "worked", but the premise was wrong:
  // AAC decoders discard the priming samples themselves (implicit codec
  // delay), so the audio was never late and the shift made audio audibly
  // EARLY. Kept at 0 = no compensation; both tracks start at PTS 0 and both
  // timelines derive from the same bpm arithmetic.
  const AAC_PRIMING_US = 0 // documented above; do not resurrect without a verified mux dump
  void AAC_PRIMING_US
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

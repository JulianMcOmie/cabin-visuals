// Export Engine — Offline video+audio export using WebCodecs + mp4-muxer
//
// Two-pass approach:
// 1. Audio pass: Tone.Offline() renders audio faster-than-realtime
// 2. Video pass: Step R3F frame-by-frame with virtualClock + WebCodecs VideoEncoder
// 3. Mux: Combine audio + video into MP4 via mp4-muxer

import * as Tone from 'tone';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { Project } from './types';
import { resolveProject } from './resolution';
import { getInstrument } from '@daw/instruments';
import { getVisualPlaybackEngine } from './visualPlayback';
import { virtualClock } from './virtualClock';
import { getExportHandle } from '@daw/components/ExportController';
import { useUIStore } from '@daw/stores/uiStore';

export interface ExportOptions {
  project: Project;
  fps: number;
  width: number;
  height: number;
  videoBitrate?: number;
  onProgress?: (phase: string, progress: number) => void;
  abortSignal?: AbortSignal;
}

export async function exportVideo(options: ExportOptions): Promise<Blob> {
  const {
    project,
    fps,
    width,
    height,
    videoBitrate = 8_000_000,
    onProgress,
    abortSignal,
  } = options;

  const totalBeats = project.totalBars * project.beatsPerBar;
  const durationSec = totalBeats * (60 / project.bpm);
  const totalFrames = Math.ceil(durationSec * fps);

  const handle = getExportHandle();
  if (!handle) {
    throw new Error('Export controller not available. Make sure VisualView is mounted.');
  }

  // === Phase 1: Audio Pass ===
  onProgress?.('Rendering audio...', 0);

  let audioPcmData: Float32Array[] | null = null;
  const sampleRate = 44100;

  const resolvedTracks = resolveProject(project);
  const hasAudioTracks = resolvedTracks.some(t => {
    if (!t.instrumentId) return false;
    const inst = getInstrument(t.instrumentId);
    return inst?.hasAudio && inst.scheduleNote && t.instrumentId !== 'audioPlayer';
  });

  console.log('[Export] Audio tracks found:', hasAudioTracks,
    'Tracks:', resolvedTracks.map(t => ({ id: t.instrumentId, events: t.output.events.length })));

  if (hasAudioTracks) {
    try {
      const audioBuffer = await Tone.Offline(({ transport }) => {
        transport.bpm.value = project.bpm;

        for (const resolved of resolvedTracks) {
          if (!resolved.instrumentId) continue;
          const instrument = getInstrument(resolved.instrumentId);
          if (!instrument?.hasAudio || !instrument.scheduleNote || !instrument.createAudio) continue;
          // Skip AudioPlayer — requires IndexedDB file loading which isn't available in offline context
          if (resolved.instrumentId === 'audioPlayer') continue;

          const instance = instrument.createAudio(resolved.instrumentSettings ?? instrument.defaultSettings);
          const events = resolved.output.events;

          // Filter events within blackout regions
          const blackoutRegions = resolved.blackoutRegions ?? [];
          const isBlackedOut = (beatTime: number): boolean =>
            blackoutRegions.some(r => beatTime >= r.startBeat && beatTime < r.endBeat);

          const secPerBeat = 60 / project.bpm;
          for (const event of events) {
            if (isBlackedOut(event.startTimeInBeats)) continue;
            const timeSec = event.startTimeInBeats * secPerBeat;
            const durationSec = event.duration * secPerBeat;
            // Schedule note at absolute time
            instrument.scheduleNote(instance, {
              ...event,
              duration: durationSec,
            }, timeSec);
          }
        }

        transport.start(0);
      }, durationSec, 2, sampleRate);

      audioPcmData = [];
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        audioPcmData.push(audioBuffer.getChannelData(ch));
      }

      // Check if audio actually has content
      const maxSample = Math.max(...audioPcmData[0].slice(0, 44100).map(Math.abs));
      console.log('[Export] Audio rendered:', audioBuffer.numberOfChannels, 'ch,',
        audioBuffer.length, 'samples,', audioBuffer.duration.toFixed(2), 's, peak:', maxSample.toFixed(4));
    } catch (err) {
      console.warn('Audio render failed, exporting video only:', err);
    }
  }

  if (abortSignal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  onProgress?.('Rendering audio...', 1);

  // === Phase 2: Video Pass ===
  onProgress?.('Rendering video...', 0);

  // Save original renderer state
  const origSize = handle.getSize();
  const origDpr = handle.getPixelRatio();

  // Configure renderer for export
  handle.setPixelRatio(1);
  handle.setSize(width, height);
  handle.setFrameloop('never');

  // Yield to let React effects fire (EffectComposer resize, etc.)
  await new Promise(r => setTimeout(r, 50));

  // Resolve visual playback engine with project
  const visualEngine = getVisualPlaybackEngine();
  visualEngine.resolveFromProject(project);

  // Create video encoder
  const muxerTarget = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: muxerTarget,
    video: {
      codec: 'avc',
      width,
      height,
    },
    audio: audioPcmData ? {
      codec: 'aac',
      numberOfChannels: audioPcmData.length,
      sampleRate,
    } : undefined,
    fastStart: 'in-memory',
  });

  // Video encoder setup
  let videoEncoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      console.error('VideoEncoder error:', err);
      videoEncoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  // H.264 High profile — pick level based on resolution
  // Level 4.0 (0x28): up to 2MP (1080p), Level 5.1 (0x33): up to 36MP (4K+)
  const avcCodec = width * height > 2_097_152 ? 'avc1.640033' : 'avc1.640028';
  videoEncoder.configure({
    codec: avcCodec,
    width,
    height,
    bitrate: videoBitrate,
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware',
  });

  // Frame-by-frame rendering
  const beatsPerFrame = totalBeats / totalFrames;
  const microsecondsPerFrame = 1_000_000 / fps;

  try {
    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (abortSignal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (videoEncoderError) throw videoEncoderError;
      if (videoEncoder.state === 'closed') throw new Error('VideoEncoder closed unexpectedly');

      const beat = frameIndex * beatsPerFrame;
      const virtualTimeMs = (frameIndex / fps) * 1000;

      // Set virtual time for instruments that use virtualClock
      virtualClock.setExportTime(virtualTimeMs);

      // Update beat position
      useUIStore.setState({ currentBeat: beat });

      // Compute visual state at this beat
      visualEngine.computeStatesAtBeat(beat);

      // Advance R3F — triggers all useFrame callbacks + renders
      handle.advance(virtualTimeMs);

      // Capture frame from canvas
      const frame = new VideoFrame(handle.canvas, {
        timestamp: Math.round(frameIndex * microsecondsPerFrame),
      });

      videoEncoder.encode(frame, {
        keyFrame: frameIndex % (fps * 2) === 0, // Keyframe every 2 seconds
      });
      frame.close();

      // Yield sparingly — only for progress updates or encoder backpressure
      if (frameIndex % 60 === 0 || videoEncoder.encodeQueueSize > 30) {
        onProgress?.(`Rendering frame ${frameIndex + 1}/${totalFrames}...`, frameIndex / totalFrames);
        await new Promise(r => setTimeout(r, 0));

        // Re-assert export dimensions — R3F's ResizeObserver may have reset
        // the canvas/FBOs back to the DOM container size during the yield
        handle.setPixelRatio(1);
        handle.setSize(width, height);
      }
    }

    // Flush remaining video frames
    if (videoEncoder.state !== 'closed') {
      await videoEncoder.flush();
      videoEncoder.close();
    }

  } finally {
    // Restore renderer state
    virtualClock.setExportTime(null);
    handle.setPixelRatio(origDpr);
    handle.setSize(origSize.width, origSize.height);
    handle.setFrameloop('always');
  }

  // === Phase 3: Audio encoding (if we have audio) ===
  if (audioPcmData) {
    onProgress?.('Encoding audio...', 0);

    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta);
      },
      error: (err) => {
        console.error('AudioEncoder error:', err);
      },
    });

    audioEncoder.configure({
      codec: 'mp4a.40.2', // AAC-LC
      numberOfChannels: audioPcmData.length,
      sampleRate,
      bitrate: 128_000,
    });

    // Encode audio in chunks (f32-planar: channels laid out sequentially)
    const chunkSize = 1024;
    const totalSamples = audioPcmData[0].length;
    const numberOfChannels = audioPcmData.length;

    for (let offset = 0; offset < totalSamples; offset += chunkSize) {
      if (abortSignal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

      const len = Math.min(chunkSize, totalSamples - offset);

      // Build planar buffer: [ch0_samples...][ch1_samples...]
      const planarBuffer = new Float32Array(len * numberOfChannels);
      for (let ch = 0; ch < numberOfChannels; ch++) {
        planarBuffer.set(audioPcmData[ch].subarray(offset, offset + len), ch * len);
      }

      const audioFrame = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: len,
        numberOfChannels,
        timestamp: Math.round((offset / sampleRate) * 1_000_000),
        data: planarBuffer,
      });

      audioEncoder.encode(audioFrame);
      audioFrame.close();

      if (offset % (chunkSize * 100) === 0) {
        onProgress?.('Encoding audio...', offset / totalSamples);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    await audioEncoder.flush();
    audioEncoder.close();
  }

  // === Phase 4: Finalize ===
  onProgress?.('Finalizing...', 0.9);
  muxer.finalize();

  const blob = new Blob([muxerTarget.buffer], { type: 'video/mp4' });
  onProgress?.('Complete', 1);
  return blob;
}

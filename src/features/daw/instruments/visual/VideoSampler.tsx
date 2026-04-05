'use client';

import { useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { getVideoFile } from '@daw/services/videoStorage';
import { Instrument } from '../types';

const DEFAULTS = {
  videoStorageId: '',
  numSlices: 8,
  startTime: 0,
  sliceDuration: 0,
  playbackMode: 'hold' as 'hold' | 'freeze',
  x: 0,
  y: 0,
  scale: 1,
  opacity: 1,
};

function VideoSamplerVisual({ trackId }: { trackId: string }) {
  const engineRef = useRef(getVisualPlaybackEngine());
  const meshRef = useRef<THREE.Mesh>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const textureRef = useRef<THREE.VideoTexture | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const loadedIdRef = useRef<string>('');
  const aspectRef = useRef(16 / 9);
  const durationRef = useRef(0);
  const hasTriggeredRef = useRef(false);
  const wasActiveRef = useRef(false);
  const activeSliceRef = useRef(-1);
  const activeNoteStartRef = useRef(-1);
  const { viewport } = useThree();
  const [ready, setReady] = useState(false);

  useFrame(() => {
    const state = engineRef.current.getTrackState(trackId);
    if (!state || !meshRef.current) return;

    const videoStorageId = (state.params.videoStorageId as string) ?? DEFAULTS.videoStorageId;
    const numSlices = (state.params.numSlices as number) ?? DEFAULTS.numSlices;
    const startTime = (state.params.startTime as number) ?? DEFAULTS.startTime;
    const sliceDurationSetting = (state.params.sliceDuration as number) ?? DEFAULTS.sliceDuration;
    const playbackMode = (state.params.playbackMode as string) ?? DEFAULTS.playbackMode;
    const x = (state.params.x as number) ?? DEFAULTS.x;
    const y = (state.params.y as number) ?? DEFAULTS.y;
    const scale = (state.params.scale as number) ?? DEFAULTS.scale;
    const opacity = (state.params.opacity as number) ?? DEFAULTS.opacity;

    // Load video if videoStorageId changed
    if (videoStorageId && videoStorageId !== loadedIdRef.current) {
      loadedIdRef.current = videoStorageId;
      setReady(false);
      hasTriggeredRef.current = false;
      wasActiveRef.current = false;
      activeSliceRef.current = -1;
      activeNoteStartRef.current = -1;
      getVideoFile(videoStorageId).then((file) => {
        // Guard against stale load (user switched again before this resolved)
        if (loadedIdRef.current !== videoStorageId) return;
        if (!file) return;

        // Revoke old blob URL
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
        }

        const url = URL.createObjectURL(file.blob);
        blobUrlRef.current = url;
        aspectRef.current = file.width / file.height;
        durationRef.current = file.duration;

        // Create video element
        const video = document.createElement('video');
        video.src = url;
        video.crossOrigin = 'anonymous';
        video.playsInline = true;
        video.muted = true;
        video.preload = 'auto';
        video.load();

        // Dispose old
        if (textureRef.current) textureRef.current.dispose();
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.src = '';
        }

        videoRef.current = video;

        const tex = new THREE.VideoTexture(video);
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        textureRef.current = tex;

        if (meshRef.current) {
          (meshRef.current.material as THREE.MeshBasicMaterial).map = tex;
          (meshRef.current.material as THREE.MeshBasicMaterial).needsUpdate = true;
        }
        setReady(true);
      });
    }

    const video = videoRef.current;
    if (!video || !ready) {
      meshRef.current.visible = false;
      return;
    }

    const isActive = state.activeNotes.size > 0;
    // If sliceDuration is 0 (default), auto-calculate to evenly divide remaining video
    const sliceDur = sliceDurationSetting > 0
      ? sliceDurationSetting
      : (durationRef.current - startTime) / numSlices;

    // Handle note-on: seek to slice position and play
    if (isActive) {
      hasTriggeredRef.current = true;
      // Find the lowest active pitch to determine slice
      let lowestPitch = Infinity;
      state.activeNotes.forEach((_event, pitch) => {
        if (pitch < lowestPitch) lowestPitch = pitch;
      });
      const sliceIndex = Math.max(0, Math.min(numSlices - 1, lowestPitch - 60));
      const rawStart = startTime + sliceIndex * sliceDur;
      const sliceStart = rawStart % durationRef.current;
      const sliceEnd = sliceStart + sliceDur;

      // Track the startTimeInBeats of the driving note to detect retriggers
      const activeEvent = state.activeNotes.get(lowestPitch);
      const noteStart = activeEvent?.startTimeInBeats ?? -1;

      if (!wasActiveRef.current || sliceIndex !== activeSliceRef.current || noteStart !== activeNoteStartRef.current) {
        // New note, different slice, or retrigger: seek and play
        video.currentTime = sliceStart;
        video.play().catch(() => {});
        activeSliceRef.current = sliceIndex;
        activeNoteStartRef.current = noteStart;
      }

      // Clamp playback to slice boundary (handle wrap-around)
      if (sliceEnd > durationRef.current) {
        // Slice wraps around video end — loop back to start
        if (video.currentTime >= durationRef.current - 0.01) {
          video.currentTime = 0;
          video.play().catch(() => {});
        }
        const wrappedEnd = sliceEnd % durationRef.current;
        if (video.currentTime < sliceStart && video.currentTime >= wrappedEnd) {
          video.pause();
          video.currentTime = wrappedEnd - 0.01;
        }
      } else if (video.currentTime >= sliceEnd) {
        video.pause();
        video.currentTime = sliceEnd - 0.01;
      }
      wasActiveRef.current = true;
    } else if (wasActiveRef.current) {
      // Note-off
      wasActiveRef.current = false;
      activeSliceRef.current = -1;
      activeNoteStartRef.current = -1;
      video.pause();
    }

    // Visibility
    if (playbackMode === 'hold') {
      meshRef.current.visible = isActive && ready;
    } else {
      // freeze: visible once triggered
      meshRef.current.visible = hasTriggeredRef.current && ready;
    }

    // Apply position and scale
    const baseScale = Math.min(viewport.width, viewport.height) * 0.5 * scale;
    meshRef.current.scale.set(baseScale * aspectRef.current, baseScale, 1);
    meshRef.current.position.set(x * viewport.width * 0.5, y * viewport.height * 0.5, 0);

    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = opacity;
  });

  // Cleanup
  useEffect(() => {
    return () => {
      if (textureRef.current) textureRef.current.dispose();
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
      }
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  return (
    <mesh ref={meshRef} visible={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial transparent depthWrite={false} />
    </mesh>
  );
}

function generateRangeLabels(numSlices: number) {
  return Array.from({ length: numSlices }, (_, i) => ({
    startPitch: 60 + i,
    endPitch: 60 + i,
    label: `Slice ${i + 1}`,
  }));
}

export const VideoSampler: Instrument = {
  id: 'videoSampler',
  name: 'Video Sampler',
  description: 'Slices a video into segments triggered by MIDI notes',
  icon: '🎬',
  color: '#cc6688',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',
  noteRange: { min: 60, max: 60 + 127 },
  rangeLabels: generateRangeLabels(128),

  defaultSettings: { ...DEFAULTS },

  settingsSchema: {
    numSlices: {
      type: 'number', label: 'Slices', min: 2, max: 128, step: 1,
      default: DEFAULTS.numSlices,
    },
    startTime: {
      type: 'number', label: 'Start Time (s)', min: 0, max: 600, step: 0.1,
      default: DEFAULTS.startTime,
    },
    sliceDuration: {
      type: 'number', label: 'Slice Duration (s)', min: 0, max: 60, step: 0.1,
      default: DEFAULTS.sliceDuration,
    },
    playbackMode: {
      type: 'select', label: 'Playback Mode',
      options: [
        { value: 'hold', label: 'Play While Held' },
        { value: 'freeze', label: 'Freeze Frame' },
      ],
      default: DEFAULTS.playbackMode,
    },
    x: {
      type: 'number', label: 'X Position', min: -1, max: 1, step: 0.05,
      default: DEFAULTS.x,
    },
    y: {
      type: 'number', label: 'Y Position', min: -1, max: 1, step: 0.05,
      default: DEFAULTS.y,
    },
    scale: {
      type: 'number', label: 'Scale', min: 0.1, max: 5, step: 0.1,
      default: DEFAULTS.scale,
    },
    opacity: {
      type: 'number', label: 'Opacity', min: 0, max: 1, step: 0.05,
      default: DEFAULTS.opacity,
    },
  },

  VisualComponent: VideoSamplerVisual,
};

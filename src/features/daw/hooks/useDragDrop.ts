'use client';

import { useCallback, DragEvent, useState } from 'react';
import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore, addTrackFromPreset, addTrackFromInstrument } from '@daw/stores/projectStore';
import { Preset } from '@daw/core/types';
import { PATTERN_PRESETS } from '@daw/core/presets';
import { processAudioFile, audioDurationToBars, isAudioFile } from '@daw/core/audio';
import { getInstrument } from '@daw/instruments';
import { storeImageFile } from '@daw/services/imageStorage';
import { storeVideoFile } from '@daw/services/videoStorage';
import { generateId } from '@daw/utils/id';

export function useDragDrop() {
  const dragState = useUIStore((s) => s.dragState);
  const startDragPreset = useUIStore((s) => s.startDragPreset);
  const startDragBlock = useUIStore((s) => s.startDragBlock);
  const setDropTarget = useUIStore((s) => s.setDropTarget);
  const endDrag = useUIStore((s) => s.endDrag);
  const dropTargetTrackId = useUIStore((s) => s.dropTargetTrackId);
  const dropTargetBar = useUIStore((s) => s.dropTargetBar);

  const { addBlock, moveBlock, addAudioTrack, addImageTrack, addVideoTrack, addVideoKaleidoscopeTrack, updateTrack } = useProjectStore();
  const project = useProjectStore((state) => state.project);

  // Track if we're currently processing an audio file drop
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);

  // Start dragging a preset from the library
  const handlePresetDragStart = useCallback(
    (e: DragEvent, preset: Preset) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'preset', presetId: preset.id }));
      startDragPreset(preset);
    },
    [startDragPreset]
  );

  // Start dragging a block from the timeline
  const handleBlockDragStart = useCallback(
    (e: DragEvent, blockId: string, trackId: string) => {
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'block', blockId, trackId }));
      startDragBlock(blockId, trackId);
    },
    [startDragBlock]
  );

  // Handle drag over timeline or track hierarchy
  const handleDragOver = useCallback(
    (e: DragEvent, trackId: string | null, bar?: number) => {
      e.preventDefault();
      // For presets and instruments always copy, for blocks check Alt key
      if (dragState.type === 'preset' || dragState.type === 'instrument') {
        e.dataTransfer.dropEffect = 'copy';
      } else {
        e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move';
      }
      setDropTarget(trackId, bar);
    },
    [dragState.type, setDropTarget]
  );

  // Handle drag leave
  const handleDragLeave = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      // Only clear if we're leaving the actual element, not entering a child
      const relatedTarget = e.relatedTarget as HTMLElement;
      const currentTarget = e.currentTarget as HTMLElement;
      if (!currentTarget.contains(relatedTarget)) {
        setDropTarget(null, null);
      }
    },
    [setDropTarget]
  );

  // Handle audio file drop
  const handleAudioFileDrop = useCallback(
    async (file: File, trackId: string | null, bar: number) => {
      if (isProcessingAudio) return;

      setIsProcessingAudio(true);

      try {
        // Process the audio file
        const { audioData } = await processAudioFile(file);

        // Calculate block duration based on audio length
        const durationBars = audioDurationToBars(
          audioData.duration,
          project.bpm,
          project.beatsPerBar
        );

        let targetTrackId = trackId;

        // Check if dropping on an existing audio track
        if (trackId) {
          const track = project.tracks[trackId];
          if (track?.instrumentId !== 'audioPlayer') {
            // Not an audio track, create a new one
            targetTrackId = addAudioTrack(audioData.fileName);
          }
        } else {
          // No track specified, create a new audio track
          targetTrackId = addAudioTrack(audioData.fileName);
        }

        // Add the audio block
        addBlock(targetTrackId!, {
          startBar: bar,
          durationBars,
          loop: false,
          streams: [],
          audioData,
        });

      } catch (error) {
        console.error('Error processing audio file:', error);
        // Could add toast notification here
      } finally {
        setIsProcessingAudio(false);
      }
    },
    [isProcessingAudio, project.bpm, project.beatsPerBar, project.tracks, addAudioTrack, addBlock]
  );

  // Handle image file drop
  const handleImageFileDrop = useCallback(
    async (file: File, _trackId: string | null, bar: number) => {
      try {
        const imageStorageId = generateId();

        // Get image dimensions
        const bitmap = await createImageBitmap(file);
        const width = bitmap.width;
        const height = bitmap.height;
        bitmap.close();

        // Store in IndexedDB
        await storeImageFile(imageStorageId, file, {
          fileName: file.name,
          mimeType: file.type,
          width,
          height,
        });

        // Create track
        const newTrackId = addImageTrack(file.name.replace(/\.[^.]+$/, ''), imageStorageId);

        // Add a 4-bar block with a single note so the image is visible by default
        addBlock(newTrackId, {
          startBar: bar,
          durationBars: 4,
          loop: true,
          streams: [{
            events: [{ pitch: 60, startTimeInBeats: 0, duration: 16, velocity: 100 }],
          }],
        });
      } catch (error) {
        console.error('Error processing image file:', error);
      }
    },
    [addImageTrack, addBlock]
  );

  // Handle video file drop
  const handleVideoFileDrop = useCallback(
    async (file: File, _trackId: string | null, bar: number) => {
      try {
        const videoStorageId = generateId();
        const numSlices = 8;

        // Extract video metadata
        const metadata = await new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadedmetadata = () => {
            resolve({
              width: video.videoWidth,
              height: video.videoHeight,
              duration: video.duration,
            });
            URL.revokeObjectURL(video.src);
          };
          video.onerror = () => {
            URL.revokeObjectURL(video.src);
            reject(new Error('Failed to load video metadata'));
          };
          video.src = URL.createObjectURL(file);
        });

        // Store in IndexedDB
        await storeVideoFile(videoStorageId, file, {
          fileName: file.name,
          mimeType: file.type,
          width: metadata.width,
          height: metadata.height,
          duration: metadata.duration,
        });

        // Create track
        const newTrackId = addVideoTrack(file.name.replace(/\.[^.]+$/, ''), videoStorageId, numSlices);

        // Auto-generate sliced MIDI block: 4 bars, one note per slice
        const blockDurationBars = 4;
        const beatsPerSlice = (blockDurationBars * project.beatsPerBar) / numSlices;
        const events = Array.from({ length: numSlices }, (_, i) => ({
          pitch: 60 + i,
          startTimeInBeats: i * beatsPerSlice,
          duration: beatsPerSlice,
          velocity: 100,
        }));

        addBlock(newTrackId, {
          startBar: bar,
          durationBars: blockDurationBars,
          loop: true,
          streams: [{ events }],
        });
      } catch (error) {
        console.error('Error processing video file:', error);
      }
    },
    [addVideoTrack, addBlock, project.beatsPerBar]
  );

  // Handle multiple video files drop → kaleidoscope
  const handleMultiVideoKaleidoscopeDrop = useCallback(
    async (videoFiles: File[], bar: number) => {
      try {
        const numSegments = videoFiles.length;
        const sliceVideoMap: Record<string, string> = {};

        // Store each video and build the slice map
        for (let i = 0; i < videoFiles.length; i++) {
          const file = videoFiles[i];
          const videoStorageId = generateId();

          const metadata = await new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
              resolve({
                width: video.videoWidth,
                height: video.videoHeight,
                duration: video.duration,
              });
              URL.revokeObjectURL(video.src);
            };
            video.onerror = () => {
              URL.revokeObjectURL(video.src);
              reject(new Error('Failed to load video metadata'));
            };
            video.src = URL.createObjectURL(file);
          });

          await storeVideoFile(videoStorageId, file, {
            fileName: file.name,
            mimeType: file.type,
            width: metadata.width,
            height: metadata.height,
            duration: metadata.duration,
          });

          sliceVideoMap[String(i)] = videoStorageId;
        }

        // Create kaleidoscope track
        const newTrackId = addVideoKaleidoscopeTrack('Video Kaleidoscope', sliceVideoMap, numSegments);

        // Auto-generate MIDI block: 4 bars, one note per segment
        const blockDurationBars = 4;
        const beatsPerSegment = (blockDurationBars * project.beatsPerBar) / numSegments;
        const events = Array.from({ length: numSegments }, (_, i) => ({
          pitch: 60 + i,
          startTimeInBeats: i * beatsPerSegment,
          duration: beatsPerSegment,
          velocity: 100,
        }));

        addBlock(newTrackId, {
          startBar: bar,
          durationBars: blockDurationBars,
          loop: true,
          streams: [{ events }],
        });
      } catch (error) {
        console.error('Error creating video kaleidoscope:', error);
      }
    },
    [addVideoKaleidoscopeTrack, addBlock, project.beatsPerBar]
  );

  // Handle single video drop onto existing kaleidoscope track
  const handleVideoOntoKaleidoscope = useCallback(
    async (file: File, trackId: string) => {
      try {
        const videoStorageId = generateId();

        const metadata = await new Promise<{ width: number; height: number; duration: number }>((resolve, reject) => {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadedmetadata = () => {
            resolve({
              width: video.videoWidth,
              height: video.videoHeight,
              duration: video.duration,
            });
            URL.revokeObjectURL(video.src);
          };
          video.onerror = () => {
            URL.revokeObjectURL(video.src);
            reject(new Error('Failed to load video metadata'));
          };
          video.src = URL.createObjectURL(file);
        });

        await storeVideoFile(videoStorageId, file, {
          fileName: file.name,
          mimeType: file.type,
          width: metadata.width,
          height: metadata.height,
          duration: metadata.duration,
        });

        // Find next empty segment slot
        const track = project.tracks[trackId];
        const existingMap = (track.instrumentSettings?.sliceVideoMap as Record<string, string>) || {};
        const numSegments = (track.instrumentSettings?.numSegments as number) || 6;
        let nextSlot = -1;
        for (let i = 0; i < numSegments; i++) {
          if (!existingMap[String(i)]) {
            nextSlot = i;
            break;
          }
        }

        if (nextSlot === -1) {
          // All slots full - expand numSegments if under 16
          if (numSegments < 16) {
            nextSlot = numSegments;
            updateTrack(trackId, {
              instrumentSettings: {
                ...track.instrumentSettings,
                numSegments: numSegments + 1,
                sliceVideoMap: { ...existingMap, [String(nextSlot)]: videoStorageId },
              },
            });
          } else {
            console.warn('All 16 kaleidoscope segments are full');
          }
        } else {
          updateTrack(trackId, {
            instrumentSettings: {
              ...track.instrumentSettings,
              sliceVideoMap: { ...existingMap, [String(nextSlot)]: videoStorageId },
            },
          });
        }
      } catch (error) {
        console.error('Error adding video to kaleidoscope:', error);
      }
    },
    [project.tracks, updateTrack]
  );

  // Handle drop on timeline
  const handleTimelineDrop = useCallback(
    async (e: DragEvent, trackId: string | null, bar: number) => {
      e.preventDefault();

      // Check for file drop first
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const videoExts = /\.(mp4|webm|mov)$/i;

        // Check if multiple video files were dropped → kaleidoscope
        const videoFiles = Array.from(files).filter(f => videoExts.test(f.name));
        if (videoFiles.length > 1) {
          await handleMultiVideoKaleidoscopeDrop(videoFiles, bar);
          endDrag();
          return;
        }

        // Single video drop
        const file = files[0];

        // Check video files first
        if (videoExts.test(file.name)) {
          // If dropping onto an existing kaleidoscope track, add to it
          if (trackId) {
            const track = project.tracks[trackId];
            if (track?.instrumentId === 'videoKaleidoscope') {
              await handleVideoOntoKaleidoscope(file, trackId);
              endDrag();
              return;
            }
          }
          await handleVideoFileDrop(file, trackId, bar);
          endDrag();
          return;
        }

        // Check image files before audio
        const imageExts = /\.(png|jpe?g|gif|webp|svg)$/i;
        if (imageExts.test(file.name)) {
          await handleImageFileDrop(file, trackId, bar);
          endDrag();
          return;
        }

        if (isAudioFile(file)) {
          await handleAudioFileDrop(file, trackId, bar);
          endDrag();
          return;
        }
      }

      try {
        // Try to get instrument data first
        const instrumentId = e.dataTransfer.getData('application/instrument');
        if (instrumentId) {
          // Dropping an instrument
          if (trackId) {
            // Drop on existing track - assign the instrument to it
            const instrument = getInstrument(instrumentId);
            updateTrack(trackId, {
              instrumentId,
              instrumentSettings: instrument?.defaultSettings ? { ...instrument.defaultSettings } : undefined,
            });
          } else {
            // Drop on empty area - create new track with this instrument
            addTrackFromInstrument(instrumentId);
          }
          endDrag();
          return;
        }

        const data = JSON.parse(e.dataTransfer.getData('application/json'));

        if (data.type === 'preset') {
          if (trackId) {
            const preset = PATTERN_PRESETS.find(p => p.id === data.presetId);
            if (preset) {
              addBlock(trackId, {
                startBar: bar,
                durationBars: preset.durationBars,
                loop: true,
                streams: [{ events: [...preset.events] }],
              });
            }
          }
        } else if (data.type === 'block' && trackId) {
          const sourceTrack = project.tracks[data.trackId];
          const block = sourceTrack?.blocks.find(b => b.id === data.blockId);
          if (block) {
            const isCopy = e.altKey;

            if (isCopy) {
              // Copy block - deep clone streams data and audio data
              const clonedStreams = block.streams?.map(stream => ({
                ...stream,
                events: stream.events.map(event => ({ ...event })),
              }));

              addBlock(trackId, {
                startBar: bar,
                durationBars: block.durationBars,
                loop: block.loop,
                streams: clonedStreams,
                audioData: block.audioData ? { ...block.audioData } : undefined,
              });
            } else if (data.trackId === trackId) {
              // Same track - just update position
              useProjectStore.getState().updateBlock(trackId, data.blockId, { startBar: bar });
            } else {
              // Different track - move block
              moveBlock(data.trackId, data.blockId, trackId);
              useProjectStore.getState().updateBlock(trackId, data.blockId, { startBar: bar });
            }
          }
        }
      } catch (err) {
        // Ignore parse errors - might be empty or instrument drop
      }

      endDrag();
    },
    [addBlock, moveBlock, updateTrack, project.tracks, endDrag, handleAudioFileDrop, handleImageFileDrop, handleVideoFileDrop, handleMultiVideoKaleidoscopeDrop, handleVideoOntoKaleidoscope]
  );

  // Handle drop on track hierarchy (adds a child track)
  const handleHierarchyDrop = useCallback(
    (e: DragEvent, parentTrackId?: string) => {
      e.preventDefault();

      try {
        // Try to get instrument data first
        const instrumentId = e.dataTransfer.getData('application/instrument');
        if (instrumentId) {
          addTrackFromInstrument(instrumentId, parentTrackId);
          endDrag();
          return;
        }

        const data = JSON.parse(e.dataTransfer.getData('application/json'));

        if (data.type === 'preset') {
          addTrackFromPreset(data.presetId, parentTrackId);
        }
      } catch (err) {
        // Ignore parse errors
      }

      endDrag();
    },
    [endDrag]
  );

  // Handle drag end (cleanup)
  const handleDragEnd = useCallback(() => {
    endDrag();
  }, [endDrag]);

  return {
    dragState,
    dropTargetTrackId,
    dropTargetBar,
    isProcessingAudio,
    handlePresetDragStart,
    handleBlockDragStart,
    handleDragOver,
    handleDragLeave,
    handleTimelineDrop,
    handleHierarchyDrop,
    handleDragEnd,
    handleAudioFileDrop,
    handleImageFileDrop,
    handleVideoFileDrop,
    handleMultiVideoKaleidoscopeDrop,
    handleVideoOntoKaleidoscope,
  };
}

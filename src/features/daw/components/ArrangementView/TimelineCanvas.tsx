'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState, RefObject } from 'react';
import { TrackNode } from '@daw/utils/tree';
import { Block, Track, getDrumType } from '@daw/core/types';
import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore } from '@daw/stores/projectStore';
import { usePlayback } from '@daw/hooks/usePlayback';
import { useDragDrop } from '@daw/hooks/useDragDrop';
import { isAudioFile } from '@daw/core/audio';
import { INSTRUMENT_COLORS, TRACK_TYPE_COLORS, darken, tintWhite } from '@daw/utils/colors';
import { getInstrument } from '@daw/instruments';
import { getPlugin } from '@daw/plugins';

// Ruler height constant
const RULER_HEIGHT = 48;

interface TimelineCanvasProps {
  flatTracks: TrackNode[];
  pixelsPerBeat: number;
  beatsPerBar: number;
  totalBars: number;
  bpm: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  compact?: boolean; // If true, no minimum height — fits exactly to track count
}

// Helper to find track ID for a given block ID
function findTrackForBlock(tracks: Record<string, Track>, blockId: string): string | null {
  for (const [trackId, track] of Object.entries(tracks)) {
    if (track.blocks.some(b => b.id === blockId)) {
      return trackId;
    }
  }
  return null;
}

// Safe min/max that avoids stack overflow from spreading large arrays
function safeMax(arr: number[], initial: number): number {
  let max = initial;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > max) max = arr[i];
  }
  return max;
}

function safeMin(arr: number[], initial: number): number {
  let min = initial;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
  }
  return min;
}

function getPatternBars(block: Block, beatsPerBar: number): number {
  const allEvents = block.streams?.flatMap((s) => s.events) || [];
  const patternLengthBeats = allEvents.length > 0
    ? safeMax(allEvents.map((e) => e.startTimeInBeats + (e.duration || 0.25)), beatsPerBar)
    : beatsPerBar;
  return Math.ceil(patternLengthBeats / beatsPerBar);
}

// Get a readable text color for selection header
function getSelectionTextColor(baseColor: string): string {
  const hex = baseColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const darkenAmount = luminance > 0.5 ? 100 : 50;
  const newR = Math.max(0, r - darkenAmount);
  const newG = Math.max(0, g - darkenAmount);
  const newB = Math.max(0, b - darkenAmount);
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
}

// Per-block canvas for event dots
// Debounce delay for canvas redraws during zoom — CSS scale bridges the gap
const CANVAS_REDRAW_DEBOUNCE_MS = 100;

function BlockEventCanvas({
  block,
  track,
  pixelsPerBeat,
  beatsPerBar,
  contentWidth,
  contentHeight,
  bpm,
}: {
  block: Block;
  track: Track;
  pixelsPerBeat: number;
  beatsPerBar: number;
  contentWidth: number;
  contentHeight: number;
  bpm: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isAudioBlock = track.instrumentId === 'audioPlayer' && block.audioData;
  // Track the dimensions/params the canvas was last drawn at
  const drawnRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = contentWidth * dpr;
    canvas.height = contentHeight * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, contentWidth, contentHeight);

    if (isAudioBlock && block.audioData?.waveformPeaks) {
      // Draw waveform
      const peaks = block.audioData.waveformPeaks;
      const barWidth = beatsPerBar * pixelsPerBeat;
      const beatsPerSecond = bpm / 60;
      const audioBeats = block.audioData.duration * beatsPerSecond;
      const audioBars = audioBeats / beatsPerBar;
      const audioWidthPx = audioBars * barWidth;

      const centerY = contentHeight / 2;
      const maxAmplitude = contentHeight / 2 - 2;
      const audioOffsetSeconds = block.audioOffset ?? 0;
      const offsetRatio = audioOffsetSeconds / Math.max(block.audioData.duration, 0.001);
      const peakOffset = Math.floor(offsetRatio * peaks.length);
      const remainingDuration = block.audioData.duration - audioOffsetSeconds;
      const remainingBeats = remainingDuration * beatsPerSecond;
      const remainingBars = remainingBeats / beatsPerBar;
      const remainingWidthPx = remainingBars * barWidth;
      const drawWidth = Math.min(remainingWidthPx, contentWidth);
      const samplesPerPixel = peaks.length / Math.max(1, audioWidthPx);

      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let x = 0; x < drawWidth; x++) {
        const sampleIndex = peakOffset + Math.floor(x * samplesPerPixel);
        const peak = peaks[Math.min(sampleIndex, peaks.length - 1)] || 0;
        const barHeight = Math.max(1, peak * maxAmplitude);
        ctx.fillRect(x, centerY - barHeight, 1, barHeight * 2);
      }
    } else {
      // Draw event dots
      const allEvents = block.streams?.flatMap((s) => s.events) || [];
      if (allEvents.length === 0) {
        drawnRef.current = { width: contentWidth, height: contentHeight };
        return;
      }

      const patternLengthBeats = safeMax(allEvents.map((e) => e.startTimeInBeats + (e.duration || 0.25)), beatsPerBar);
      const patternBars = Math.ceil(patternLengthBeats / beatsPerBar);
      const patternBeats = patternBars * beatsPerBar;
      const patternWidthPx = patternBeats * pixelsPerBeat;
      const blockTotalBeats = block.durationBars * beatsPerBar;
      const loopCount = block.loop ? Math.ceil(blockTotalBeats / patternBeats) : 1;

      const pitches = allEvents.filter((e) => e.pitch !== undefined).map((e) => e.pitch!);
      const minPitch = pitches.length > 0 ? safeMin(pitches, 60) : 60;
      const maxPitch = pitches.length > 0 ? safeMax(pitches, 72) : 72;
      const pitchRange = Math.max(maxPitch - minPitch + 1, 1);

      for (let loopIdx = 0; loopIdx < loopCount; loopIdx++) {
        const offsetPx = loopIdx * patternWidthPx;

        for (const event of allEvents) {
          const eventStartBeat = event.startTimeInBeats + loopIdx * patternBeats;
          if (eventStartBeat >= blockTotalBeats) continue;

          const eventStartPx = event.startTimeInBeats * pixelsPerBeat + offsetPx;
          const duration = event.duration || 0.25;
          const eventWidthPx = Math.max(duration * pixelsPerBeat, 2);

          let topPercent: number;
          let heightPercent: number;

          const drumType = getDrumType(event.pitch);
          if (drumType) {
            const drumLanes: Record<string, number> = { hihat: 0, clap: 1, snare: 2, kick: 3 };
            const laneCount = 4;
            const lane = drumLanes[drumType] ?? 2;
            heightPercent = (100 / laneCount - 4) / 100;
            topPercent = ((lane / laneCount) * 100 + 2) / 100;
          } else {
            const normalizedPitch = (event.pitch - minPitch) / pitchRange;
            heightPercent = Math.max(1 / pitchRange, 0.06);
            topPercent = (1 - normalizedPitch) * (1 - heightPercent);
          }

          const baseOpacity = Math.max((event.velocity || 100) / 127, 0.4);
          const opacity = loopIdx === 0 ? baseOpacity : baseOpacity * 0.85;

          const y = topPercent * contentHeight;
          const h = heightPercent * contentHeight;
          const x = eventStartPx;

          if (x >= contentWidth) continue;
          const drawW = Math.min(eventWidthPx, contentWidth - x);

          ctx.fillStyle = `rgba(255,255,255,${0.8 * opacity})`;
          ctx.fillRect(x, y, drawW, h);
        }
      }
    }

    drawnRef.current = { width: contentWidth, height: contentHeight };
    // Clear CSS scale since we just drew at full resolution
    canvas.style.transform = '';
    canvas.style.transformOrigin = '';
    canvas.style.width = `${contentWidth}px`;
    canvas.style.height = `${contentHeight}px`;
  }, [block, track, pixelsPerBeat, beatsPerBar, contentWidth, contentHeight, bpm, isAudioBlock]);

  useEffect(() => {
    const drawn = drawnRef.current;
    if (drawn.width === 0) {
      // First draw — render immediately
      drawCanvas();
      return;
    }

    // Dimensions changed — apply CSS scale as placeholder, debounce real redraw
    const canvas = canvasRef.current;
    if (canvas && drawn.width > 0 && drawn.height > 0) {
      const scaleX = contentWidth / drawn.width;
      const scaleY = contentHeight / drawn.height;
      canvas.style.transformOrigin = 'left top';
      canvas.style.transform = `scale(${scaleX}, ${scaleY})`;
      canvas.style.width = `${drawn.width}px`;
      canvas.style.height = `${drawn.height}px`;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(drawCanvas, CANVAS_REDRAW_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [drawCanvas, contentWidth, contentHeight]);

  // Redraw immediately when block data or non-zoom params change
  useEffect(() => {
    drawCanvas();
  }, [block, track, beatsPerBar, bpm, isAudioBlock]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: contentWidth,
        height: contentHeight,
        position: 'absolute',
        left: 3,
        top: 24,
        pointerEvents: 'none',
      }}
    />
  );
}

// SVG selection border with bezier divets for looped blocks
function SelectionBorderSVG({
  block,
  blockHeight,
  contentAreaWidth,
  selectionColor,
  beatsPerBar,
  pixelsPerBeat,
}: {
  block: Block;
  blockHeight: number;
  contentAreaWidth: number;
  selectionColor: string;
  beatsPerBar: number;
  pixelsPerBeat: number;
}) {
  const allEvents = block.streams?.flatMap((s) => s.events) || [];
  const patternLengthBeats = allEvents.length > 0
    ? safeMax(allEvents.map((e) => e.startTimeInBeats + (e.duration || 0.25)), beatsPerBar)
    : beatsPerBar;
  const patternBars = Math.ceil(patternLengthBeats / beatsPerBar);
  const patternBeats = patternBars * beatsPerBar;
  const patternWidthPx = patternBeats * pixelsPerBeat;
  const blockTotalBeats = block.durationBars * beatsPerBar;
  const loopCount = block.loop ? Math.ceil(blockTotalBeats / patternBeats) : 1;

  const radius = 6;
  const h = blockHeight;

  const d = useMemo(() => {
    const parts: string[] = [];

    if (block.loop && loopCount > 1) {
      // Start at top-left corner
      parts.push(`M 0,${radius}`);
      parts.push(`Q 0,0 ${radius},0`);

      // Trace top edge with divets
      for (let i = 0; i < loopCount; i++) {
        const iterLeft = i * patternWidthPx;
        const visibleBeats = Math.min(patternBeats, blockTotalBeats - i * patternBeats);
        let iterWidth = visibleBeats * pixelsPerBeat;
        const isLast = i === loopCount - 1;

        if (isLast) iterWidth = Math.min(iterWidth, contentAreaWidth - iterLeft);
        if (iterWidth <= 4) iterWidth = 4;

        const iterRight = iterLeft + iterWidth;

        if (i === 0) {
          if (!isLast) {
            parts.push(`L ${iterRight - radius},0`);
            parts.push(`Q ${iterRight},0 ${iterRight},${radius}`);
          } else {
            parts.push(`L ${contentAreaWidth},0`);
          }
        } else {
          parts.push(`Q ${iterLeft},0 ${iterLeft + radius},0`);
          if (!isLast) {
            parts.push(`L ${iterRight - radius},0`);
            parts.push(`Q ${iterRight},0 ${iterRight},${radius}`);
          } else {
            parts.push(`L ${contentAreaWidth},0`);
          }
        }
      }

      // Right edge (handle area - straight down)
      parts.push(`L ${contentAreaWidth},${h}`);

      // Trace bottom edge with divets (right to left)
      for (let i = loopCount - 1; i >= 0; i--) {
        const iterLeft = i * patternWidthPx;
        const visibleBeats = Math.min(patternBeats, blockTotalBeats - i * patternBeats);
        let iterWidth = visibleBeats * pixelsPerBeat;
        const isFirst = i === 0;
        const isLast = i === loopCount - 1;

        if (isLast) iterWidth = Math.min(iterWidth, contentAreaWidth - iterLeft);
        if (iterWidth <= 4) iterWidth = 4;

        const iterRight = iterLeft + iterWidth;

        if (isLast) {
          parts.push(`L ${iterLeft + radius},${h}`);
        } else {
          parts.push(`L ${iterRight + radius},${h}`);
          parts.push(`Q ${iterRight},${h} ${iterRight},${h - radius}`);
          parts.push(`Q ${iterRight},${h} ${iterRight - radius},${h}`);
          if (isFirst) {
            parts.push(`L ${radius},${h}`);
          } else {
            parts.push(`L ${iterLeft + radius},${h}`);
          }
        }
      }

      // Bottom-left corner
      parts.push(`Q 0,${h} 0,${h - radius}`);
      parts.push('Z');
    } else {
      // Simple rectangle with rounded left corners
      parts.push(`M 0,${radius}`);
      parts.push(`Q 0,0 ${radius},0`);
      parts.push(`L ${contentAreaWidth},0`);
      parts.push(`L ${contentAreaWidth},${h}`);
      parts.push(`L ${radius},${h}`);
      parts.push(`Q 0,${h} 0,${h - radius}`);
      parts.push('Z');
    }

    return parts.join(' ');
  }, [block.loop, loopCount, patternWidthPx, patternBeats, blockTotalBeats, contentAreaWidth, h, radius]);

  return (
    <svg
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: contentAreaWidth,
        height: h,
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 5,
      }}
    >
      <path d={d} fill="none" stroke={selectionColor} strokeWidth={1.5} />
    </svg>
  );
}

// Main Component
export function TimelineCanvas({
  flatTracks,
  pixelsPerBeat,
  beatsPerBar,
  totalBars,
  bpm,
  viewportWidth,
  viewportHeight,
  scrollContainerRef,
  compact,
}: TimelineCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const trackHeightScale = useUIStore((state) => state.trackHeightScale);
  const { handleAudioFileDrop, handleImageFileDrop, handleVideoFileDrop, handleMultiVideoKaleidoscopeDrop, handleVideoOntoKaleidoscope, isProcessingAudio } = useDragDrop();

  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const dragCounter = useRef(0);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    trackId: string | null;
    bar: number;
    blockId: string | null;
  } | null>(null);

  const selectedBlockIds = useUIStore((state) => state.selectedBlockIds);
  const selectBlock = useUIStore((state) => state.selectBlock);
  const selectBlocks = useUIStore((state) => state.selectBlocks);
  const clearBlockSelection = useUIStore((state) => state.clearBlockSelection);
  const setIsScrubbing = useUIStore((state) => state.setIsScrubbing);
  const setCurrentBeat = useUIStore((state) => state.setCurrentBeat);
  const loopStart = useUIStore((state) => state.loopStart);
  const loopEnd = useUIStore((state) => state.loopEnd);
  const setLoopEnabled = useUIStore((state) => state.setLoopEnabled);
  const timelineQuantize = useUIStore((state) => state.timelineQuantize);
  const timelineSnapEnabled = useUIStore((state) => state.timelineSnapEnabled);
  const updateBlock = useProjectStore((state) => state.updateBlock);
  const addBlock = useProjectStore((state) => state.addBlock);
  const addTrack = useProjectStore((state) => state.addTrack);
  const moveBlock = useProjectStore((state) => state.moveBlock);
  const tracks = useProjectStore((state) => state.project.tracks);
  const { isPlaying, seekTo, setLoopRegion } = usePlayback();

  const trackHeight = Math.round(64 * trackHeightScale);
  const barWidth = beatsPerBar * pixelsPerBeat;
  const timelineWidth = totalBars * barWidth;
  const contentHeight = compact
    ? flatTracks.length * trackHeight
    : Math.max(flatTracks.length * trackHeight, 400);
  const totalHeight = RULER_HEIGHT + contentHeight;

  // Scrubbing state
  const [isScrubbing, setLocalScrubbing] = useState(false);
  // Loop dragging state
  const [isLoopDragging, setIsLoopDragging] = useState(false);
  const [loopDragStart, setLoopDragStart] = useState(0);

  // Drag state
  const [dragState, setDragState] = useState<{
    type: 'none' | 'drag' | 'resize-left' | 'resize-right-loop' | 'resize-right-extend' | 'marquee';
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    block?: Block;
    track?: Track;
    trackIndex?: number;
    originalPositions?: Map<string, { startBar: number; durationBars: number; trackId: string; trackIndex: number; audioOffset?: number; audioData?: import('@daw/core/types').AudioData }>;
    isCopying?: boolean;
    shiftKey?: boolean;
  }>({
    type: 'none',
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  });

  // Hover state
  const [hoverBlockId, setHoverBlockId] = useState<string | null>(null);
  const [hoverZone, setHoverZone] = useState<string | null>(null);

  // Grid background CSS
  const gridBackground = useMemo(() => {
    return {
      backgroundImage: `repeating-linear-gradient(to right, rgba(255,255,255,0.06) 0px 1px, transparent 1px ${barWidth}px)`,
      backgroundSize: `${barWidth}px 100%`,
    };
  }, [barWidth]);

  // Playhead update via direct DOM mutation (rAF loop)
  useEffect(() => {
    let rafId: number;
    const update = () => {
      if (playheadRef.current) {
        const beat = useUIStore.getState().currentBeat;
        playheadRef.current.style.transform = `translateX(${beat * pixelsPerBeat}px)`;
      }
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
  }, [pixelsPerBeat]);

  // screenToWorld: convert client coords to content coords
  // Uses the timeline container ref (not the scroll container) so the track label
  // offset is already accounted for by the element's own position in the grid.
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return { x, y };
  }, []);

  const totalBeats = totalBars * beatsPerBar;

  const pixelToBeat = useCallback((pixelX: number) => {
    const beat = pixelX / pixelsPerBeat;
    const quantize = 0.25;
    const quantized = Math.round(beat / quantize) * quantize;
    return Math.max(0, Math.min(totalBeats - quantize, quantized));
  }, [pixelsPerBeat, totalBeats]);

  const pixelToBar = useCallback((pixelX: number) => {
    const beat = pixelX / pixelsPerBeat;
    const { timelineQuantize: q, timelineSnapEnabled: snapOn } = useUIStore.getState();
    const snap = snapOn ? q : beatsPerBar;
    const snapped = Math.round(beat / snap) * snap;
    return Math.max(0, Math.min(totalBars * beatsPerBar, snapped));
  }, [pixelsPerBeat, beatsPerBar, totalBars]);

  // Block pointer down
  const handleBlockPointerDown = useCallback((
    e: React.PointerEvent,
    block: Block,
    track: Track,
    trackIndex: number,
    zone: string
  ) => {
    e.stopPropagation();
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const isAltHeld = e.altKey;

    // Handle selection
    if (e.shiftKey) {
      const newSelection = new Set(selectedBlockIds);
      if (newSelection.has(block.id)) {
        newSelection.delete(block.id);
      } else {
        newSelection.add(block.id);
      }
      selectBlocks(Array.from(newSelection));
    } else if (!selectedBlockIds.has(block.id)) {
      selectBlock(block.id, track.id, false);
    }

    let dragType: typeof dragState.type = 'none';
    if (zone === 'left-edge') dragType = 'resize-left';
    else if (zone === 'right-loop') dragType = 'resize-right-loop';
    else if (zone === 'right-extend') dragType = 'resize-right-extend';
    else dragType = 'drag';

    const blocksToProcess = selectedBlockIds.has(block.id) ? selectedBlockIds : new Set([block.id]);
    const shouldCopy = isAltHeld && dragType === 'drag';

    const originalPositions = new Map<string, { startBar: number; durationBars: number; trackId: string; trackIndex: number; audioOffset?: number; audioData?: import('@daw/core/types').AudioData }>();
    const newBlockIds: string[] = [];

    for (const blockId of blocksToProcess) {
      const trackId = findTrackForBlock(tracks, blockId);
      if (trackId) {
        const foundBlock = tracks[trackId].blocks.find(b => b.id === blockId);
        if (foundBlock) {
          if (shouldCopy) {
            const newBlockId = addBlock(trackId, {
              startBar: foundBlock.startBar,
              durationBars: foundBlock.durationBars,
              loop: foundBlock.loop,
              streams: foundBlock.streams?.map(s => ({
                events: s.events.map(ev => ({ ...ev })),
              })),
              audioData: foundBlock.audioData ? { ...foundBlock.audioData } : undefined,
            });
            const ti = flatTracks.findIndex(n => n.track.id === trackId);
            originalPositions.set(newBlockId, {
              startBar: foundBlock.startBar,
              durationBars: foundBlock.durationBars,
              trackId,
              trackIndex: ti >= 0 ? ti : 0,
              audioOffset: foundBlock.audioOffset,
              audioData: foundBlock.audioData,
            });
            newBlockIds.push(newBlockId);
          } else {
            const ti2 = flatTracks.findIndex(n => n.track.id === trackId);
            originalPositions.set(blockId, {
              startBar: foundBlock.startBar,
              durationBars: foundBlock.durationBars,
              trackId,
              trackIndex: ti2 >= 0 ? ti2 : 0,
              audioOffset: foundBlock.audioOffset,
              audioData: foundBlock.audioData,
            });
          }
        }
      }
    }

    if (shouldCopy && newBlockIds.length > 0) {
      selectBlocks(newBlockIds);
    }

    setDragState({
      type: dragType,
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      block,
      track,
      trackIndex,
      originalPositions,
      isCopying: shouldCopy,
    });
  }, [selectedBlockIds, selectBlock, selectBlocks, tracks, addBlock, screenToWorld]);

  // Background pointer down (marquee)
  const handleBackgroundPointerDown = useCallback((e: React.PointerEvent) => {
    if (dragState.type !== 'none') return;
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    if (!e.shiftKey) clearBlockSelection();
    setDragState({
      type: 'marquee',
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      shiftKey: e.shiftKey,
    });
  }, [dragState.type, clearBlockSelection, screenToWorld]);

  // Ruler loop drag
  const handleRulerLoopDragStart = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    const { x } = screenToWorld(e.clientX, e.clientY);
    const startBeat = pixelToBar(x);
    setIsLoopDragging(true);
    setLoopDragStart(startBeat);
    setLoopRegion(startBeat, startBeat);
    setLoopEnabled(true);
  }, [pixelToBar, setLoopRegion, setLoopEnabled, screenToWorld]);

  // Ruler scrub
  const handleRulerScrubStart = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    const { x } = screenToWorld(e.clientX, e.clientY);
    const beat = pixelToBeat(x);
    setLocalScrubbing(true);
    setIsScrubbing(true);
    if (isPlaying) {
      seekTo(beat);
    } else {
      setCurrentBeat(beat);
    }
  }, [pixelToBeat, setIsScrubbing, isPlaying, seekTo, setCurrentBeat, screenToWorld]);

  // Playhead scrub start
  const handleScrubStart = useCallback(() => {
    setLocalScrubbing(true);
    setIsScrubbing(true);
  }, [setIsScrubbing]);

  // Drag move/up for blocks and marquee
  useEffect(() => {
    if (dragState.type === 'none') return;

    const handleMove = (e: PointerEvent) => {
      const { x, y } = screenToWorld(e.clientX, e.clientY);
      if (x === 0 && y === 0) return;

      const snapSize = timelineSnapEnabled ? timelineQuantize : 1 / 128;
      const quantizePixels = snapSize * pixelsPerBeat;
      const minDurationBars = snapSize / beatsPerBar;

      if (dragState.type === 'marquee') {
        setDragState(prev => ({ ...prev, currentX: x, currentY: y }));
      } else if (dragState.type === 'drag' && dragState.originalPositions && dragState.block) {
        const deltaX = x - dragState.startX;
        const deltaQuantizeUnits = Math.round(deltaX / quantizePixels);
        const deltaBars = (deltaQuantizeUnits * snapSize) / beatsPerBar;

        const deltaY = y - dragState.startY;
        const deltaTrackIndex = Math.round(deltaY / trackHeight);

        for (const [blockId, original] of dragState.originalPositions) {
          const newStartBar = Math.max(0, original.startBar + deltaBars);

          // Vertical: move to new track if needed
          const newTrackIndex = Math.min(flatTracks.length - 1, Math.max(0, original.trackIndex + deltaTrackIndex));
          const targetTrackId = flatTracks[newTrackIndex].track.id;
          const currentTrackId = findTrackForBlock(tracks, blockId);
          if (currentTrackId && currentTrackId !== targetTrackId) {
            moveBlock(currentTrackId, blockId, targetTrackId);
          }

          // Horizontal: use targetTrackId since block may have just moved
          updateBlock(targetTrackId, blockId, { startBar: newStartBar });
        }
      } else if (dragState.type === 'resize-left' && dragState.originalPositions) {
        const deltaX = x - dragState.startX;
        const deltaQuantizeUnits = Math.round(deltaX / quantizePixels);
        const deltaBars = (deltaQuantizeUnits * snapSize) / beatsPerBar;

        for (const [blockId, original] of dragState.originalPositions) {
          const newStartBar = Math.max(0, original.startBar + deltaBars);
          const startDelta = newStartBar - original.startBar;
          const newDuration = Math.max(minDurationBars, original.durationBars - startDelta);
          const originalEndBar = original.startBar + original.durationBars;
          const clampedDuration = Math.min(newDuration, originalEndBar - newStartBar);

          if (clampedDuration >= minDurationBars) {
            const updates: Record<string, unknown> = {
              startBar: newStartBar,
              durationBars: clampedDuration,
            };
            // For audio blocks, adjust audioOffset so playback starts later/earlier in the file
            if (original.audioData) {
              const deltaSeconds = startDelta * beatsPerBar * 60 / bpm;
              const newOffset = Math.max(0, Math.min(
                (original.audioOffset ?? 0) + deltaSeconds,
                original.audioData.duration
              ));
              updates.audioOffset = newOffset;
            }
            updateBlock(original.trackId, blockId, updates);
          }
        }
      } else if ((dragState.type === 'resize-right-loop' || dragState.type === 'resize-right-extend') && dragState.originalPositions) {
        const deltaX = x - dragState.startX;
        const deltaQuantizeUnits = Math.round(deltaX / quantizePixels);
        const deltaBars = (deltaQuantizeUnits * snapSize) / beatsPerBar;

        for (const [blockId, original] of dragState.originalPositions) {
          const newDuration = Math.max(minDurationBars, original.durationBars + deltaBars);
          const blk = tracks[original.trackId]?.blocks.find(b => b.id === blockId);

          if (dragState.type === 'resize-right-loop' && blk) {
            const patternBars = getPatternBars(blk, beatsPerBar);
            const shouldLoop = newDuration > patternBars;
            updateBlock(original.trackId, blockId, {
              durationBars: newDuration,
              loop: shouldLoop,
            });
          } else {
            let clampedDuration = newDuration;
            // For non-looping audio blocks, clamp so block doesn't exceed remaining audio
            if (blk && blk.audioData && !blk.loop) {
              const remainingAudio = blk.audioData.duration - (original.audioOffset ?? blk.audioOffset ?? 0);
              const remainingBars = (remainingAudio / 60) * bpm / beatsPerBar;
              clampedDuration = Math.min(clampedDuration, remainingBars);
            }
            updateBlock(original.trackId, blockId, { durationBars: clampedDuration });
          }
        }
      }
    };

    const handleUp = () => {
      if (dragState.type === 'marquee') {
        const { startX, startY, currentX, currentY } = dragState;
        const minX = Math.min(startX, currentX);
        const maxX = Math.max(startX, currentX);
        const minY = Math.min(startY, currentY);
        const maxY = Math.max(startY, currentY);

        const matchingBlockIds: string[] = [];

        flatTracks.forEach((node, trackIndex) => {
          const track = node.track;
          const trackTop = RULER_HEIGHT + trackIndex * trackHeight;
          const trackBottom = trackTop + trackHeight;

          if (maxY < trackTop || minY > trackBottom) return;

          track.blocks.forEach((block) => {
            const blockLeft = block.startBar * barWidth;
            const blockRight = blockLeft + block.durationBars * barWidth;

            if (maxX >= blockLeft && minX <= blockRight) {
              matchingBlockIds.push(block.id);
            }
          });
        });

        if (matchingBlockIds.length > 0) {
          if (dragState.shiftKey) {
            // Merge with existing selection
            const existing = Array.from(selectedBlockIds);
            selectBlocks([...existing, ...matchingBlockIds]);
          } else {
            selectBlocks(matchingBlockIds);
          }
        }
      }

      setDragState({
        type: 'none',
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
      });
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragState, barWidth, trackHeight, flatTracks, updateBlock, moveBlock, selectBlocks, tracks, beatsPerBar, screenToWorld, pixelsPerBeat, timelineQuantize, timelineSnapEnabled]);

  // Loop drag move/up
  useEffect(() => {
    if (!isLoopDragging) return;

    const handleMove = (e: PointerEvent) => {
      const { x } = screenToWorld(e.clientX, e.clientY);
      const cb = pixelToBar(x);
      const loopStartBeat = Math.min(loopDragStart, cb);
      const loopEndBeat = Math.max(loopDragStart, cb);
      setLoopRegion(loopStartBeat, loopEndBeat);
    };

    const handleUp = () => setIsLoopDragging(false);

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [isLoopDragging, loopDragStart, pixelToBar, setLoopRegion, screenToWorld]);

  // Scrub move/up
  useEffect(() => {
    if (!isScrubbing) return;

    const handleMove = (e: PointerEvent) => {
      const { x } = screenToWorld(e.clientX, e.clientY);
      const beat = pixelToBeat(x);
      if (isPlaying) seekTo(beat);
      else setCurrentBeat(beat);
    };

    const handleUp = () => {
      setLocalScrubbing(false);
      setIsScrubbing(false);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [isScrubbing, pixelToBeat, isPlaying, seekTo, setCurrentBeat, setIsScrubbing, screenToWorld]);

  // File drag handlers
  const handleFileDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDraggingFile(true);
  }, []);

  const handleFileDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDraggingFile(false);
  }, []);

  const handleFileDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDraggingFile(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const bar = Math.max(0, Math.floor(x / barWidth));
    const y = e.clientY - rect.top - RULER_HEIGHT;
    const trackIndex = Math.floor(y / trackHeight);
    const targetTrack = trackIndex >= 0 ? flatTracks[trackIndex]?.track : undefined;

    const videoExts = /\.(mp4|webm|mov)$/i;
    const imageExts = /\.(png|jpe?g|gif|webp|svg)$/i;

    // Check for multiple video files → kaleidoscope
    const videoFiles = Array.from(files).filter(f => videoExts.test(f.name));
    if (videoFiles.length > 1) {
      await handleMultiVideoKaleidoscopeDrop(videoFiles, bar);
      return;
    }

    const file = files[0];

    if (videoExts.test(file.name)) {
      // Single video onto existing kaleidoscope track
      if (targetTrack?.instrumentId === 'videoKaleidoscope') {
        await handleVideoOntoKaleidoscope(file, targetTrack.id);
      } else {
        await handleVideoFileDrop(file, targetTrack?.id || null, bar);
      }
    } else if (imageExts.test(file.name)) {
      await handleImageFileDrop(file, targetTrack?.id || null, bar);
    } else if (isAudioFile(file)) {
      await handleAudioFileDrop(file, targetTrack?.id || null, bar);
    }
  }, [barWidth, trackHeight, flatTracks, handleAudioFileDrop, handleImageFileDrop, handleVideoFileDrop, handleMultiVideoKaleidoscopeDrop, handleVideoOntoKaleidoscope]);

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = screenToWorld(e.clientX, e.clientY);
    const bar = Math.floor(x / barWidth);
    const trackY = y - RULER_HEIGHT;
    const trackIndex = Math.floor(trackY / trackHeight);
    const targetTrack = trackIndex >= 0 && trackIndex < flatTracks.length
      ? flatTracks[trackIndex]?.track
      : null;

    // Check if click is on a block
    let clickedBlockId: string | null = null;
    if (targetTrack) {
      for (const block of targetTrack.blocks) {
        const blockLeft = block.startBar * barWidth;
        const blockRight = blockLeft + block.durationBars * barWidth;
        if (x >= blockLeft && x <= blockRight) {
          clickedBlockId = block.id;
          break;
        }
      }
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      trackId: targetTrack?.id || null,
      bar: Math.max(0, bar),
      blockId: clickedBlockId,
    });
  }, [barWidth, trackHeight, flatTracks, screenToWorld]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (contextMenu) {
      const handleClick = () => closeContextMenu();
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenu, closeContextMenu]);

  const handleAddBlock = useCallback(() => {
    if (!contextMenu) return;
    if (contextMenu.trackId) {
      addBlock(contextMenu.trackId, {
        startBar: contextMenu.bar,
        durationBars: 1,
        loop: true,
        streams: [{ events: [] }],
      });
    } else {
      const trackId = addTrack();
      addBlock(trackId, {
        startBar: contextMenu.bar,
        durationBars: 1,
        loop: true,
        streams: [{ events: [] }],
      });
    }
    closeContextMenu();
  }, [contextMenu, addBlock, addTrack, closeContextMenu]);

  const handleAddChildTrack = useCallback(() => {
    if (!contextMenu?.trackId) return;
    const newTrackId = addTrack(contextMenu.trackId);
    useUIStore.getState().selectTrack(newTrackId);
    // Expand parent if collapsed
    if (useUIStore.getState().collapsedTrackIds.has(contextMenu.trackId)) {
      useUIStore.getState().toggleTrackCollapsed(contextMenu.trackId);
    }
    closeContextMenu();
  }, [contextMenu, addTrack, closeContextMenu]);

  const handleAddChildWithRegion = useCallback(() => {
    if (!contextMenu?.trackId || !contextMenu.blockId) return;
    const clickedBlock = tracks[contextMenu.trackId]?.blocks.find(b => b.id === contextMenu.blockId);
    if (!clickedBlock) return;
    const patternBars = getPatternBars(clickedBlock, beatsPerBar);
    const newTrackId = addTrack(contextMenu.trackId);
    useProjectStore.getState().updateTrack(newTrackId, { typeId: 'add' });
    addBlock(newTrackId, {
      startBar: clickedBlock.startBar,
      durationBars: patternBars,
      loop: true,
      streams: [{ events: [] }],
    });
    useUIStore.getState().selectTrack(newTrackId);
    if (useUIStore.getState().collapsedTrackIds.has(contextMenu.trackId)) {
      useUIStore.getState().toggleTrackCollapsed(contextMenu.trackId);
    }
    closeContextMenu();
  }, [contextMenu, tracks, beatsPerBar, addTrack, addBlock, closeContextMenu]);

  const handleReplaceWithChild = useCallback(() => {
    if (!contextMenu?.trackId || !contextMenu.blockId) return;
    const clickedBlock = tracks[contextMenu.trackId]?.blocks.find(b => b.id === contextMenu.blockId);
    if (!clickedBlock) return;
    const patternBars = getPatternBars(clickedBlock, beatsPerBar);
    const newTrackId = addTrack(contextMenu.trackId);
    useProjectStore.getState().updateTrack(newTrackId, { typeId: 'override' });
    addBlock(newTrackId, {
      startBar: clickedBlock.startBar,
      durationBars: patternBars,
      loop: true,
      streams: [{ events: [] }],
    });
    useUIStore.getState().selectTrack(newTrackId);
    if (useUIStore.getState().collapsedTrackIds.has(contextMenu.trackId)) {
      useUIStore.getState().toggleTrackCollapsed(contextMenu.trackId);
    }
    closeContextMenu();
  }, [contextMenu, tracks, beatsPerBar, addTrack, addBlock, closeContextMenu]);

  const handleAddSuppressTrack = useCallback(() => {
    if (!contextMenu?.trackId) return;
    const newTrackId = addTrack(contextMenu.trackId);
    useProjectStore.getState().updateTrack(newTrackId, { typeId: 'suppress', name: 'Suppress' });
    useUIStore.getState().selectTrack(newTrackId);
    if (useUIStore.getState().collapsedTrackIds.has(contextMenu.trackId)) {
      useUIStore.getState().toggleTrackCollapsed(contextMenu.trackId);
    }
    closeContextMenu();
  }, [contextMenu, addTrack, closeContextMenu]);

  const handleAddMuteTrack = useCallback(() => {
    if (!contextMenu?.trackId) return;
    const newTrackId = addTrack(contextMenu.trackId);
    useProjectStore.getState().updateTrack(newTrackId, { typeId: 'mute', name: 'Mute' });
    useUIStore.getState().selectTrack(newTrackId);
    if (useUIStore.getState().collapsedTrackIds.has(contextMenu.trackId)) {
      useUIStore.getState().toggleTrackCollapsed(contextMenu.trackId);
    }
    closeContextMenu();
  }, [contextMenu, addTrack, closeContextMenu]);

  const handleAddAutomationTrack = useCallback(() => {
    if (!contextMenu?.trackId) return;
    const newTrackId = useProjectStore.getState().addAutomationTrack(contextMenu.trackId, '');
    useUIStore.getState().selectTrack(newTrackId);
    if (useUIStore.getState().collapsedTrackIds.has(contextMenu.trackId)) {
      useUIStore.getState().toggleTrackCollapsed(contextMenu.trackId);
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  // Marquee overlay
  const marqueeStyle = useMemo(() => {
    if (dragState.type !== 'marquee') return null;
    const x1 = Math.min(dragState.startX, dragState.currentX);
    const y1 = Math.min(dragState.startY, dragState.currentY);
    const w = Math.abs(dragState.currentX - dragState.startX);
    const h = Math.abs(dragState.currentY - dragState.startY);
    if (w < 2 || h < 2) return null;
    return {
      position: 'absolute' as const,
      left: x1,
      top: y1 - RULER_HEIGHT,
      width: w,
      height: h,
      backgroundColor: 'rgba(59, 130, 246, 0.15)',
      border: '1px solid rgba(59, 130, 246, 0.6)',
      pointerEvents: 'none' as const,
      zIndex: 20,
    };
  }, [dragState]);

  // Loop region overlay
  const loopRegionStyle = useMemo(() => {
    if (loopStart === null || loopEnd === null || loopStart === loopEnd) return null;
    const startX = loopStart * pixelsPerBeat;
    const endX = loopEnd * pixelsPerBeat;
    return {
      position: 'absolute' as const,
      left: startX,
      top: 0,
      width: endX - startX,
      height: RULER_HEIGHT / 2,
      backgroundColor: 'rgba(251, 191, 36, 0.3)',
      borderTop: '2px solid #fbbf24',
      pointerEvents: 'none' as const,
      zIndex: 2,
    };
  }, [loopStart, loopEnd, pixelsPerBeat]);

  return (
    <div
      ref={containerRef}
      className="timeline-content relative"
      style={{ width: timelineWidth, minHeight: compact ? undefined : '100%', height: totalHeight }}
      onDragEnter={handleFileDragEnter}
      onDragLeave={handleFileDragLeave}
      onDragOver={handleFileDragOver}
      onDrop={handleFileDrop}
      onContextMenu={handleContextMenu}
    >
      {/* Ruler */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          left: 0,
          width: timelineWidth,
          height: RULER_HEIGHT,
          backgroundColor: '#111111',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          zIndex: 10,
          userSelect: 'none',
        }}
      >
        {/* Ruler divider line */}
        <div style={{
          position: 'absolute',
          top: RULER_HEIGHT / 2,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: 'rgba(255,255,255,0.04)',
        }} />

        {/* Bar numbers and tick marks */}
        {Array.from({ length: totalBars }).map((_, i) => (
          <React.Fragment key={i}>
            {/* Bar number */}
            <span
              style={{
                position: 'absolute',
                left: i * barWidth + 8,
                top: RULER_HEIGHT / 4,
                transform: 'translateY(-50%)',
                fontSize: 11,
                color: '#666666',
                opacity: 0.9,
                pointerEvents: 'none',
              }}
            >
              {i + 1}
            </span>
            {/* Bar divider line */}
            <div style={{
              position: 'absolute',
              left: i * barWidth,
              top: 0,
              width: 1,
              height: RULER_HEIGHT,
              backgroundColor: 'rgba(255,255,255,0.08)',
              pointerEvents: 'none',
            }} />
            {/* Beat tick marks */}
            {Array.from({ length: beatsPerBar - 1 }).map((_, beat) => (
              <div
                key={beat}
                style={{
                  position: 'absolute',
                  left: i * barWidth + (beat + 1) * pixelsPerBeat,
                  bottom: 4,
                  width: 1,
                  height: 8,
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  pointerEvents: 'none',
                }}
              />
            ))}
          </React.Fragment>
        ))}

        {/* Loop region overlay */}
        {loopRegionStyle && <div style={loopRegionStyle} />}

        {/* Top half hit area - loop dragging */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: timelineWidth,
            height: RULER_HEIGHT / 2,
            cursor: 'crosshair',
            zIndex: 3,
          }}
          onPointerDown={handleRulerLoopDragStart}
        />

        {/* Bottom half hit area - scrubbing */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: RULER_HEIGHT / 2,
            width: timelineWidth,
            height: RULER_HEIGHT / 2,
            cursor: 'pointer',
            zIndex: 3,
          }}
          onPointerDown={handleRulerScrubStart}
        />
      </div>

      {/* Grid area */}
      <div
        style={{
          position: 'absolute',
          top: RULER_HEIGHT,
          left: 0,
          width: timelineWidth,
          height: contentHeight,
          backgroundColor: '#0e0e0e',
          ...gridBackground,
        }}
        onPointerDown={handleBackgroundPointerDown}
      >
        {/* Blocks */}
        {(() => {
          const anySolo = flatTracks.some((n) => n.track.solo);
          return flatTracks.map((node, trackIndex) =>
            node.track.blocks.map((block) => {
            const track = node.track;
            const isSoloed = track.solo;
            const isGrayedOut = anySolo && !isSoloed;
            const handleWidthPx = 12;
            const blockLeft = block.startBar * barWidth;
            const fullBlockWidth = block.durationBars * barWidth;
            const blockWidth = Math.max(fullBlockWidth - 2, 20);
            const blockTop = trackIndex * trackHeight + 4;
            const blockHeight = trackHeight - 8;
            const contentAreaWidth = blockWidth - handleWidthPx;

            const baseColor = (track.instrumentId
              ? INSTRUMENT_COLORS[track.instrumentId]
              : TRACK_TYPE_COLORS[track.typeId]) || '#64748b';
            const blockBgColor = isGrayedOut ? '#2a2a2a' : baseColor;
            const handleColor = isGrayedOut ? '#1e1e1e' : darken(baseColor, 40);
            const selectionColor = tintWhite(baseColor, 0.85);
            const selectedHandleColor = tintWhite(baseColor, 0.5);
            const isSelected = selectedBlockIds.has(block.id);
            const isHovered = hoverBlockId === block.id;
            const hoveredZone = isHovered ? hoverZone : null;
            const handleOpacity = isSelected ? 1.0 : (isHovered && (hoveredZone === 'right-loop' || hoveredZone === 'right-extend') ? 1.0 : 0.8);

            // Pattern info for loops
            const allEvents = block.streams?.flatMap((s) => s.events) || [];
            const patternLengthBeats = allEvents.length > 0
              ? safeMax(allEvents.map((e) => e.startTimeInBeats + (e.duration || 0.25)), beatsPerBar)
              : beatsPerBar;
            const patternBars = Math.ceil(patternLengthBeats / beatsPerBar);
            const patternBeats = patternBars * beatsPerBar;
            const patternWidthPx = patternBeats * pixelsPerBeat;
            const blockTotalBeats = block.durationBars * beatsPerBar;
            const loopCount = block.loop ? Math.ceil(blockTotalBeats / patternBeats) : 1;

            return (
              <div
                key={block.id}
                style={{
                  position: 'absolute',
                  left: blockLeft,
                  top: blockTop,
                  width: blockWidth,
                  height: blockHeight,
                  zIndex: isSelected ? 3 : 1,
                }}
              >
                {/* Iteration backgrounds */}
                {block.loop && loopCount > 1 ? (
                  Array.from({ length: loopCount }).map((_, i) => {
                    const iterLeftPx = i * patternWidthPx;
                    const visibleBeats = Math.min(patternBeats, blockTotalBeats - i * patternBeats);
                    let iterWidthPx = visibleBeats * pixelsPerBeat;
                    if (iterWidthPx <= 0) return null;
                    const isFirst = i === 0;
                    const isLast = i === loopCount - 1;
                    if (isLast) iterWidthPx = Math.min(iterWidthPx, contentAreaWidth - iterLeftPx);
                    if (iterWidthPx <= 4) iterWidthPx = 4;
                    const iterColor = isGrayedOut ? (isFirst ? '#2a2a2a' : '#222222') : (isFirst ? baseColor : darken(baseColor, 20));

                    return (
                      <div
                        key={`iter-${i}`}
                        style={{
                          position: 'absolute',
                          left: iterLeftPx,
                          top: 0,
                          width: iterWidthPx,
                          height: blockHeight,
                          backgroundColor: iterColor,
                          borderRadius: `6px ${isLast ? '0' : '6px'} ${isLast ? '0' : '6px'} 6px`,
                        }}
                      />
                    );
                  })
                ) : (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: Math.max(4, contentAreaWidth),
                      height: blockHeight,
                      backgroundColor: blockBgColor,
                      borderRadius: '6px 0 0 6px',
                    }}
                  />
                )}

                {/* Handle */}
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    width: handleWidthPx,
                    height: blockHeight,
                    backgroundColor: isSelected ? selectedHandleColor : handleColor,
                    borderRadius: '0 6px 6px 0',
                    opacity: handleOpacity,
                  }}
                />

                {/* Selected header background */}
                {isSelected && (
                  block.loop && loopCount > 1 ? (
                    Array.from({ length: loopCount }).map((_, i) => {
                      const iterLeft = i * patternWidthPx;
                      const visibleBeats = Math.min(patternBeats, blockTotalBeats - i * patternBeats);
                      let iterWidth = visibleBeats * pixelsPerBeat;
                      const isFirst = i === 0;
                      const isLast = i === loopCount - 1;
                      if (isLast) iterWidth = Math.min(iterWidth, contentAreaWidth - iterLeft);
                      if (iterWidth <= 4) iterWidth = 4;
                      const leftRadius = isFirst ? 6 : 6;
                      const rightRadius = isLast ? 0 : 6;

                      return (
                        <div
                          key={`header-${i}`}
                          style={{
                            position: 'absolute',
                            left: iterLeft,
                            top: 0,
                            width: iterWidth,
                            height: 20,
                            backgroundColor: selectionColor,
                            borderRadius: `${leftRadius}px ${rightRadius}px 0 0`,
                            zIndex: 2,
                          }}
                        />
                      );
                    })
                  ) : (
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        width: contentAreaWidth,
                        height: 20,
                        backgroundColor: selectionColor,
                        borderRadius: '6px 0 0 0',
                        zIndex: 2,
                      }}
                    />
                  )
                )}

                {/* Track name */}
                <span
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: 10,
                    transform: 'translateY(-50%)',
                    fontSize: 11,
                    color: isSelected ? getSelectionTextColor(baseColor) : isGrayedOut ? baseColor : 'white',
                    opacity: isSelected ? 1 : isGrayedOut ? 0.85 : 0.9,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: contentAreaWidth - (block.loop ? 32 : 16),
                    pointerEvents: 'none',
                    zIndex: 3,
                  }}
                >
                  {track.name}
                </span>

                {/* Loop indicator */}
                {block.loop && (
                  <span
                    style={{
                      position: 'absolute',
                      right: handleWidthPx + 4,
                      top: 10,
                      transform: 'translateY(-50%)',
                      fontSize: 10,
                      color: isSelected ? getSelectionTextColor(baseColor) : isGrayedOut ? baseColor : 'white',
                      opacity: 0.7,
                      pointerEvents: 'none',
                      zIndex: 3,
                    }}
                  >
                    ⟳
                  </span>
                )}

                {/* Event dots / waveform canvas */}
                <BlockEventCanvas
                  block={block}
                  track={track}
                  pixelsPerBeat={pixelsPerBeat}
                  beatsPerBar={beatsPerBar}
                  contentWidth={contentAreaWidth - 6}
                  contentHeight={blockHeight - 28}
                  bpm={bpm}
                />

                {/* Selection border */}
                {isSelected && (
                  <SelectionBorderSVG
                    block={block}
                    blockHeight={blockHeight}
                    contentAreaWidth={contentAreaWidth}
                    selectionColor={selectionColor}
                    beatsPerBar={beatsPerBar}
                    pixelsPerBeat={pixelsPerBeat}
                  />
                )}

                {/* Solo border */}
                {isSoloed && (
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: blockWidth,
                      height: blockHeight,
                      borderRadius: 6,
                      border: '2px solid #facc15',
                      boxShadow: '0 0 6px rgba(250, 204, 21, 0.5)',
                      pointerEvents: 'none',
                      zIndex: 5,
                    }}
                  />
                )}

                {/* Hit areas */}
                {/* Body */}
                <div
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: 0,
                    width: contentAreaWidth - 24,
                    height: blockHeight,
                    cursor: 'grab',
                    zIndex: 4,
                  }}
                  onPointerDown={(e) => handleBlockPointerDown(e, block, track, trackIndex, 'body')}
                  onPointerOver={() => { setHoverBlockId(block.id); setHoverZone('body'); }}
                  onPointerOut={() => { setHoverBlockId(null); setHoverZone(null); }}
                />
                {/* Left edge */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: 12,
                    height: blockHeight,
                    cursor: 'ew-resize',
                    zIndex: 4,
                  }}
                  onPointerDown={(e) => handleBlockPointerDown(e, block, track, trackIndex, 'left-edge')}
                  onPointerOver={() => { setHoverBlockId(block.id); setHoverZone('left-edge'); }}
                  onPointerOut={() => { setHoverBlockId(null); setHoverZone(null); }}
                />
                {/* Right loop (top half of handle) */}
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    width: handleWidthPx,
                    height: blockHeight / 2,
                    cursor: 'col-resize',
                    zIndex: 4,
                  }}
                  onPointerDown={(e) => handleBlockPointerDown(e, block, track, trackIndex, 'right-loop')}
                  onPointerOver={() => { setHoverBlockId(block.id); setHoverZone('right-loop'); }}
                  onPointerOut={() => { setHoverBlockId(null); setHoverZone(null); }}
                />
                {/* Right extend (bottom half of handle) */}
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: blockHeight / 2,
                    width: handleWidthPx,
                    height: blockHeight / 2,
                    cursor: 'e-resize',
                    zIndex: 4,
                  }}
                  onPointerDown={(e) => handleBlockPointerDown(e, block, track, trackIndex, 'right-extend')}
                  onPointerOver={() => { setHoverBlockId(block.id); setHoverZone('right-extend'); }}
                  onPointerOut={() => { setHoverBlockId(null); setHoverZone(null); }}
                />
              </div>
            );
            })
          );
        })()}

        {/* Playhead */}
        <div
          ref={playheadRef}
          style={{
            position: 'absolute',
            top: -RULER_HEIGHT,
            left: 0,
            width: 0,
            height: contentHeight + RULER_HEIGHT,
            zIndex: 15,
            pointerEvents: 'none',
            transform: `translateX(0px)`,
          }}
        >
          {/* Playhead stem (top of ruler to triangle) */}
          <div style={{
            position: 'absolute',
            left: -10,
            top: RULER_HEIGHT / 2,
            width: 20,
            height: Math.max(0, RULER_HEIGHT / 2 - 12),
            backgroundColor: '#ffd93d',
            borderRadius: '3px 3px 0 0',
            pointerEvents: 'none',
          }} />
          {/* Playhead head (triangle) */}
          <div style={{
            position: 'absolute',
            left: -10,
            top: RULER_HEIGHT - 12,
            width: 20,
            height: 12,
            backgroundColor: '#ffd93d',
            clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
            pointerEvents: 'none',
          }} />
          {/* Playhead line */}
          <div style={{
            position: 'absolute',
            left: -1,
            top: RULER_HEIGHT,
            width: 2,
            height: contentHeight,
            backgroundColor: '#ffd93d',
          }} />
          {/* Playhead hit area - covers head and full line */}
          <div
            style={{
              position: 'absolute',
              left: -6,
              top: RULER_HEIGHT,
              width: 12,
              height: contentHeight,
              cursor: 'pointer',
              pointerEvents: 'auto',
              zIndex: 16,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              handleScrubStart();
            }}
          />
          {/* Playhead head hit area */}
          <div
            style={{
              position: 'absolute',
              left: -15,
              top: RULER_HEIGHT / 2,
              width: 30,
              height: RULER_HEIGHT / 2,
              cursor: 'pointer',
              pointerEvents: 'auto',
              zIndex: 16,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              handleScrubStart();
            }}
          />
        </div>

        {/* Marquee */}
        {marqueeStyle && <div style={marqueeStyle} />}
      </div>

      {/* Empty state */}
      {flatTracks.length === 0 && (
        <div
          className="flex items-center justify-center pointer-events-none"
          style={{
            position: 'sticky',
            left: 0,
            top: 0,
            width: viewportWidth,
            height: viewportHeight,
          }}
        >
          <p className="text-muted-foreground">
            Add tracks from the Library
          </p>
        </div>
      )}

      {/* Audio file drop zone overlay */}
      {isDraggingFile && (
        <div
          className="z-50 flex items-center justify-center pointer-events-none"
          style={{
            position: 'sticky',
            left: 0,
            top: 0,
            width: viewportWidth,
            height: viewportHeight,
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            border: '2px dashed rgba(34, 197, 94, 0.6)',
          }}
        >
          <div className="bg-surface/95 px-6 py-3 rounded-lg shadow-lg border border-green-500/30">
            <span className="text-green-400 font-medium text-lg">
              {isProcessingAudio ? 'Processing file...' : 'Drop file here'}
            </span>
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[100] min-w-[160px] bg-surface border border-border rounded-lg shadow-xl py-1 overflow-hidden"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleAddBlock}
            className="w-full px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
          >
            <span className="text-muted-foreground">+</span>
            <span>Add Region</span>
            {contextMenu.trackId ? (
              <span className="text-xs text-muted-foreground ml-auto">Bar {contextMenu.bar + 1}</span>
            ) : (
              <span className="text-xs text-muted-foreground ml-auto">New Track</span>
            )}
          </button>
          {contextMenu.trackId && (
            <>
              <button
                onClick={handleAddChildTrack}
                className="w-full px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
              >
                <span className="text-muted-foreground">+</span>
                <span>Add Child Track</span>
              </button>
              <button
                onClick={handleAddSuppressTrack}
                className="w-full px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
              >
                <span className="text-muted-foreground">S</span>
                <span>Add Suppress Track</span>
              </button>
              <button
                onClick={handleAddMuteTrack}
                className="w-full px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
              >
                <span className="text-muted-foreground">M</span>
                <span>Add Mute Track</span>
              </button>
              {(() => {
                const t = tracks[contextMenu.trackId!];
                const inst = t?.instrumentId ? getInstrument(t.instrumentId) : undefined;
                const hasAutoParams = (inst?.settingsSchema && Object.values(inst.settingsSchema).some(f => f.type === 'number')) ||
                  (t?.visualPlugins && t.visualPlugins.length > 0);
                if (!hasAutoParams) return null;
                return (
                  <button
                    onClick={handleAddAutomationTrack}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
                  >
                    <span className="text-muted-foreground">A</span>
                    <span>Add Automation Track</span>
                  </button>
                );
              })()}
            </>
          )}
          {contextMenu.trackId && contextMenu.blockId && (
            <>
              <div className="border-t border-border my-1" />
              <button
                onClick={handleAddChildWithRegion}
                className="w-full px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
              >
                <span className="text-muted-foreground">+</span>
                <span>Add to Region</span>
              </button>
              <button
                onClick={handleReplaceWithChild}
                className="w-full px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
              >
                <span className="text-muted-foreground">↻</span>
                <span>Replace Region</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

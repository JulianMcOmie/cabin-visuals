'use client';

import { useRef, useCallback, useEffect } from 'react';
import { useUIStore } from '@daw/stores/uiStore';
import { usePlayback } from '@daw/hooks/usePlayback';

interface TimelineRulerProps {
  totalBars: number;
  beatsPerBar: number;
  pixelsPerBeat: number;
}

export function TimelineRuler({
  totalBars,
  beatsPerBar,
  pixelsPerBeat,
}: TimelineRulerProps) {
  const barWidth = beatsPerBar * pixelsPerBeat;
  const totalWidth = totalBars * barWidth;

  const { isPlaying, seekTo, setLoopRegion } = usePlayback();
  const loopStart = useUIStore((s) => s.loopStart);
  const loopEnd = useUIStore((s) => s.loopEnd);
  const setCurrentBeat = useUIStore((s) => s.setCurrentBeat);
  const setIsScrubbing = useUIStore((s) => s.setIsScrubbing);
  const setLoopEnabled = useUIStore((s) => s.setLoopEnabled);

  const rulerRef = useRef<HTMLDivElement>(null);
  const loopDragRef = useRef<{ startBeat: number; isDragging: boolean }>({
    startBeat: 0,
    isDragging: false,
  });
  const scrubDragRef = useRef<{ isDragging: boolean }>({ isDragging: false });

  // Convert pixel position to beat, snapped to current quantize setting
  // Convert pixel position to beat, snapped to bar boundaries
  const pixelToBar = useCallback(
    (pixelX: number) => {
      const beat = pixelX / pixelsPerBeat;
      const bar = Math.round(beat / beatsPerBar);
      return Math.max(0, Math.min(totalBars, bar)) * beatsPerBar;
    },
    [pixelsPerBeat, beatsPerBar, totalBars]
  );

  // Convert pixel position to beat (for scrubbing, quantized to 1/16th note)
  const pixelToBeat = useCallback(
    (pixelX: number) => {
      const beat = pixelX / pixelsPerBeat;
      const quantize = 0.25; // 1/16th note
      const quantized = Math.round(beat / quantize) * quantize;
      return Math.max(0, Math.min(totalBars * beatsPerBar - quantize, quantized));
    },
    [pixelsPerBeat, beatsPerBar, totalBars]
  );

  // Handle loop region dragging (top half)
  const handleLoopMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!rulerRef.current) return;
      const rect = rulerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const startBeat = pixelToBar(x);

      loopDragRef.current = { startBeat, isDragging: true };
      setLoopRegion(startBeat, startBeat);
      setLoopEnabled(true);

      e.preventDefault();
    },
    [pixelToBar, setLoopRegion, setLoopEnabled]
  );

  const handleLoopMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!loopDragRef.current.isDragging || !rulerRef.current) return;

      const rect = rulerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const currentBeat = pixelToBar(x);
      const { startBeat } = loopDragRef.current;

      // Set loop region with proper start/end ordering
      const loopStartBeat = Math.min(startBeat, currentBeat);
      const loopEndBeat = Math.max(startBeat, currentBeat);

      setLoopRegion(loopStartBeat, loopEndBeat);
    },
    [pixelToBar, setLoopRegion]
  );

  const handleLoopMouseUp = useCallback(() => {
    if (loopDragRef.current.isDragging) {
      loopDragRef.current.isDragging = false;

      // If loop region has zero length (click without drag), disable looping
      const { loopStart: ls, loopEnd: le } = useUIStore.getState();
      if (ls !== null && le !== null && ls === le) {
        setLoopRegion(null, null);
        setLoopEnabled(false);
      }
    }
  }, [setLoopRegion, setLoopEnabled]);

  // Handle scrubbing (bottom half)
  const handleScrubMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!rulerRef.current) return;
      const rect = rulerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const beat = pixelToBeat(x);

      scrubDragRef.current.isDragging = true;
      setIsScrubbing(true);

      if (isPlaying) {
        seekTo(beat);
      } else {
        setCurrentBeat(beat);
      }

      e.preventDefault();
    },
    [pixelToBeat, isPlaying, seekTo, setCurrentBeat, setIsScrubbing]
  );

  const handleScrubMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!scrubDragRef.current.isDragging || !rulerRef.current) return;

      const rect = rulerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const beat = pixelToBeat(x);

      if (isPlaying) {
        seekTo(beat);
      } else {
        setCurrentBeat(beat);
      }
    },
    [pixelToBeat, isPlaying, seekTo, setCurrentBeat]
  );

  const handleScrubMouseUp = useCallback(() => {
    if (scrubDragRef.current.isDragging) {
      scrubDragRef.current.isDragging = false;
      setIsScrubbing(false);
    }
  }, [setIsScrubbing]);

  // Global mouse event listeners
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      handleLoopMouseMove(e);
      handleScrubMouseMove(e);
    };

    const handleMouseUp = () => {
      handleLoopMouseUp();
      handleScrubMouseUp();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleLoopMouseMove, handleScrubMouseMove, handleLoopMouseUp, handleScrubMouseUp]);

  // Calculate loop region position
  const loopStartPx = loopStart !== null ? loopStart * pixelsPerBeat : 0;
  const loopEndPx = loopEnd !== null ? loopEnd * pixelsPerBeat : 0;
  const loopWidthPx = loopEndPx - loopStartPx;
  const hasLoopRegion = loopStart !== null && loopEnd !== null && loopStart !== loopEnd;

  return (
    <div
      ref={rulerRef}
      className="h-full flex flex-col bg-surface select-none"
      style={{ width: totalWidth }}
    >
      {/* Top Half - Loop Region (24px) */}
      <div
        className="h-6 relative cursor-crosshair"
        onMouseDown={handleLoopMouseDown}
      >
        {/* Bar numbers */}
        <div className="absolute inset-0 flex">
          {Array.from({ length: totalBars }).map((_, i) => (
            <div
              key={i}
              className="h-full border-r border-border flex items-center"
              style={{ width: barWidth }}
            >
              <span className="text-xs text-muted-foreground ml-2 font-mono">
                {i + 1}
              </span>
            </div>
          ))}
        </div>

        {/* Loop region overlay */}
        {hasLoopRegion && (
          <div
            className="absolute top-0 bottom-0 pointer-events-none"
            style={{
              left: loopStartPx,
              width: loopWidthPx,
              background: 'rgba(251, 191, 36, 0.3)',
              borderTop: '2px solid rgb(251, 191, 36)',
            }}
          />
        )}
      </div>

      {/* Bottom Half - Scrub Area (24px) */}
      <div
        className="h-6 relative cursor-col-resize border-t border-border/50"
        onMouseDown={handleScrubMouseDown}
      >
        {/* Beat tick marks */}
        <div className="absolute inset-0 flex">
          {Array.from({ length: totalBars }).map((_, barIdx) => (
            <div
              key={barIdx}
              className="h-full relative border-r border-border"
              style={{ width: barWidth }}
            >
              {Array.from({ length: beatsPerBar - 1 }).map((_, beatIdx) => (
                <div
                  key={beatIdx}
                  className="absolute bottom-1 w-px h-2 bg-border"
                  style={{ left: (beatIdx + 1) * pixelsPerBeat }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

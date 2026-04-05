'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore } from '@daw/stores/projectStore';
import { usePlayback } from '@daw/hooks/usePlayback';
import { VisualViewPanel } from './VisualViewPanel';

const CONTROLS_HIDE_DELAY = 2500;

export function VisualFullscreen() {
  const setVisualFullscreen = useUIStore((s) => s.setVisualFullscreen);
  const isPlaying = useUIStore((s) => s.isPlaying);
  const totalBars = useProjectStore((s) => s.project.totalBars);
  const beatsPerBar = useProjectStore((s) => s.project.beatsPerBar);
  const { toggle, seekTo } = usePlayback();

  const [showControls, setShowControls] = useState(true);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubBarRef = useRef<HTMLDivElement>(null);
  const isDraggingScrub = useRef(false);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const beatTextRef = useRef<HTMLSpanElement>(null);

  const totalBeats = totalBars * beatsPerBar;

  // Imperative progress/beat display update (avoids 60fps re-renders)
  useEffect(() => {
    let rafId: number;
    const update = () => {
      const currentBeat = useUIStore.getState().currentBeat;
      const progress = totalBeats > 0 ? currentBeat / totalBeats : 0;
      if (progressBarRef.current) {
        progressBarRef.current.style.width = `${progress * 100}%`;
      }
      if (beatTextRef.current) {
        const bar = Math.floor(currentBeat / beatsPerBar) + 1;
        const beat = Math.floor(currentBeat % beatsPerBar) + 1;
        beatTextRef.current.textContent = `${bar}.${beat}`;
      }
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
  }, [totalBeats, beatsPerBar]);

  const resetHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    setShowControls(true);
    hideTimeoutRef.current = setTimeout(() => setShowControls(false), CONTROLS_HIDE_DELAY);
  }, []);

  // Mouse movement shows controls
  const handleMouseMove = useCallback(() => {
    resetHideTimeout();
  }, [resetHideTimeout]);

  // Escape to exit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setVisualFullscreen(false);
      }
      if (e.key === ' ') {
        e.preventDefault();
        toggle();
        // Spacebar does NOT trigger controls visibility
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setVisualFullscreen, toggle]);

  // Start initial hide timeout
  useEffect(() => {
    hideTimeoutRef.current = setTimeout(() => setShowControls(false), CONTROLS_HIDE_DELAY);
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  // Scrub bar seek
  const seekFromEvent = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      const bar = scrubBarRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const beat = (x / rect.width) * totalBeats;
      seekTo(beat);
    },
    [totalBeats, seekTo]
  );

  const handleScrubMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingScrub.current = true;
      seekFromEvent(e);

      const handleMove = (ev: MouseEvent) => {
        if (isDraggingScrub.current) seekFromEvent(ev);
      };
      const handleUp = () => {
        isDraggingScrub.current = false;
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      };
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [seekFromEvent]
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col"
      onMouseMove={handleMouseMove}
    >
      {/* Visual content */}
      <div className="flex-1 overflow-hidden">
        <VisualViewPanel />
      </div>

      {/* Controls overlay */}
      <div
        className="absolute inset-0 pointer-events-none flex flex-col justify-between transition-opacity duration-300"
        style={{ opacity: showControls ? 1 : 0 }}
      >
        {/* Top bar - close button */}
        <div className="flex justify-end p-4 pointer-events-auto">
          <button
            onClick={() => setVisualFullscreen(false)}
            className="p-2 rounded-lg bg-black/50 hover:bg-black/70 text-white/80 hover:text-white transition-colors"
            title="Exit fullscreen"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Bottom bar - play/pause, position, scrub bar */}
        <div className="px-4 pb-4 pointer-events-auto space-y-2">
          {/* Scrub bar */}
          <div
            ref={scrubBarRef}
            className="h-1.5 bg-white/20 rounded-full cursor-pointer group hover:h-2.5 transition-all"
            onMouseDown={handleScrubMouseDown}
          >
            <div
              ref={progressBarRef}
              className="h-full bg-white/80 rounded-full relative"
              style={{ width: '0%' }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => toggle()}
              className="p-2 rounded-lg bg-black/50 hover:bg-black/70 text-white/80 hover:text-white transition-colors"
            >
              {isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <span ref={beatTextRef} className="text-white/80 text-sm font-mono tabular-nums">
              1.1
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

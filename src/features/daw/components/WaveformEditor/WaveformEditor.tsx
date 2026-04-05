'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore } from '@daw/stores/projectStore';
import { Block, Track } from '@daw/core/types';
import { loadAudioFromStorage, generateWaveformPeaks } from '@daw/core/audio';

interface WaveformEditorProps {
  block: Block;
  track: Track;
  beatsPerBar: number;
}

export function WaveformEditor({ block, track, beatsPerBar }: WaveformEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasScrolledRef = useRef(false);
  const pixelsPerBeat = useUIStore((s) => s.midiPixelsPerBeat);
  const setPixelsPerBeat = useUIStore((s) => s.setMidiPixelsPerBeat);
  const bpm = useProjectStore((s) => s.project.bpm);

  const [hiResPeaks, setHiResPeaks] = useState<number[] | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);

  const audioData = block.audioData;
  if (!audioData) return null;

  // Block position in beats
  const blockStartBeat = block.startBar * beatsPerBar;
  const audioBeats = audioData.duration * (bpm / 60);
  const audioEndBeat = blockStartBeat + audioBeats;

  // Add some padding before and after for context
  const padBeats = beatsPerBar * 2;
  const viewStartBeat = Math.max(0, blockStartBeat - padBeats);
  const viewEndBeat = audioEndBeat + padBeats;
  const viewTotalBeats = viewEndBeat - viewStartBeat;
  const totalWidth = viewTotalBeats * pixelsPerBeat;

  // Waveform pixel offset and width within the canvas
  const waveformOffsetPx = (blockStartBeat - viewStartBeat) * pixelsPerBeat;
  const waveformWidthPx = audioBeats * pixelsPerBeat;

  // Load full audio buffer from IndexedDB once
  useEffect(() => {
    let cancelled = false;
    const storageId = audioData?.storageId;
    if (!storageId) return;

    loadAudioFromStorage(storageId).then((result) => {
      if (cancelled || !result) return;
      setAudioBuffer(result.buffer);
    });

    return () => { cancelled = true; };
  }, [audioData?.storageId]);

  // Generate hi-res peaks whenever buffer or waveform width changes
  useEffect(() => {
    if (!audioBuffer) return;
    const numSamples = Math.max(1000, Math.ceil(waveformWidthPx / 2));
    const peaks = generateWaveformPeaks(audioBuffer, numSamples);
    setHiResPeaks(peaks);
  }, [audioBuffer, waveformWidthPx]);

  const peaks = hiResPeaks ?? audioData.waveformPeaks;

  // Auto-scroll to block position on mount
  useEffect(() => {
    if (!hasScrolledRef.current && scrollRef.current) {
      scrollRef.current.scrollLeft = waveformOffsetPx - 40;
      hasScrolledRef.current = true;
    }
  }, [waveformOffsetPx]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioData) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const height = rect.height;

    canvas.width = totalWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, totalWidth, height);

    // Dim region outside the audio block
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, waveformOffsetPx, height);
    ctx.fillRect(waveformOffsetPx + waveformWidthPx, 0, totalWidth - (waveformOffsetPx + waveformWidthPx), height);

    // Draw beat grid across entire view, aligned to absolute beat positions
    const firstBeat = Math.floor(viewStartBeat);
    const lastBeat = Math.ceil(viewEndBeat);
    for (let beat = firstBeat; beat <= lastBeat; beat++) {
      const x = (beat - viewStartBeat) * pixelsPerBeat;
      const isBar = beat % beatsPerBar === 0;

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.strokeStyle = isBar
        ? 'rgba(255, 255, 255, 0.25)'
        : 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = isBar ? 1.5 : 0.5;
      ctx.stroke();

      // Bar numbers at bar lines
      if (isBar) {
        const barNum = beat / beatsPerBar + 1;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '10px sans-serif';
        ctx.fillText(`${barNum}`, x + 3, 12);
      }
    }

    // Draw subdivision lines (half-beat)
    for (let beat = firstBeat; beat < lastBeat; beat++) {
      const x = (beat + 0.5 - viewStartBeat) * pixelsPerBeat;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Draw waveform at block position
    if (!peaks || peaks.length === 0) return;

    const centerY = height / 2;
    const ampScale = height * 0.45;

    ctx.beginPath();
    for (let i = 0; i < peaks.length; i++) {
      const x = waveformOffsetPx + (i / peaks.length) * waveformWidthPx;
      const y = centerY - peaks[i] * ampScale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = peaks.length - 1; i >= 0; i--) {
      const x = waveformOffsetPx + (i / peaks.length) * waveformWidthPx;
      const y = centerY + peaks[i] * ampScale;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(99, 179, 237, 0.5)';
    ctx.fill();

    // Waveform outline (top)
    ctx.beginPath();
    for (let i = 0; i < peaks.length; i++) {
      const x = waveformOffsetPx + (i / peaks.length) * waveformWidthPx;
      const y = centerY - peaks[i] * ampScale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(99, 179, 237, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Waveform outline (bottom)
    ctx.beginPath();
    for (let i = 0; i < peaks.length; i++) {
      const x = waveformOffsetPx + (i / peaks.length) * waveformWidthPx;
      const y = centerY + peaks[i] * ampScale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(99, 179, 237, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Center line
    ctx.beginPath();
    ctx.moveTo(waveformOffsetPx, centerY);
    ctx.lineTo(waveformOffsetPx + waveformWidthPx, centerY);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }, [audioData, peaks, totalWidth, pixelsPerBeat, beatsPerBar, viewStartBeat, viewEndBeat, waveformOffsetPx, waveformWidthPx]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  useEffect(() => {
    const observer = new ResizeObserver(() => drawCanvas());
    const el = scrollRef.current;
    if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [drawCanvas]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -5 : 5;
      setPixelsPerBeat(pixelsPerBeat + delta);
    }
  }, [pixelsPerBeat, setPixelsPerBeat]);

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border/50 bg-surface/50 text-xs text-muted">
        <span>{audioData.fileName}</span>
        <span className="opacity-50">|</span>
        <span>{audioData.duration.toFixed(1)}s</span>
        <span className="opacity-50">|</span>
        <span>Bar {block.startBar + 1} — {audioBeats.toFixed(1)} beats</span>
        {!hiResPeaks && <span className="opacity-50 animate-pulse">Loading HD waveform...</span>}
        <div className="ml-auto flex items-center gap-2">
          <span>Zoom</span>
          <input
            type="range"
            min={10}
            max={200}
            value={pixelsPerBeat}
            onChange={(e) => setPixelsPerBeat(Number(e.target.value))}
            className="w-24 h-1 accent-blue-400"
          />
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-hidden"
        onWheel={handleWheel}
      >
        <canvas ref={canvasRef} className="block" />
      </div>
    </div>
  );
}

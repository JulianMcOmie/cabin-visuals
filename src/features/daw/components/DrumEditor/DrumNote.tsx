'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type DrumType = 'kick' | 'snare' | 'hihat' | 'clap';

interface DrumNoteProps {
  id: string;
  drum: DrumType;
  time: number;
  duration: number;
  pixelsPerBeat: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updates: { time?: number; duration?: number }) => void;
  onDelete: () => void;
  minTime: number;
  maxTime: number;
}

const DRUM_COLORS: Record<DrumType, string> = {
  hihat: '#FFD93D',
  clap: '#6BCB77',
  snare: '#4D96FF',
  kick: '#FF6B6B',
};

export function DrumNote({
  id,
  drum,
  time,
  duration,
  pixelsPerBeat,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  minTime,
  maxTime,
}: DrumNoteProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);

  const dragStartX = useRef(0);
  const originalTime = useRef(time);
  const originalDuration = useRef(duration);

  const left = time * pixelsPerBeat;
  const width = duration * pixelsPerBeat;
  const color = DRUM_COLORS[drum];

  // Handle drag start (move entire note)
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isResizingLeft || isResizingRight) return;
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    originalTime.current = time;
    onSelect();
  }, [time, isResizingLeft, isResizingRight, onSelect]);

  // Handle left resize start
  const handleLeftResizeStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizingLeft(true);
    dragStartX.current = e.clientX;
    originalTime.current = time;
    originalDuration.current = duration;
    onSelect();
  }, [time, duration, onSelect]);

  // Handle right resize start
  const handleRightResizeStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizingRight(true);
    dragStartX.current = e.clientX;
    originalDuration.current = duration;
    onSelect();
  }, [duration, onSelect]);

  // Handle mouse move
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const deltaX = e.clientX - dragStartX.current;
    const deltaBeats = deltaX / pixelsPerBeat;

    if (isDragging) {
      // Move the note - snap to 16th notes (0.25 beats)
      let newTime = Math.round((originalTime.current + deltaBeats) * 4) / 4;
      newTime = Math.max(minTime, Math.min(maxTime - duration, newTime));
      if (newTime !== time) {
        onUpdate({ time: newTime });
      }
    } else if (isResizingLeft) {
      // Resize from left edge
      let newTime = Math.round((originalTime.current + deltaBeats) * 4) / 4;
      const maxStart = originalTime.current + originalDuration.current - 0.25;
      newTime = Math.max(minTime, Math.min(maxStart, newTime));
      const newDuration = originalTime.current + originalDuration.current - newTime;
      if (newTime !== time || newDuration !== duration) {
        onUpdate({ time: newTime, duration: newDuration });
      }
    } else if (isResizingRight) {
      // Resize from right edge
      let newDuration = Math.round((originalDuration.current + deltaBeats) * 4) / 4;
      const maxDuration = maxTime - time;
      newDuration = Math.max(0.25, Math.min(maxDuration, newDuration));
      if (newDuration !== duration) {
        onUpdate({ duration: newDuration });
      }
    }
  }, [isDragging, isResizingLeft, isResizingRight, pixelsPerBeat, time, duration, onUpdate, minTime, maxTime]);

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizingLeft(false);
    setIsResizingRight(false);
  }, []);

  // Handle keyboard delete
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isSelected && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      e.stopImmediatePropagation(); // Prevent global handler from deleting the block
      onDelete();
    }
  }, [isSelected, onDelete]);

  // Add/remove event listeners
  useEffect(() => {
    if (isDragging || isResizingLeft || isResizingRight) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizingLeft, isResizingRight, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    if (isSelected) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isSelected, handleKeyDown]);

  return (
    <div
      data-drum-note
      className={`absolute top-0.5 bottom-0.5 rounded cursor-pointer transition-shadow select-none ${
        isDragging || isResizingLeft || isResizingRight ? 'opacity-80' : ''
      } ${isSelected ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-surface z-10' : ''}`}
      style={{
        left,
        width: Math.max(width, 8),
        backgroundColor: isSelected ? `color-mix(in srgb, ${color} 60%, white)` : color,
        boxShadow: isSelected
          ? `0 0 6px 2px ${color}90, 0 0 12px 4px ${color}50`
          : '0 1px 3px rgba(0, 0, 0, 0.3)',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onMouseDown={handleDragStart}
    >
      {/* Left resize handle - disabled for now, may add as advanced option later
      <div
        className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize hover:bg-black/20 rounded-l"
        onMouseDown={handleLeftResizeStart}
      />
      */}

      {/* Right resize handle - disabled for now, may add as advanced option later
      <div
        className="absolute top-0 bottom-0 right-0 w-2 cursor-ew-resize hover:bg-black/20 rounded-r"
        onMouseDown={handleRightResizeStart}
      />
      */}
    </div>
  );
}

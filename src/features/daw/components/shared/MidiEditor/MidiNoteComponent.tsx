'use client';

import { memo, useCallback, useEffect, useRef, useState } from 'react';

export interface MidiNoteProps {
  id: string;
  time: number;
  duration: number;
  pixelsPerBeat: number;
  color: string;
  isSelected: boolean;
  onSelect: (addToSelection: boolean) => void;
  onUpdate: (updates: { time?: number; duration?: number }) => void;
  onDelete: () => void;
  minTime: number;
  maxTime: number;
  quantize: number;
  selectedCount: number;
  onUpdateSelected: (deltaTime: number) => void;
}

export function MidiNoteComponent({
  id,
  time,
  duration,
  pixelsPerBeat,
  color,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  minTime,
  maxTime,
  quantize,
  selectedCount,
  onUpdateSelected,
}: MidiNoteProps) {
  const [isDragging, setIsDragging] = useState(false);

  const dragStartX = useRef(0);
  const originalTime = useRef(time);
  const lastDeltaTime = useRef(0);

  const left = time * pixelsPerBeat;
  const width = duration * pixelsPerBeat;

  // Handle drag start (move entire note)
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    originalTime.current = time;
    lastDeltaTime.current = 0;
    // Select with shift key support
    onSelect(e.shiftKey);
  }, [time, onSelect]);

  // Handle mouse move
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;

    const deltaX = e.clientX - dragStartX.current;
    const deltaBeats = deltaX / pixelsPerBeat;

    // Calculate snapped delta
    const snappedDelta = Math.round(deltaBeats / quantize) * quantize;

    // If multiple notes selected, move all of them
    if (isSelected && selectedCount > 1) {
      const actualDelta = snappedDelta - lastDeltaTime.current;
      if (actualDelta !== 0) {
        lastDeltaTime.current = snappedDelta;
        onUpdateSelected(actualDelta);
      }
    } else {
      // Move single note
      let newTime = Math.round((originalTime.current + deltaBeats) / quantize) * quantize;
      newTime = Math.max(minTime, Math.min(maxTime - duration, newTime));
      if (newTime !== time) {
        onUpdate({ time: newTime });
      }
    }
  }, [isDragging, pixelsPerBeat, quantize, time, duration, onUpdate, minTime, maxTime, isSelected, selectedCount, onUpdateSelected]);

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    lastDeltaTime.current = 0;
  }, []);

  // Add/remove event listeners
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      data-midi-note
      className={`absolute top-0.5 bottom-0.5 rounded cursor-pointer transition-shadow select-none ${
        isDragging ? 'opacity-80' : ''
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
        onSelect(e.shiftKey);
      }}
      onMouseDown={handleDragStart}
    />
  );
}

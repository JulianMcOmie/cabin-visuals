'use client';

import { useUIStore } from '@daw/stores/uiStore';

export function ZoomControls() {
  const pixelsPerBeat = useUIStore((s) => s.pixelsPerBeat);
  const setPixelsPerBeat = useUIStore((s) => s.setPixelsPerBeat);
  const trackHeightScale = useUIStore((s) => s.trackHeightScale);
  const setTrackHeightScale = useUIStore((s) => s.setTrackHeightScale);

  return (
    <div className="absolute bottom-4 right-4 z-50 flex flex-col gap-2 p-2 rounded-lg bg-surface/80 backdrop-blur-sm border border-border shadow-lg"
      style={{ width: 180 }}
    >
      {/* Horizontal Zoom */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-4 flex-shrink-0">H</span>
        <input
          type="range"
          min="2"
          max="100"
          value={pixelsPerBeat}
          onChange={(e) => setPixelsPerBeat(Number(e.target.value))}
          className="flex-1 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-accent-from"
        />
        <span className="text-xs text-muted-foreground w-8 text-right">{pixelsPerBeat}</span>
      </div>

      {/* Vertical Zoom */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-4 flex-shrink-0">V</span>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.1"
          value={trackHeightScale}
          onChange={(e) => setTrackHeightScale(Number(e.target.value))}
          className="flex-1 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-accent-from"
        />
        <span className="text-xs text-muted-foreground w-8 text-right">{trackHeightScale.toFixed(1)}</span>
      </div>
    </div>
  );
}

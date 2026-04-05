'use client';

import { useUIStore } from '@daw/stores/uiStore';

// Quantize options (in beats)
const QUANTIZE_OPTIONS = [
  { value: 0.25, label: '1/16' },
  { value: 0.5, label: '1/8' },
  { value: 1, label: '1/4' },
  { value: 2, label: '1/2' },
  { value: 4, label: 'Bar' },
];

// Horizontal zoom icon (left-right arrows)
function HorizontalZoomIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-muted-foreground">
      <path
        d="M1 7h12M1 7l2.5-2.5M1 7l2.5 2.5M13 7l-2.5-2.5M13 7l-2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Vertical zoom icon (up-down arrows)
function VerticalZoomIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-muted-foreground">
      <path
        d="M7 1v12M7 1L4.5 3.5M7 1l2.5 2.5M7 13l-2.5-2.5M7 13l2.5-2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TimelineToolbar() {
  const pixelsPerBeat = useUIStore((state) => state.pixelsPerBeat);
  const setPixelsPerBeat = useUIStore((state) => state.setPixelsPerBeat);
  const trackHeightScale = useUIStore((state) => state.trackHeightScale);
  const setTrackHeightScale = useUIStore((state) => state.setTrackHeightScale);
  const timelineQuantize = useUIStore((state) => state.timelineQuantize);
  const setTimelineQuantize = useUIStore((state) => state.setTimelineQuantize);
  const timelineSnapEnabled = useUIStore((state) => state.timelineSnapEnabled);
  const setTimelineSnapEnabled = useUIStore((state) => state.setTimelineSnapEnabled);

  return (
    <div className="flex items-center gap-4 px-3 py-1.5 bg-surface border-b border-border">
      {/* Snap/Quantize */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTimelineSnapEnabled(!timelineSnapEnabled)}
          className={`px-2 py-0.5 border rounded text-xs font-medium transition-colors ${
            timelineSnapEnabled
              ? 'bg-accent-from/20 border-accent-from text-accent-from'
              : 'bg-background border-border text-muted-foreground hover:border-muted-foreground'
          }`}
          title={timelineSnapEnabled ? 'Snap to grid (on)' : 'Snap to grid (off)'}
        >
          Snap
        </button>
        <select
          value={timelineQuantize}
          onChange={(e) => setTimelineQuantize(Number(e.target.value))}
          className="px-2 py-0.5 bg-background border border-border rounded text-xs text-foreground cursor-pointer hover:border-muted-foreground transition-colors"
        >
          {QUANTIZE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Zoom controls */}
      <div className="flex items-center gap-3">
        {/* Horizontal Zoom */}
        <div className="flex items-center gap-1.5 group" title="Horizontal zoom (timeline)">
          <span className="cursor-help">
            <HorizontalZoomIcon />
          </span>
          <input
            type="range"
            min="2"
            max="100"
            value={pixelsPerBeat}
            onChange={(e) => setPixelsPerBeat(Number(e.target.value))}
            className="w-16 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-accent-from"
          />
        </div>

        {/* Vertical Zoom */}
        <div className="flex items-center gap-1.5 group" title="Vertical zoom (track height)">
          <span className="cursor-help">
            <VerticalZoomIcon />
          </span>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={trackHeightScale}
            onChange={(e) => setTrackHeightScale(Number(e.target.value))}
            className="w-16 h-1 bg-muted rounded-lg appearance-none cursor-pointer accent-accent-from"
          />
        </div>
      </div>
    </div>
  );
}

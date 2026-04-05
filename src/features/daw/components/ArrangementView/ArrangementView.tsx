'use client';

import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { TimelineCanvas } from './TimelineCanvas';
import { TrackTree } from '../TrackHierarchy/TrackTree';
import { TimelineToolbar } from './TimelineToolbar';
import { useProjectStore } from '@daw/stores/projectStore';
import { useUIStore } from '@daw/stores/uiStore';
import { flattenTracks } from '@daw/utils/tree';

export function ArrangementView() {
  // Separate selectors for primitives vs object data
  const totalBars = useProjectStore((state) => state.project.totalBars);
  const beatsPerBar = useProjectStore((state) => state.project.beatsPerBar);
  const bpm = useProjectStore((state) => state.project.bpm);
  // tracks subscription still needed for flattenTracks - this is a known remaining bottleneck
  const tracks = useProjectStore((state) => state.project.tracks);
  const rootTracks = useProjectStore((state) => state.project.rootTracks);
  const rootScenes = useProjectStore((state) => state.project.rootScenes);
  const { addTrack, addScene } = useProjectStore();
  const collapsedTrackIds = useUIStore((s) => s.collapsedTrackIds);
  const showMasterTrack = useUIStore((s) => s.showMasterTrack);
  const toggleMasterTrack = useUIStore((s) => s.toggleMasterTrack);
  const pixelsPerBeat = useUIStore((s) => s.pixelsPerBeat);
  const trackHeightScale = useUIStore((s) => s.trackHeightScale);
  const scrollLeft = useUIStore((s) => s.scrollLeft);
  const scrollTop = useUIStore((s) => s.scrollTop);
  const setScrollLeft = useUIStore((s) => s.setScrollLeft);
  const setScrollTop = useUIStore((s) => s.setScrollTop);
  const setPixelsPerBeat = useUIStore((s) => s.setPixelsPerBeat);
  const setTrackHeightScale = useUIStore((s) => s.setTrackHeightScale);
  const copyBlocks = useUIStore((s) => s.copyBlocks);
  const pasteBlocks = useUIStore((s) => s.pasteBlocks);

  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  // Create minimal project-like object for flattenTracks
  const hideMaster = !showMasterTrack;
  const flatTracks = flattenTracks({ tracks, rootTracks } as Parameters<typeof flattenTracks>[0], collapsedTrackIds, hideMaster);

  // Scene tracks (for the scene bar)
  const sceneFlatTracks = useMemo(() => {
    if (rootScenes.length === 0) return [];
    return flattenTracks(
      { tracks, rootTracks: rootScenes } as Parameters<typeof flattenTracks>[0],
      collapsedTrackIds
    );
  }, [tracks, rootScenes, collapsedTrackIds]);

  const hasScenes = rootScenes.length > 0;

  const totalBeats = totalBars * beatsPerBar;
  const timelineWidth = totalBeats * pixelsPerBeat;
  const trackLabelWidth = 256;

  // Track viewport size for canvas rendering
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateViewportSize = () => {
      // Viewport is the visible area minus track labels
      const width = container.clientWidth - trackLabelWidth;
      const height = container.clientHeight;
      setViewportSize({ width: Math.max(width, 100), height: Math.max(height, 100) });
    };

    updateViewportSize();

    const resizeObserver = new ResizeObserver(updateViewportSize);
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [trackLabelWidth]);

  // Restore scroll position when layout changes (e.g., bottom panel opens/closes)
  useEffect(() => {
    if (containerRef.current && containerRef.current.scrollLeft !== scrollLeft) {
      containerRef.current.scrollLeft = scrollLeft;
    }
  });

  // Handle scroll
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      setScrollLeft(e.currentTarget.scrollLeft);
      setScrollTop(e.currentTarget.scrollTop);
    },
    [setScrollLeft, setScrollTop]
  );

  // Copy/Paste blocks at playhead
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'c') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        copyBlocks();
      }
      if (e.metaKey && e.key === 'v') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        pasteBlocks();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copyBlocks, pasteBlocks]);

  // Handle wheel zoom with native event listener (passive: false to allow preventDefault)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Option/Alt + scroll: Zoom mode
      // deltaX controls horizontal zoom, deltaY controls vertical zoom
      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();

        // Horizontal zoom from deltaX - centered on playhead
        if (Math.abs(e.deltaX) > 2) {
          const hDelta = -e.deltaX * 0.02;
          const newPixelsPerBeat = Math.max(2, Math.min(100, pixelsPerBeat + hDelta));

          const beat = useUIStore.getState().currentBeat;
          const playheadX = beat * pixelsPerBeat;
          const newPlayheadX = beat * newPixelsPerBeat;
          const playheadViewportOffset = playheadX - scrollLeft;
          const newScrollLeft = newPlayheadX - playheadViewportOffset;

          setPixelsPerBeat(newPixelsPerBeat);
          setScrollLeft(Math.max(0, newScrollLeft));
        }

        // Vertical zoom from deltaY
        if (Math.abs(e.deltaY) > 2) {
          const vDelta = -e.deltaY * 0.005;
          setTrackHeightScale(Math.max(0.5, Math.min(2.0, trackHeightScale + vDelta)));
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [pixelsPerBeat, trackHeightScale, scrollLeft, setPixelsPerBeat, setTrackHeightScale, setScrollLeft]);

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <TimelineToolbar />

      {/* Scrollable content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-background"
        onScroll={handleScroll}
      >
        <div
          className="grid timeline-content"
          style={{
            gridTemplateColumns: `${trackLabelWidth}px 1fr`,
            width: timelineWidth + trackLabelWidth,
            minHeight: '100%',
          }}
        >
          {/* Track Labels - sticky left, z-30 to stay above timeline blocks and handles */}
          <div className="sticky left-0 z-30 bg-surface border-r border-border">
            {/* Scene bar section */}
            {hasScenes && (
              <>
                <div
                  className="sticky top-0 z-40 bg-surface border-b border-border select-none"
                >
                  <div className="h-12 px-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      Scenes
                    </h2>
                    <button
                      onClick={() => addScene()}
                      className="px-2 py-1 text-xs rounded bg-gradient-to-r from-accent-from/20 to-accent-to/20 text-accent-from hover:from-accent-from/30 hover:to-accent-to/30 transition-colors"
                    >
                      + Scene
                    </button>
                  </div>
                </div>
                <div className="track-tree-reset border-b border-border">
                  <TrackTree treeId="scene-tracks" rootIds={rootScenes} />
                </div>
              </>
            )}

            {/* Corner header - part of track labels column */}
            <div className="sticky top-0 z-40 bg-surface border-b border-border" style={{ top: hasScenes ? undefined : 0 }}>
              <div className="h-12 px-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Tracks
                </h2>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={toggleMasterTrack}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      showMasterTrack
                        ? 'bg-slate-400/20 text-slate-300'
                        : 'bg-surface-hover text-muted-foreground hover:text-foreground'
                    }`}
                    title={showMasterTrack ? 'Hide master track' : 'Show master track'}
                  >
                    M
                  </button>
                  {!hasScenes && (
                    <button
                      onClick={() => addScene()}
                      className="px-2 py-1 text-xs rounded bg-surface-hover text-muted-foreground hover:text-foreground transition-colors"
                      title="Add a scene for split-screen / mask compositing"
                    >
                      + Scene
                    </button>
                  )}
                  <button
                    onClick={() => addTrack()}
                    className="px-2 py-1 text-xs rounded bg-gradient-to-r from-accent-from/20 to-accent-to/20 text-accent-from hover:from-accent-from/30 hover:to-accent-to/30 transition-colors"
                  >
                    + Track
                  </button>
                </div>
              </div>
            </div>
            <div className="track-tree-reset">
              <TrackTree treeId="arrangement-tracks" hideMasterTrack={hideMaster} />
            </div>
          </div>

          {/* Timeline Content */}
          <div>
            {/* Scene timeline */}
            {hasScenes && sceneFlatTracks.length > 0 && (
              <div className="border-b border-border">
                <TimelineCanvas
                  flatTracks={sceneFlatTracks}
                  pixelsPerBeat={pixelsPerBeat}
                  beatsPerBar={beatsPerBar}
                  totalBars={totalBars}
                  bpm={bpm}
                  viewportWidth={viewportSize.width}
                  viewportHeight={viewportSize.height}
                  scrollContainerRef={containerRef}
                  compact
                />
              </div>
            )}

            {/* Main tracks timeline */}
            <TimelineCanvas
              flatTracks={flatTracks}
              pixelsPerBeat={pixelsPerBeat}
              beatsPerBar={beatsPerBar}
              totalBars={totalBars}
              bpm={bpm}
              viewportWidth={viewportSize.width}
              viewportHeight={viewportSize.height}
              scrollContainerRef={containerRef}
            />
          </div>
        </div>
      </div>

    </div>
  );
}

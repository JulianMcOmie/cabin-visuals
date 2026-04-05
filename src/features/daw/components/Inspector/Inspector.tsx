'use client';

import { TrackInspector } from './TrackInspector';
import { BlockInspector } from './BlockInspector';
import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore } from '@daw/stores/projectStore';
import { VisualViewPanel } from '../VisualView';

export function Inspector() {
  const selectedTrackId = useUIStore((s) => s.selectedTrackId);
  const selectedBlockIds = useUIStore((s) => s.selectedBlockIds);
  const setVisualFullscreen = useUIStore((s) => s.setVisualFullscreen);
  const project = useProjectStore((state) => state.project);

  const selectedTrack = selectedTrackId ? project.tracks[selectedTrackId] : null;

  // Get the first selected block ID (for single selection display)
  const selectedBlockId = selectedBlockIds.size === 1 ? Array.from(selectedBlockIds)[0] : null;
  const selectedBlock = selectedTrack?.blocks.find((b) => b.id === selectedBlockId);

  // Check if multiple blocks are selected
  const multipleBlocksSelected = selectedBlockIds.size > 1;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Inspector
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {multipleBlocksSelected ? (
          <div className="text-center text-muted-foreground py-8">
            <p className="text-sm font-medium">{selectedBlockIds.size} blocks selected</p>
            <p className="text-xs mt-2">Press Delete to remove all selected blocks</p>
          </div>
        ) : selectedBlock && selectedTrack ? (
          <BlockInspector block={selectedBlock} track={selectedTrack} />
        ) : selectedTrack ? (
          <TrackInspector track={selectedTrack} />
        ) : (
          <div className="text-center text-muted-foreground py-8">
            <p className="text-sm">Select a track or block to edit its properties</p>
          </div>
        )}
      </div>

      {/* Visual Preview */}
      <div className="relative border-t border-border h-[200px] shrink-0">
        <button
          onClick={() => setVisualFullscreen(true)}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-black/40 hover:bg-black/60 text-white/80 hover:text-white transition-colors"
          title="Fullscreen"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5" />
          </svg>
        </button>
        <VisualViewPanel />
      </div>
    </div>
  );
}

'use client';

import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore } from '@daw/stores/projectStore';
import { TransposeEditor } from './TransposeEditor';

/**
 * TransposeEditorPanel renders the transpose editor UI.
 * BlockEditor determines when to show this panel based on track properties.
 */
export function TransposeEditorPanel() {
  const selectedBlockIds = useUIStore((s) => s.selectedBlockIds);
  const selectedTrackId = useUIStore((s) => s.selectedTrackId);
  const { project } = useProjectStore();

  const selectedBlockId = selectedBlockIds.size === 1 ? Array.from(selectedBlockIds)[0] : null;
  const selectedTrack = selectedTrackId ? project.tracks[selectedTrackId] : null;
  const selectedBlock = selectedTrack?.blocks.find(b => b.id === selectedBlockId);

  if (!selectedTrack || !selectedBlock) {
    return null;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Editor content */}
      <div className="flex-1 overflow-hidden">
        <TransposeEditor
          block={selectedBlock}
          track={selectedTrack}
          beatsPerBar={project.beatsPerBar}
        />
      </div>
    </div>
  );
}

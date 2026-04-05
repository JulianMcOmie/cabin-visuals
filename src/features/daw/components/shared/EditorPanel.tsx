'use client';

import { ReactNode } from 'react';
import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore } from '@daw/stores/projectStore';
import { PresetSelector } from './PresetSelector';
import { Preset, Block, Track } from '@daw/core/types';
import { getInheritedMidiInstrumentId } from '@daw/instruments';

interface EditorPanelProps {
  presets?: Preset[];
  color?: string;
  children: (props: { block: Block; track: Track; beatsPerBar: number; instrumentId?: string }) => ReactNode;
}

/**
 * EditorPanel is a generic wrapper for editor panels.
 * It handles selection state, preset application, and provides common layout.
 */
export function EditorPanel({ presets, color, children }: EditorPanelProps) {
  const selectedBlockIds = useUIStore((s) => s.selectedBlockIds);
  const selectedTrackId = useUIStore((s) => s.selectedTrackId);
  const { project, updateBlock } = useProjectStore();

  const selectedBlockId = selectedBlockIds.size === 1 ? Array.from(selectedBlockIds)[0] : null;
  const selectedTrack = selectedTrackId ? project.tracks[selectedTrackId] : null;
  const selectedBlock = selectedTrack?.blocks.find(b => b.id === selectedBlockId);

  const handleApplyPreset = (preset: Preset) => {
    if (!selectedTrackId || !selectedBlockId) return;

    updateBlock(selectedTrackId, selectedBlockId, {
      streams: [{ events: [...preset.events] }],
      durationBars: preset.durationBars,
    });
  };

  if (!selectedTrack || !selectedBlock) {
    return null;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Preset Selector - only show if presets provided */}
      {presets && presets.length > 0 && (
        <div className="py-2 border-b border-border/50 bg-surface/50">
          <PresetSelector presets={presets} onSelectPreset={handleApplyPreset} color={color} />
        </div>
      )}

      {/* Editor content */}
      <div className="flex-1 overflow-hidden">
        {children({ block: selectedBlock, track: selectedTrack, beatsPerBar: project.beatsPerBar, instrumentId: getInheritedMidiInstrumentId(selectedTrack, project.tracks) })}
      </div>
    </div>
  );
}

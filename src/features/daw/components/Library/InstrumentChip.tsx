'use client';

import { Instrument } from '@daw/instruments';
import { withAlpha } from '@daw/utils/colors';
import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore } from '@daw/stores/projectStore';

interface InstrumentChipProps {
  instrument: Instrument;
}

export function InstrumentChip({ instrument }: InstrumentChipProps) {
  const startDragInstrument = useUIStore((s) => s.startDragInstrument);
  const endDrag = useUIStore((s) => s.endDrag);
  const selectedTrackId = useUIStore((s) => s.selectedTrackId);
  const { updateTrack } = useProjectStore();
  const tracks = useProjectStore((s) => s.project.tracks);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/instrument', instrument.id);
    startDragInstrument(instrument.id);
  };

  const handleDragEnd = () => {
    endDrag();
  };

  const handleClick = () => {
    // If a track is selected, assign this instrument to it
    if (selectedTrackId && tracks[selectedTrackId]) {
      updateTrack(selectedTrackId, {
        instrumentId: instrument.id,
        instrumentSettings: { ...instrument.defaultSettings },
      });
    }
  };

  // Build capability badges
  const capabilities: string[] = [];
  if (instrument.hasAudio) capabilities.push('Audio');
  if (instrument.hasVisual) capabilities.push('Visual');

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      className="px-3 py-2 rounded-lg cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
      style={{
        backgroundColor: withAlpha(instrument.color, 0.15),
        borderLeft: `3px solid ${instrument.color}`,
      }}
      title={instrument.description}
    >
      <div className="flex items-center gap-2">
        {instrument.icon && (
          <span className="text-base">{instrument.icon}</span>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{instrument.name}</div>
          <div className="text-xs text-muted-foreground truncate">
            {capabilities.join(' + ')}
          </div>
        </div>
      </div>
    </div>
  );
}

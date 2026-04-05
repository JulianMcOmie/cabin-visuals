'use client';

import { Preset } from '@daw/core/types';
import { CATEGORY_COLORS, withAlpha } from '@daw/utils/colors';
import { useDragDrop } from '@daw/hooks/useDragDrop';

interface PresetChipProps {
  preset: Preset;
}

export function PresetChip({ preset }: PresetChipProps) {
  const { handlePresetDragStart, handleDragEnd } = useDragDrop();
  const color = CATEGORY_COLORS[preset.category];

  return (
    <div
      draggable
      onDragStart={(e) => handlePresetDragStart(e, preset)}
      onDragEnd={handleDragEnd}
      className="px-3 py-2 rounded-lg cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-md"
      style={{
        backgroundColor: withAlpha(color, 0.15),
        borderLeft: `3px solid ${color}`,
      }}
      title={preset.description}
    >
      <div className="text-sm font-medium truncate">{preset.name}</div>
      <div className="text-xs text-muted-foreground truncate">
        {preset.durationBars} bar{preset.durationBars > 1 ? 's' : ''}
      </div>
    </div>
  );
}

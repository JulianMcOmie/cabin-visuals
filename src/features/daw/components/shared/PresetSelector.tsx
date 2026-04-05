'use client';

import { Preset } from '@daw/core/types';
import { withAlpha } from '@daw/utils/colors';

interface PresetSelectorProps {
  presets: Preset[];
  onSelectPreset: (preset: Preset) => void;
  color?: string;
}

export function PresetSelector({ presets, onSelectPreset, color = '#888888' }: PresetSelectorProps) {
  if (presets.length === 0) return null;

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 px-4 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
      {presets.map((preset) => (
        <button
          key={preset.id}
          onClick={() => onSelectPreset(preset)}
          className="flex-shrink-0 px-2.5 py-1 rounded-md text-xs font-medium transition-all hover:scale-105 active:scale-95"
          style={{
            backgroundColor: withAlpha(color, 0.2),
            borderLeft: `2px solid ${color}`,
          }}
          title={preset.description}
        >
          {preset.name}
        </button>
      ))}
    </div>
  );
}

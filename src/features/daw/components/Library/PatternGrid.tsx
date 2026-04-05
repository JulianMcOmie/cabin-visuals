'use client';

import { PresetChip } from './PresetChip';
import { getPresets } from '@daw/core/presets';

export function PatternGrid() {
  const patterns = getPresets();

  return (
    <div className="flex flex-col gap-2">
      {patterns.map((preset) => (
        <PresetChip key={preset.id} preset={preset} />
      ))}
    </div>
  );
}

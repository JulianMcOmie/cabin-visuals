'use client';

import { PresetChip } from './PresetChip';
import { getLoopsByCategory } from '@daw/core/presets';
import { CATEGORY_COLORS } from '@daw/utils/colors';
import { PatternCategory } from '@daw/core/types';

interface CategorySectionProps {
  category: PatternCategory;
  isExpanded: boolean;
  onToggle: () => void;
}

const CATEGORY_LABELS: Record<PatternCategory, string> = {
  drums: 'Drums',
  chords: 'Chords',
  bass: 'Bass',
  arp: 'Arps',
  modifier: 'Modifiers',
  rhythm: 'Rhythms',
  suppress: 'Suppress',
  mute: 'Mutes',
  rest: 'Rests',
  swing: 'Swing',
};

export function CategorySection({ category, isExpanded, onToggle }: CategorySectionProps) {
  const presets = getLoopsByCategory(category);
  const color = CATEGORY_COLORS[category];

  return (
    <div className="rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <span className="font-medium text-sm">{CATEGORY_LABELS[category]}</span>
        <span className="text-muted-foreground text-xs">
          {isExpanded ? '−' : '+'}
        </span>
      </button>

      {isExpanded && (
        <div className="px-2 py-2 space-y-1.5">
          {presets.map((preset) => (
            <PresetChip key={preset.id} preset={preset} />
          ))}
        </div>
      )}
    </div>
  );
}

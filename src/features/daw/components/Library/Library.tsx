'use client';

import { useState } from 'react';
import { CategorySection } from './CategorySection';
import { SegmentedControl, LibraryTab } from './SegmentedControl';
import { PatternGrid } from './PatternGrid';
import { InstrumentBrowser } from './InstrumentBrowser';
import { PRESET_CATEGORIES } from '@daw/core/presets';

export function Library() {
  const [activeTab, setActiveTab] = useState<LibraryTab>('instruments');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(PRESET_CATEGORIES)
  );

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  return (
    <div className="p-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Library
      </h2>

      <SegmentedControl activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'instruments' && <InstrumentBrowser />}

      {activeTab === 'loops' && (
        <div className="space-y-2">
          {PRESET_CATEGORIES.map((category) => (
            <CategorySection
              key={category}
              category={category}
              isExpanded={expandedCategories.has(category)}
              onToggle={() => toggleCategory(category)}
            />
          ))}
        </div>
      )}

      {activeTab === 'patterns' && <PatternGrid />}

      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {activeTab === 'instruments'
            ? 'Click to assign to selected track, or drag onto timeline.'
            : 'Drag patterns onto the timeline or track hierarchy to add them.'}
        </p>
      </div>
    </div>
  );
}

'use client';

export type LibraryTab = 'instruments' | 'loops' | 'patterns';

interface SegmentedControlProps {
  activeTab: LibraryTab;
  onChange: (tab: LibraryTab) => void;
}

const TABS: { id: LibraryTab; label: string }[] = [
  { id: 'instruments', label: 'Instruments' },
  { id: 'loops', label: 'Loops' },
  { id: 'patterns', label: 'Patterns' },
];

export function SegmentedControl({ activeTab, onChange }: SegmentedControlProps) {
  return (
    <div className="flex rounded-lg bg-muted/50 p-1 mb-3">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-1 px-2 py-1.5 text-sm font-medium rounded-md transition-all ${
            activeTab === tab.id
              ? 'bg-gradient-to-r from-accent-from to-accent-to text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { InstrumentChip } from './InstrumentChip';
import { getInstrumentFolderTree, getInstrument, InstrumentFolder } from '@daw/instruments';

interface FolderSectionProps {
  folder: InstrumentFolder;
  isExpanded: boolean;
  onToggle: () => void;
  level?: number;
}

// Folder colors for visual distinction
const FOLDER_COLORS: Record<string, string> = {
  'Synths': '#6366f1',
  'Drums': '#ef4444',
  'Audio': '#22c55e',
  'Visual': '#8b5cf6',
};

function FolderSection({ folder, isExpanded, onToggle, level = 0 }: FolderSectionProps) {
  const color = FOLDER_COLORS[folder.name] || '#64748b';
  const instruments = folder.instruments
    .map((id) => getInstrument(id))
    .filter((i): i is NonNullable<typeof i> => i !== undefined);

  return (
    <div className="rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
        style={{
          borderLeft: `3px solid ${color}`,
          paddingLeft: `${12 + level * 12}px`,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {isExpanded ? '📂' : '📁'}
          </span>
          <span className="font-medium text-sm">{folder.name}</span>
        </div>
        <span className="text-muted-foreground text-xs">
          {instruments.length}
        </span>
      </button>

      {isExpanded && (
        <div className="px-2 py-2 space-y-1.5">
          {instruments.map((instrument) => (
            <InstrumentChip key={instrument.id} instrument={instrument} />
          ))}
        </div>
      )}
    </div>
  );
}

export function InstrumentBrowser() {
  const folderTree = getInstrumentFolderTree();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(folderTree.subfolders?.map((f) => f.name) || [])
  );

  const toggleFolder = (folderName: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {folderTree.subfolders?.map((subfolder) => (
        <FolderSection
          key={subfolder.name}
          folder={subfolder}
          isExpanded={expandedFolders.has(subfolder.name)}
          onToggle={() => toggleFolder(subfolder.name)}
        />
      ))}

      {/* Show any root-level instruments */}
      {folderTree.instruments.length > 0 && (
        <div className="px-2 py-2 space-y-1.5">
          {folderTree.instruments.map((id) => {
            const instrument = getInstrument(id);
            return instrument ? (
              <InstrumentChip key={id} instrument={instrument} />
            ) : null;
          })}
        </div>
      )}
    </div>
  );
}

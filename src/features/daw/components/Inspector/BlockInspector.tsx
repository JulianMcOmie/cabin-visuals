'use client';

import { Block, Track, getDrumType } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { useUIStore } from '@daw/stores/uiStore';

interface BlockInspectorProps {
  block: Block;
  track: Track;
}

export function BlockInspector({ block, track }: BlockInspectorProps) {
  const { updateBlock, deleteBlock } = useProjectStore();
  const selectBlock = useUIStore((s) => s.selectBlock);
  const project = useProjectStore((state) => state.project);

  const totalEvents = block.streams?.reduce((sum, s) => sum + s.events.length, 0) || 0;

  const handleDelete = () => {
    deleteBlock(track.id, block.id);
    selectBlock(null);
  };

  return (
    <div className="space-y-4">
      {/* Back to Track */}
      <button
        onClick={() => selectBlock(null)}
        className="text-xs text-accent-from hover:underline"
      >
        ← Back to track
      </button>

      {/* Block Header */}
      <div className="p-3 rounded-lg bg-muted/30">
        <h3 className="font-medium text-sm">{track.name} Block</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {totalEvents} event{totalEvents !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Start Bar */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Start Bar</label>
        <input
          type="number"
          value={block.startBar + 1}
          onChange={(e) =>
            updateBlock(track.id, block.id, {
              startBar: Math.max(0, parseInt(e.target.value) - 1) || 0,
            })
          }
          className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
          min={1}
          max={project.totalBars}
        />
      </div>

      {/* Duration */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Duration (bars)</label>
        <input
          type="number"
          value={block.durationBars}
          onChange={(e) =>
            updateBlock(track.id, block.id, {
              durationBars: Math.max(1, parseInt(e.target.value)) || 1,
            })
          }
          className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
          min={1}
          max={32}
        />
      </div>

      {/* Loop Toggle */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={block.loop}
            onChange={(e) =>
              updateBlock(track.id, block.id, { loop: e.target.checked })
            }
            className="w-4 h-4 rounded border-border accent-accent-from"
          />
          <span className="text-sm">Loop pattern</span>
        </label>
      </div>

      {/* Reference Block Settings (if applicable) */}
      {(block.sourceBlockId || block.sourceTrackId) && (
        <div className="pt-4 border-t border-border space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">
            Reference Settings
          </h4>

          {/* Source Track */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Source Track
            </label>
            <select
              value={block.sourceTrackId || ''}
              onChange={(e) =>
                updateBlock(track.id, block.id, {
                  sourceTrackId: e.target.value || undefined,
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
            >
              <option value="">None</option>
              {Object.values(project.tracks)
                .filter((t) => t.id !== track.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Extract Mode */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Extract
            </label>
            <select
              value={block.extractMode || 'all'}
              onChange={(e) =>
                updateBlock(track.id, block.id, {
                  extractMode: e.target.value as Block['extractMode'],
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-from"
            >
              <option value="all">All (timing, pitch, velocity)</option>
              <option value="timing">Timing only</option>
              <option value="pitch">Pitch only</option>
              <option value="velocity">Velocity only</option>
            </select>
          </div>
        </div>
      )}

      {/* Event Preview */}
      {totalEvents > 0 && (
        <div className="pt-4 border-t border-border">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
            Events Preview
          </h4>
          <div className="max-h-32 overflow-y-auto text-xs font-mono bg-background rounded-lg p-2 space-y-0.5">
            {block.streams?.[0]?.events
              .filter((event) => event && typeof event.startTimeInBeats === 'number')
              .slice(0, 10)
              .map((event, i) => {
                const drumType = getDrumType(event.pitch);
                return (
                  <div key={i} className="text-muted-foreground">
                    t:{event.startTimeInBeats.toFixed(2)}{' '}
                    {drumType ? `d:${drumType}` : `p:${event.pitch}`}{' '}
                    v:{event.velocity}
                  </div>
                );
              })}
            {totalEvents > 10 && (
              <div className="text-muted-foreground/50">
                ...and {totalEvents - 10} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Button */}
      <div className="pt-4">
        <button
          onClick={handleDelete}
          className="w-full px-4 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
        >
          Delete Block
        </button>
      </div>
    </div>
  );
}

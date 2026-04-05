'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { TrackNode } from '@daw/utils/tree';
import { useProjectStore } from '@daw/stores/projectStore';
import { useUIStore } from '@daw/stores/uiStore';
import { useDragDrop } from '@daw/hooks/useDragDrop';
import { TRACK_TYPE_COLORS, INSTRUMENT_COLORS, withAlpha } from '@daw/utils/colors';
import { getInstrument } from '@daw/instruments';
import { getPlugin } from '@daw/plugins';

interface TrackLabelsProps {
  flatTracks: TrackNode[];
}

export function TrackLabels({ flatTracks }: TrackLabelsProps) {
  const dropTargetTrackId = useUIStore((state) => state.dropTargetTrackId);
  const dragState = useUIStore((state) => state.dragState);
  const trackHeightScale = useUIStore((state) => state.trackHeightScale);
  const { handleDragOver, handleDragLeave, handleHierarchyDrop } = useDragDrop();
  const updateTrack = useProjectStore((state) => state.updateTrack);

  const trackHeight = Math.round(64 * trackHeightScale);
  const hasTracks = flatTracks.length > 0;

  // Drag-over mute/solo state (Logic-style: mousedown on M/S, drag over others)
  const muteSoloDragRef = useRef<{ type: 'mute' | 'solo'; value: boolean } | null>(null);

  const handleMuteSoloDragStart = useCallback((type: 'mute' | 'solo', value: boolean) => {
    muteSoloDragRef.current = { type, value };
  }, []);

  const handleMuteSoloDragEnter = useCallback((trackId: string) => {
    const drag = muteSoloDragRef.current;
    if (!drag) return;
    if (drag.type === 'mute') {
      updateTrack(trackId, { muted: drag.value });
    } else {
      updateTrack(trackId, { solo: drag.value });
    }
  }, [updateTrack]);

  useEffect(() => {
    const handlePointerUp = () => { muteSoloDragRef.current = null; };
    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
  }, []);

  return (
    <div
      className="min-h-full"
      onDragOver={(e) => {
        if (dragState.type === 'preset') {
          handleDragOver(e, '__root__');
        }
      }}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        if (dragState.type === 'preset') {
          handleHierarchyDrop(e);
        }
      }}
    >
      {!hasTracks && (
        <div
          className={`m-3 p-6 border-2 border-dashed rounded-lg text-center transition-colors ${
            dropTargetTrackId === '__root__'
              ? 'border-accent-from bg-accent-from/10'
              : 'border-border'
          }`}
        >
          <p className="text-muted-foreground text-sm">
            Drag a pattern here to create your first track
          </p>
        </div>
      )}

      {/* Simple display - NO DnD wrapper, NO drag handles */}
      <div className="py-1">
        {flatTracks.map((node) => (
          <TrackLabelRow key={node.track.id} node={node} trackHeight={trackHeight} onMuteSoloDragStart={handleMuteSoloDragStart} onMuteSoloDragEnter={handleMuteSoloDragEnter} />
        ))}
      </div>
    </div>
  );
}

// Simplified row without drag handle - display only
function TrackLabelRow({ node, trackHeight, onMuteSoloDragStart, onMuteSoloDragEnter }: {
  node: TrackNode;
  trackHeight: number;
  onMuteSoloDragStart: (type: 'mute' | 'solo', value: boolean) => void;
  onMuteSoloDragEnter: (trackId: string) => void;
}) {
  const { track, depth } = node;
  const updateTrack = useProjectStore((state) => state.updateTrack);
  const addTrack = useProjectStore((state) => state.addTrack);
  const selectedTrackId = useUIStore((state) => state.selectedTrackId);
  const selectedTrackIds = useUIStore((state) => state.selectedTrackIds);
  const selectTrack = useUIStore((state) => state.selectTrack);
  const collapsedTrackIds = useUIStore((state) => state.collapsedTrackIds);
  const toggleTrackCollapsed = useUIStore((state) => state.toggleTrackCollapsed);
  const dropTargetTrackId = useUIStore((state) => state.dropTargetTrackId);
  const dragState = useUIStore((state) => state.dragState);
  const { handleDragOver, handleDragLeave, handleHierarchyDrop } = useDragDrop();

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => closeContextMenu();
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu, closeContextMenu]);

  const handleAddChildTrack = useCallback(() => {
    const newTrackId = addTrack(track.id);
    selectTrack(newTrackId);
    if (collapsedTrackIds.has(track.id)) {
      toggleTrackCollapsed(track.id);
    }
    closeContextMenu();
  }, [track.id, addTrack, selectTrack, collapsedTrackIds, toggleTrackCollapsed, closeContextMenu]);

  const handleAddSuppressTrack = useCallback(() => {
    const newTrackId = addTrack(track.id);
    useProjectStore.getState().updateTrack(newTrackId, { typeId: 'suppress', name: 'Suppress' });
    selectTrack(newTrackId);
    if (collapsedTrackIds.has(track.id)) {
      toggleTrackCollapsed(track.id);
    }
    closeContextMenu();
  }, [track.id, addTrack, selectTrack, collapsedTrackIds, toggleTrackCollapsed, closeContextMenu]);

  const handleAddMuteTrack = useCallback(() => {
    const newTrackId = addTrack(track.id);
    useProjectStore.getState().updateTrack(newTrackId, { typeId: 'mute', name: 'Mute' });
    selectTrack(newTrackId);
    if (collapsedTrackIds.has(track.id)) {
      toggleTrackCollapsed(track.id);
    }
    closeContextMenu();
  }, [track.id, addTrack, selectTrack, collapsedTrackIds, toggleTrackCollapsed, closeContextMenu]);

  const handleAddAutomationTrack = useCallback(() => {
    const newTrackId = useProjectStore.getState().addAutomationTrack(track.id, '');
    selectTrack(newTrackId);
    if (collapsedTrackIds.has(track.id)) {
      toggleTrackCollapsed(track.id);
    }
    closeContextMenu();
  }, [track.id, selectTrack, collapsedTrackIds, toggleTrackCollapsed, closeContextMenu]);

  // Check if track has automatable params (instrument or visual plugins)
  const instrument = track.instrumentId ? getInstrument(track.instrumentId) : undefined;
  const hasAutomatableParams = (instrument?.settingsSchema &&
    Object.values(instrument.settingsSchema).some(f => f.type === 'number')) ||
    (track.visualPlugins && track.visualPlugins.length > 0);

  const isSelected = selectedTrackIds.has(track.id);
  const isCollapsed = collapsedTrackIds.has(track.id);
  const hasChildren = track.childIds.length > 0;
  const isDropTarget = dropTargetTrackId === track.id;
  const isMaster = track.typeId === 'master';
  const typeColor = TRACK_TYPE_COLORS[track.typeId];
  const instrumentColor = track.instrumentId ? INSTRUMENT_COLORS[track.instrumentId] : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`group relative flex items-center px-2 cursor-pointer transition-colors ${
        isSelected ? '' : 'hover:bg-muted/50'
      } ${isDropTarget && dragState.type === 'preset' ? 'bg-accent-from/30' : ''} ${
        isMaster ? 'border-t border-border/50' : ''
      }`}
      style={{
        height: trackHeight,
        paddingLeft: `${8 + depth * 16}px`,
        ...(isSelected
          ? { background: 'linear-gradient(90deg, rgba(100, 116, 139, 0.25) 0%, rgba(71, 85, 105, 0.1) 100%)' }
          : isMaster
          ? { background: 'rgba(148, 163, 184, 0.05)' }
          : {}),
      }}
      onClick={(e) => selectTrack(track.id, e.shiftKey)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectTrack(track.id, e.shiftKey); }}
      onContextMenu={handleContextMenu}
      onDragOver={(e) => {
        if (dragState.type === 'preset') {
          handleDragOver(e, track.id);
        }
      }}
      onDragLeave={handleDragLeave}
      onDrop={(e) => {
        if (dragState.type === 'preset') {
          e.stopPropagation();
          handleHierarchyDrop(e, track.id);
        }
      }}
    >
      {/* Expand/Collapse Toggle (no drag handle in timeline view) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleTrackCollapsed(track.id);
        }}
        className={`w-5 h-5 flex items-center justify-center text-xs text-muted-foreground hover:text-foreground transition-colors ${
          !hasChildren ? 'invisible' : ''
        }`}
      >
        {isCollapsed ? '▶' : '▼'}
      </button>

      {/* Track Type Badge */}
      <div
        className="w-2 h-2 rounded-full mx-1.5"
        style={{ backgroundColor: typeColor }}
        title={track.typeId}
      />

      {/* Track Name */}
      <span className={`flex-1 text-base truncate ${track.muted ? 'text-muted-foreground' : ''}`}>
        {track.name}
      </span>

      {/* Instrument Badge */}
      {track.instrumentId && (
        <span
          className="text-xs px-1.5 py-0.5 rounded ml-1"
          style={{
            backgroundColor: withAlpha(instrumentColor || '#888', 0.2),
            color: instrumentColor,
          }}
        >
          {track.instrumentId.slice(0, 3)}
        </span>
      )}

      {/* Mute Button */}
      <button
        onPointerDown={(e) => {
          e.stopPropagation();
          updateTrack(track.id, { muted: !track.muted });
          onMuteSoloDragStart('mute', !track.muted);
        }}
        onPointerEnter={() => onMuteSoloDragEnter(track.id)}
        className={`ml-2 w-6 h-6 rounded text-xs flex items-center justify-center transition-colors ${
          track.muted ? 'bg-red-500/20 text-red-400' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
        }`}
        title={track.muted ? 'Unmute' : 'Mute'}
      >
        M
      </button>

      {/* Solo Button */}
      <button
        onPointerDown={(e) => {
          e.stopPropagation();
          updateTrack(track.id, { solo: !track.solo });
          onMuteSoloDragStart('solo', !track.solo);
        }}
        onPointerEnter={() => onMuteSoloDragEnter(track.id)}
        className={`w-6 h-6 rounded text-xs flex items-center justify-center transition-colors ${
          track.solo ? 'bg-yellow-500/20 text-yellow-400' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
        }`}
        title={track.solo ? 'Unsolo' : 'Solo'}
      >
        S
      </button>

      {/* Context menu (not shown for master track — only automation is relevant) */}
      {contextMenu && (
        <div
          role="menu"
          className="fixed z-[100] min-w-[160px] bg-surface border border-border rounded-lg shadow-xl py-1 overflow-hidden"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Escape') closeContextMenu(); }}
        >
          {!isMaster && (
            <>
              <button
                onClick={handleAddChildTrack}
                className="w-full px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
              >
                <span className="text-muted-foreground">+</span>
                <span>Add Child Track</span>
              </button>
              <button
                onClick={handleAddSuppressTrack}
                className="w-full px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
              >
                <span className="text-muted-foreground">S</span>
                <span>Add Suppress Track</span>
              </button>
              <button
                onClick={handleAddMuteTrack}
                className="w-full px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
              >
                <span className="text-muted-foreground">M</span>
                <span>Add Mute Track</span>
              </button>
            </>
          )}
          {hasAutomatableParams && (
            <button
              onClick={handleAddAutomationTrack}
              className="w-full px-4 py-2 text-left text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
            >
              <span className="text-muted-foreground">A</span>
              <span>Add Automation Track</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

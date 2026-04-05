'use client';

import { useState, useCallback, useEffect } from 'react';
import { TreeItem, TreeItemRenderContext } from 'react-complex-tree';
import { Track } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { useUIStore } from '@daw/stores/uiStore';
import { useDragDrop } from '@daw/hooks/useDragDrop';
import { TRACK_TYPE_COLORS, INSTRUMENT_COLORS, withAlpha } from '@daw/utils/colors';
import { getInstrument } from '@daw/instruments';

// Shared mute/solo drag ref (Logic-style: mousedown on M/S, drag over others)
const muteSoloDragRef: { current: { type: 'mute' | 'solo'; value: boolean } | null } = { current: null };

// Global listener setup (once)
if (typeof window !== 'undefined') {
  window.addEventListener('pointerup', () => { muteSoloDragRef.current = null; });
}

interface TrackRowRendererProps {
  item: TreeItem<Track>;
  title: React.ReactNode;
  context: TreeItemRenderContext;
  children: React.ReactNode;
  depth: number;
}

export function TrackRowRenderer({ item, context, children, depth }: TrackRowRendererProps) {
  const treeTrack = item.data;
  const isRootOrEmpty = !treeTrack || item.index === 'root';

  // All hooks must be called unconditionally (React rules of hooks)
  const storeTrack = useProjectStore((s) => s.project.tracks[item.index as string]);
  const { updateTrack, addTrack } = useProjectStore();
  const addAutomationTrack = useProjectStore((s) => s.addAutomationTrack);
  const trackHeightScale = useUIStore((s) => s.trackHeightScale);
  const dropTargetTrackId = useUIStore((s) => s.dropTargetTrackId);
  const dragState = useUIStore((s) => s.dragState);
  const selectTrack = useUIStore((s) => s.selectTrack);
  const collapsedTrackIds = useUIStore((s) => s.collapsedTrackIds);
  const toggleTrackCollapsed = useUIStore((s) => s.toggleTrackCollapsed);
  const { handleDragOver, handleDragLeave, handleHierarchyDrop } = useDragDrop();
  const selectedTrackIds = useUIStore((s) => s.selectedTrackIds);

  // Read live track from store — item.data is a stale snapshot from StaticTreeDataProvider
  const track = storeTrack ?? treeTrack;

  const trackHeight = Math.round(64 * trackHeightScale);
  const isSelected = !isRootOrEmpty && track ? selectedTrackIds.has(track.id) : false;
  const isExpanded = context.isExpanded;
  const hasChildren = item.children && item.children.length > 0;
  const isDraggingOver = context.isDraggingOver;
  const trackId = track?.id ?? '';
  const isDropTarget = dropTargetTrackId === trackId;

  const typeColor = track ? TRACK_TYPE_COLORS[track.typeId] : undefined;
  const instrumentColor = track?.instrumentId ? INSTRUMENT_COLORS[track.instrumentId] : undefined;

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (contextMenu) {
      const handleClick = () => closeContextMenu();
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenu, closeContextMenu]);

  const handleAddChildTrack = useCallback(() => {
    const newTrackId = addTrack(trackId);
    selectTrack(newTrackId);
    if (collapsedTrackIds.has(trackId)) {
      toggleTrackCollapsed(trackId);
    }
    closeContextMenu();
  }, [trackId, addTrack, selectTrack, collapsedTrackIds, toggleTrackCollapsed, closeContextMenu]);

  const handleAddSuppressTrack = useCallback(() => {
    const newTrackId = addTrack(trackId);
    useProjectStore.getState().updateTrack(newTrackId, { typeId: 'suppress', name: 'Suppress' });
    selectTrack(newTrackId);
    if (collapsedTrackIds.has(trackId)) {
      toggleTrackCollapsed(trackId);
    }
    closeContextMenu();
  }, [trackId, addTrack, selectTrack, collapsedTrackIds, toggleTrackCollapsed, closeContextMenu]);

  const handleAddMuteTrack = useCallback(() => {
    const newTrackId = addTrack(trackId);
    useProjectStore.getState().updateTrack(newTrackId, { typeId: 'mute', name: 'Mute' });
    selectTrack(newTrackId);
    if (collapsedTrackIds.has(trackId)) {
      toggleTrackCollapsed(trackId);
    }
    closeContextMenu();
  }, [trackId, addTrack, selectTrack, collapsedTrackIds, toggleTrackCollapsed, closeContextMenu]);

  const handleAddAutomationTrack = useCallback(() => {
    const newTrackId = addAutomationTrack(trackId, '');
    selectTrack(newTrackId);
    if (collapsedTrackIds.has(trackId)) {
      toggleTrackCollapsed(trackId);
    }
    closeContextMenu();
  }, [trackId, addAutomationTrack, selectTrack, collapsedTrackIds, toggleTrackCollapsed, closeContextMenu]);

  // Check if track has automatable params
  const instrument = track?.instrumentId ? getInstrument(track.instrumentId) : undefined;
  const hasAutomatableParams = (instrument?.settingsSchema &&
    Object.values(instrument.settingsSchema).some(f => f.type === 'number')) ||
    (track?.visualPlugins && track.visualPlugins.length > 0);

  // Mute/solo drag handlers
  const handleMuteSoloDragStart = useCallback((type: 'mute' | 'solo', value: boolean) => {
    muteSoloDragRef.current = { type, value };
  }, []);

  const handleMuteSoloDragEnter = useCallback(() => {
    const drag = muteSoloDragRef.current;
    if (!drag) return;
    if (drag.type === 'mute') {
      updateTrack(trackId, { muted: drag.value });
    } else {
      updateTrack(trackId, { solo: drag.value });
    }
  }, [updateTrack, trackId]);

  // Extract the onClick from interactiveElementProps to handle it properly
  const { onClick: rctOnClick, ...restInteractiveProps } = context.interactiveElementProps;

  // Skip rendering the root item (early return after all hooks)
  if (isRootOrEmpty) {
    return <>{children}</>;
  }

  return (
    <li
      {...context.itemContainerWithChildrenProps}
      className="list-none"
    >
      <div
        {...context.itemContainerWithoutChildrenProps}
        {...restInteractiveProps}
        role="treeitem"
        tabIndex={0}
        className={`group relative flex items-center px-2 cursor-pointer transition-colors select-none outline-none ${
          isSelected ? '' : 'hover:bg-muted/50'
        } ${isDropTarget && dragState.type === 'preset' ? 'bg-accent-from/30' : ''} ${
          isDraggingOver ? 'bg-accent/10' : ''
        }`}
        style={{
          height: trackHeight,
          paddingLeft: `${8 + depth * 16}px`,
          userSelect: 'none',
          ...(isSelected
            ? { background: 'linear-gradient(90deg, rgba(100, 116, 139, 0.25) 0%, rgba(71, 85, 105, 0.1) 100%)' }
            : {}),
        }}
        onClick={(e) => {
          if (rctOnClick) {
            rctOnClick(e);
          }
        }}
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
        {/* Drag Handle */}
        <div className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity mr-1">
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="2" cy="2" r="1.5" />
            <circle cx="8" cy="2" r="1.5" />
            <circle cx="2" cy="7" r="1.5" />
            <circle cx="8" cy="7" r="1.5" />
            <circle cx="2" cy="12" r="1.5" />
            <circle cx="8" cy="12" r="1.5" />
          </svg>
        </div>

        {/* Expand/Collapse Toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            context.toggleExpandedState();
          }}
          className={`w-5 h-5 flex items-center justify-center text-xs text-muted-foreground hover:text-foreground transition-colors ${
            !hasChildren ? 'invisible' : ''
          }`}
          type="button"
        >
          {isExpanded ? '▼' : '▶'}
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
            handleMuteSoloDragStart('mute', !track.muted);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerEnter={handleMuteSoloDragEnter}
          className={`ml-2 w-6 h-6 rounded text-xs flex items-center justify-center transition-colors ${
            track.muted ? 'bg-red-500/20 text-red-400' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
          }`}
          title={track.muted ? 'Unmute' : 'Mute'}
          type="button"
        >
          M
        </button>

        {/* Solo Button */}
        <button
          onPointerDown={(e) => {
            e.stopPropagation();
            updateTrack(track.id, { solo: !track.solo });
            handleMuteSoloDragStart('solo', !track.solo);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onPointerEnter={handleMuteSoloDragEnter}
          className={`w-6 h-6 rounded text-xs flex items-center justify-center transition-colors ${
            track.solo ? 'bg-yellow-500/20 text-yellow-400' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
          }`}
          title={track.solo ? 'Unsolo' : 'Solo'}
          type="button"
        >
          S
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-[100] min-w-[160px] bg-surface border border-border rounded-lg shadow-xl py-1 overflow-hidden"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
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

      {/* Render children (nested tracks) */}
      {children}
    </li>
  );
}

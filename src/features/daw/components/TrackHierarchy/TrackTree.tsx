'use client';

import { useMemo, useCallback, useRef, useEffect } from 'react';
import {
  UncontrolledTreeEnvironment,
  Tree,
  StaticTreeDataProvider,
  TreeItemIndex,
  DraggingPosition,
  TreeItem,
  InteractionMode,
} from 'react-complex-tree';
import 'react-complex-tree/lib/style-modern.css';
import { Track } from '@daw/core/types';
import { useProjectStore } from '@daw/stores/projectStore';
import { useUIStore } from '@daw/stores/uiStore';
import { tracksToTreeItems } from '@daw/utils/trackTreeAdapter';
import { getDescendants } from '@daw/utils/tree';
import { TrackRowRenderer } from './TrackRowRenderer';

interface TrackTreeProps {
  treeId: string;
  rootIds?: string[];
  hideMasterTrack?: boolean;
}

export function TrackTree({ treeId, rootIds, hideMasterTrack = false }: TrackTreeProps) {
  const project = useProjectStore((state) => state.project);
  const { moveTrack, duplicateTrack } = useProjectStore();
  const collapsedTrackIds = useUIStore((s) => s.collapsedTrackIds);
  const toggleTrackCollapsed = useUIStore((s) => s.toggleTrackCollapsed);
  const selectedTrackIds = useUIStore((s) => s.selectedTrackIds);
  const selectTracks = useUIStore((s) => s.selectTracks);

  // Track Alt key state for opt+drag duplicate
  const altKeyRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { altKeyRef.current = e.altKey; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  // Convert project tracks to tree items
  const treeItems = useMemo(() => tracksToTreeItems(project, rootIds, hideMasterTrack), [project, rootIds, hideMasterTrack]);

  // Key that changes when track structure changes, forcing tree remount.
  // StaticTreeDataProvider has private data that can't be updated externally,
  // so we remount the entire tree when tracks are added/removed/reordered.
  const effectiveRootIds = rootIds ?? project.rootTracks;
  const treeKey = useMemo(() => {
    const rootStr = effectiveRootIds.join(',');
    const childStr = Object.entries(project.tracks)
      .map(([id, t]) => `${id}:${t.childIds.join('.')}:${t.name}`)
      .sort()
      .join('|');
    return `${rootStr}||${childStr}`;
  }, [project.tracks, effectiveRootIds]);

  // Create data provider (memoized per treeKey)
  const dataProvider = useMemo(() => {
    return new StaticTreeDataProvider(treeItems, (item, newName) => ({
      ...item,
      data: item.data ? { ...item.data, name: newName } : item.data,
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeKey]);

  // Validate drop - prevent circular references
  const canDropAt = useCallback(
    (items: TreeItem<Track>[], target: DraggingPosition): boolean => {
      const draggedId = items[0]?.index as string;
      if (!draggedId || draggedId === 'root') return false;

      // For 'item' drops (reparenting), check if target is descendant
      if (target.targetType === 'item') {
        const targetId = target.targetItem as string;
        if (draggedId === targetId) return false;
        const descendants = getDescendants(project, draggedId);
        if (descendants.includes(targetId)) return false;
      }

      // For 'between-items' drops, check parent
      if (target.targetType === 'between-items') {
        const parentId = target.parentItem as string;
        if (parentId !== 'root') {
          const descendants = getDescendants(project, draggedId);
          if (descendants.includes(parentId)) return false;
        }
      }

      return true;
    },
    [project]
  );

  // Handle drop - call moveTrack with correct parent/index
  const handleDrop = useCallback(
    (items: TreeItem<Track>[], target: DraggingPosition) => {
      const draggedId = items[0]?.index as string;
      if (!draggedId) return;

      let newParentId: string | undefined;
      let insertIndex: number;

      switch (target.targetType) {
        case 'item':
          // Drop ON a track = reparent as child (at end)
          newParentId = target.targetItem as string;
          if (newParentId === 'root') newParentId = undefined;
          insertIndex = newParentId
            ? project.tracks[newParentId]?.childIds.length ?? 0
            : project.rootTracks.length;
          break;

        case 'between-items':
          // Drop between = reorder
          newParentId = target.parentItem as string;
          if (newParentId === 'root') newParentId = undefined;
          insertIndex = target.childIndex;
          break;

        case 'root':
          // Drop at root level
          newParentId = undefined;
          insertIndex = project.rootTracks.length;
          break;

        default:
          return;
      }

      if (altKeyRef.current) {
        duplicateTrack(draggedId, newParentId, insertIndex);
      } else {
        moveTrack(draggedId, newParentId, insertIndex);
      }
    },
    [project, moveTrack, duplicateTrack]
  );

  // Sync selection
  const handleSelectItems = useCallback(
    (items: TreeItemIndex[]) => {
      const ids = items.map(String).filter((id) => id !== 'root');
      selectTracks(ids);
    },
    [selectTracks]
  );

  // Sync expand/collapse
  const handleExpandItem = useCallback(
    (item: TreeItem<Track>) => {
      const id = item.index as string;
      if (collapsedTrackIds.has(id)) {
        toggleTrackCollapsed(id);
      }
    },
    [collapsedTrackIds, toggleTrackCollapsed]
  );

  const handleCollapseItem = useCallback(
    (item: TreeItem<Track>) => {
      const id = item.index as string;
      if (!collapsedTrackIds.has(id)) {
        toggleTrackCollapsed(id);
      }
    },
    [collapsedTrackIds, toggleTrackCollapsed]
  );

  // Calculate expanded items (inverse of collapsed) - recomputed on remount via treeKey
  const defaultExpandedItems = useMemo(() => {
    return Object.keys(project.tracks).filter((id) => !collapsedTrackIds.has(id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeKey]);

  return (
    <UncontrolledTreeEnvironment
      key={treeKey}
      dataProvider={dataProvider}
      defaultInteractionMode={InteractionMode.ClickArrowToExpand}
      getItemTitle={(item) => item.data?.name || ''}
      viewState={{
        [treeId]: {
          selectedItems: Array.from(selectedTrackIds),
          expandedItems: defaultExpandedItems,
        },
      }}
      canDragAndDrop
      canReorderItems
      canDropOnFolder
      canDropOnNonFolder={false}
      canDropAt={canDropAt}
      onDrop={handleDrop}
      onSelectItems={handleSelectItems}
      onExpandItem={handleExpandItem}
      onCollapseItem={handleCollapseItem}
      renderItemTitle={({ title }) => <span>{title}</span>}
      renderItem={(props) => <TrackRowRenderer {...props} />}
    >
      <Tree treeId={treeId} rootItem="root" />
    </UncontrolledTreeEnvironment>
  );
}

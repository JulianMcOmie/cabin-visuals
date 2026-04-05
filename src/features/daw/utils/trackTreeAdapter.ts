'use client';

import { TreeItem } from 'react-complex-tree';
import { Project, Track } from '@daw/core/types';

// TreeItem with Track payload
export type TrackTreeItem = TreeItem<Track | null>;

/**
 * Convert flat track dictionary to react-complex-tree's format.
 * RCT expects a Record<string, TreeItem> where each item has a `children` array of IDs.
 */
export function tracksToTreeItems(project: Project, rootIds?: string[], hideMasterTrack: boolean = false): Record<string, TrackTreeItem> {
  let rootChildren = rootIds ?? project.rootTracks;

  // Sort so master is always last, optionally filter it out
  if (!rootIds) {
    rootChildren = [...rootChildren].sort((a, b) => {
      const aIsMaster = project.tracks[a]?.typeId === 'master' ? 1 : 0;
      const bIsMaster = project.tracks[b]?.typeId === 'master' ? 1 : 0;
      return aIsMaster - bIsMaster;
    });
    if (hideMasterTrack) {
      rootChildren = rootChildren.filter(id => project.tracks[id]?.typeId !== 'master');
    }
  }

  const items: Record<string, TrackTreeItem> = {
    root: {
      index: 'root',
      isFolder: true,
      children: rootChildren,
      data: null,
      canMove: false,
      canRename: false,
    },
  };

  Object.values(project.tracks).forEach((track) => {
    items[track.id] = {
      index: track.id,
      isFolder: true, // All tracks can accept children
      children: track.childIds,
      data: track,
      canMove: true,
      canRename: true,
    };
  });

  return items;
}

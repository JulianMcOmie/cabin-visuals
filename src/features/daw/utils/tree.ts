import { Project, Track } from '@daw/core/types';

export interface TrackNode {
  track: Track;
  depth: number;
  index: number;
  isLast: boolean;
  parentPath: string[];
}

// Flatten track tree for rendering
export function flattenTracks(
  project: Project,
  collapsedIds: Set<string> = new Set(),
  hideMasterTrack: boolean = false
): TrackNode[] {
  const result: TrackNode[] = [];

  function traverse(trackIds: string[], depth: number, parentPath: string[]) {
    trackIds.forEach((trackId, index) => {
      const track = project.tracks[trackId];
      if (!track) return;

      const isLast = index === trackIds.length - 1;
      const node: TrackNode = {
        track,
        depth,
        index,
        isLast,
        parentPath,
      };

      result.push(node);

      // Traverse children if not collapsed
      if (track.childIds.length > 0 && !collapsedIds.has(trackId)) {
        traverse(track.childIds, depth + 1, [...parentPath, trackId]);
      }
    });
  }

  // Sort root tracks so master track is always last, optionally filter it out
  let sortedRootTracks = [...project.rootTracks].sort((a, b) => {
    const aIsMaster = project.tracks[a]?.typeId === 'master' ? 1 : 0;
    const bIsMaster = project.tracks[b]?.typeId === 'master' ? 1 : 0;
    return aIsMaster - bIsMaster;
  });
  if (hideMasterTrack) {
    sortedRootTracks = sortedRootTracks.filter(id => project.tracks[id]?.typeId !== 'master');
  }
  traverse(sortedRootTracks, 0, []);
  return result;
}

// Find all ancestor track IDs
export function getAncestors(project: Project, trackId: string): string[] {
  const ancestors: string[] = [];
  let current = project.tracks[trackId];

  while (current?.parentId) {
    ancestors.unshift(current.parentId);
    current = project.tracks[current.parentId];
  }

  return ancestors;
}

// Find all descendant track IDs
export function getDescendants(project: Project, trackId: string): string[] {
  const descendants: string[] = [];
  const track = project.tracks[trackId];
  if (!track) return descendants;

  function traverse(ids: string[]) {
    for (const id of ids) {
      descendants.push(id);
      const t = project.tracks[id];
      if (t?.childIds.length) {
        traverse(t.childIds);
      }
    }
  }

  traverse(track.childIds);
  return descendants;
}

// Check if a track is an ancestor of another
export function isAncestor(project: Project, ancestorId: string, descendantId: string): boolean {
  return getAncestors(project, descendantId).includes(ancestorId);
}

// Get visible track IDs (respecting collapsed state)
export function getVisibleTrackIds(project: Project, collapsedIds: Set<string>): string[] {
  return flattenTracks(project, collapsedIds).map(node => node.track.id);
}

// Find next/previous visible track
export function getAdjacentTrackId(
  project: Project,
  trackId: string,
  direction: 'next' | 'prev',
  collapsedIds: Set<string>
): string | null {
  const visible = getVisibleTrackIds(project, collapsedIds);
  const index = visible.indexOf(trackId);
  if (index === -1) return null;

  const newIndex = direction === 'next' ? index + 1 : index - 1;
  if (newIndex < 0 || newIndex >= visible.length) return null;

  return visible[newIndex];
}

// Count total tracks in project
export function countTracks(project: Project): number {
  return Object.keys(project.tracks).length;
}

// Count total blocks in project
export function countBlocks(project: Project): number {
  return Object.values(project.tracks).reduce(
    (sum, track) => sum + track.blocks.length,
    0
  );
}

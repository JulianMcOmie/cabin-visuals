'use client';

import { useMemo } from 'react';
import { useProjectStore } from '@daw/stores/projectStore';
import { useVisualSync } from '@daw/hooks/useVisualPlayback';
import { VisualView, VisualTrackInfo } from './VisualView';
import { getInstrument } from '@daw/instruments';
import { Track } from '@daw/core/types';

export function VisualViewPanel() {
  const tracks = useProjectStore((s) => s.project.tracks);
  const rootTracks = useProjectStore((s) => s.project.rootTracks);
  const rootScenes = useProjectStore((s) => s.project.rootScenes);
  const mainSceneTrackId = useProjectStore((s) => s.project.mainSceneTrackId);

  // Sync visual engine with project changes
  useVisualSync();

  // Find all tracks that should be rendered:
  // 1. Tracks with visual instruments
  // 2. Groups with visual plugins (effects) that have visual children
  const visualTracks = useMemo(() => {
    const result: VisualTrackInfo[] = [];
    const processedIds = new Set<string>();

    // Helper to check if a track or its descendants have visual instruments
    const hasVisualDescendant = (track: Track): boolean => {
      if (track.instrumentId) {
        const instrument = getInstrument(track.instrumentId);
        if (instrument?.hasVisual) return true;
      }
      return track.childIds.some((childId) => {
        const child = tracks[childId];
        return child && hasVisualDescendant(child);
      });
    };

    // Helper to collect visual tracks, respecting group hierarchy
    const collectVisualTracks = (trackIds: string[], parentHasEffects: boolean = false) => {
      const siblings = trackIds.map(id => tracks[id]).filter(Boolean);
      const anySoloed = siblings.some(t => t.solo);

      for (const trackId of trackIds) {
        const track = tracks[trackId];
        if (!track || processedIds.has(trackId)) continue;
        if (anySoloed && !track.solo) continue;

        const hasPlugins = (track.visualPlugins?.length ?? 0) > 0;
        const isGroup = track.childIds.length > 0;
        const hasVisualInstrument = track.instrumentId
          ? getInstrument(track.instrumentId)?.hasVisual
          : false;

        // If this is a group with effects and has visual descendants, render as group
        if (isGroup && hasPlugins && hasVisualDescendant(track)) {
          processedIds.add(trackId);
          result.push({
            id: trackId,
            instrumentId: track.instrumentId || '__group__',
            isGroup: true,
            childIds: track.childIds,
            sceneId: track.sceneId,
          });
          // Mark all descendants as processed (they'll be rendered by the group)
          const markProcessed = (ids: string[]) => {
            for (const id of ids) {
              processedIds.add(id);
              const child = tracks[id];
              if (child) markProcessed(child.childIds);
            }
          };
          markProcessed(track.childIds);
        }
        // If this track has a visual instrument, render it
        else if (hasVisualInstrument) {
          processedIds.add(trackId);
          result.push({
            id: trackId,
            instrumentId: track.instrumentId!,
            sceneId: track.sceneId,
          });
          // Also process children (e.g. nested visual instruments under a visual track with modifiers)
          if (isGroup) {
            collectVisualTracks(track.childIds);
          }
        }
        // Otherwise, process children
        else if (isGroup) {
          collectVisualTracks(track.childIds);
        }
      }
    };

    collectVisualTracks(rootTracks);
    return result;
  }, [tracks, rootTracks]);

  // Collect scene track IDs for passing to VisualView
  // Filter out the main scene track — it's only used for palette background, not as a named scene overlay
  const sceneTrackIds = useMemo(() => {
    return rootScenes.filter(id => tracks[id] && id !== mainSceneTrackId);
  }, [rootScenes, tracks, mainSceneTrackId]);

  if (visualTracks.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted">
        <p className="text-sm">No tracks with visual instruments</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <VisualView tracks={visualTracks} rootScenes={sceneTrackIds} />
    </div>
  );
}

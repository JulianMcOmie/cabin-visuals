'use client';

import { OrbitControls } from '@react-three/drei';
import { VisualTrackInfo } from './VisualView';
import { TrackRenderer } from './TrackRenderer';
import { VisualBeatSync } from './VisualBeatSync';
import { useProjectStore } from '@daw/stores/projectStore';
import { useMemo } from 'react';
import { PluginInstance } from '@daw/core/types';

interface VisualSceneProps {
  tracks: VisualTrackInfo[];
}

export function VisualScene({ tracks }: VisualSceneProps) {
  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks]);
  const hasCameraTrack = useMemo(() => tracks.some((t) => t.instrumentId === 'cameraControl'), [tracks]);

  // Read the full tracks record once (stable ref from store)
  const storeTracks = useProjectStore((s) => s.project.tracks);

  // Derive plugins from the stable store reference
  const pluginsByTrack = useMemo(() => {
    const result: Record<string, PluginInstance[]> = {};
    for (const id of trackIds) {
      result[id] = storeTracks[id]?.visualPlugins ?? [];
    }
    return result;
  }, [storeTracks, trackIds]);

  return (
    <>
      {/* Compute visual state before instruments read it */}
      <VisualBeatSync />

      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} />
      <pointLight position={[-5, 5, -5]} intensity={0.5} color="#8b5cf6" />

      {/* Camera controls — disabled when Camera instrument is active */}
      {!hasCameraTrack && (
        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={3}
          maxDistance={15}
          autoRotate={false}
        />
      )}

      {/* Render visual instruments through plugin chain */}
      {tracks.map((track) => (
        <TrackRenderer
          key={track.id}
          trackId={track.id}
          instrumentId={track.instrumentId}
          plugins={pluginsByTrack[track.id] ?? []}
          isGroup={track.isGroup}
          childIds={track.childIds}
        />
      ))}
    </>
  );
}

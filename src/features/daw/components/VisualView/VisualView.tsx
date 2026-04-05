'use client';

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { VisualScene } from './VisualScene';
import { SceneCompositor } from './SceneCompositor';
import { ExportController } from '../ExportController';
import { getInstrument } from '@daw/instruments';

export interface VisualTrackInfo {
  id: string;
  instrumentId: string;
  isGroup?: boolean;
  childIds?: string[];
  sceneId?: string;
}

interface VisualViewProps {
  tracks: VisualTrackInfo[];
  rootScenes?: string[];
}

const EMPTY_ROOT_SCENES: string[] = [];

export function VisualView({ tracks, rootScenes = EMPTY_ROOT_SCENES }: VisualViewProps) {
  const shouldDisableBloom = useMemo(
    () => tracks.some((t) => getInstrument(t.instrumentId)?.disableBloom),
    [tracks],
  );

  // Check if any track uses the master channel (always true for new projects)
  const hasMasterTrack = useMemo(
    () => tracks.some((t) => t.instrumentId === 'masterChannel'),
    [tracks],
  );
  const hasScenes = rootScenes.length > 0;
  // Always use compositor when master track exists (for post-processing) or when scenes exist
  const useCompositor = hasScenes || hasMasterTrack;

  return (
    <div className="w-full h-full bg-black/90">
      <Canvas
        camera={{ position: [0, 0, 8], fov: 50 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#0a0a0f']} />
        <fog attach="fog" args={['#0a0a0f', 10, 30]} />
        <ExportController />

        {useCompositor ? (
          <SceneCompositor allTracks={tracks} rootScenes={rootScenes} />
        ) : (
          <VisualScene tracks={tracks} />
        )}

        {!shouldDisableBloom && (
          <EffectComposer multisampling={0}>
            <Bloom
              intensity={1.5}
              luminanceThreshold={0.2}
              luminanceSmoothing={0.9}
              mipmapBlur
            />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}

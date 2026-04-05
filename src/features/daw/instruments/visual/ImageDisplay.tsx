'use client';

import { useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { getImageFile } from '@daw/services/imageStorage';
import { Instrument } from '../types';

const DEFAULTS = {
  imageStorageId: '',
  x: 0,
  y: 0,
  scale: 1,
  opacity: 1,
};

function ImageDisplayVisual({ trackId }: { trackId: string }) {
  const engineRef = useRef(getVisualPlaybackEngine());
  const meshRef = useRef<THREE.Mesh>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const loadedIdRef = useRef<string>('');
  const aspectRef = useRef(1);
  const { viewport } = useThree();
  const [ready, setReady] = useState(false);

  // Load image from IndexedDB when imageStorageId changes
  useFrame(() => {
    const state = engineRef.current.getTrackState(trackId);
    if (!state || !meshRef.current) return;

    const imageStorageId = (state.params.imageStorageId as string) ?? DEFAULTS.imageStorageId;
    const x = (state.params.x as number) ?? DEFAULTS.x;
    const y = (state.params.y as number) ?? DEFAULTS.y;
    const scale = (state.params.scale as number) ?? DEFAULTS.scale;
    const opacity = (state.params.opacity as number) ?? DEFAULTS.opacity;

    // Load texture if imageStorageId changed
    if (imageStorageId && imageStorageId !== loadedIdRef.current) {
      loadedIdRef.current = imageStorageId;
      getImageFile(imageStorageId).then((file) => {
        if (!file) return;

        // Revoke old blob URL
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
        }

        const url = URL.createObjectURL(file.blob);
        blobUrlRef.current = url;
        aspectRef.current = file.width / file.height;

        const loader = new THREE.TextureLoader();
        loader.load(url, (tex) => {
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;

          // Dispose old texture
          if (textureRef.current) {
            textureRef.current.dispose();
          }
          textureRef.current = tex;

          if (meshRef.current) {
            (meshRef.current.material as THREE.MeshBasicMaterial).map = tex;
            (meshRef.current.material as THREE.MeshBasicMaterial).needsUpdate = true;
          }
          setReady(true);
        });
      });
    }

    // Apply position and scale BEFORE setting visibility so the mesh is
    // already at the correct location on the frame it first appears.
    const baseScale = Math.min(viewport.width, viewport.height) * 0.5 * scale;
    meshRef.current.scale.set(baseScale * aspectRef.current, baseScale, 1);
    meshRef.current.position.set(x * viewport.width * 0.5, y * viewport.height * 0.5, 0);

    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = opacity;

    // Visibility based on active notes (set AFTER transforms are applied)
    const isVisible = state.activeNotes.size > 0;
    meshRef.current.visible = isVisible && ready;
  });

  // Cleanup
  useEffect(() => {
    return () => {
      if (textureRef.current) textureRef.current.dispose();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  return (
    <mesh ref={meshRef} visible={false}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial transparent depthWrite={false} />
    </mesh>
  );
}

export const ImageDisplay: Instrument = {
  id: 'imageDisplay',
  name: 'Image Display',
  description: 'Displays an image on the visual canvas, visible when MIDI notes are active',
  icon: '🖼',
  color: '#88aacc',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',
  noteRange: { min: 48, max: 72 },

  defaultSettings: { ...DEFAULTS },

  settingsSchema: {
    x: {
      type: 'number', label: 'X Position', min: -1, max: 1, step: 0.05,
      default: DEFAULTS.x,
    },
    y: {
      type: 'number', label: 'Y Position', min: -1, max: 1, step: 0.05,
      default: DEFAULTS.y,
    },
    scale: {
      type: 'number', label: 'Scale', min: 0.1, max: 5, step: 0.1,
      default: DEFAULTS.scale,
    },
    opacity: {
      type: 'number', label: 'Opacity', min: 0, max: 1, step: 0.05,
      default: DEFAULTS.opacity,
    },
  },

  VisualComponent: ImageDisplayVisual,
};

'use client';

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { Instrument } from '../types';

const DEFAULTS = {
  posX: 0,
  posY: 0,
  posZ: 8,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  fov: 50,
};

function CameraControlVisual({ trackId }: { trackId: string }) {
  const engineRef = useRef(getVisualPlaybackEngine());
  const { camera } = useThree();

  useFrame(() => {
    const state = engineRef.current.getTrackState(trackId);
    if (!state) return;

    const posX = (state.params.posX as number) ?? DEFAULTS.posX;
    const posY = (state.params.posY as number) ?? DEFAULTS.posY;
    const posZ = (state.params.posZ as number) ?? DEFAULTS.posZ;
    const rotX = (state.params.rotX as number) ?? DEFAULTS.rotX;
    const rotY = (state.params.rotY as number) ?? DEFAULTS.rotY;
    const rotZ = (state.params.rotZ as number) ?? DEFAULTS.rotZ;
    const fov = (state.params.fov as number) ?? DEFAULTS.fov;

    camera.position.set(posX, posY, posZ);
    camera.rotation.set(
      rotX * (Math.PI / 180),
      rotY * (Math.PI / 180),
      rotZ * (Math.PI / 180),
    );

    if (camera instanceof THREE.PerspectiveCamera && camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

export const CameraControl: Instrument = {
  id: 'cameraControl',
  name: 'Camera',
  description: 'Control camera position, rotation, and FOV — add automation tracks to animate',
  icon: '🎥',
  color: '#f59e0b',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',
  singleton: true,

  noteRange: { min: 0, max: 0 },

  defaultSettings: { ...DEFAULTS },

  settingsSchema: {
    posX: { type: 'number', label: 'Position X', min: -50, max: 50, step: 0.5, default: DEFAULTS.posX },
    posY: { type: 'number', label: 'Position Y', min: -50, max: 50, step: 0.5, default: DEFAULTS.posY },
    posZ: { type: 'number', label: 'Position Z', min: -50, max: 50, step: 0.5, default: DEFAULTS.posZ },
    rotX: { type: 'number', label: 'Rotation X', min: -180, max: 180, step: 5, default: DEFAULTS.rotX },
    rotY: { type: 'number', label: 'Rotation Y', min: -180, max: 180, step: 5, default: DEFAULTS.rotY },
    rotZ: { type: 'number', label: 'Rotation Z', min: -180, max: 180, step: 5, default: DEFAULTS.rotZ },
    fov:  { type: 'number', label: 'Field of View', min: 10, max: 120, step: 5, default: DEFAULTS.fov },
  },

  VisualComponent: CameraControlVisual,
};

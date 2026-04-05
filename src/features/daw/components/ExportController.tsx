'use client';

import { RootState, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';

/**
 * Shared store for R3F internals that the export engine needs access to.
 * R3F state is only available inside the Canvas tree, so this component
 * exposes it to the outside world via a module-level ref.
 */

export interface R3FExportHandle {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  advance: (timestamp: number) => void;
  setFrameloop: (mode: 'always' | 'never') => void;
  setSize: (width: number, height: number) => void;
  getSize: () => { width: number; height: number };
  getPixelRatio: () => number;
  setPixelRatio: (dpr: number) => void;
  canvas: HTMLCanvasElement;
}

let exportHandle: R3FExportHandle | null = null;

export function getExportHandle(): R3FExportHandle | null {
  return exportHandle;
}

/**
 * Place this component inside the R3F <Canvas> tree.
 * It captures the renderer, scene, camera, and advance function
 * so the export engine can drive rendering from outside React.
 */
export function ExportController() {
  const { gl, scene, camera, advance } = useThree();
  const rootState = useThree((s) => s);

  useEffect(() => {
    const canvas = gl.domElement;
    exportHandle = {
      gl,
      scene,
      camera,
      advance: (timestamp: number) => {
        // R3F's advance() triggers all useFrame callbacks and renders
        advance(timestamp / 1000); // advance expects seconds
      },
      setFrameloop: (mode: 'always' | 'never') => {
        rootState.set({ frameloop: mode });
      },
      setSize: (width: number, height: number) => {
        // Resize the WebGL buffer (false = don't touch CSS styles)
        gl.setSize(width, height, false);
        // Update camera aspect ratio
        if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
          (camera as THREE.PerspectiveCamera).aspect = width / height;
          (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
        }
        // Update R3F's internal size state — this propagates to EffectComposer
        // and any other component subscribed to size via useThree
        rootState.setSize(width, height);
      },
      getSize: () => {
        return { width: rootState.size.width, height: rootState.size.height };
      },
      getPixelRatio: () => gl.getPixelRatio(),
      setPixelRatio: (dpr: number) => {
        gl.setPixelRatio(dpr);
        rootState.setDpr(dpr);
      },
      canvas,
    };

    return () => {
      exportHandle = null;
    };
  }, [gl, scene, camera, advance, rootState]);

  return null;
}

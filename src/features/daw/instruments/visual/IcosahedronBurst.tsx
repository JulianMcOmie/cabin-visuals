'use client';

import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { Instrument } from '../types';

interface Props {
  trackId: string;
}

interface Shell {
  lineSegments: THREE.LineSegments;
  material: THREE.LineBasicMaterial;
  age: number;
  hue: number;
}

// Shared edge geometry (unit icosahedron) — created once, reused for all shells
let sharedEdgeGeometry: THREE.BufferGeometry | null = null;

function getEdgeGeometry(): THREE.BufferGeometry {
  if (!sharedEdgeGeometry) {
    sharedEdgeGeometry = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1));
  }
  return sharedEdgeGeometry;
}

const _tmpColor = new THREE.Color();
let hueCounter = 0;

function IcosahedronBurstVisual({ trackId }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const engineRef = useRef(getVisualPlaybackEngine());
  const shellsRef = useRef<Shell[]>([]);
  const lastCountRef = useRef(0);

  // Cleanup on unmount
  useEffect(() => () => {
    const g = groupRef.current;
    if (g) {
      for (const s of shellsRef.current) {
        g.remove(s.lineSegments);
        s.material.dispose();
      }
    }
    shellsRef.current = [];
  }, []);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const vs = engineRef.current.getTrackState(trackId);
    if (!vs) return;

    const par = vs.params;
    const startSize      = (par.startSize as number)      ?? 0.15;
    const expansionSpeed = (par.expansionSpeed as number)  ?? 4;
    const maxSize        = (par.maxSize as number)         ?? 6;
    const fadeStart      = (par.fadeStart as number)       ?? 0.5;
    const hueStep        = (par.hueStep as number)        ?? 0.08;
    const baseHue        = (par.baseHue as number)        ?? 0.55;
    const saturation     = (par.saturation as number)     ?? 0.9;
    const lightness      = (par.lightness as number)      ?? 0.6;

    // Spawn shells on new MIDI notes (clamp to max 3 per frame for scrub safety)
    const rawDelta = vs.noteOnCount - lastCountRef.current;
    lastCountRef.current = vs.noteOnCount;

    if (rawDelta > 0) {
      const newNotes = Math.min(rawDelta, 3);

      for (let i = 0; i < newNotes; i++) {
        const hue = (baseHue + hueCounter * hueStep) % 1;
        hueCounter++;

        const material = new THREE.LineBasicMaterial({
          color: _tmpColor.setHSL(hue, saturation, lightness).getHex(),
          transparent: true,
          opacity: 1,
          depthWrite: false,
        });
        material.blending = THREE.AdditiveBlending;

        const lineSegments = new THREE.LineSegments(getEdgeGeometry(), material);
        lineSegments.scale.setScalar(startSize);
        group.add(lineSegments);

        shellsRef.current.push({ lineSegments, material, age: 0, hue });
      }
    }

    // Update shells
    const dead: Shell[] = [];

    for (const shell of shellsRef.current) {
      shell.age += delta;
      const size = startSize + shell.age * expansionSpeed;

      if (size >= maxSize) {
        dead.push(shell);
        continue;
      }

      shell.lineSegments.scale.setScalar(size);

      // Fade out after fadeStart fraction of maxSize
      const fadeThreshold = maxSize * fadeStart;
      if (size > fadeThreshold) {
        shell.material.opacity = 1 - (size - fadeThreshold) / (maxSize - fadeThreshold);
      } else {
        shell.material.opacity = 1;
      }
    }

    // Remove dead shells
    for (const shell of dead) {
      group.remove(shell.lineSegments);
      shell.material.dispose();
    }
    if (dead.length > 0) {
      shellsRef.current = shellsRef.current.filter(s => !dead.includes(s));
    }
  });

  return <group ref={groupRef} />;
}

export const IcosahedronBurst: Instrument = {
  id: 'icosahedronBurst',
  name: 'Icosahedron Burst',
  description: 'Nested icosahedron wireframes spawn on MIDI and expand outward',
  icon: '💎',
  color: '#06b6d4',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',

  defaultSettings: {
    startSize: 0.15,
    expansionSpeed: 4,
    maxSize: 6,
    fadeStart: 0.5,
    hueStep: 0.08,
    baseHue: 0.55,
    saturation: 0.9,
    lightness: 0.6,
  },

  settingsSchema: {
    startSize:      { type: 'number', label: 'Start Size',       min: 0.05, max: 1,   step: 0.05, default: 0.15 },
    expansionSpeed: { type: 'number', label: 'Expansion Speed',  min: 0.5,  max: 15,  step: 0.5,  default: 4 },
    maxSize:        { type: 'number', label: 'Max Size',         min: 2,    max: 20,  step: 0.5,  default: 6 },
    fadeStart:      { type: 'number', label: 'Fade Start',       min: 0.1,  max: 0.9, step: 0.05, default: 0.5 },
    hueStep:        { type: 'number', label: 'Hue Step',         min: 0,    max: 0.5, step: 0.01, default: 0.08 },
    baseHue:        { type: 'number', label: 'Base Hue',         min: 0,    max: 1,   step: 0.05, default: 0.55 },
    saturation:     { type: 'number', label: 'Saturation',       min: 0,    max: 1,   step: 0.05, default: 0.9 },
    lightness:      { type: 'number', label: 'Lightness',        min: 0.1,  max: 1,   step: 0.05, default: 0.6 },
  },

  VisualComponent: IcosahedronBurstVisual,
};

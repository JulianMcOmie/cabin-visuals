'use client';

import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore } from '@daw/stores/projectStore';
import { Instrument } from '../types';

interface Props {
  trackId: string;
}

// --- Cylinder geometry cache ---
// Key: "segments_openEnded" — all cylinders are unit-sized, scaled via mesh.scale
const cylinderGeoCache = new Map<string, THREE.CylinderGeometry>();

function getCylinderGeometry(radialSegments: number, openEnded: boolean): THREE.CylinderGeometry {
  const key = `${radialSegments}_${openEnded ? 1 : 0}`;
  let geo = cylinderGeoCache.get(key);
  if (geo) return geo;

  // Unit cylinder: radius 1, height 1, centered at origin
  geo = new THREE.CylinderGeometry(1, 1, 1, radialSegments, 1, openEnded);
  cylinderGeoCache.set(key, geo);
  return geo;
}

// --- Pooled Mesh ---

interface PooledMesh {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  active: boolean;
}

const _tmpColor = new THREE.Color();

function CylinderFlightVisual({ trackId }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const engineRef = useRef(getVisualPlaybackEngine());
  const poolRef = useRef<PooledMesh[]>([]);
  const lastTimeRef = useRef(0);

  // Cleanup on unmount
  useEffect(() => () => {
    const g = groupRef.current;
    if (g) {
      for (const p of poolRef.current) {
        g.remove(p.mesh);
        p.material.dispose();
      }
    }
    poolRef.current = [];
  }, []);

  function acquireMesh(group: THREE.Group): PooledMesh {
    for (const p of poolRef.current) {
      if (!p.active) {
        p.active = true;
        p.mesh.visible = true;
        return p;
      }
    }
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.blending = THREE.AdditiveBlending;
    material.fog = false;
    const mesh = new THREE.Mesh(getCylinderGeometry(16, false), material);
    // Rotate so cylinder axis points along Z (toward camera)
    mesh.rotation.x = Math.PI / 2;
    group.add(mesh);
    const entry: PooledMesh = { mesh, material, active: true };
    poolRef.current.push(entry);
    return entry;
  }

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const engine = engineRef.current;
    const vs = engine.getTrackState(trackId);
    if (!vs) return;

    const events = engine.getTrackEvents(trackId);
    if (!events || events.length === 0) return;

    const par = vs.params;
    const speed          = (par.speed as number)          ?? 10;
    const spread         = (par.spread as number)         ?? 0;
    const farZ           = (par.farZ as number)           ?? 40;
    const baseRadius     = (par.baseRadius as number)     ?? 0.6;
    const radiusStep     = (par.radiusStep as number)     ?? 0.1;
    const baseHeight     = (par.baseHeight as number)     ?? 1.0;
    const heightStep     = (par.heightStep as number)     ?? 0.15;
    const hueStep        = (par.hueStep as number)        ?? 0.07;
    const baseHue        = (par.baseHue as number)        ?? 0.0;
    const saturation     = (par.saturation as number)     ?? 0.8;
    const lightness      = (par.lightness as number)      ?? 0.7;
    const rotationSpeed  = (par.rotationSpeed as number)  ?? 0.4;
    const tiltAmount     = (par.tiltAmount as number)     ?? 0.8;
    const shapePitch     = (par.shapePitch as number)     ?? 48;
    const fadeOutZ       = (par.fadeOutZ as number)       ?? 15;
    const segments       = (par.segments as number)       ?? 16;

    const currentBeat = useUIStore.getState().currentBeat;
    const bpm = useProjectStore.getState().project.bpm;
    const secPerBeat = 60 / bpm;

    lastTimeRef.current += delta;
    const time = lastTimeRef.current;

    // Mark all inactive
    for (const p of poolRef.current) {
      p.active = false;
      p.mesh.visible = false;
    }

    let shapeIndex = 0;
    for (let ei = 0; ei < events.length; ei++) {
      const ev = events[ei];
      if (ev.pitch < shapePitch) continue;

      // Pitch maps to number of radial segments for the cylinder
      const pitchSegments = Math.min(Math.max(segments + (ev.pitch - shapePitch), 4), 64);

      // Continuous evolution of radius and height
      const radius = baseRadius + (shapeIndex * radiusStep) % 1.5;
      const height = baseHeight + (shapeIndex * heightStep) % 2.0;

      // Position from beat math
      const beatsAgo = currentBeat - ev.startTimeInBeats;
      const secondsAgo = beatsAgo * secPerBeat;
      const z = secondsAgo * speed;

      shapeIndex++;

      if (z < -farZ || z > fadeOutZ) continue;

      const pooled = acquireMesh(group);

      // Set geometry (closed ends — solid cylinders)
      const geo = getCylinderGeometry(pitchSegments, false);
      pooled.mesh.geometry = geo;

      // Deterministic spread
      const spreadX = spread > 0 ? (Math.sin(ei * 7.31 + 0.5) * spread) : 0;
      const spreadY = spread > 0 ? (Math.cos(ei * 13.17 + 0.3) * spread) : 0;
      pooled.mesh.position.set(spreadX, spreadY, z);

      // Scale: radius on x/z, height on y
      const progress = 1 - Math.max(0, -z) / farZ;
      const scaleFactor = 0.5 + progress * 1.5;
      pooled.mesh.scale.set(radius * scaleFactor, height * scaleFactor, radius * scaleFactor);

      // Rotation: base PI/2 on X so cylinder faces camera, then tilt + spin on top
      const tiltX = Math.sin(ei * 3.47) * tiltAmount;
      const tiltY = Math.cos(ei * 5.13) * tiltAmount;
      pooled.mesh.rotation.set(
        Math.PI / 2 + tiltX + time * rotationSpeed * 0.3,
        tiltY + time * rotationSpeed,
        ei * 0.5 + time * rotationSpeed * 0.5,
      );

      // Color
      const hue = (baseHue + shapeIndex * hueStep) % 1;
      _tmpColor.setHSL(hue, saturation, lightness);
      pooled.material.color.copy(_tmpColor);

      // Opacity
      if (z > 0) {
        pooled.material.opacity = Math.max(0, 1 - z / fadeOutZ);
      } else {
        pooled.material.opacity = 1;
      }
    }
  });

  return <group ref={groupRef} />;
}

export const CylinderFlight: Instrument = {
  id: 'cylinderFlight',
  name: 'Cylinder Flight',
  description: 'Interlocked wireframe cylinders fly toward the camera — scrubbable',
  icon: '🛢️',
  color: '#ec4899',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',

  defaultSettings: {
    speed: 10,
    spread: 1,
    farZ: 40,
    baseRadius: 0.6,
    radiusStep: 0.1,
    baseHeight: 1.0,
    heightStep: 0.15,
    rotationSpeed: 0.4,
    tiltAmount: 0.8,
    hueStep: 0.07,
    baseHue: 0.0,
    saturation: 0.8,
    lightness: 0.7,
    shapePitch: 48,
    fadeOutZ: 15,
    segments: 16,
  },

  settingsSchema: {
    speed:         { type: 'number', label: 'Flight Speed',      min: 2,    max: 40,   step: 1,     default: 10 },
    spread:        { type: 'number', label: 'Spread',            min: 0,    max: 10,   step: 0.5,   default: 1 },
    farZ:          { type: 'number', label: 'Spawn Depth',       min: 10,   max: 100,  step: 5,     default: 40 },
    baseRadius:    { type: 'number', label: 'Base Radius',       min: 0.1,  max: 3,    step: 0.1,   default: 0.6 },
    radiusStep:    { type: 'number', label: 'Radius Step',       min: 0,    max: 0.5,  step: 0.01,  default: 0.1 },
    baseHeight:    { type: 'number', label: 'Base Height',       min: 0.2,  max: 5,    step: 0.1,   default: 1.0 },
    heightStep:    { type: 'number', label: 'Height Step',       min: 0,    max: 0.5,  step: 0.01,  default: 0.15 },
    rotationSpeed: { type: 'number', label: 'Rotation Speed',    min: 0,    max: 3,    step: 0.1,   default: 0.4 },
    tiltAmount:    { type: 'number', label: 'Tilt Amount',       min: 0,    max: 2,    step: 0.1,   default: 0.8 },
    hueStep:       { type: 'number', label: 'Hue Step',          min: 0,    max: 0.5,  step: 0.01,  default: 0.07 },
    baseHue:       { type: 'number', label: 'Base Hue',          min: 0,    max: 1,    step: 0.05,  default: 0.0 },
    saturation:    { type: 'number', label: 'Saturation',        min: 0,    max: 1,    step: 0.05,  default: 0.8 },
    lightness:     { type: 'number', label: 'Lightness',         min: 0.1,  max: 1,    step: 0.05,  default: 0.7 },
    shapePitch:    { type: 'number', label: 'Shape Base Pitch',  min: 24,   max: 72,   step: 1,     default: 48 },
    fadeOutZ:      { type: 'number', label: 'Fade Out Distance', min: 5,    max: 30,   step: 1,     default: 15 },
    segments:      { type: 'number', label: 'Base Segments',     min: 3,    max: 32,   step: 1,     default: 16 },
  },

  VisualComponent: CylinderFlightVisual,
};

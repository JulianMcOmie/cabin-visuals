'use client';

import { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { useUIStore } from '@daw/stores/uiStore';
import { Instrument } from '../types';

// ── Pitch range (same as WindowsXP icon range) ─────────────────────────────

const PITCH_MIN = 60; // C4
const PITCH_MAX = 71; // B4

// ── Canvas rounded-rect helper (no native roundRect dependency) ─────────────

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  rtl: number, rtr: number, rbr: number, rbl: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + rtl, y);
  ctx.lineTo(x + w - rtr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rtr);
  ctx.lineTo(x + w, y + h - rbr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rbr, y + h);
  ctx.lineTo(x + rbl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rbl);
  ctx.lineTo(x, y + rtl);
  ctx.quadraticCurveTo(x, y, x + rtl, y);
  ctx.closePath();
}

// ── Folder icon texture (pre-rendered once) ─────────────────────────────────

let _folderTexture: THREE.CanvasTexture | null = null;

function getFolderTexture(): THREE.CanvasTexture {
  if (_folderTexture) return _folderTexture;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const sc = size / 32;
  ctx.save();
  ctx.scale(sc, sc);

  // Folder tab
  ctx.fillStyle = '#F7D774';
  ctx.strokeStyle = '#D4A840';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(4, 10);
  ctx.lineTo(14, 10);
  ctx.lineTo(16, 7);
  ctx.lineTo(4, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Folder body
  ctx.fillStyle = '#F7D774';
  ctx.strokeStyle = '#D4A840';
  roundedRect(ctx, 4, 10, 24, 16, 1, 1, 1, 1);
  ctx.fill();
  ctx.stroke();

  // Subtle front highlight
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  roundedRect(ctx, 4, 10, 24, 8, 1, 1, 0, 0);
  ctx.fill();

  ctx.restore();

  _folderTexture = new THREE.CanvasTexture(canvas);
  _folderTexture.minFilter = THREE.LinearFilter;
  _folderTexture.magFilter = THREE.LinearFilter;
  return _folderTexture;
}

// ── Sprite pool ─────────────────────────────────────────────────────────────

interface FolderSprite {
  mesh: THREE.Mesh;
  birthTime: number;
  vx: number;
  vy: number;
  tumbleX: number;
  tumbleY: number;
  targetScale: number;
  pitch: number;
}

const MAX_SPRITES = 512;
const _tmpColor = new THREE.Color();

// ── Visual component ────────────────────────────────────────────────────────

interface Props {
  trackId: string;
}

function FolderFlightVisual({ trackId }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const engineRef = useRef(getVisualPlaybackEngine());
  const spritesRef = useRef<FolderSprite[]>([]);
  const lastSubdivRef = useRef(-1);
  const geoRef = useRef<THREE.PlaneGeometry | null>(null);
  const { camera } = useThree();
  // Legato glide: smooth Y per pitch
  const targetYRef = useRef(new Map<number, number>());
  const currentYRef = useRef(new Map<number, number>());

  // Shared geometry for all folder quads
  useEffect(() => {
    geoRef.current = new THREE.PlaneGeometry(1, 1);
    return () => {
      geoRef.current?.dispose();
      geoRef.current = null;
      // Dispose all active sprites
      for (const spr of spritesRef.current) {
        spr.mesh.geometry.dispose();
        (spr.mesh.material as THREE.Material).dispose();
      }
      spritesRef.current = [];
    };
  }, []);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const engine = engineRef.current;
    const vs = engine.getTrackState(trackId);
    if (!vs) return;

    const par = vs.params;
    const speed = (par.speed as number) ?? 15;
    const iconScale = (par.iconScale as number) ?? 2;
    const opacity = (par.opacity as number) ?? 1;
    const maxDepth = (par.maxDepth as number) ?? 50;
    const subdivRate = (par.subdivRate as number) ?? 8;
    const ySpread = (par.ySpread as number) ?? 4;
    const drift = (par.drift as number) ?? 0.5;
    const tumble = (par.tumble as number) ?? 1;
    const glideTime = (par.glideTime as number) ?? 0.5;

    const currentBeat = useUIStore.getState().currentBeat;
    const subdiv = Math.floor(currentBeat * subdivRate);

    // ── Legato glide: lerp currentY toward targetY per pitch ──
    const glideAlpha = glideTime > 0 ? 1 - Math.exp(-delta / (glideTime * 0.2)) : 1;
    for (let pitch = PITCH_MIN; pitch <= PITCH_MAX; pitch++) {
      const target = targetYRef.current.get(pitch);
      if (target === undefined) continue;
      const cur = currentYRef.current.get(pitch) ?? target;
      currentYRef.current.set(pitch, cur + (target - cur) * glideAlpha);
    }

    // ── Update target Y for any active notes ──
    for (let pitch = PITCH_MIN; pitch <= PITCH_MAX; pitch++) {
      if (vs.activeNotes.has(pitch)) {
        const pitchNorm = (pitch - PITCH_MIN) / Math.max(1, PITCH_MAX - PITCH_MIN);
        const newTarget = (pitchNorm - 0.5) * ySpread;
        targetYRef.current.set(pitch, newTarget);
        // Initialize currentY on first note-on
        if (!currentYRef.current.has(pitch)) {
          currentYRef.current.set(pitch, newTarget);
        }
      }
    }

    // ── Spawn new folders while notes are held ──
    if (subdiv !== lastSubdivRef.current) {
      lastSubdivRef.current = subdiv;
      for (let pitch = PITCH_MIN; pitch <= PITCH_MAX; pitch++) {
        if (vs.activeNotes.has(pitch)) {
          if (spritesRef.current.length >= MAX_SPRITES) break;

          // Use glided Y position
          const spawnY = currentYRef.current.get(pitch) ?? 0;

          const texture = getFolderTexture();
          const mat = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity,
            side: THREE.DoubleSide,
            depthWrite: false,
            toneMapped: false,
          });
          const mesh = new THREE.Mesh(geoRef.current!.clone(), mat);

          // Start a few units in front of the camera
          mesh.position.set(0, spawnY, -5);
          mesh.scale.setScalar(0.01); // will spring up
          group.add(mesh);

          const seed = subdiv * 13 + pitch * 7;
          const pseudoRand = (n: number) => {
            const x = Math.sin(n * 9301 + 49297) * 233280;
            return x - Math.floor(x);
          };

          spritesRef.current.push({
            mesh,
            birthTime: currentBeat,
            vx: (pseudoRand(seed) - 0.5) * drift,
            vy: (pseudoRand(seed + 1) - 0.5) * drift * 0.6,
            tumbleX: (pseudoRand(seed + 2) - 0.5) * tumble,
            tumbleY: (pseudoRand(seed + 3) - 0.5) * tumble,
            targetScale: iconScale,
            pitch,
          });
        }
      }
    }

    // ── Update existing sprites ──
    const dt = Math.min(delta, 0.05); // cap to avoid jumps
    const toRemove: number[] = [];

    for (let i = 0; i < spritesRef.current.length; i++) {
      const spr = spritesRef.current[i];
      const mesh = spr.mesh;

      // Fly backward into z-depth
      mesh.position.z -= speed * dt;

      // Drift in x/y as they fly away
      mesh.position.x += spr.vx * dt;
      mesh.position.y += spr.vy * dt;

      // Tumble rotation
      mesh.rotation.x += spr.tumbleX * dt;
      mesh.rotation.y += spr.tumbleY * dt;

      // Spring scale animation (quick pop-in)
      const age = (currentBeat - spr.birthTime) * 0.5; // in ~seconds approximation
      const springProgress = Math.min(age * 8, 1);
      const spring = 1 - Math.pow(1 - springProgress, 3); // ease out cubic
      const currentScale = spr.targetScale * spring;
      mesh.scale.setScalar(currentScale);

      // Fade out near max depth
      const depth = -mesh.position.z;
      const fadeStart = maxDepth * 0.7;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (depth > fadeStart) {
        mat.opacity = opacity * Math.max(0, 1 - (depth - fadeStart) / (maxDepth - fadeStart));
      } else {
        mat.opacity = opacity;
      }

      // Cull
      if (depth > maxDepth) {
        toRemove.push(i);
      }
    }

    // Remove culled sprites (reverse order to keep indices stable)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      const spr = spritesRef.current[idx];
      group.remove(spr.mesh);
      spr.mesh.geometry.dispose();
      (spr.mesh.material as THREE.Material).dispose();
      spritesRef.current.splice(idx, 1);
    }
  });

  return <group ref={groupRef} />;
}

// ── Instrument export ───────────────────────────────────────────────────────

export const FolderFlight: Instrument = {
  id: 'folderFlight',
  name: 'Folder Flight',
  description: '3D folder icons fly backward into z-depth when MIDI notes are held',
  icon: '📁',
  color: '#F7D774',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',

  noteRange: { min: PITCH_MIN, max: PITCH_MAX },
  rangeLabels: [
    { startPitch: PITCH_MIN, endPitch: PITCH_MAX, label: 'Folders' },
  ],

  defaultSettings: {
    speed: 15,
    iconScale: 2,
    opacity: 1,
    maxDepth: 50,
    subdivRate: 8,
    ySpread: 4,
    drift: 0.5,
    tumble: 1,
    glideTime: 0.5,
  },

  settingsSchema: {
    speed:       { type: 'number', label: 'Flight Speed',     min: 2,    max: 60,   step: 1,    default: 15 },
    iconScale:   { type: 'number', label: 'Icon Scale',       min: 0.1,  max: 5,    step: 0.1,  default: 2 },
    opacity:     { type: 'number', label: 'Opacity',          min: 0,    max: 1,    step: 0.05, default: 1 },
    maxDepth:    { type: 'number', label: 'Max Depth',        min: 10,   max: 200,  step: 5,    default: 50 },
    subdivRate:  { type: 'number', label: 'Spawns per Beat',  min: 1,    max: 32,   step: 1,    default: 8 },
    ySpread:     { type: 'number', label: 'Y Spread',         min: 0,    max: 10,   step: 0.5,  default: 4 },
    drift:       { type: 'number', label: 'Drift',            min: 0,    max: 3,    step: 0.1,  default: 0.5 },
    tumble:      { type: 'number', label: 'Tumble',           min: 0,    max: 5,    step: 0.1,  default: 1 },
    glideTime:   { type: 'number', label: 'Glide Time (s)',   min: 0,    max: 2,    step: 0.05, default: 0.5 },
  },

  VisualComponent: FolderFlightVisual,
};

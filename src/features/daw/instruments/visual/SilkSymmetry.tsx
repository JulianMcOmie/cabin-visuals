'use client';

import { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useProjectStore } from '@daw/stores/projectStore';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { Instrument } from '../types';

interface SilkSymmetryProps {
  trackId: string;
}

interface Point {
  x: number;
  y: number;
  z: number;
}

interface Line {
  points: Point[];
  hue: number;
  opacity: number;
}

interface Oscillator {
  beatMultiple: number;
  baseAmp: number;
  freqModBeats: number;
  freqModAmp: number;
  ampModBeats: number;
  ampModAmp: number;
  phase: number;
}

const CONFIG = {
  symmetryFolds: 8,
  lineCount: 12,
  pointsPerLine: 200,
  globalSpeed: 0.3,
  morphSpeed: 0.15,
  metaDepth: 0.6,
  weaveFactor: 0.4,
  depthFactor: 0.6,
  glowIntensity: 0.7,
  baseHue: 0.6,
  hueRange: 0.3,
  roseK: 4,
  lissA: 3,
  lissB: 4,
};

function createOscillator(seed: number): Oscillator {
  const rand = (s: number) => Math.sin(s * 12.9898 + 78.233) * 0.5 + 0.5;
  return {
    beatMultiple: 0.25 + rand(seed) * 0.75,
    baseAmp: 0.3 + rand(seed + 1) * 0.4,
    freqModBeats: 2 + rand(seed + 2) * 6,
    freqModAmp: 0.1 + rand(seed + 3) * 0.2,
    ampModBeats: 4 + rand(seed + 4) * 8,
    ampModAmp: 0.1 + rand(seed + 5) * 0.15,
    phase: rand(seed + 6) * Math.PI * 2,
  };
}

function oscillate(osc: Oscillator, beats: number, speedMult: number = 1): number {
  const b = beats * speedMult;
  const freqMod = Math.sin((b / osc.freqModBeats) * Math.PI * 2 + osc.phase * 0.7) * osc.freqModAmp;
  const effectiveFreq = osc.beatMultiple + freqMod;
  const ampMod = Math.sin((b / osc.ampModBeats) * Math.PI * 2 + osc.phase * 1.3) * osc.ampModAmp;
  const effectiveAmp = Math.max(0, osc.baseAmp + ampMod);
  return Math.sin(b * effectiveFreq * Math.PI * 2 + osc.phase) * effectiveAmp;
}

function smoothRandom(seed: number, t: number, freq: number = 1): number {
  const phase1 = seed * 12.9898;
  const phase2 = seed * 78.233;
  const phase3 = seed * 43.758;
  return (
    Math.sin(t * freq * 0.7 + phase1) * 0.5 +
    Math.sin(t * freq * 1.1 + phase2) * 0.3 +
    Math.sin(t * freq * 1.7 + phase3) * 0.2
  );
}

function smoothField(x: number, y: number, z: number, t: number, seed: number): number {
  const p1 = seed * 12.9898 + 78.233;
  const p2 = seed * 43.758 + 94.673;
  const p3 = seed * 37.719 + 29.456;
  return (
    Math.sin(x * 2.1 + y * 1.7 + z * 0.9 + t * 0.3 + p1) +
    Math.sin(x * 1.3 + y * 2.3 + z * 1.1 + t * 0.23 + p2) * 0.7 +
    Math.sin(x * 3.1 + y * 0.7 + z * 2.1 + t * 0.17 + p3) * 0.5 +
    Math.sin(x * 0.9 + y * 1.1 + z * 3.3 + t * 0.13 + p1 + p2) * 0.3
  ) / 2.5;
}

interface GenerateParams {
  lineCount: number;
  pointsPerLine: number;
  globalSpeed: number;
  morphSpeed: number;
  metaDepth: number;
  weaveFactor: number;
  depthFactor: number;
  baseHue: number;
  hueRange: number;
  roseK: number;
  lissA: number;
  lissB: number;
}

function generateLines(
  beats: number,
  oscillators: Oscillator[],
  spiralDirection: number,
  genParams: GenerateParams
): Line[] {
  const lines: Line[] = [];
  const morphT = beats * genParams.morphSpeed;
  const speed = genParams.globalSpeed * spiralDirection;

  const weaveFactor = genParams.weaveFactor + oscillate(oscillators[0], beats, speed) * genParams.metaDepth * 0.3;
  const depthFactor = genParams.depthFactor + oscillate(oscillators[1], beats, speed) * genParams.metaDepth * 0.2;
  const hue = genParams.baseHue + oscillate(oscillators[3], beats, speed) * 0.15;
  const roseK = genParams.roseK + oscillate(oscillators[6], beats, speed) * 2;
  const lissA = genParams.lissA + oscillate(oscillators[7], beats, speed) * 1.5;
  const lissB = genParams.lissB + oscillate(oscillators[8], beats, speed) * 1.5;
  const spread = 0.5 + oscillate(oscillators[9], beats, speed) * 0.3;
  const startRadiusMod = oscillate(oscillators[10], beats, speed);
  const phaseShift = oscillate(oscillators[11], beats, speed) * Math.PI;

  for (let i = 0; i < genParams.lineCount; i++) {
    const points: Point[] = [];
    const lineIndex = i / genParams.lineCount;

    const angleOffset = smoothRandom(i * 100, morphT, 0.5) * spread;
    const startAngle = lineIndex * Math.PI * 2 + angleOffset + phaseShift * 0.1;
    const startRadius = 0.15 + smoothRandom(i * 200, morphT, 0.3) * 0.1 + startRadiusMod * 0.05;

    let x = Math.cos(startAngle) * startRadius;
    let y = Math.sin(startAngle) * startRadius;
    let z = smoothRandom(i * 300, morphT, 0.4) * 0.3;
    let vx = 0, vy = 0, vz = 0;

    const lineRoseK = roseK + smoothRandom(i * 400, morphT, 0.2) * 1.5;
    const lineLissA = lissA + smoothRandom(i * 500, morphT, 0.25) * 1.0;
    const lineLissB = lissB + smoothRandom(i * 600, morphT, 0.22) * 1.0;
    const lineLissPhase = smoothRandom(i * 700, morphT, 0.18) * Math.PI + phaseShift;

    for (let j = 0; j < genParams.pointsPerLine; j++) {
      const t = j / genParams.pointsPerLine;

      const roseAngle = Math.atan2(y, x);
      const roseInfluence = Math.sin(lineRoseK * roseAngle) * 0.3;

      const noiseScale = 2 + weaveFactor * 3;
      const nx = smoothField(x * noiseScale, y * noiseScale, z * noiseScale + t, morphT, i * 1000);
      const ny = smoothField(x * noiseScale + 50, y * noiseScale, z * noiseScale + t, morphT, i * 1000 + 1);
      const nz = smoothField(x * noiseScale, y * noiseScale + 50, z * noiseScale + t, morphT, i * 1000 + 2);

      const dist = Math.sqrt(x * x + y * y);
      const centerForce = Math.max(0, dist - 0.5) * 0.5;

      const lissForce = 0.3;
      const lissX = Math.sin(t * Math.PI * lineLissA + lineLissPhase) * lissForce * 0.01;
      const lissY = Math.cos(t * Math.PI * lineLissB) * lissForce * 0.01;

      vx += nx * weaveFactor * 0.02 + lissX - (x / (dist + 0.001)) * centerForce * 0.01
            + roseInfluence * (y / (dist + 0.001)) * 0.01;
      vy += ny * weaveFactor * 0.02 + lissY - (y / (dist + 0.001)) * centerForce * 0.01
            - roseInfluence * (x / (dist + 0.001)) * 0.01;
      vz += nz * weaveFactor * depthFactor * 0.015;

      vx *= 0.98;
      vy *= 0.98;
      vz *= 0.95;

      x += vx;
      y += vy;
      z += vz;
      z = Math.max(-1, Math.min(1, z));

      points.push({ x, y, z });
    }

    const lineHueOffset = smoothRandom(i * 800, morphT * 0.5, 0.1) * genParams.hueRange;
    const lineHue = hue + lineHueOffset;
    const lineOpacity = 0.35 + smoothRandom(i * 900, morphT * 0.3, 0.15) * 0.3;

    lines.push({ points, hue: lineHue, opacity: lineOpacity });
  }
  return lines;
}

function renderLines(
  ctx: CanvasRenderingContext2D,
  lines: Line[],
  width: number,
  height: number,
  rotation: number,
  scale: number,
  params: Record<string, unknown>
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const baseScaleVal = Math.min(width, height) * 0.4;
  const symmetryFolds = (params.symmetryFolds as number) ?? CONFIG.symmetryFolds;
  const glowIntensity = (params.glowIntensity as number) ?? CONFIG.glowIntensity;
  const depthFactor = (params.depthFactor as number) ?? CONFIG.depthFactor;

  ctx.globalCompositeOperation = 'lighter';

  for (const line of lines) {
    for (let fold = 0; fold < symmetryFolds; fold++) {
      const angle = (fold / symmetryFolds) * Math.PI * 2 + rotation;
      const mirror = fold % 2 === 1;

      ctx.beginPath();

      for (let i = 0; i < line.points.length; i++) {
        const point = line.points[i];
        let px = point.x;
        let py = point.y;

        if (mirror) px = -px;

        const rotatedX = px * Math.cos(angle) - py * Math.sin(angle);
        const rotatedY = px * Math.sin(angle) + py * Math.cos(angle);

        const depthScale = 1 + point.z * depthFactor * 0.3;
        const screenX = centerX + rotatedX * baseScaleVal * depthScale * scale;
        const screenY = centerY + rotatedY * baseScaleVal * depthScale * scale;

        if (i === 0) ctx.moveTo(screenX, screenY);
        else ctx.lineTo(screenX, screenY);
      }

      const avgZ = line.points.reduce((sum, p) => sum + p.z, 0) / line.points.length;
      const depthBrightness = 0.5 + (avgZ + 1) * 0.25;
      const lineHue = ((line.hue + fold * 0.015) % 1) * 360;
      const saturation = 70 + depthBrightness * 20;
      const lightness = 40 + depthBrightness * 30;

      const passes = [
        { width: 8 * glowIntensity, alpha: 0.03 * line.opacity },
        { width: 4 * glowIntensity, alpha: 0.08 * line.opacity },
        { width: 2 * glowIntensity, alpha: 0.15 * line.opacity },
        { width: 1, alpha: 0.4 * line.opacity },
      ];

      for (const pass of passes) {
        ctx.strokeStyle = `hsla(${lineHue}, ${saturation}%, ${lightness}%, ${pass.alpha})`;
        ctx.lineWidth = pass.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }
  }
}

function renderVignette(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(width, height) * 0.7;

  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  gradient.addColorStop(0, 'rgba(5, 5, 8, 0)');
  gradient.addColorStop(0.6, 'rgba(5, 5, 8, 0)');
  gradient.addColorStop(1, 'rgba(5, 5, 8, 0.8)');

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function SilkSymmetryVisual({ trackId }: SilkSymmetryProps) {
  const { viewport } = useThree();
  const bpm = useProjectStore((s) => s.project.bpm);
  const meshRef = useRef<THREE.Mesh>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const beatsRef = useRef(0);
  const engineRef = useRef(getVisualPlaybackEngine());

  const oscillators = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => createOscillator(i * 17.3));
  }, []);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    canvasRef.current = canvas;

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    textureRef.current = texture;

    return () => {
      texture.dispose();
    };
  }, []);

  useFrame((_, delta) => {
    const canvas = canvasRef.current;
    const texture = textureRef.current;
    const mesh = meshRef.current;
    if (!canvas || !texture || !mesh) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const state = engineRef.current.getTrackState(trackId);
    const params = state?.params ?? {};
    const hasActiveNotes = state ? state.activeNotes.size > 0 : false;
    const spiralDirection = hasActiveNotes ? -1 : 1;

    const beatsPerSecond = bpm / 60;
    beatsRef.current += delta * beatsPerSecond;

    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Build generation params from settings
    const genParams: GenerateParams = {
      lineCount: (params.lineCount as number) ?? CONFIG.lineCount,
      pointsPerLine: (params.pointsPerLine as number) ?? CONFIG.pointsPerLine,
      globalSpeed: (params.globalSpeed as number) ?? CONFIG.globalSpeed,
      morphSpeed: (params.morphSpeed as number) ?? CONFIG.morphSpeed,
      metaDepth: (params.metaDepth as number) ?? CONFIG.metaDepth,
      weaveFactor: (params.weaveFactor as number) ?? CONFIG.weaveFactor,
      depthFactor: (params.depthFactor as number) ?? CONFIG.depthFactor,
      baseHue: (params.baseHue as number) ?? CONFIG.baseHue,
      hueRange: (params.hueRange as number) ?? CONFIG.hueRange,
      roseK: (params.roseK as number) ?? CONFIG.roseK,
      lissA: (params.lissA as number) ?? CONFIG.lissA,
      lissB: (params.lissB as number) ?? CONFIG.lissB,
    };

    const rotation = beatsRef.current * 0.05 * spiralDirection;
    const lines = generateLines(beatsRef.current, oscillators, spiralDirection, genParams);
    renderLines(ctx, lines, canvas.width, canvas.height, rotation, 1.0, params);
    renderVignette(ctx, canvas.width, canvas.height);

    texture.needsUpdate = true;

    const material = mesh.material as THREE.MeshBasicMaterial;
    if (!material.map) {
      material.map = texture;
      material.needsUpdate = true;
    }
  });

  const planeSize = Math.max(viewport.width, viewport.height) * 1.5;

  return (
    <mesh ref={meshRef} position={[0, 0, -5]}>
      <planeGeometry args={[planeSize, planeSize]} />
      <meshBasicMaterial transparent opacity={1} depthWrite={false} />
    </mesh>
  );
}

// Unified Instrument definition
export const SilkSymmetry: Instrument = {
  id: 'silkSymmetry',
  name: 'Silk Symmetry',
  description: 'Flowing silk-like patterns with radial symmetry - MIDI inverts spiral direction',
  icon: '🌀',
  color: '#8b5cf6',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',

  defaultSettings: {
    symmetryFolds: 8,
    lineCount: 12,
    pointsPerLine: 200,
    globalSpeed: 0.3,
    morphSpeed: 0.15,
    metaDepth: 0.6,
    weaveFactor: 0.4,
    depthFactor: 0.6,
    glowIntensity: 0.7,
    baseHue: 0.6,
    hueRange: 0.3,
    roseK: 4,
    lissA: 3,
    lissB: 4,
  },

  settingsSchema: {
    symmetryFolds: { type: 'number', label: 'Symmetry', min: 2, max: 16, step: 1, default: 8 },
    lineCount: { type: 'number', label: 'Lines', min: 4, max: 24, step: 1, default: 12 },
    pointsPerLine: { type: 'number', label: 'Detail', min: 50, max: 400, step: 25, default: 200 },
    globalSpeed: { type: 'number', label: 'Speed', min: 0.1, max: 1, step: 0.05, default: 0.3 },
    morphSpeed: { type: 'number', label: 'Morph Speed', min: 0.05, max: 0.5, step: 0.05, default: 0.15 },
    metaDepth: { type: 'number', label: 'Meta Depth', min: 0, max: 1, step: 0.1, default: 0.6 },
    weaveFactor: { type: 'number', label: 'Weave', min: 0, max: 1, step: 0.1, default: 0.4 },
    depthFactor: { type: 'number', label: 'Depth', min: 0, max: 1, step: 0.1, default: 0.6 },
    glowIntensity: { type: 'number', label: 'Glow', min: 0, max: 1, step: 0.1, default: 0.7 },
    baseHue: { type: 'number', label: 'Base Hue', min: 0, max: 1, step: 0.05, default: 0.6 },
    hueRange: { type: 'number', label: 'Hue Range', min: 0, max: 0.5, step: 0.05, default: 0.3 },
    roseK: { type: 'number', label: 'Rose K', min: 1, max: 8, step: 0.5, default: 4 },
    lissA: { type: 'number', label: 'Lissajous A', min: 1, max: 8, step: 0.5, default: 3 },
    lissB: { type: 'number', label: 'Lissajous B', min: 1, max: 8, step: 0.5, default: 4 },
  },

  colorRoleMapping: [
    { role: 'primary', param: 'baseHue', type: 'hsl-hue' },
  ],

  VisualComponent: SilkSymmetryVisual,
};

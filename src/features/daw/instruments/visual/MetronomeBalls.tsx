'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { useProjectStore } from '@daw/stores/projectStore';
import { Instrument } from '../types';
import { virtualClock } from '@daw/core/virtualClock';
import {
  ManagedLineSet,
  ManagedDotSet,
  ManagedBlobPool,
  createDisplacementUniforms,
  createDisplacementMaterial,
  DisplacementUniforms,
} from '@daw/lib/three';

interface MetronomeBallsProps {
  trackId: string;
}

// Color palettes: [background, foreground, accent, glow, tertiary]
interface Palette { bg: number; fg: number; accent: number; glow: number; tertiary: number; invertFg?: number }

const PALETTES: Record<string, Palette> = {
  default:  { bg: 0xf5f2eb, fg: 0x1a2744, accent: 0xb5563e, glow: 0xb5563e, tertiary: 0x4a7a6f },
  sepia:    { bg: 0xe8dcc8, fg: 0x3b2612, accent: 0x8b5e34, glow: 0xc4883a, tertiary: 0x6b7f4a },
  midnight: { bg: 0x0d1117, fg: 0xc9d1d9, accent: 0xd4a847, glow: 0xd4a847, tertiary: 0x58a6c9 },
  botanical:{ bg: 0xeae6df, fg: 0x2d4a3e, accent: 0xb47a4e, glow: 0x6b8f6b, tertiary: 0x8a5a7a },
  plum:     { bg: 0xf0e8f0, fg: 0x3a1f4a, accent: 0xc25a7c, glow: 0xc25a7c, tertiary: 0x5a8a6a },
  crimson:  { bg: 0x0a0a0a, fg: 0xdc143c, accent: 0x8b0000, glow: 0xdc143c, tertiary: 0x4a0010, invertFg: 0xffffff },
  scarlet:  { bg: 0xdc143c, fg: 0x0a0a0a, accent: 0x4a0010, glow: 0x8b0000, tertiary: 0x2a0008, invertFg: 0xffffff },
};

// MIDI trigger pitches
const PITCH_FG = 48;
const PITCH_BG = 50;
const PITCH_GLOW = 52;
const PITCH_INK = 54;
const PITCH_INVERT = 56;
const PITCH_PAL_SEPIA = 58;
const PITCH_PAL_MIDNIGHT = 60;
const PITCH_PAL_BOTANICAL = 62;
const PITCH_PAL_PLUM = 64;
const PITCH_PAL_CRIMSON = 65;
const PITCH_WAVE_MIN = 66;
const PITCH_WAVE_MAX = 70;
const PITCH_WARP_MIN = 72;
const PITCH_WARP_MAX = 76;
const PITCH_SPIRAL = 78;
const PITCH_CRAZY_INK = 80;
const PITCH_SCALE_POP = 82;
const PITCH_LINE_WEIGHT = 84;
const PITCH_SNARE_L = 86;
const PITCH_SNARE_C = 88;
const PITCH_SNARE_R = 90;
const PITCH_PAL_SCARLET = 92;
const PITCH_INVERT_LINES = 94;

// Spiral dot constants
const SPIRAL_ARMS = 5;
const SPIRAL_GROWTH = 8;
const SPIRAL_FADE_PER_STEP = 0.06;
const SPIRAL_MAX_STEPS = 24;
const SPIRAL_ROTATION_PER_KICK = Math.PI / 12;

// Crazy polar ink constants
const CRAZY_INK_POSITIONS = 256;
const CRAZY_INK_DOTS_PER_TRIGGER = 12;
const CRAZY_INK_ORBIT_FRAC = 0.30;
const CRAZY_INK_BLOB_MULT = 0.8;
const CRAZY_INK_BLOB_VERTS = 8;
const CRAZY_INK_BLOB_NOISE = 0.25;
const CRAZY_INK_FADE_PER_STEP = 0.15;

// Scale pop & line weight
const SCALE_POP_STEPS: number[] = [1.03, 1.0];
const LINE_WEIGHT_OPACITY_MULT = 2.2;
const LINE_WEIGHT_DOT_MULT = 1.5;
const LINE_WEIGHT_HOLD_TICKS = 1;

// Snare bounce pattern
const SNARE_BALLS = 16;
const SNARE_SPEED = 2.5;
const SNARE_BOUNCE_RADIUS = 60;
const SNARE_SIM_BEATS = 30;
const SNARE_LINE_OPACITY = 0.25;
const SNARE_KICK_STEP = 4;
const SNARE_SNARE_STEP = 3;
const SNARE_EVOLVE_KICK_STEP = 1.5;
const SNARE_EVOLVE_SNARE_STEP = 1.0;
const SNARE_PITCHES = [PITCH_SNARE_L, PITCH_SNARE_C, PITCH_SNARE_R];

// Effect tuning
const WAVE_FREQ_MIN = 2.0;
const WAVE_FREQ_MAX = 14.0;
const WAVE_AMP_SCALE = 0.012;
const WAVE_SPEED = 1.8;
const WARP_FOLD_MIN = 3.0;
const WARP_FOLD_MAX = 8.0;
const WARP_AMP_SCALE = 0.018;
const EFFECT_LERP = 0.08;

const DEFAULTS = {
  balls: 24,
  kickStart: 37,
  snareStart: 53,
  kickStep: 3,
  snareStep: 2,
  speed: 2,
  dotSize: 2,
  lineOpacity: 0.2,
  fgMultiplier: 1,
  bgMultiplier: 4,
};

// Simulation constants
const SIM_BEATS = 200;
const STEPS_PER_BEAT = 30;
const BG_BALLS = 32;
const BG_SPEED = 3;
const BG_LINE_OPACITY = 0.12;
const BG_SCALE = 1.8;
const PATTERN_EXTENT = 500;
const MAX_EXTENT = PATTERN_EXTENT * 2;
const MAX_BALLS = 80; // max from settingsSchema
const MAX_POINTS_PER_LINE = SIM_BEATS * STEPS_PER_BEAT + 1;
const MAX_INK_BLOBS = 256;
const MAX_CRAZY_INK_BLOBS = 256;
const MAX_SPIRAL_DOTS = 256;

// Foreground fade constants
const FG_FADE_PER_TICK = 0.07;  // subtle opacity loss per tick
const FG_FADE_TICKS_PER_BAR = 2; // fade twice per measure
const FG_FADE_MIN = 0.15;        // never fully invisible

// Ink dot constants
const INK_POSITIONS = 128;
const INK_DOTS = 4;
const INK_ORBIT_FRAC = 0.35;
const INK_BLOB_MULT = 2.0;
const INK_BLOB_VERTS = 10;
const INK_BLOB_NOISE = 0.35;
const INK_FADE_PER_STEP = 0.2;

const BG_ROTATION_STEP = (Math.PI * 2) / 24;

// Bird constants
const BIRD_COUNT = 5;
const BIRD_SCALE_BASE = 6;
const BIRD_WING_FREQ = 2.5; // flaps per second

// Wire line constants (for bird weaving depth effect)
const WIRE_LINES_TOP = 3;
const WIRE_LINES_BOTTOM = 3;
const WIRE_TOTAL = WIRE_LINES_TOP + WIRE_LINES_BOTTOM;
const WIRE_Y_FRAC = 0.35;       // fraction of vh/2 from center for wire group
const WIRE_SPACING_FRAC = 0.04; // fraction of vh between wires
const WIRE_SUBS = 40;           // subdivisions per wire for catenary sag
const WIRE_SAG_FRAC = 0.003;    // fraction of vw for sag depth
const WIRE_OPACITY = 0.18;

// Deterministic bird placement configs: { yFrac (of vh/2), direction, speed multiplier, size multiplier }
const BIRD_CONFIGS = [
  { yFrac:  0.36, dir:  1, speedMult: 1.0,  scaleMult: 1.0,  phaseSeed: 0.0 },
  { yFrac:  0.38, dir: -1, speedMult: 0.7,  scaleMult: 0.85, phaseSeed: 1.3 },
  { yFrac:  0.33, dir:  1, speedMult: 1.3,  scaleMult: 0.7,  phaseSeed: 2.7 },
  { yFrac: -0.35, dir:  1, speedMult: 0.9,  scaleMult: 0.95, phaseSeed: 4.1 },
  { yFrac: -0.38, dir: -1, speedMult: 0.8,  scaleMult: 0.8,  phaseSeed: 5.5 },
];

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

/** Deterministic hash for ink blob vertex noise */
function inkHash(a: number, b: number, c: number, d: number): number {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791) ^ (d * 41729501);
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return (h & 0xffff) / 0xffff;
}

/** Create a noisy circle ShapeGeometry for organic ink-blob look */
function createNoisyBlobGeometry(verts: number, noise: number, seed: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  for (let v = 0; v < verts; v++) {
    const n = inkHash(seed, v, 0, 0) * 2 - 1;
    const r = 1 + n * noise;
    const angle = (v / verts) * Math.PI * 2;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    if (v === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

// --- Polar path functions (unchanged) ---

function inkPolarPath(slot: number, baseR: number): [number, number] {
  const t = (slot / INK_POSITIONS) * Math.PI * 2;
  const r = baseR * (1
    + 0.12 * Math.sin(3 * t)
    + 0.08 * Math.cos(5 * t)
    + 0.06 * Math.sin(7 * t)
    + 0.04 * Math.cos(11 * t)
  );
  return [Math.cos(t) * r, Math.sin(t) * r];
}

function crazyPolarPath(slot: number, baseR: number): [number, number] {
  const t = (slot / CRAZY_INK_POSITIONS) * Math.PI * 2;
  const r = baseR * (1
    + 0.25 * Math.sin(5 * t)
    + 0.18 * Math.cos(7 * t)
    + 0.15 * Math.sin(11 * t)
    + 0.12 * Math.cos(13 * t)
    + 0.10 * Math.sin(17 * t)
    + 0.08 * Math.cos(19 * t)
    + 0.06 * Math.sin(23 * t)
    + 0.04 * Math.cos(29 * t)
  );
  return [Math.cos(t) * r, Math.sin(t) * r];
}

// --- Bird shape geometry ---
function createBirdGeometry(): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  // Left wingtip
  s.moveTo(-1.0, 0);
  // Left wing curves up
  s.quadraticCurveTo(-0.65, 0.52, -0.15, 0.12);
  // Body dip at center
  s.quadraticCurveTo(0, -0.02, 0.15, 0.12);
  // Right wing curves up to tip
  s.quadraticCurveTo(0.65, 0.52, 1.0, 0);
  // Right trailing edge back
  s.quadraticCurveTo(0.55, 0.08, 0.12, -0.06);
  // Body bottom
  s.lineTo(-0.12, -0.06);
  // Left trailing edge back to start
  s.quadraticCurveTo(-0.55, 0.08, -1.0, 0);
  return new THREE.ShapeGeometry(s);
}

// --- Data types ---

interface Trajectory {
  points: Float32Array;
  count: number;
}

interface SpiralDot {
  panelIndex: number;
  baseAngle: number;
  step: number;
  opacity: number;
  seed: number;
}

interface InkBlob {
  slot: number;
  opacity: number;
  seed: number;
}

// --- Pattern computation (unchanged) ---

function computePattern(
  balls: number,
  kickAngle: number,
  snareAngle: number,
  baseSpeed: number,
): Trajectory[] {
  const result: Trajectory[] = [];
  const maxPoints = SIM_BEATS * STEPS_PER_BEAT + 1;

  for (let i = 0; i < balls; i++) {
    let angle = (i / balls) * Math.PI * 2;
    let x = 0, y = 0;
    const pts = new Float32Array(maxPoints * 2);
    pts[0] = 0; pts[1] = 0;
    let count = 1;
    let alive = true;

    for (let beat = 0; beat < SIM_BEATS && alive; beat++) {
      const bim = beat % 4;
      let speed: number;
      if (bim === 0 || bim === 2) { angle += kickAngle; speed = Math.abs(baseSpeed); }
      else { angle -= snareAngle; speed = -Math.abs(baseSpeed); }
      const dx = Math.cos(angle) * speed;
      const dy = Math.sin(angle) * speed;

      for (let s = 0; s < STEPS_PER_BEAT && alive; s++) {
        x += dx; y += dy;
        if (Math.abs(x) > MAX_EXTENT || Math.abs(y) > MAX_EXTENT) { alive = false; }
        else { pts[count * 2] = x; pts[count * 2 + 1] = y; count++; }
      }
    }
    result.push({ points: pts, count });
  }
  return result;
}

function computePatternBounce(
  balls: number,
  kickAngle: number,
  snareAngle: number,
  baseSpeed: number,
  bounceRadius: number,
  simBeats: number = SIM_BEATS,
): Trajectory[] {
  const result: Trajectory[] = [];
  const maxPoints = simBeats * STEPS_PER_BEAT + 1;

  for (let i = 0; i < balls; i++) {
    let angle = (i / balls) * Math.PI * 2;
    let x = 0, y = 0;
    const pts = new Float32Array(maxPoints * 2);
    pts[0] = 0; pts[1] = 0;
    let count = 1;

    for (let beat = 0; beat < simBeats; beat++) {
      const bim = beat % 4;
      let speed: number;
      if (bim === 0 || bim === 2) { angle += kickAngle; speed = Math.abs(baseSpeed); }
      else { angle -= snareAngle; speed = -Math.abs(baseSpeed); }
      let dx = Math.cos(angle) * speed;
      let dy = Math.sin(angle) * speed;

      for (let s = 0; s < STEPS_PER_BEAT; s++) {
        let nx = x + dx, ny = y + dy;
        const dist = Math.sqrt(nx * nx + ny * ny);
        if (dist > bounceRadius && dist > 0.001) {
          const normX = -nx / dist, normY = -ny / dist;
          const dot = dx * normX + dy * normY;
          dx = dx - 2 * dot * normX; dy = dy - 2 * dot * normY;
          nx = (nx / dist) * bounceRadius + dx;
          ny = (ny / dist) * bounceRadius + dy;
        }
        x = nx; y = ny;
        pts[count * 2] = x; pts[count * 2 + 1] = y;
        count++;
        if (count >= maxPoints) break;
      }
      if (count >= maxPoints) break;
    }
    result.push({ points: pts, count });
  }
  return result;
}

// --- Reusable scratch buffers for trajectory → line position conversion ---
// Pre-allocate one large buffer for writing line positions (x,y,z triples)
const _scratchLinePos = new Float32Array(MAX_POINTS_PER_LINE * 3);

/** Copy trajectory points into _scratchLinePos scaled, return point count. */
function trajectoryToPositions(traj: Trajectory, scale: number): number {
  const count = traj.count;
  for (let i = 0; i < count; i++) {
    _scratchLinePos[i * 3] = traj.points[i * 2] * scale;
    _scratchLinePos[i * 3 + 1] = traj.points[i * 2 + 1] * scale;
    _scratchLinePos[i * 3 + 2] = 0;
  }
  return count;
}

// --- Persistent scene graph holder ---
interface SceneRefs {
  // Paper backdrop
  paperMesh: THREE.Mesh;
  paperMat: THREE.MeshBasicMaterial;
  // Background flower
  bgGroup: THREE.Group;
  bgLineSet: ManagedLineSet;
  bgDotSet: ManagedDotSet;
  bgLineMat: THREE.ShaderMaterial;
  bgDotMat: THREE.ShaderMaterial;
  // Mask rectangles
  masks: THREE.Mesh[];
  maskMats: THREE.MeshBasicMaterial[];
  // Foreground panels (3 panels)
  fgGroups: THREE.Group[];
  fgLineSets: ManagedLineSet[];
  fgDotSets: ManagedDotSet[];
  fgLineMats: THREE.ShaderMaterial[];
  fgDotMats: THREE.ShaderMaterial[];
  // Ink blob pools (one per panel → single pool across all panels)
  inkPool: ManagedBlobPool;
  crazyInkPool: ManagedBlobPool;
  spiralPool: ManagedBlobPool;
  inkBlobGeom: THREE.BufferGeometry;
  crazyInkBlobGeom: THREE.BufferGeometry;
  spiralBlobGeom: THREE.BufferGeometry;
  // Snare patterns (3 panels)
  snareGroups: THREE.Group[];
  snareLineSets: ManagedLineSet[];
  snareDotSets: ManagedDotSet[];
  snareLineMats: THREE.ShaderMaterial[];
  snareDotMats: THREE.ShaderMaterial[];
  // Glow overlay
  glowMesh: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  // Displacement uniforms (shared by all displacement materials)
  sharedUniforms: DisplacementUniforms;
}

function MetronomeBallsVisual({ trackId }: MetronomeBallsProps) {
  const rootRef = useRef<THREE.Group>(null);
  const engineRef = useRef(getVisualPlaybackEngine());
  const bpm = useProjectStore((s) => s.project.bpm);
  const beatsPerBar = useProjectStore((s) => s.project.beatsPerBar);
  const initRef = useRef(false);
  const sceneRef = useRef<SceneRefs | null>(null);

  // Mutable angle state
  const fgKickAngle = useRef(0);
  const fgSnareAngle = useRef(0);
  const bgKickAngle = useRef(0);
  const bgSnareAngle = useRef(0);
  const bgRotation = useRef(0);
  const inkStep = useRef(0);
  const inkBlobs = useRef<InkBlob[]>([]);
  const inkSeedCounter = useRef(0);
  const inverted = useRef(false);
  const invertedLines = useRef(false);
  const paletteKey = useRef('default');

  // Spiral dot state
  const spiralDots = useRef<SpiralDot[]>([]);
  const spiralSeedCounter = useRef(0);
  const spiralBaseAngle = useRef(0);
  const lastSpiralStepTime = useRef(0);

  // Crazy polar ink state
  const crazyInkStep = useRef(0);
  const crazyInkBlobs = useRef<InkBlob[]>([]);
  const crazyInkSeedCounter = useRef(0);

  // Scale pop state
  const scalePopStep = useRef(-1);
  const scalePopTickTime = useRef(0);

  // Line weight state
  const lineWeightTicks = useRef(0);
  const lineWeightTickTime = useRef(0);

  // Continuous ink fade timer
  const lastInkFadeTime = useRef(0);

  // Foreground fade state
  const fgFadeOpacity = useRef(1.0);
  const lastFgFadeTick = useRef(0);

  // Snare bounce pattern state
  const snareActive = useRef([false, false, false]);
  const snareKickAngle = useRef([deg2rad(20), deg2rad(20), deg2rad(20)]);
  const snareSnareAngle = useRef([deg2rad(15), deg2rad(15), deg2rad(15)]);
  const snareEvolveTime = useRef(0);

  // Track params to detect changes
  const prevParamsRef = useRef('');
  const prevPitchCountsRef = useRef(new Map<number, number>());

  // Glow opacity (mutated in useFrame)
  const glowOpacity = useRef(0);

  // Displacement smoothing
  const waveAmpSmooth = useRef(0);
  const waveFreqSmooth = useRef(WAVE_FREQ_MIN);
  const warpAmpSmooth = useRef(0);
  const warpFoldSmooth = useRef(WARP_FOLD_MIN);

  // Cached viewport dimensions for resize detection
  const prevVwRef = useRef(0);
  const prevVhRef = useRef(0);

  const { viewport } = useThree();

  // --- Build persistent scene graph (called once, or on viewport resize) ---
  const buildPersistentScene = useCallback(() => {
    const root = rootRef.current;
    if (!root) return null;

    // Dispose old scene if any
    if (sceneRef.current) {
      disposePersistentScene(sceneRef.current, root);
    }

    const vw = viewport.width;
    const vh = viewport.height;
    const panelWidth = vw / 3;
    const fgScale = panelWidth / PATTERN_EXTENT;

    const sharedUniforms = createDisplacementUniforms();

    // === 0. Paper backdrop ===
    const paperGeom = new THREE.PlaneGeometry(vw * 2, vh * 2);
    const paperMat = new THREE.MeshBasicMaterial({ color: 0xf5f2eb, depthWrite: false, depthTest: false });
    const paperMesh = new THREE.Mesh(paperGeom, paperMat);
    paperMesh.renderOrder = -1;
    root.add(paperMesh);

    // === 1. Background flower ===
    const bgGroup = new THREE.Group();
    bgGroup.renderOrder = 0;
    root.add(bgGroup);

    const bgLineMat = createDisplacementMaterial(sharedUniforms, new THREE.Color(0xb5563e), BG_LINE_OPACITY);
    const bgDotMat = createDisplacementMaterial(sharedUniforms, new THREE.Color(0xb5563e), 1.0);

    const bgLineSet = new ManagedLineSet({
      parent: bgGroup,
      maxLines: BG_BALLS,
      maxPointsPerLine: MAX_POINTS_PER_LINE,
      material: bgLineMat,
    });
    const bgDotSet = new ManagedDotSet({
      parent: bgGroup,
      maxDots: BG_BALLS,
      material: bgDotMat,
      radius: 1, // will be scaled by setDot
    });

    // === 2. Mask rectangles (3 panels) ===
    const masks: THREE.Mesh[] = [];
    const maskMats: THREE.MeshBasicMaterial[] = [];
    for (let pi = 0; pi < 3; pi++) {
      const mGeom = new THREE.PlaneGeometry(1, 1); // will be rescaled
      const mMat = new THREE.MeshBasicMaterial({ color: 0xf5f2eb, depthWrite: false, depthTest: false });
      const mask = new THREE.Mesh(mGeom, mMat);
      mask.renderOrder = 1;
      root.add(mask);
      masks.push(mask);
      maskMats.push(mMat);
    }

    // === 3. Foreground panels ===
    const fgGroups: THREE.Group[] = [];
    const fgLineSets: ManagedLineSet[] = [];
    const fgDotSets: ManagedDotSet[] = [];
    const fgLineMats: THREE.ShaderMaterial[] = [];
    const fgDotMats: THREE.ShaderMaterial[] = [];
    for (let pi = 0; pi < 3; pi++) {
      const panelGroup = new THREE.Group();
      panelGroup.renderOrder = 2;
      panelGroup.position.x = (pi - 1) * panelWidth;
      root.add(panelGroup);
      fgGroups.push(panelGroup);

      const fgLineMat = createDisplacementMaterial(sharedUniforms, new THREE.Color(0x1a2744), DEFAULTS.lineOpacity);
      const fgDotMat = createDisplacementMaterial(sharedUniforms, new THREE.Color(0x1a2744), 1.0);
      fgLineMats.push(fgLineMat);
      fgDotMats.push(fgDotMat);

      fgLineSets.push(new ManagedLineSet({
        parent: panelGroup,
        maxLines: MAX_BALLS,
        maxPointsPerLine: MAX_POINTS_PER_LINE,
        material: fgLineMat,
      }));
      fgDotSets.push(new ManagedDotSet({
        parent: panelGroup,
        maxDots: MAX_BALLS,
        material: fgDotMat,
        radius: 1,
      }));
    }

    // === 4. Blob pools (shared across all 3 panels — positions include panel offset) ===
    const inkBlobGeom = createNoisyBlobGeometry(INK_BLOB_VERTS, INK_BLOB_NOISE, 42);
    const crazyInkBlobGeom = createNoisyBlobGeometry(CRAZY_INK_BLOB_VERTS, CRAZY_INK_BLOB_NOISE, 137);
    const spiralBlobGeom = createNoisyBlobGeometry(8, 0.2, 271);

    // Ink blobs rendered in a group at renderOrder 2 (on top of fg)
    const inkPoolGroup = new THREE.Group();
    inkPoolGroup.renderOrder = 2;
    root.add(inkPoolGroup);
    const inkPool = new ManagedBlobPool({
      parent: inkPoolGroup,
      maxInstances: MAX_INK_BLOBS,
      geometry: inkBlobGeom,
      color: new THREE.Color(0x1a2744),
    });

    const crazyInkPoolGroup = new THREE.Group();
    crazyInkPoolGroup.renderOrder = 2;
    root.add(crazyInkPoolGroup);
    const crazyInkPool = new ManagedBlobPool({
      parent: crazyInkPoolGroup,
      maxInstances: MAX_CRAZY_INK_BLOBS,
      geometry: crazyInkBlobGeom,
      color: new THREE.Color(0x1a2744),
    });

    const spiralPoolGroup = new THREE.Group();
    spiralPoolGroup.renderOrder = 2;
    root.add(spiralPoolGroup);
    const spiralPool = new ManagedBlobPool({
      parent: spiralPoolGroup,
      maxInstances: MAX_SPIRAL_DOTS,
      geometry: spiralBlobGeom,
      color: new THREE.Color(0x1a2744),
    });

    // === 5. Snare panels ===
    const snareGroups: THREE.Group[] = [];
    const snareLineSets: ManagedLineSet[] = [];
    const snareDotSets: ManagedDotSet[] = [];
    const snareLineMats: THREE.ShaderMaterial[] = [];
    const snareDotMats: THREE.ShaderMaterial[] = [];
    for (let pi = 0; pi < 3; pi++) {
      const snareGroup = new THREE.Group();
      snareGroup.renderOrder = 2;
      snareGroup.position.x = (pi - 1) * panelWidth;
      snareGroup.visible = false;
      root.add(snareGroup);
      snareGroups.push(snareGroup);

      const snareLineMat = createDisplacementMaterial(sharedUniforms, new THREE.Color(0x4a7a6f), SNARE_LINE_OPACITY);
      const snareDotMat = createDisplacementMaterial(sharedUniforms, new THREE.Color(0x4a7a6f), 1.0);
      snareLineMats.push(snareLineMat);
      snareDotMats.push(snareDotMat);

      snareLineSets.push(new ManagedLineSet({
        parent: snareGroup,
        maxLines: SNARE_BALLS,
        maxPointsPerLine: SNARE_SIM_BEATS * STEPS_PER_BEAT + 1,
        material: snareLineMat,
      }));
      snareDotSets.push(new ManagedDotSet({
        parent: snareGroup,
        maxDots: SNARE_BALLS,
        material: snareDotMat,
        radius: 1,
      }));
    }

    // === 6. Glow overlay ===
    const glowRadius = Math.max(vw, vh) * 0.6;
    const glowGeom = new THREE.CircleGeometry(glowRadius, 48);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0xb5563e, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    });
    const glowMesh = new THREE.Mesh(glowGeom, glowMat);
    glowMesh.renderOrder = 3;
    root.add(glowMesh);

    const refs: SceneRefs = {
      paperMesh, paperMat,
      bgGroup, bgLineSet, bgDotSet, bgLineMat, bgDotMat,
      masks, maskMats,
      fgGroups, fgLineSets, fgDotSets, fgLineMats, fgDotMats,
      inkPool, crazyInkPool, spiralPool,
      inkBlobGeom, crazyInkBlobGeom, spiralBlobGeom,
      snareGroups, snareLineSets, snareDotSets, snareLineMats, snareDotMats,
      glowMesh, glowMat,
      sharedUniforms,
    };

    sceneRef.current = refs;
    prevVwRef.current = vw;
    prevVhRef.current = vh;
    return refs;
  }, [viewport.width, viewport.height]);

  function disposePersistentScene(refs: SceneRefs, root: THREE.Group) {
    // Remove and dispose everything
    root.remove(refs.paperMesh);
    refs.paperMesh.geometry.dispose();
    refs.paperMat.dispose();

    refs.bgLineSet.dispose();
    refs.bgDotSet.dispose();
    refs.bgLineMat.dispose();
    refs.bgDotMat.dispose();
    root.remove(refs.bgGroup);

    for (const mask of refs.masks) { root.remove(mask); mask.geometry.dispose(); }
    for (const mat of refs.maskMats) mat.dispose();

    for (let pi = 0; pi < 3; pi++) {
      refs.fgLineSets[pi].dispose();
      refs.fgDotSets[pi].dispose();
      refs.fgLineMats[pi].dispose();
      refs.fgDotMats[pi].dispose();
      root.remove(refs.fgGroups[pi]);
    }

    // Blob pools — their parent groups need removing too
    const inkParent = refs.inkPool.getMesh().parent!;
    refs.inkPool.dispose();
    root.remove(inkParent);
    const crazyInkParent = refs.crazyInkPool.getMesh().parent!;
    refs.crazyInkPool.dispose();
    root.remove(crazyInkParent);
    const spiralParent = refs.spiralPool.getMesh().parent!;
    refs.spiralPool.dispose();
    root.remove(spiralParent);
    refs.inkBlobGeom.dispose();
    refs.crazyInkBlobGeom.dispose();
    refs.spiralBlobGeom.dispose();

    for (let pi = 0; pi < 3; pi++) {
      refs.snareLineSets[pi].dispose();
      refs.snareDotSets[pi].dispose();
      refs.snareLineMats[pi].dispose();
      refs.snareDotMats[pi].dispose();
      root.remove(refs.snareGroups[pi]);
    }

    root.remove(refs.glowMesh);
    refs.glowMesh.geometry.dispose();
    refs.glowMat.dispose();
  }

  // --- Helper: update all fg lines + dots from current trajectories ---
  function updateFgLines(refs: SceneRefs, trajs: Trajectory[], scale: number, dotScale: number, balls: number) {
    for (let pi = 0; pi < 3; pi++) {
      const lineSet = refs.fgLineSets[pi];
      const dotSet = refs.fgDotSets[pi];

      let visibleCount = balls;
      for (let bi = 0; bi < balls; bi++) {
        const traj = trajs[bi];
        if (!traj || traj.count < 2) {
          visibleCount = bi;
          break;
        }
        const count = trajectoryToPositions(traj, scale);
        lineSet.updateLine(bi, _scratchLinePos, count);

        // Dot at final position
        const lx = traj.points[(traj.count - 1) * 2] * scale;
        const ly = traj.points[(traj.count - 1) * 2 + 1] * scale;
        dotSet.setDot(bi, lx, ly, dotScale);
      }

      // Set count AFTER positioning to avoid briefly showing unpositioned instances
      lineSet.setLineCount(visibleCount);
      dotSet.setCount(visibleCount);
    }
  }

  // --- Helper: update bg lines + dots ---
  function updateBgLines(refs: SceneRefs, trajs: Trajectory[], scale: number, dotScale: number) {
    const lineSet = refs.bgLineSet;
    const dotSet = refs.bgDotSet;

    for (let bi = 0; bi < BG_BALLS; bi++) {
      const traj = trajs[bi];
      if (!traj || traj.count < 2) continue;
      const count = trajectoryToPositions(traj, scale);
      lineSet.updateLine(bi, _scratchLinePos, count);

      const lx = traj.points[(traj.count - 1) * 2] * scale;
      const ly = traj.points[(traj.count - 1) * 2 + 1] * scale;
      dotSet.setDot(bi, lx, ly, dotScale);
    }

    // Set count AFTER positioning
    lineSet.setLineCount(BG_BALLS);
    dotSet.setCount(BG_BALLS);
    refs.bgGroup.rotation.z = bgRotation.current;
  }

  // --- Helper: update snare lines + dots for a panel ---
  function updateSnareLines(refs: SceneRefs, pi: number, panelWidth: number, dotSize: number) {
    if (!snareActive.current[pi]) {
      refs.snareGroups[pi].visible = false;
      return;
    }
    refs.snareGroups[pi].visible = true;
    const snareScale = (panelWidth * 0.8) / SNARE_BOUNCE_RADIUS;
    const trajs = computePatternBounce(
      SNARE_BALLS,
      snareKickAngle.current[pi],
      snareSnareAngle.current[pi],
      SNARE_SPEED,
      SNARE_BOUNCE_RADIUS,
      SNARE_SIM_BEATS,
    );
    const lineSet = refs.snareLineSets[pi];
    const dotSet = refs.snareDotSets[pi];

    for (let bi = 0; bi < SNARE_BALLS; bi++) {
      const traj = trajs[bi];
      if (!traj || traj.count < 2) continue;
      const count = trajectoryToPositions(traj, snareScale);
      lineSet.updateLine(bi, _scratchLinePos, count);

      const lx = traj.points[(traj.count - 1) * 2] * snareScale;
      const ly = traj.points[(traj.count - 1) * 2 + 1] * snareScale;
      dotSet.setDot(bi, lx, ly, dotSize * 0.7 * snareScale * 0.5);
    }

    // Set count AFTER positioning
    lineSet.setLineCount(SNARE_BALLS);
    dotSet.setCount(SNARE_BALLS);
  }

  // --- Helper: update ink blob pool instances ---
  function updateInkBlobs(refs: SceneRefs, panelWidth: number, dotSize: number, fgScale: number) {
    const orbitR = panelWidth * INK_ORBIT_FRAC;
    const blobR = dotSize * fgScale * INK_BLOB_MULT;
    const blobs = inkBlobs.current;
    let idx = 0;

    for (let pi = 0; pi < 3; pi++) {
      const panelX = (pi - 1) * panelWidth;
      for (const blob of blobs) {
        if (idx >= MAX_INK_BLOBS) break;
        const [x, y] = inkPolarPath(blob.slot, orbitR);
        const rot = blob.seed * 2.399;
        refs.inkPool.setInstance(idx, panelX + x, y, blob.opacity, blobR, rot);
        idx++;
      }
    }
    refs.inkPool.setCount(idx);
  }

  function updateCrazyInkBlobs(refs: SceneRefs, panelWidth: number, dotSize: number, fgScale: number) {
    const orbitR = panelWidth * CRAZY_INK_ORBIT_FRAC;
    const blobR = dotSize * fgScale * CRAZY_INK_BLOB_MULT;
    const blobs = crazyInkBlobs.current;
    let idx = 0;

    for (let pi = 0; pi < 3; pi++) {
      const panelX = (pi - 1) * panelWidth;
      for (const blob of blobs) {
        if (idx >= MAX_CRAZY_INK_BLOBS) break;
        const [x, y] = crazyPolarPath(blob.slot, orbitR);
        const rot = blob.seed * 2.399;
        refs.crazyInkPool.setInstance(idx, panelX + x, y, blob.opacity, blobR, rot);
        idx++;
      }
    }
    refs.crazyInkPool.setCount(idx);
  }

  function updateSpiralDots(refs: SceneRefs, panelWidth: number, dotSize: number, fgScale: number) {
    const blobR = dotSize * fgScale * 0.6;
    const dots = spiralDots.current;
    let idx = 0;

    for (const dot of dots) {
      if (idx >= MAX_SPIRAL_DOTS) break;
      const panelX = (dot.panelIndex - 1) * panelWidth;
      const theta = dot.baseAngle + spiralBaseAngle.current + dot.step * 0.5;
      const r = SPIRAL_GROWTH * fgScale * dot.step;
      const x = panelX + Math.cos(theta) * r;
      const y = Math.sin(theta) * r;
      const rot = dot.seed * 2.399;
      refs.spiralPool.setInstance(idx, x, y, dot.opacity, blobR, rot);
      idx++;
    }
    refs.spiralPool.setCount(idx);
  }

  // --- Helper: update all colors from current palette/inversion ---
  function updateColors(refs: SceneRefs) {
    const pal = PALETTES[paletteKey.current] ?? PALETTES.default;
    const inv = inverted.current;
    const invLines = invertedLines.current;
    const colBg = inv ? pal.fg : pal.bg;
    let colFg = inv ? pal.bg : pal.fg;
    if (invLines) colFg = pal.invertFg ?? (0xffffff - colFg);
    const colAccent = inv ? pal.bg : pal.accent;
    const colGlow = inv ? pal.bg : pal.glow;
    const colTertiary = inv ? pal.bg : pal.tertiary;

    refs.paperMat.color.set(colBg);
    refs.bgLineMat.uniforms.uColor.value.set(colAccent);
    refs.bgDotMat.uniforms.uColor.value.set(colAccent);

    for (const mat of refs.maskMats) mat.color.set(colBg);

    for (let pi = 0; pi < 3; pi++) {
      refs.fgLineMats[pi].uniforms.uColor.value.set(colFg);
      refs.fgDotMats[pi].uniforms.uColor.value.set(colFg);
      refs.snareLineMats[pi].uniforms.uColor.value.set(colTertiary);
      refs.snareDotMats[pi].uniforms.uColor.value.set(colTertiary);
    }

    refs.inkPool.setColor(colFg);
    refs.crazyInkPool.setColor(colFg);
    refs.spiralPool.setColor(colFg);
    refs.glowMat.color.set(colGlow);
  }

  // --- Helper: update mask sizes/positions from fg bounding box ---
  function updateMasks(refs: SceneRefs, trajs: Trajectory[], fgScale: number, panelWidth: number) {
    let bbMinX = Infinity, bbMinY = Infinity, bbMaxX = -Infinity, bbMaxY = -Infinity;
    for (const t of trajs) {
      for (let i = 0; i < t.count; i++) {
        const px = t.points[i * 2], py = t.points[i * 2 + 1];
        if (px < bbMinX) bbMinX = px; if (py < bbMinY) bbMinY = py;
        if (px > bbMaxX) bbMaxX = px; if (py > bbMaxY) bbMaxY = py;
      }
    }
    const pad = 10;
    bbMinX -= pad; bbMinY -= pad; bbMaxX += pad; bbMaxY += pad;
    const maskW = (bbMaxX - bbMinX) * fgScale;
    const maskH = (bbMaxY - bbMinY) * fgScale;
    const maskCx = ((bbMaxX + bbMinX) / 2) * fgScale;
    const maskCy = ((bbMaxY + bbMinY) / 2) * fgScale;

    for (let pi = 0; pi < 3; pi++) {
      const panelX = (pi - 1) * panelWidth;
      refs.masks[pi].scale.set(maskW, maskH, 1);
      refs.masks[pi].position.set(panelX + maskCx, maskCy, 0);
    }
  }

  // --- Helper: update line opacity + dot size for line weight effect ---
  function updateLineWeight(refs: SceneRefs, lineOpacity: number, dotSize: number, fgScale: number) {
    const lwActive = lineWeightTicks.current > 0;
    const effectiveOpacity = lwActive ? lineOpacity * LINE_WEIGHT_OPACITY_MULT : lineOpacity;
    const effectiveDotSize = lwActive ? dotSize * LINE_WEIGHT_DOT_MULT : dotSize;

    for (let pi = 0; pi < 3; pi++) {
      refs.fgLineMats[pi].uniforms.uOpacity.value = effectiveOpacity;
      // Dot size is baked into scale per setDot, so we just need to track this
      // The dot set material opacity stays at 1.0
    }

    return { effectiveOpacity, effectiveDotSize };
  }

  // ============================
  // useFrame — zero allocations
  // ============================
  useFrame(() => {
    const root = rootRef.current;
    if (!root) return;
    const state = engineRef.current.getTrackState(trackId);
    if (!state) return;

    // Check for viewport resize → full rebuild
    const vw = viewport.width;
    const vh = viewport.height;
    if (vw !== prevVwRef.current || vh !== prevVhRef.current) {
      buildPersistentScene();
      initRef.current = false; // force re-init on next frame
    }

    const balls = (state.params.balls as number) ?? DEFAULTS.balls;
    const kickStep = (state.params.kickStep as number) ?? DEFAULTS.kickStep;
    const snareStep = (state.params.snareStep as number) ?? DEFAULTS.snareStep;
    const speed = (state.params.speed as number) ?? DEFAULTS.speed;
    const dotSize = (state.params.dotSize as number) ?? DEFAULTS.dotSize;
    const lineOpacity = (state.params.lineOpacity as number) ?? DEFAULTS.lineOpacity;
    const fgMultiplier = (state.params.fgMultiplier as number) ?? DEFAULTS.fgMultiplier;
    const bgMultiplier = (state.params.bgMultiplier as number) ?? DEFAULTS.bgMultiplier;

    const paramsKey = `${balls},${speed},${dotSize},${lineOpacity},${fgMultiplier},${bgMultiplier}`;
    const panelWidth = vw / 3;
    const fgScale = panelWidth / PATTERN_EXTENT;

    // Build persistent scene if not yet created
    let refs = sceneRef.current;
    if (!refs) {
      refs = buildPersistentScene();
      if (!refs) return;
    }

    // Initial build
    if (!initRef.current) {
      initRef.current = true;
      const kickStart = (state.params.kickStart as number) ?? DEFAULTS.kickStart;
      const snareStart = (state.params.snareStart as number) ?? DEFAULTS.snareStart;
      fgKickAngle.current = deg2rad(kickStart);
      fgSnareAngle.current = deg2rad(snareStart);
      bgKickAngle.current = deg2rad(kickStart);
      bgSnareAngle.current = deg2rad(snareStart);
      prevParamsRef.current = paramsKey;

      // Full initial update
      const bgS = fgScale * BG_SCALE;
      const bgTrajs = computePattern(BG_BALLS, bgKickAngle.current, bgSnareAngle.current, BG_SPEED);
      updateBgLines(refs, bgTrajs, bgS, dotSize * bgS * 0.5);

      const fgTrajs = computePattern(balls, fgKickAngle.current, fgSnareAngle.current, speed);
      updateFgLines(refs, fgTrajs, fgScale, dotSize * fgScale * 0.5, balls);
      updateMasks(refs, fgTrajs, fgScale, panelWidth);
      updateColors(refs);
      updateLineWeight(refs, lineOpacity, dotSize, fgScale);
      return;
    }

    // Dirty flags — only update what changed
    let fgDirty = false;
    let bgDirty = false;
    let colorsDirty = false;
    let inkDirty = false;
    let snareDirty = false;
    let lineWeightDirty = false;

    // Param change → recompute fg + bg + masks
    if (paramsKey !== prevParamsRef.current) {
      prevParamsRef.current = paramsKey;
      fgDirty = true;
      bgDirty = true;
      lineWeightDirty = true;
    }

    // Detect per-pitch note-on triggers
    const prevCounts = prevPitchCountsRef.current;

    for (const [pitch, count] of state.pitchNoteOnCounts) {
      const prevCount = prevCounts.get(pitch) ?? 0;
      const delta = count - prevCount;
      if (delta <= 0) continue;

      if (pitch === PITCH_FG) {
        for (let i = 0; i < delta; i++) {
          fgKickAngle.current += deg2rad(kickStep) * fgMultiplier;
          fgSnareAngle.current += deg2rad(snareStep) * fgMultiplier;
          spiralBaseAngle.current += SPIRAL_ROTATION_PER_KICK;
        }
        fgFadeOpacity.current = 1.0;
        fgDirty = true;
      } else if (pitch === PITCH_BG) {
        for (let i = 0; i < delta; i++) {
          bgKickAngle.current += deg2rad(kickStep) * bgMultiplier;
          bgSnareAngle.current += deg2rad(snareStep) * bgMultiplier;
          bgRotation.current += BG_ROTATION_STEP;
        }
        bgDirty = true;
      } else if (pitch === PITCH_INK) {
        for (let i = 0; i < delta; i++) {
          inkStep.current = (inkStep.current + 1) % INK_POSITIONS;
          for (let d = 0; d < INK_DOTS; d++) {
            const slot = (inkStep.current + d * (INK_POSITIONS / INK_DOTS)) % INK_POSITIONS;
            inkBlobs.current.push({ slot, opacity: 1.0, seed: inkSeedCounter.current++ });
          }
        }
        inkDirty = true;
      } else if (pitch === PITCH_INVERT) {
        for (let i = 0; i < delta; i++) inverted.current = !inverted.current;
        colorsDirty = true;
      } else if (pitch === PITCH_GLOW) {
        glowOpacity.current = 0.25;
      } else if (pitch === PITCH_SPIRAL) {
        for (let i = 0; i < delta; i++) {
          for (let pi = 0; pi < 3; pi++) {
            for (let arm = 0; arm < SPIRAL_ARMS; arm++) {
              spiralDots.current.push({
                panelIndex: pi,
                baseAngle: (arm / SPIRAL_ARMS) * Math.PI * 2,
                step: 0, opacity: 1.0,
                seed: spiralSeedCounter.current++,
              });
            }
          }
        }
        if (lastSpiralStepTime.current === 0) lastSpiralStepTime.current = virtualClock.now();
        inkDirty = true;
      } else if (pitch === PITCH_CRAZY_INK) {
        for (let i = 0; i < delta; i++) {
          crazyInkStep.current = (crazyInkStep.current + 1) % CRAZY_INK_POSITIONS;
          for (let d = 0; d < CRAZY_INK_DOTS_PER_TRIGGER; d++) {
            const slot = (crazyInkStep.current + d * Math.floor(CRAZY_INK_POSITIONS / CRAZY_INK_DOTS_PER_TRIGGER)) % CRAZY_INK_POSITIONS;
            crazyInkBlobs.current.push({ slot, opacity: 1.0, seed: crazyInkSeedCounter.current++ });
          }
        }
        inkDirty = true;
      } else if (pitch === PITCH_SCALE_POP) {
        scalePopStep.current = 0;
        scalePopTickTime.current = virtualClock.now();
      } else if (pitch === PITCH_LINE_WEIGHT) {
        lineWeightTicks.current = LINE_WEIGHT_HOLD_TICKS;
        lineWeightTickTime.current = virtualClock.now();
        lineWeightDirty = true;
      } else if (pitch === PITCH_INVERT_LINES) {
        for (let i = 0; i < delta; i++) invertedLines.current = !invertedLines.current;
        colorsDirty = true;
      } else if (SNARE_PITCHES.includes(pitch)) {
        const pi = SNARE_PITCHES.indexOf(pitch);
        for (let i = 0; i < delta; i++) {
          snareKickAngle.current[pi] += deg2rad(SNARE_KICK_STEP);
          snareSnareAngle.current[pi] += deg2rad(SNARE_SNARE_STEP);
        }
        snareDirty = true;
      }
    }

    // Snare sustained check
    {
      let snareChanged = false;
      for (let pi = 0; pi < 3; pi++) {
        const held = state.activeNotes.has(SNARE_PITCHES[pi]);
        if (held !== snareActive.current[pi]) {
          snareActive.current[pi] = held;
          snareChanged = true;
        }
      }
      const anyActive = snareActive.current.some(a => a);
      if (anyActive && snareEvolveTime.current === 0) snareEvolveTime.current = virtualClock.now();
      if (!anyActive) snareEvolveTime.current = 0;
      if (snareChanged) snareDirty = true;
    }

    // Palette switches
    const palPitches: [number, string][] = [
      [PITCH_PAL_SEPIA, 'sepia'], [PITCH_PAL_MIDNIGHT, 'midnight'],
      [PITCH_PAL_BOTANICAL, 'botanical'], [PITCH_PAL_PLUM, 'plum'],
      [PITCH_PAL_CRIMSON, 'crimson'], [PITCH_PAL_SCARLET, 'scarlet'],
    ];
    let winningPalKey: string | null = null;
    let winningPalDelta = 0;
    for (const [pp, key] of palPitches) {
      const d = (state.pitchNoteOnCounts.get(pp) ?? 0) - (prevCounts.get(pp) ?? 0);
      if (d > 0) { winningPalKey = key; winningPalDelta = d; }
    }
    if (winningPalKey !== null) {
      if (winningPalDelta % 2 === 1) {
        paletteKey.current = paletteKey.current === winningPalKey ? 'default' : winningPalKey;
      }
      colorsDirty = true;
    }

    // Snapshot counts
    prevPitchCountsRef.current = new Map(state.pitchNoteOnCounts);

    // === Spiral dot advancement ===
    if (spiralDots.current.length > 0) {
      const now = virtualClock.now();
      const thirtySecondMs = (60000 / bpm) / 8;
      const elapsed = now - lastSpiralStepTime.current;
      const steps = Math.floor(elapsed / thirtySecondMs);
      if (steps > 0) {
        lastSpiralStepTime.current += steps * thirtySecondMs;
        for (const dot of spiralDots.current) {
          dot.step += steps;
          dot.opacity -= SPIRAL_FADE_PER_STEP * steps;
        }
        spiralDots.current = spiralDots.current.filter(d => d.opacity > 0.01 && d.step < SPIRAL_MAX_STEPS);
        inkDirty = true;
      }
    }

    // === Continuous ink fade ===
    if (inkBlobs.current.length > 0 || crazyInkBlobs.current.length > 0) {
      const now = virtualClock.now();
      const eighthMs = (60000 / bpm) / 2;
      if (lastInkFadeTime.current === 0) lastInkFadeTime.current = now;
      const elapsed = now - lastInkFadeTime.current;
      const ticks = Math.floor(elapsed / eighthMs);
      if (ticks > 0) {
        lastInkFadeTime.current += ticks * eighthMs;
        for (const blob of inkBlobs.current) blob.opacity -= INK_FADE_PER_STEP * ticks;
        for (const blob of crazyInkBlobs.current) blob.opacity -= CRAZY_INK_FADE_PER_STEP * ticks;
        inkBlobs.current = inkBlobs.current.filter(b => b.opacity > 0.01);
        crazyInkBlobs.current = crazyInkBlobs.current.filter(b => b.opacity > 0.01);
        inkDirty = true;
      }
    }

    // === Snare evolution ===
    if (snareEvolveTime.current > 0) {
      const now = virtualClock.now();
      const thirtySecondMs = (60000 / bpm) / 8;
      const elapsed = now - snareEvolveTime.current;
      const ticks = Math.floor(elapsed / thirtySecondMs);
      if (ticks > 0) {
        snareEvolveTime.current += ticks * thirtySecondMs;
        for (let pi = 0; pi < 3; pi++) {
          if (!snareActive.current[pi]) continue;
          snareKickAngle.current[pi] += deg2rad(SNARE_EVOLVE_KICK_STEP) * ticks;
          snareSnareAngle.current[pi] += deg2rad(SNARE_EVOLVE_SNARE_STEP) * ticks;
        }
        snareDirty = true;
      }
    }

    // === Foreground fade tick (twice per measure) ===
    {
      const now = virtualClock.now();
      const halfBarMs = (60000 / bpm) * (beatsPerBar / FG_FADE_TICKS_PER_BAR);
      if (lastFgFadeTick.current === 0) lastFgFadeTick.current = now;
      const elapsed = now - lastFgFadeTick.current;
      const ticks = Math.floor(elapsed / halfBarMs);
      if (ticks > 0) {
        lastFgFadeTick.current += ticks * halfBarMs;
        fgFadeOpacity.current = Math.max(FG_FADE_MIN, fgFadeOpacity.current - FG_FADE_PER_TICK * ticks);
      }
    }

    // === Scale pop & line weight tick ===
    {
      const now = virtualClock.now();
      const sixteenthMs = (60000 / bpm) / 4;
      if (scalePopStep.current >= 0 && scalePopStep.current < SCALE_POP_STEPS.length - 1) {
        const elapsed = now - scalePopTickTime.current;
        const ticks = Math.floor(elapsed / sixteenthMs);
        if (ticks > 0) {
          scalePopTickTime.current += ticks * sixteenthMs;
          scalePopStep.current = Math.min(scalePopStep.current + ticks, SCALE_POP_STEPS.length - 1);
        }
      }
      if (lineWeightTicks.current > 0) {
        const elapsed = now - lineWeightTickTime.current;
        const ticks = Math.floor(elapsed / sixteenthMs);
        if (ticks > 0) {
          lineWeightTickTime.current += ticks * sixteenthMs;
          lineWeightTicks.current = Math.max(0, lineWeightTicks.current - ticks);
          lineWeightDirty = true;
        }
      }
    }

    // === Incremental updates based on dirty flags ===
    if (colorsDirty) {
      updateColors(refs);
    }

    if (lineWeightDirty) {
      updateLineWeight(refs, lineOpacity, dotSize, fgScale);
    }

    if (fgDirty) {
      const fgTrajs = computePattern(balls, fgKickAngle.current, fgSnareAngle.current, speed);
      const { effectiveDotSize } = updateLineWeight(refs, lineOpacity, dotSize, fgScale);
      updateFgLines(refs, fgTrajs, fgScale, effectiveDotSize * fgScale * 0.5, balls);
      updateMasks(refs, fgTrajs, fgScale, panelWidth);
    }

    if (bgDirty) {
      const bgS = fgScale * BG_SCALE;
      const bgTrajs = computePattern(BG_BALLS, bgKickAngle.current, bgSnareAngle.current, BG_SPEED);
      updateBgLines(refs, bgTrajs, bgS, dotSize * bgS * 0.5);
    }

    if (inkDirty) {
      const effectiveDotSize = lineWeightTicks.current > 0 ? dotSize * LINE_WEIGHT_DOT_MULT : dotSize;
      updateInkBlobs(refs, panelWidth, effectiveDotSize, fgScale);
      updateCrazyInkBlobs(refs, panelWidth, effectiveDotSize, fgScale);
      updateSpiralDots(refs, panelWidth, effectiveDotSize, fgScale);
    }

    if (snareDirty) {
      for (let pi = 0; pi < 3; pi++) {
        updateSnareLines(refs, pi, panelWidth, dotSize);
      }
    }

    // === Every frame: apply foreground fade opacity ===
    {
      const fade = fgFadeOpacity.current;
      const lwActive = lineWeightTicks.current > 0;
      const baseFgOpacity = lwActive ? lineOpacity * LINE_WEIGHT_OPACITY_MULT : lineOpacity;
      for (let pi = 0; pi < 3; pi++) {
        refs.fgLineMats[pi].uniforms.uOpacity.value = baseFgOpacity * fade;
        refs.fgDotMats[pi].uniforms.uOpacity.value = 1.0 * fade;
        refs.snareLineMats[pi].uniforms.uOpacity.value = SNARE_LINE_OPACITY * fade;
        refs.snareDotMats[pi].uniforms.uOpacity.value = 1.0 * fade;
      }
    }

    // === Every frame: displacement uniforms ===
    let waveTarget = 0;
    let waveFreqTarget = waveFreqSmooth.current;
    let warpTarget = 0;
    let warpFoldTarget = warpFoldSmooth.current;

    for (let p = PITCH_WAVE_MIN; p <= PITCH_WAVE_MAX; p++) {
      const note = state.activeNotes.get(p);
      if (note) {
        const t = (p - PITCH_WAVE_MIN) / (PITCH_WAVE_MAX - PITCH_WAVE_MIN);
        waveFreqTarget = WAVE_FREQ_MIN + t * (WAVE_FREQ_MAX - WAVE_FREQ_MIN);
        waveTarget = (note.velocity / 127) * WAVE_AMP_SCALE * vw;
        break;
      }
    }
    for (let p = PITCH_WARP_MIN; p <= PITCH_WARP_MAX; p++) {
      const note = state.activeNotes.get(p);
      if (note) {
        const t = (p - PITCH_WARP_MIN) / (PITCH_WARP_MAX - PITCH_WARP_MIN);
        warpFoldTarget = WARP_FOLD_MIN + t * (WARP_FOLD_MAX - WARP_FOLD_MIN);
        warpTarget = (note.velocity / 127) * WARP_AMP_SCALE * vw;
        break;
      }
    }

    waveAmpSmooth.current += (waveTarget - waveAmpSmooth.current) * EFFECT_LERP;
    waveFreqSmooth.current += (waveFreqTarget - waveFreqSmooth.current) * EFFECT_LERP;
    warpAmpSmooth.current += (warpTarget - warpAmpSmooth.current) * EFFECT_LERP;
    warpFoldSmooth.current += (warpFoldTarget - warpFoldSmooth.current) * EFFECT_LERP;

    // Update shared displacement uniforms (all materials respond automatically)
    refs.sharedUniforms.uWaveAmp.value = waveAmpSmooth.current;
    refs.sharedUniforms.uWaveFreq.value = waveFreqSmooth.current;
    refs.sharedUniforms.uWaveSpeed.value = WAVE_SPEED;
    refs.sharedUniforms.uWarpAmp.value = warpAmpSmooth.current;
    refs.sharedUniforms.uWarpFold.value = warpFoldSmooth.current;
    refs.sharedUniforms.uTime.value = virtualClock.now() * 0.001;

    // Scale pop
    if (scalePopStep.current >= 0) {
      const s = SCALE_POP_STEPS[scalePopStep.current];
      root.scale.set(s, s, 1);
    }

    // Glow decay
    if (glowOpacity.current > 0) {
      glowOpacity.current = Math.max(0, glowOpacity.current - 0.025);
      refs.glowMat.opacity = glowOpacity.current;
    }
  });

  useEffect(() => {
    return () => {
      if (sceneRef.current && rootRef.current) {
        disposePersistentScene(sceneRef.current, rootRef.current);
        sceneRef.current = null;
      }
    };
  }, []);

  return <group ref={rootRef} />;
}

export const MetronomeBalls: Instrument = {
  id: 'metronomeBalls',
  name: 'Metronome Balls',
  description: 'Generative line-drawing patterns driven by drum MIDI input — three panels with a rotating background flower',
  icon: '◉',
  color: '#4a6fa5',
  hasAudio: false,
  hasVisual: true,
  disableBloom: true,
  editorType: 'generic',
  noteRange: { min: PITCH_FG, max: PITCH_INVERT_LINES },
  rangeLabels: [
    { startPitch: PITCH_FG, endPitch: PITCH_FG, label: 'Foreground' },
    { startPitch: PITCH_BG, endPitch: PITCH_BG, label: 'Background' },
    { startPitch: PITCH_GLOW, endPitch: PITCH_GLOW, label: 'Glow' },
    { startPitch: PITCH_INK, endPitch: PITCH_INK, label: 'Ink Dots' },
    { startPitch: PITCH_INVERT, endPitch: PITCH_INVERT, label: 'Invert' },
    { startPitch: PITCH_PAL_SEPIA, endPitch: PITCH_PAL_SEPIA, label: 'Sepia' },
    { startPitch: PITCH_PAL_MIDNIGHT, endPitch: PITCH_PAL_MIDNIGHT, label: 'Midnight' },
    { startPitch: PITCH_PAL_BOTANICAL, endPitch: PITCH_PAL_BOTANICAL, label: 'Botanical' },
    { startPitch: PITCH_PAL_PLUM, endPitch: PITCH_PAL_PLUM, label: 'Plum' },
    { startPitch: PITCH_PAL_CRIMSON, endPitch: PITCH_PAL_CRIMSON, label: 'Crimson' },
    { startPitch: PITCH_WAVE_MIN, endPitch: PITCH_WAVE_MAX, label: 'Ink Wave' },
    { startPitch: PITCH_WARP_MIN, endPitch: PITCH_WARP_MAX, label: 'Warp Field' },
    { startPitch: PITCH_SPIRAL, endPitch: PITCH_SPIRAL, label: 'Spiral' },
    { startPitch: PITCH_CRAZY_INK, endPitch: PITCH_CRAZY_INK, label: 'Crazy Ink' },
    { startPitch: PITCH_SCALE_POP, endPitch: PITCH_SCALE_POP, label: 'Scale Pop' },
    { startPitch: PITCH_LINE_WEIGHT, endPitch: PITCH_LINE_WEIGHT, label: 'Line Weight' },
    { startPitch: PITCH_SNARE_L, endPitch: PITCH_SNARE_L, label: 'Snare L' },
    { startPitch: PITCH_SNARE_C, endPitch: PITCH_SNARE_C, label: 'Snare C' },
    { startPitch: PITCH_SNARE_R, endPitch: PITCH_SNARE_R, label: 'Snare R' },
    { startPitch: PITCH_PAL_SCARLET, endPitch: PITCH_PAL_SCARLET, label: 'Scarlet' },
    { startPitch: PITCH_INVERT_LINES, endPitch: PITCH_INVERT_LINES, label: 'Invert Lines' },
  ],

  defaultSettings: {
    balls: DEFAULTS.balls,
    kickStart: DEFAULTS.kickStart,
    snareStart: DEFAULTS.snareStart,
    kickStep: DEFAULTS.kickStep,
    snareStep: DEFAULTS.snareStep,
    speed: DEFAULTS.speed,
    dotSize: DEFAULTS.dotSize,
    lineOpacity: DEFAULTS.lineOpacity,
    fgMultiplier: DEFAULTS.fgMultiplier,
    bgMultiplier: DEFAULTS.bgMultiplier,
  },

  settingsSchema: {
    balls: { type: 'number', label: 'Balls', min: 1, max: 80, step: 1, default: DEFAULTS.balls },
    kickStart: { type: 'number', label: 'Kick Start (°)', min: 1, max: 180, step: 1, default: DEFAULTS.kickStart },
    snareStart: { type: 'number', label: 'Snare Start (°)', min: 1, max: 180, step: 1, default: DEFAULTS.snareStart },
    kickStep: { type: 'number', label: 'Kick Step (°)', min: -10, max: 10, step: 0.1, default: DEFAULTS.kickStep },
    snareStep: { type: 'number', label: 'Snare Step (°)', min: -10, max: 10, step: 0.1, default: DEFAULTS.snareStep },
    speed: { type: 'number', label: 'Speed', min: 0.5, max: 8, step: 0.1, default: DEFAULTS.speed },
    dotSize: { type: 'number', label: 'Dot Size', min: 0.5, max: 8, step: 0.5, default: DEFAULTS.dotSize },
    lineOpacity: { type: 'number', label: 'Line Opacity', min: 0.02, max: 0.6, step: 0.02, default: DEFAULTS.lineOpacity },
    fgMultiplier: { type: 'number', label: 'FG Multiplier', min: 0.1, max: 10, step: 0.1, default: DEFAULTS.fgMultiplier },
    bgMultiplier: { type: 'number', label: 'BG Multiplier', min: 0.1, max: 20, step: 0.1, default: DEFAULTS.bgMultiplier },
  },

  VisualComponent: MetronomeBallsVisual,
};

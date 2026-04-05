'use client';

import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { Instrument } from '../types';
import { virtualClock } from '@daw/core/virtualClock';

// --- Constants ---
const MAX_STARS = 3000;

// MIDI pitch mappings
const PITCH_WARP_FWD = 48;
const PITCH_WARP_BWD = 49;
const PITCH_DRIFT_RIGHT = 50;
const PITCH_DRIFT_LEFT = 51;
const PITCH_DRIFT_UP = 52;
const PITCH_DRIFT_DOWN = 53;
const PITCH_BARREL_CW = 54;
const PITCH_BARREL_CCW = 55;
const PITCH_TUMBLE = 56;
const PITCH_PULSE = 57;
const PITCH_BRAKE = 58;
const PITCH_STREAK = 59;

// Background theme pitches — one per theme
const PITCH_BG_VOID = 60;
const PITCH_BG_DEEP_SPACE = 61;
const PITCH_BG_NEBULA = 62;
const PITCH_BG_CRIMSON = 63;
const PITCH_BG_OCEAN = 64;
const PITCH_BG_FOREST = 65;
const PITCH_BG_AMBER = 66;
const PITCH_BG_MIDNIGHT = 67;

const BG_THEMES: Record<number, string> = {
  [PITCH_BG_VOID]:       '#0a0a0f',
  [PITCH_BG_DEEP_SPACE]: '#05051a',
  [PITCH_BG_NEBULA]:     '#1a0a2e',
  [PITCH_BG_CRIMSON]:    '#1a0505',
  [PITCH_BG_OCEAN]:      '#051a1a',
  [PITCH_BG_FOREST]:     '#0a1a05',
  [PITCH_BG_AMBER]:      '#1a1005',
  [PITCH_BG_MIDNIGHT]:   '#0a0a1f',
};

const DEFAULTS = {
  starCount: 1500,
  dotSize: 2,
  speed: 1,
  spread: 6,
  depth: 15,
  drift: 0.1,
  tint: 220,
  bgColor: '#0a0a0f',
  ground: false,
  groundY: -3,
  groundColor: '#4a3a8a',
};

// --- Shaders ---

const vertexShader = `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStreak;
  uniform float uStreakFactor;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (1.0 + uStreakFactor * 2.0);
    gl_Position = projectionMatrix * mvPosition;
    vStreak = uStreakFactor;
  }
`;

const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStreak;

  void main() {
    vec2 cxy = gl_PointCoord * 2.0 - 1.0;
    // Stretch horizontally when streaking for an elongated look
    float r;
    if (vStreak > 0.0) {
      float sx = cxy.x / (1.0 + vStreak * 3.0);
      r = sx * sx + cxy.y * cxy.y;
    } else {
      r = dot(cxy, cxy);
    }
    if (r > 1.0) discard;
    float alpha = vAlpha * (1.0 - smoothstep(0.4, 1.0, r));
    gl_FragColor = vec4(vColor, alpha);
  }
`;

// --- Star generation ---

function generateStarfield(
  count: number,
  spread: number,
  depth: number,
): Float32Array {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * spread * 2;
    positions[i * 3 + 1] = (Math.random() - 0.5) * spread * 2;
    positions[i * 3 + 2] = (Math.random() - 0.5) * depth;
  }
  return positions;
}

// --- Pulse event ---
interface PulseEvent {
  spawnTime: number;
  strength: number;
}

// --- Component ---

function StarsVisual({ trackId }: { trackId: string }) {
  const rootRef = useRef<THREE.Group>(null);
  const engineRef = useRef(getVisualPlaybackEngine());
  const { scene } = useThree();
  const bgColorObj = useRef(new THREE.Color(DEFAULTS.bgColor));
  const bgTargetColor = useRef(new THREE.Color(DEFAULTS.bgColor));

  // Scene objects
  const pointsObj = useRef<THREE.Points | null>(null);
  const geomRef = useRef<THREE.BufferGeometry | null>(null);
  const matRef = useRef<THREE.ShaderMaterial | null>(null);

  // Pre-allocated buffers (max size)
  const posBuf = useRef(new Float32Array(MAX_STARS * 3));
  const sizeBuf = useRef(new Float32Array(MAX_STARS));
  const colBuf = useRef(new Float32Array(MAX_STARS * 3));
  const alphaBuf = useRef(new Float32Array(MAX_STARS));

  // State refs
  const prevCounts = useRef(new Map<number, number>());
  const streakOn = useRef(false);
  const pulses = useRef<PulseEvent[]>([]);

  // Smoothed velocity for motion decay
  const velRef = useRef({ x: 0, y: 0, z: 0 });
  // Tumble axis precession
  const tumbleAxis = useRef({ x: 0.3, y: 0.7, z: 0.1 });
  const tumbleTime = useRef(0);

  // Build tracking
  const builtCount = useRef(0);
  const builtSpread = useRef(0);
  const builtDepth = useRef(0);

  // Ground plane
  const groundGroup = useRef<THREE.Group | null>(null);
  const groundBuilt = useRef(false);
  const groundOffset = useRef({ x: 0, z: 0 });

  // Scratch color
  const scratchColor = useRef(new THREE.Color());

  function build(count: number, spread: number, depth: number) {
    const root = rootRef.current;
    if (!root) return;

    if (pointsObj.current) root.remove(pointsObj.current);
    geomRef.current?.dispose();
    matRef.current?.dispose();

    // Generate initial positions into posBuf
    const initPos = generateStarfield(count, spread, depth);
    posBuf.current.set(initPos);

    const geom = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(posBuf.current, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const sizeAttr = new THREE.BufferAttribute(sizeBuf.current, 1);
    sizeAttr.setUsage(THREE.DynamicDrawUsage);
    const colorAttr = new THREE.BufferAttribute(colBuf.current, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    const alphaAttr = new THREE.BufferAttribute(alphaBuf.current, 1);
    alphaAttr.setUsage(THREE.DynamicDrawUsage);

    geom.setAttribute('position', posAttr);
    geom.setAttribute('aSize', sizeAttr);
    geom.setAttribute('aColor', colorAttr);
    geom.setAttribute('aAlpha', alphaAttr);
    geom.setDrawRange(0, count);

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uStreakFactor: { value: 0 },
      },
    });

    const pts = new THREE.Points(geom, mat);
    root.add(pts);

    pointsObj.current = pts;
    geomRef.current = geom;
    matRef.current = mat;
    builtCount.current = count;
    builtSpread.current = spread;
    builtDepth.current = depth;
  }

  function buildGround(spread: number, depth: number, groundY: number, color: string) {
    const root = rootRef.current;
    if (!root) return;

    // Remove old ground
    if (groundGroup.current) {
      root.remove(groundGroup.current);
      groundGroup.current.traverse((child) => {
        if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
        if ((child as THREE.Mesh).material) ((child as THREE.Mesh).material as THREE.Material).dispose();
      });
    }

    const grp = new THREE.Group();
    grp.position.y = groundY;

    const gridSize = spread * 4;
    const divisions = 40;
    const step = gridSize / divisions;
    const gridDepth = depth * 2;
    const depthDivisions = Math.ceil(gridDepth / step);

    const gridColor = new THREE.Color(color);

    // Create grid lines as a single LineSegments geometry
    const vertices: number[] = [];

    // Lines along X (横 rows at different Z)
    for (let i = 0; i <= depthDivisions; i++) {
      const z = -gridDepth / 2 + i * step;
      vertices.push(-gridSize / 2, 0, z, gridSize / 2, 0, z);
    }

    // Lines along Z (縦 columns at different X)
    for (let i = 0; i <= divisions; i++) {
      const x = -gridSize / 2 + i * step;
      vertices.push(x, 0, -gridDepth / 2, x, 0, gridDepth / 2);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

    const mat = new THREE.LineBasicMaterial({
      color: gridColor,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });

    const lines = new THREE.LineSegments(geom, mat);
    grp.add(lines);

    root.add(grp);
    groundGroup.current = grp;
    groundBuilt.current = true;
    groundOffset.current = { x: 0, z: 0 };
  }

  useFrame((_state, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const tState = engineRef.current.getTrackState(trackId);
    if (!tState) return;

    const dt = Math.min(delta, 0.05); // Cap delta to avoid huge jumps

    // Read settings
    const starCount = Math.round(Math.min(
      MAX_STARS,
      (tState.params.starCount as number) ?? DEFAULTS.starCount,
    ));
    const dotSize = (tState.params.dotSize as number) ?? DEFAULTS.dotSize;
    const speed = (tState.params.speed as number) ?? DEFAULTS.speed;
    const spread = (tState.params.spread as number) ?? DEFAULTS.spread;
    const depth = (tState.params.depth as number) ?? DEFAULTS.depth;
    const driftSpeed = (tState.params.drift as number) ?? DEFAULTS.drift;
    const tint = (tState.params.tint as number) ?? DEFAULTS.tint;

    const depthHalf = depth / 2;

    // Rebuild if settings changed
    if (
      starCount !== builtCount.current ||
      Math.abs(spread - builtSpread.current) > 0.01 ||
      Math.abs(depth - builtDepth.current) > 0.01
    ) {
      build(starCount, spread, depth);
    }

    const geom = geomRef.current;
    const mat = matRef.current;
    if (!geom || !mat) return;

    const n = starCount;
    const now = virtualClock.now();

    // --- MIDI triggers (note-on toggles) ---
    const prev = prevCounts.current;
    for (const [pitch, cnt] of tState.pitchNoteOnCounts) {
      const prevVal = prev.get(pitch) ?? 0;
      const noteDelta = cnt - prevVal;
      if (noteDelta <= 0) continue;

      if (pitch === PITCH_STREAK) {
        for (let i = 0; i < noteDelta; i++) {
          streakOn.current = !streakOn.current;
        }
      }

      if (pitch === PITCH_PULSE) {
        for (let i = 0; i < noteDelta; i++) {
          pulses.current.push({ spawnTime: now, strength: 1 });
        }
      }

      if (pitch in BG_THEMES) {
        bgTargetColor.current.set(BG_THEMES[pitch]);
      }
    }
    prevCounts.current = new Map(tState.pitchNoteOnCounts);

    // Clean expired pulses
    pulses.current = pulses.current.filter(
      (p) => now - p.spawnTime < 600,
    );

    // --- Compute aggregate velocity from held notes ---
    let targetVx = 0;
    let targetVy = 0;
    let targetVz = driftSpeed; // Idle forward drift
    let rollSpeed = 0;
    let tumbleActive = false;
    let brakeActive = false;

    for (const [pitch, event] of tState.activeNotes) {
      const velScale = (event.velocity / 127) * speed;

      switch (pitch) {
        case PITCH_WARP_FWD:
          targetVz += 3 * velScale;
          break;
        case PITCH_WARP_BWD:
          targetVz -= 3 * velScale;
          break;
        case PITCH_DRIFT_RIGHT:
          targetVx += 2 * velScale;
          break;
        case PITCH_DRIFT_LEFT:
          targetVx -= 2 * velScale;
          break;
        case PITCH_DRIFT_UP:
          targetVy += 2 * velScale;
          break;
        case PITCH_DRIFT_DOWN:
          targetVy -= 2 * velScale;
          break;
        case PITCH_BARREL_CW:
          rollSpeed += 1.5 * velScale;
          break;
        case PITCH_BARREL_CCW:
          rollSpeed -= 1.5 * velScale;
          break;
        case PITCH_TUMBLE:
          tumbleActive = true;
          break;
        case PITCH_BRAKE:
          brakeActive = true;
          break;
      }
    }

    // Smooth velocity with decay
    const vel = velRef.current;
    const decayRate = brakeActive ? 8 : 3;
    vel.x += (targetVx - vel.x) * Math.min(1, decayRate * dt);
    vel.y += (targetVy - vel.y) * Math.min(1, decayRate * dt);
    vel.z += (targetVz - vel.z) * Math.min(1, decayRate * dt);

    // Compute pulse burst
    let pulseBurst = 0;
    for (let p = 0; p < pulses.current.length; p++) {
      const pulse = pulses.current[p];
      const age = (now - pulse.spawnTime) / 1000;
      pulseBurst += pulse.strength * Math.exp(-age * 8);
    }

    // Update tumble
    if (tumbleActive) {
      tumbleTime.current += dt;
      // Slowly precess the tumble axis
      const tt = tumbleTime.current * 0.3;
      tumbleAxis.current.x = Math.sin(tt * 1.3) * 0.5 + Math.cos(tt * 0.7) * 0.5;
      tumbleAxis.current.y = Math.cos(tt * 0.9) * 0.5 + Math.sin(tt * 1.1) * 0.5;
      tumbleAxis.current.z = Math.sin(tt * 0.5) * 0.3;
      // Normalize
      const len = Math.sqrt(
        tumbleAxis.current.x ** 2 +
        tumbleAxis.current.y ** 2 +
        tumbleAxis.current.z ** 2,
      );
      if (len > 0) {
        tumbleAxis.current.x /= len;
        tumbleAxis.current.y /= len;
        tumbleAxis.current.z /= len;
      }
    }

    const tumbleAngle = tumbleActive ? dt * 2 * speed : 0;
    const ta = tumbleAxis.current;

    // Streak factor for shader
    const streakTarget = streakOn.current ? 1 : 0;
    const currentStreak = mat.uniforms.uStreakFactor.value as number;
    mat.uniforms.uStreakFactor.value =
      currentStreak + (streakTarget - currentStreak) * Math.min(1, 6 * dt);

    // Tint color for distant stars
    const tintHue = tint / 360;
    const sc = scratchColor.current;

    const pos = posBuf.current;
    const sz = sizeBuf.current;
    const col = colBuf.current;
    const alp = alphaBuf.current;

    for (let i = 0; i < n; i++) {
      let x = pos[i * 3];
      let y = pos[i * 3 + 1];
      let z = pos[i * 3 + 2];

      // Parallax factor: closer stars (small |z|) move faster
      const absZ = Math.abs(z) + 0.5;
      const parallax = depthHalf / absZ;

      // Apply translation velocity with parallax
      x += vel.x * parallax * dt;
      y += vel.y * parallax * dt;
      z += vel.z * parallax * dt;

      // Pulse burst — radial push outward from center in XY
      if (pulseBurst > 0) {
        const px = x;
        const py = y;
        const pDist = Math.sqrt(px * px + py * py);
        if (pDist > 0.01) {
          const pushStr = pulseBurst * parallax * dt * 4;
          x += (px / pDist) * pushStr;
          y += (py / pDist) * pushStr;
        }
      }

      // Barrel roll (rotate XY around Z axis — incremental per frame)
      if (rollSpeed !== 0) {
        const incCos = Math.cos(rollSpeed * dt);
        const incSin = Math.sin(rollSpeed * dt);
        const tmpX = x;
        const tmpY = y;
        x = tmpX * incCos - tmpY * incSin;
        y = tmpX * incSin + tmpY * incCos;
      }

      // Tumble (arbitrary axis rotation)
      if (tumbleAngle > 0) {
        const cosT = Math.cos(tumbleAngle);
        const sinT = Math.sin(tumbleAngle);
        const dot = ta.x * x + ta.y * y + ta.z * z;
        const cx = ta.y * z - ta.z * y;
        const cy = ta.z * x - ta.x * z;
        const cz = ta.x * y - ta.y * x;
        const nx = x * cosT + cx * sinT + ta.x * dot * (1 - cosT);
        const ny = y * cosT + cy * sinT + ta.y * dot * (1 - cosT);
        const nz = z * cosT + cz * sinT + ta.z * dot * (1 - cosT);
        x = nx;
        y = ny;
        z = nz;
      }

      // Wrap coordinates
      const spreadLimit = spread;
      if (x > spreadLimit) x -= spreadLimit * 2;
      else if (x < -spreadLimit) x += spreadLimit * 2;
      if (y > spreadLimit) y -= spreadLimit * 2;
      else if (y < -spreadLimit) y += spreadLimit * 2;
      if (z > depthHalf) z -= depth;
      else if (z < -depthHalf) z += depth;

      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;

      // Size: perspective scaling — closer = bigger
      const perspSize = dotSize * (depthHalf / absZ);
      sz[i] = Math.max(0.5, perspSize);

      // Color: near stars are white, far stars pick up tint
      const depthFrac = Math.abs(z) / depthHalf; // 0 = near, 1 = far
      if (tintHue === 0 || depthFrac < 0.1) {
        // Pure white for near stars or no tint
        col[i * 3] = 1;
        col[i * 3 + 1] = 1;
        col[i * 3 + 2] = 1;
      } else {
        // Blend toward tinted color with distance
        sc.setHSL(tintHue, 0.4 * depthFrac, 0.9 - 0.3 * depthFrac);
        const blend = depthFrac * 0.6;
        col[i * 3] = 1 + (sc.r - 1) * blend;
        col[i * 3 + 1] = 1 + (sc.g - 1) * blend;
        col[i * 3 + 2] = 1 + (sc.b - 1) * blend;
      }

      // Alpha: near = fully opaque, far = dimmer
      alp[i] = 1.0 - depthFrac * 0.7;
    }

    // --- Background color ---
    const bgColor = (tState.params.bgColor as string) ?? DEFAULTS.bgColor;
    // If no BG theme note is active, use the setting color
    let hasBgNote = false;
    for (const [p] of tState.activeNotes) {
      if (p in BG_THEMES) { hasBgNote = true; break; }
    }
    if (!hasBgNote) {
      bgTargetColor.current.set(bgColor);
    }
    // Smooth lerp toward target
    bgColorObj.current.lerp(bgTargetColor.current, Math.min(1, 4 * dt));
    scene.background = bgColorObj.current;
    // Also update fog color to match
    if (scene.fog && scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(bgColorObj.current);
    }

    // --- Ground plane ---
    const showGround = !!tState.params.ground;
    const groundY = (tState.params.groundY as number) ?? DEFAULTS.groundY;
    const groundColor = (tState.params.groundColor as string) ?? DEFAULTS.groundColor;

    if (showGround && !groundBuilt.current) {
      buildGround(spread, depth, groundY, groundColor);
    } else if (!showGround && groundBuilt.current) {
      if (groundGroup.current && rootRef.current) {
        rootRef.current.remove(groundGroup.current);
        groundGroup.current.traverse((child) => {
          if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
          if ((child as THREE.Mesh).material) ((child as THREE.Mesh).material as THREE.Material).dispose();
        });
        groundGroup.current = null;
      }
      groundBuilt.current = false;
    }

    if (showGround && groundGroup.current) {
      groundGroup.current.position.y = groundY;

      // Scroll the ground with the camera velocity, wrapping to avoid drifting away
      const gStep = (spread * 4) / 40; // grid cell size
      groundOffset.current.x += vel.x * dt;
      groundOffset.current.z += vel.z * dt;

      // Wrap offsets to stay within one grid cell
      groundOffset.current.x = ((groundOffset.current.x % gStep) + gStep) % gStep;
      groundOffset.current.z = ((groundOffset.current.z % gStep) + gStep) % gStep;

      groundGroup.current.position.x = groundOffset.current.x;
      groundGroup.current.position.z = groundOffset.current.z;

      // Apply roll rotation to ground too
      if (rollSpeed !== 0) {
        groundGroup.current.rotation.z += rollSpeed * dt;
      }

      // Fade ground based on distance effect
      const lineMat = (groundGroup.current.children[0] as THREE.LineSegments)?.material as THREE.LineBasicMaterial;
      if (lineMat) {
        lineMat.color.set(groundColor);
      }
    }

    // Flag attributes for GPU upload
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    const sizeAttr = geom.getAttribute('aSize') as THREE.BufferAttribute;
    const colorAttr = geom.getAttribute('aColor') as THREE.BufferAttribute;
    const alphaAttr = geom.getAttribute('aAlpha') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  });

  useEffect(() => {
    return () => {
      // Restore default background
      scene.background = new THREE.Color('#0a0a0f');
      if (scene.fog && scene.fog instanceof THREE.Fog) {
        scene.fog.color.set('#0a0a0f');
      }
      if (pointsObj.current && rootRef.current)
        rootRef.current.remove(pointsObj.current);
      geomRef.current?.dispose();
      matRef.current?.dispose();
      if (groundGroup.current && rootRef.current) {
        rootRef.current.remove(groundGroup.current);
        groundGroup.current.traverse((child) => {
          if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
          if ((child as THREE.Mesh).material) ((child as THREE.Mesh).material as THREE.Material).dispose();
        });
      }
    };
  }, []);

  return <group ref={rootRef} />;
}

// --- Instrument export ---

export const Stars: Instrument = {
  id: 'stars',
  name: 'Stars',
  description:
    'Warp-speed starfield with parallax, directional drift, barrel rolls, tumble, and pulse effects driven by MIDI',
  icon: '✦',
  color: '#c4b5fd',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',
  noteRange: { min: PITCH_WARP_FWD, max: PITCH_BG_MIDNIGHT },
  rangeLabels: [
    { startPitch: PITCH_WARP_FWD, endPitch: PITCH_WARP_FWD, label: 'Warp Forward' },
    { startPitch: PITCH_WARP_BWD, endPitch: PITCH_WARP_BWD, label: 'Warp Backward' },
    { startPitch: PITCH_DRIFT_RIGHT, endPitch: PITCH_DRIFT_RIGHT, label: 'Drift Right' },
    { startPitch: PITCH_DRIFT_LEFT, endPitch: PITCH_DRIFT_LEFT, label: 'Drift Left' },
    { startPitch: PITCH_DRIFT_UP, endPitch: PITCH_DRIFT_UP, label: 'Drift Up' },
    { startPitch: PITCH_DRIFT_DOWN, endPitch: PITCH_DRIFT_DOWN, label: 'Drift Down' },
    { startPitch: PITCH_BARREL_CW, endPitch: PITCH_BARREL_CW, label: 'Barrel Roll CW' },
    { startPitch: PITCH_BARREL_CCW, endPitch: PITCH_BARREL_CCW, label: 'Barrel Roll CCW' },
    { startPitch: PITCH_TUMBLE, endPitch: PITCH_TUMBLE, label: 'Tumble' },
    { startPitch: PITCH_PULSE, endPitch: PITCH_PULSE, label: 'Pulse' },
    { startPitch: PITCH_BRAKE, endPitch: PITCH_BRAKE, label: 'Brake' },
    { startPitch: PITCH_STREAK, endPitch: PITCH_STREAK, label: 'Streak Toggle' },
    { startPitch: PITCH_BG_VOID, endPitch: PITCH_BG_VOID, label: 'BG: Void' },
    { startPitch: PITCH_BG_DEEP_SPACE, endPitch: PITCH_BG_DEEP_SPACE, label: 'BG: Deep Space' },
    { startPitch: PITCH_BG_NEBULA, endPitch: PITCH_BG_NEBULA, label: 'BG: Nebula' },
    { startPitch: PITCH_BG_CRIMSON, endPitch: PITCH_BG_CRIMSON, label: 'BG: Crimson' },
    { startPitch: PITCH_BG_OCEAN, endPitch: PITCH_BG_OCEAN, label: 'BG: Ocean' },
    { startPitch: PITCH_BG_FOREST, endPitch: PITCH_BG_FOREST, label: 'BG: Forest' },
    { startPitch: PITCH_BG_AMBER, endPitch: PITCH_BG_AMBER, label: 'BG: Amber' },
    { startPitch: PITCH_BG_MIDNIGHT, endPitch: PITCH_BG_MIDNIGHT, label: 'BG: Midnight' },
  ],

  defaultSettings: { ...DEFAULTS },

  settingsSchema: {
    starCount: {
      type: 'number', label: 'Stars', min: 200, max: 3000, step: 100,
      default: DEFAULTS.starCount,
    },
    dotSize: {
      type: 'number', label: 'Dot Size', min: 0, max: 6, step: 0.5,
      default: DEFAULTS.dotSize,
    },
    speed: {
      type: 'number', label: 'Speed', min: 0, max: 20, step: 0.1,
      default: DEFAULTS.speed,
    },
    spread: {
      type: 'number', label: 'Spread', min: 2, max: 12, step: 0.5,
      default: DEFAULTS.spread,
    },
    depth: {
      type: 'number', label: 'Depth', min: 5, max: 30, step: 1,
      default: DEFAULTS.depth,
    },
    drift: {
      type: 'number', label: 'Idle Drift', min: 0, max: 1, step: 0.05,
      default: DEFAULTS.drift,
    },
    tint: {
      type: 'number', label: 'Tint Hue', min: 0, max: 360, step: 1,
      default: DEFAULTS.tint,
    },
    bgColor: {
      type: 'color', label: 'Background Color',
      default: DEFAULTS.bgColor,
    },
    ground: {
      type: 'boolean', label: 'Ground Plane',
      default: DEFAULTS.ground,
    },
    groundY: {
      type: 'number', label: 'Ground Height', min: -50, max: 50, step: 0.5,
      default: DEFAULTS.groundY,
    },
    groundColor: {
      type: 'color', label: 'Ground Color',
      default: DEFAULTS.groundColor,
    },
  },

  colorRoleMapping: [
    { role: 'background', param: 'bgColor',    type: 'hex' },
    { role: 'primary',    param: 'tint',        type: 'hsl-hue-deg' },
    { role: 'secondary',  param: 'groundColor', type: 'hex' },
  ],

  VisualComponent: StarsVisual,
};

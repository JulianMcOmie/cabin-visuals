'use client';

import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { hexToHsl } from '@daw/core/colorPalette';
import { Instrument } from '../types';
import { virtualClock } from '@daw/core/virtualClock';

// Golden angle for sunflower distribution
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_PARTICLES = 2000;

// MIDI pitch mappings — bass ripple range (held = active shake)
const PITCH_BASS_RIPPLE_MIN = 36;
const PITCH_BASS_RIPPLE_MAX = 47;

// Effect toggles & triggers
const PITCH_RIPPLE = 48;
const PITCH_SINE = 49;
const PITCH_SPIRAL = 50;
const PITCH_BREATHE = 51;
const PITCH_VORTEX = 52;
const PITCH_ROSE = 53;
const PITCH_SHOCKWAVE = 54;
const PITCH_GALAXY = 55;
const PITCH_HEARTBEAT = 56;
const PITCH_ORGANIC = 57;
const PITCH_DISRUPTOR = 58;
const PITCH_DISRUPTOR_ALGO = 59;
const PITCH_WATER_RIPPLE = 60;
const PITCH_COLOR_MODE = 61;
const PITCH_CENTER_RIPPLE = 62;
const PITCH_SCALE_KICK = 63;
const PITCH_COLOR_PULSE = 64;

const EFFECT_COUNT = 10;
const COLOR_SCHEMES = ['crimsonSunrise', 'oceanDepths', 'auroraBorealis'] as const;
const DISRUPTOR_ALGOS = ['elastic', 'gaussian', 'curl', 'fluid', 'wake'] as const;
type DisruptorAlgo = (typeof DISRUPTOR_ALGOS)[number];

const DEFAULTS = {
  particleCount: 800,
  dotSize: 3,
  speed: 1,
  intensity: 1,
  bladeCount: 3,
  disruptorStrength: 0.08,
  disruptorSpeed: 2,
  disruptorLifetime: 2,
  rippleSpeed: 1.2,
  rippleStrength: 0.06,
  opacity: 1,
};

// --- Displacement functions ---
// All return [dx, dy] in world units, scaled relative to field radius R.
type DisplaceFn = (
  bx: number, by: number, dist: number, angle: number, t: number, R: number,
) => [number, number];

const displaceFns: DisplaceFn[] = [
  // 0: Ripple — concentric waves radiating out
  (_bx, _by, d, a, t, R) => {
    const normD = d / R;
    const wave = Math.sin(normD * 20 - t * 3) * R * 0.025 * normD;
    return [Math.cos(a) * wave, Math.sin(a) * wave];
  },
  // 1: Sine Wave — directional undulation
  (bx, by, _d, _a, t, R) => {
    const dx = Math.sin(by / R * 8 + t) * R * 0.02;
    const dy = Math.cos(bx / R * 8 + t) * R * 0.02;
    return [dx, dy];
  },
  // 2: Spiral — twist particles around center
  (_bx, _by, d, a, t, R) => {
    const normD = d / R;
    const twist = normD * 2 + t * 0.8;
    const offset = normD * R * 0.04;
    return [
      Math.cos(a + twist) * offset - Math.cos(a) * offset,
      Math.sin(a + twist) * offset - Math.sin(a) * offset,
    ];
  },
  // 3: Breathe — uniform expand/contract
  (bx, by, _d, _a, t, _R) => {
    const scale = Math.sin(t * 1.5) * 0.15;
    return [bx * scale, by * scale];
  },
  // 4: Vortex — tangential force + radial pull
  (_bx, _by, d, a, t, R) => {
    const normD = d / R;
    const tangential = R * 0.09 / (normD + 0.1);
    const radial = Math.sin(t * 2) * R * 0.04;
    const perpA = a + Math.PI / 2;
    return [
      Math.cos(perpA) * tangential * normD + Math.cos(a) * radial,
      Math.sin(perpA) * tangential * normD + Math.sin(a) * radial,
    ];
  },
  // 5: Rose Curve — petal-shaped distortion
  (_bx, _by, d, a, t, R) => {
    const normD = d / R;
    const rose = Math.sin(5 * (a + t)) * R * 0.03 * normD;
    return [Math.cos(a) * rose, Math.sin(a) * rose];
  },
  // 6: Shockwave — single ring travels outward
  (_bx, _by, d, a, t, R) => {
    const waveFront = ((t * 0.5) % 1) * R;
    const distToWave = Math.abs(d - waveFront);
    const width = R * 0.08;
    if (distToWave > width) return [0, 0];
    const strength = (1 - distToWave / width) * R * 0.04;
    return [Math.cos(a) * strength, Math.sin(a) * strength];
  },
  // 7: Galaxy — 3-arm spiral density modulation
  (_bx, _by, d, a, t, R) => {
    const normD = d / R;
    const density = Math.sin(3 * (a - normD * 3 + t * 0.5));
    const radial = density * R * 0.015 * normD;
    const tangential = density * R * 0.01 * normD;
    const perpA = a + Math.PI / 2;
    return [
      Math.cos(a) * radial + Math.cos(perpA) * tangential,
      Math.sin(a) * radial + Math.sin(perpA) * tangential,
    ];
  },
  // 8: Heartbeat — pulsing beat
  (_bx, _by, d, a, t, _R) => {
    const beat = Math.pow(Math.sin(t * 3), 2) * Math.exp(-((t * 3) % Math.PI));
    const push = beat * d * 0.08;
    return [Math.cos(a) * push, Math.sin(a) * push];
  },
  // 9: Organic Flow — pseudo-noise field
  (bx, by, _d, _a, t, R) => {
    const nx = bx / R, ny = by / R;
    const dx = Math.sin(nx * 5 + t) * Math.sin(ny * 7 + t * 0.7) * R * 0.02;
    const dy = Math.cos(ny * 5 + t * 0.8) * Math.cos(nx * 6 + t * 1.2) * R * 0.02;
    return [dx, dy];
  },
];

// --- Types ---

interface Blade {
  baseAngle: number;
  spawnTime: number;
  lifetime: number;
  travelSpeed: number;
  strength: number;
  algo: DisruptorAlgo;
}

interface WaterRipple {
  cx: number;
  cy: number;
  spawnTime: number;
  speed: number;
}

interface CenterRipple {
  spawnTime: number;
  speed: number;      // world units per second
  strength: number;   // displacement amplitude in world units
}

interface ScaleKick {
  spawnTime: number;
  strength: number;   // peak scale multiplier (e.g. 0.25 = 25% outward burst)
}

interface ColorPulse {
  spawnTime: number;
}

interface BassNote {
  pitchIdx: number;   // 0-11 within bass range
  velScale: number;   // velocity / 127
}

interface ParticleField {
  baseX: Float32Array;
  baseY: Float32Array;
  dist: Float32Array;
  angle: Float32Array;
  count: number;
  radius: number;
}

// --- Particle generation ---

function generateField(count: number, radius: number): ParticleField {
  const baseX = new Float32Array(count);
  const baseY = new Float32Array(count);
  const dist = new Float32Array(count);
  const angle = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt(i / count);
    const theta = i * GOLDEN_ANGLE;
    const x = Math.cos(theta) * r;
    const y = Math.sin(theta) * r;
    baseX[i] = x;
    baseY[i] = y;
    dist[i] = r;
    angle[i] = Math.atan2(y, x);
  }

  return { baseX, baseY, dist, angle, count, radius };
}

// --- Shaders ---

const vertexShader = `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;

  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = `
  uniform float uOpacity;
  varying vec3 vColor;

  void main() {
    vec2 cxy = gl_PointCoord * 2.0 - 1.0;
    float r = dot(cxy, cxy);
    if (r > 1.0) discard;
    float alpha = (1.0 - smoothstep(0.6, 1.0, r)) * uOpacity;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

// --- Component ---

function DotFieldVisual({ trackId }: { trackId: string }) {
  const rootRef = useRef<THREE.Group>(null);
  const engineRef = useRef(getVisualPlaybackEngine());
  const { viewport, gl } = useThree();

  // Scene objects
  const pointsObj = useRef<THREE.Points | null>(null);
  const geomRef = useRef<THREE.BufferGeometry | null>(null);
  const matRef = useRef<THREE.ShaderMaterial | null>(null);
  const fieldRef = useRef<ParticleField | null>(null);

  // Pre-allocated buffers (max size)
  const posBuf = useRef(new Float32Array(MAX_PARTICLES * 3));
  const sizeBuf = useRef(new Float32Array(MAX_PARTICLES));
  const colBuf = useRef(new Float32Array(MAX_PARTICLES * 3));

  // State refs
  const effectsOn = useRef<boolean[]>(new Array(EFFECT_COUNT).fill(false));
  const prevCounts = useRef(new Map<number, number>());
  const activeBlades = useRef<Blade[]>([]);
  const algoIdx = useRef(0);
  const waterOn = useRef(false);
  const activeRipples = useRef<WaterRipple[]>([]);
  const waterAngle = useRef(0);
  const lastDropTime = useRef(0);
  const colorModeRef = useRef(0);
  const centerRipples = useRef<CenterRipple[]>([]);
  const scaleKicks = useRef<ScaleKick[]>([]);
  const colorPulses = useRef<ColorPulse[]>([]);

  // Build tracking
  const builtCount = useRef(0);
  const builtRadius = useRef(0);

  // Scratch colors
  const scratchColor = useRef(new THREE.Color());
  const rippleColorRef = useRef(new THREE.Color());

  function build(count: number, radius: number) {
    const root = rootRef.current;
    if (!root) return;

    if (pointsObj.current) root.remove(pointsObj.current);
    geomRef.current?.dispose();
    matRef.current?.dispose();

    fieldRef.current = generateField(count, radius);

    const geom = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(posBuf.current, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const sizeAttr = new THREE.BufferAttribute(sizeBuf.current, 1);
    sizeAttr.setUsage(THREE.DynamicDrawUsage);
    const colorAttr = new THREE.BufferAttribute(colBuf.current, 3);
    colorAttr.setUsage(THREE.DynamicDrawUsage);

    geom.setAttribute('position', posAttr);
    geom.setAttribute('aSize', sizeAttr);
    geom.setAttribute('aColor', colorAttr);
    geom.setDrawRange(0, count);

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uOpacity: { value: 1.0 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    const pts = new THREE.Points(geom, mat);
    root.add(pts);

    pointsObj.current = pts;
    geomRef.current = geom;
    matRef.current = mat;
    builtCount.current = count;
    builtRadius.current = radius;

    // Init positions
    const f = fieldRef.current;
    for (let i = 0; i < count; i++) {
      posBuf.current[i * 3] = f.baseX[i];
      posBuf.current[i * 3 + 1] = f.baseY[i];
      posBuf.current[i * 3 + 2] = 0;
    }
  }

  useFrame(() => {
    const root = rootRef.current;
    if (!root) return;
    const state = engineRef.current.getTrackState(trackId);
    if (!state) return;

    const vw = viewport.width;
    const vh = viewport.height;
    const radius = Math.min(vw, vh) * 0.42;
    const dpr = gl.getPixelRatio();

    const particleCount = Math.round(Math.min(
      MAX_PARTICLES,
      (state.params.particleCount as number) ?? DEFAULTS.particleCount,
    ));
    const dotSize = (state.params.dotSize as number) ?? DEFAULTS.dotSize;
    const speed = (state.params.speed as number) ?? DEFAULTS.speed;
    const intensityP = (state.params.intensity as number) ?? DEFAULTS.intensity;
    const bladeCount = (state.params.bladeCount as number) ?? DEFAULTS.bladeCount;
    const disruptorStrength =
      (state.params.disruptorStrength as number) ?? DEFAULTS.disruptorStrength;
    const disruptorSpeed =
      (state.params.disruptorSpeed as number) ?? DEFAULTS.disruptorSpeed;
    const disruptorLifetime =
      (state.params.disruptorLifetime as number) ?? DEFAULTS.disruptorLifetime;
    const rippleSpeed =
      (state.params.rippleSpeed as number) ?? DEFAULTS.rippleSpeed;
    const rippleStrength =
      (state.params.rippleStrength as number) ?? DEFAULTS.rippleStrength;
    const opacity = (state.params.opacity as number) ?? DEFAULTS.opacity;

    // Rebuild if particle count or radius changed
    if (
      particleCount !== builtCount.current ||
      Math.abs(radius - builtRadius.current) > 0.01
    ) {
      build(particleCount, radius);
    }

    const f = fieldRef.current;
    const geom = geomRef.current;
    if (!f || !geom) return;

    const n = f.count;
    const R = f.radius;
    const t = virtualClock.now() * 0.001 * speed;
    const now = virtualClock.now();

    // --- MIDI triggers ---
    const prev = prevCounts.current;

    for (const [pitch, cnt] of state.pitchNoteOnCounts) {
      const prevVal = prev.get(pitch) ?? 0;
      const delta = cnt - prevVal;
      if (delta <= 0) continue;

      // Effect toggles (pitch 48-57)
      if (pitch >= PITCH_RIPPLE && pitch <= PITCH_ORGANIC) {
        const idx = pitch - PITCH_RIPPLE;
        for (let i = 0; i < delta; i++)
          effectsOn.current[idx] = !effectsOn.current[idx];
      }

      if (pitch === PITCH_DISRUPTOR) {
        for (let i = 0; i < delta; i++) {
          const algo = DISRUPTOR_ALGOS[algoIdx.current];
          const baseA = Math.random() * Math.PI * 2;
          for (let k = 0; k < bladeCount; k++) {
            activeBlades.current.push({
              baseAngle: baseA + (k * Math.PI * 2) / bladeCount,
              spawnTime: now,
              lifetime: disruptorLifetime * 1000,
              travelSpeed: disruptorSpeed * R,
              strength: disruptorStrength * R,
              algo,
            });
          }
        }
      }

      if (pitch === PITCH_DISRUPTOR_ALGO) {
        for (let i = 0; i < delta; i++)
          algoIdx.current = (algoIdx.current + 1) % DISRUPTOR_ALGOS.length;
      }

      if (pitch === PITCH_WATER_RIPPLE) {
        for (let i = 0; i < delta; i++)
          waterOn.current = !waterOn.current;
      }

      if (pitch === PITCH_COLOR_MODE) {
        for (let i = 0; i < delta; i++)
          colorModeRef.current = (colorModeRef.current + 1) % COLOR_SCHEMES.length;
      }

      if (pitch === PITCH_CENTER_RIPPLE) {
        for (let i = 0; i < delta; i++) {
          centerRipples.current.push({
            spawnTime: now,
            speed: rippleSpeed * R,
            strength: rippleStrength * R,
          });
        }
      }

      if (pitch === PITCH_SCALE_KICK) {
        for (let i = 0; i < delta; i++) {
          scaleKicks.current.push({
            spawnTime: now,
            strength: 0.5,
          });
        }
      }

      if (pitch === PITCH_COLOR_PULSE) {
        for (let i = 0; i < delta; i++) {
          colorPulses.current.push({ spawnTime: now });
        }
      }
    }

    prevCounts.current = new Map(state.pitchNoteOnCounts);

    // --- Water ripple spawning ---
    if (waterOn.current) {
      waterAngle.current += 0.02 * speed;
      if (now - lastDropTime.current > 500 / speed) {
        const orbitR = R * 0.6;
        activeRipples.current.push({
          cx: Math.cos(waterAngle.current) * orbitR,
          cy: Math.sin(waterAngle.current) * orbitR,
          spawnTime: now,
          speed: R * 0.5,
        });
        lastDropTime.current = now;
        if (activeRipples.current.length > 20) activeRipples.current.shift();
      }
    }

    // Clean expired
    activeBlades.current = activeBlades.current.filter(
      (b) => now - b.spawnTime < b.lifetime,
    );
    activeRipples.current = activeRipples.current.filter(
      (r) => (now - r.spawnTime) / 1000 < 3,
    );
    centerRipples.current = centerRipples.current.filter(
      (cr) => (now - cr.spawnTime) / 1000 < 3,
    );
    scaleKicks.current = scaleKicks.current.filter(
      (k) => now - k.spawnTime < 700,
    );
    colorPulses.current = colorPulses.current.filter(
      (p) => now - p.spawnTime < 500,
    );

    // --- Compute scale kick envelope (instant attack, fast decay) ---
    let kickScale = 0;
    for (let k = 0; k < scaleKicks.current.length; k++) {
      const kick = scaleKicks.current[k];
      const age = (now - kick.spawnTime) / 1000; // seconds
      // Damped spring: outward burst → contracts past rest → settles
      const envelope = Math.exp(-age * 7) * Math.cos(age * 14);
      kickScale += kick.strength * envelope;
    }

    // --- Collect active bass ripple notes (held notes → shake) ---
    const bassNotes: BassNote[] = [];
    for (const [pitch, event] of state.activeNotes) {
      if (pitch >= PITCH_BASS_RIPPLE_MIN && pitch <= PITCH_BASS_RIPPLE_MAX) {
        bassNotes.push({
          pitchIdx: pitch - PITCH_BASS_RIPPLE_MIN,
          velScale: event.velocity / 127,
        });
      }
    }

    // --- Compute color pulse envelope (instant attack, ~400ms release) ---
    let pulseIntensity = 0;
    let pulseNewestSpawn = 0;
    for (let p = 0; p < colorPulses.current.length; p++) {
      const spawn = colorPulses.current[p].spawnTime;
      const age = (now - spawn) / 1000;
      const attack = Math.min(1, age / 0.008);
      const release = Math.exp(-age * 8);
      pulseIntensity = Math.min(1, pulseIntensity + attack * release);
      if (spawn > pulseNewestSpawn) pulseNewestSpawn = spawn;
    }
    // Age of newest pulse for radial sweep timing
    const pulseAge = pulseNewestSpawn > 0 ? (now - pulseNewestSpawn) / 1000 : 0;

    // --- Per-particle update ---
    const sc = scratchColor.current;
    const pixelSize = dotSize * dpr;
    const scheme = colorModeRef.current % COLOR_SCHEMES.length;

    // Check for active color palette override
    const activePalette = state.activePalette;
    const hasPalette = activePalette !== null && activePalette !== undefined;

    // Build palette gradient stops when palette is active
    type GradStop = { t: number; h: number; s: number; l: number };
    let paletteStops: GradStop[] | null = null;
    if (hasPalette) {
      const pri = hexToHsl(activePalette.primary);
      const sec = hexToHsl(activePalette.secondary);
      const acc = hexToHsl(activePalette.accent);
      const hlt = hexToHsl(activePalette.highlight);
      paletteStops = [
        { t: 0,    h: pri.h, s: pri.s, l: pri.l },
        { t: 0.33, h: sec.h, s: sec.s, l: sec.l },
        { t: 0.66, h: acc.h, s: acc.s, l: acc.l },
        { t: 1,    h: hlt.h, s: hlt.s, l: hlt.l },
      ];
    }

    // Scheme-specific base parameters (used for pulses/ripple highlights)
    let schemeH: number, schemeS: number, schemeL: number;
    if (hasPalette && paletteStops) {
      // Use primary color from palette for pulse/ripple base
      schemeH = paletteStops[0].h;
      schemeS = paletteStops[0].s;
      schemeL = paletteStops[0].l;
    } else {
      schemeH = scheme === 0 ? 0.0 : scheme === 1 ? 0.48 : 0.75;
      schemeS = scheme === 0 ? 0.9 : scheme === 1 ? 0.75 : 0.85;
      schemeL = scheme === 0 ? 0.45 : scheme === 1 ? 0.45 : 0.4;
    }

    // Ripple highlight: contrasting accent color
    let rippleH: number;
    if (hasPalette && paletteStops) {
      // Use accent color for ripple highlight
      rippleH = paletteStops[2].h;
    } else {
      rippleH = scheme === 0 ? 0.1 : scheme === 1 ? 0.15 : 0.52;
    }
    const rippleColor = rippleColorRef.current.setHSL(
      rippleH,
      Math.min(1, schemeS + 0.1),
      Math.min(0.85, schemeL + 0.3),
    );

    // Update opacity uniform
    if (matRef.current) {
      matRef.current.uniforms.uOpacity.value = opacity;
    }

    const pos = posBuf.current;
    const sz = sizeBuf.current;
    const col = colBuf.current;
    const blades = activeBlades.current;
    const ripples = activeRipples.current;
    const cRipples = centerRipples.current;

    for (let i = 0; i < n; i++) {
      const bx = f.baseX[i];
      const by = f.baseY[i];
      const d = f.dist[i];
      const a = f.angle[i];

      let dx = bx * kickScale,
        dy = by * kickScale;

      // Sum active displacement effects
      for (let e = 0; e < EFFECT_COUNT; e++) {
        if (!effectsOn.current[e]) continue;
        const [ex, ey] = displaceFns[e](bx, by, d, a, t, R);
        dx += ex * intensityP;
        dy += ey * intensityP;
      }

      // Disruptor blades
      for (let b = 0; b < blades.length; b++) {
        const blade = blades[b];
        const age = (now - blade.spawnTime) / 1000;
        const cosB = Math.cos(blade.baseAngle);
        const sinB = Math.sin(blade.baseAngle);

        const projDist = bx * cosB + by * sinB;
        const perpDist = Math.abs(-bx * sinB + by * cosB);

        const localAge = age - (projDist + R) / blade.travelSpeed;
        if (localAge < 0 || localAge > 1.5) continue;

        const ramp = Math.min(1, localAge / 0.06);
        const perpFalloff = Math.exp(
          (-perpDist * perpDist) / (R * R * 0.01),
        );
        const decay = Math.exp(-localAge * 3);

        let bdx = 0,
          bdy = 0;

        switch (blade.algo) {
          case 'elastic': {
            const spring = Math.cos(localAge * 8) * decay * ramp;
            bdx = cosB * spring * blade.strength;
            bdy = sinB * spring * blade.strength;
            break;
          }
          case 'gaussian': {
            const push = decay * ramp;
            bdx = cosB * push * blade.strength;
            bdy = sinB * push * blade.strength;
            break;
          }
          case 'curl': {
            const fwd = decay * ramp;
            const perp =
              Math.sin(localAge * 6) * decay * ramp * 0.5;
            const perpCos = Math.cos(blade.baseAngle + Math.PI / 2);
            const perpSin = Math.sin(blade.baseAngle + Math.PI / 2);
            bdx =
              cosB * fwd * blade.strength +
              perpCos * perp * blade.strength;
            bdy =
              sinB * fwd * blade.strength +
              perpSin * perp * blade.strength;
            break;
          }
          case 'fluid': {
            const push =
              localAge < 0.3
                ? decay * ramp
                : -decay * ramp * 0.3;
            bdx = cosB * push * blade.strength;
            bdy = sinB * push * blade.strength;
            break;
          }
          case 'wake': {
            const perpCos = Math.cos(blade.baseAngle + Math.PI / 2);
            const perpSin = Math.sin(blade.baseAngle + Math.PI / 2);
            const wake = Math.sin(localAge * 10) * decay * ramp;
            bdx = perpCos * wake * blade.strength;
            bdy = perpSin * wake * blade.strength;
            break;
          }
        }

        dx += bdx * perpFalloff;
        dy += bdy * perpFalloff;
      }

      // Water ripples
      for (let r = 0; r < ripples.length; r++) {
        const ripple = ripples[r];
        const rAge = (now - ripple.spawnTime) / 1000;
        const ringR = rAge * ripple.speed;
        const rpx = bx - ripple.cx;
        const rpy = by - ripple.cy;
        const pDist = Math.sqrt(rpx * rpx + rpy * rpy);
        const distToRing = Math.abs(pDist - ringR);
        const width = R * 0.06;
        if (distToRing < width && pDist > 0.001) {
          const str =
            (1 - distToRing / width) *
            Math.exp(-rAge * 2) *
            R *
            0.03 *
            intensityP;
          dx += (rpx / pDist) * str;
          dy += (rpy / pDist) * str;
        }
      }

      // Bass ripple — fast micro zig-zag from held notes
      for (let bn = 0; bn < bassNotes.length; bn++) {
        const { pitchIdx, velScale } = bassNotes[bn];
        const normPitch = pitchIdx / 11; // 0→1 across the octave

        // Amplitude: very small base, scales up with pitch
        const amp = R * (0.003 + normPitch * 0.007);

        // Zig-zag frequency: fast, increases with pitch
        const freq = 30 + pitchIdx * 7;

        // Direction: each pitch shakes along a different axis (30° apart)
        const dir = pitchIdx * (Math.PI / 6);

        // Per-particle phase offset → organic spatial variation (grows with pitch)
        const pPhase = a * (1 + pitchIdx * 0.5) + (d / R) * pitchIdx * 2;

        // Shape the wave: lower pitches are smooth sine, higher pitches sharpen
        // toward a square wave for a harder zig-zag feel
        const sharpness = 0.2 + normPitch * 0.6; // 0.2 (soft) → 0.8 (sharp)
        const raw = Math.sin(t * freq + pPhase);
        const shaped = Math.sign(raw) * Math.pow(Math.abs(raw), 1 - sharpness);

        dx += Math.cos(dir) * shaped * amp * velScale * intensityP;
        dy += Math.sin(dir) * shaped * amp * velScale * intensityP;
      }

      // Center ripples — expanding ring from origin, displaces + colors
      let rippleInfluence = 0;
      for (let cr = 0; cr < cRipples.length; cr++) {
        const crip = cRipples[cr];
        const crAge = (now - crip.spawnTime) / 1000;
        const ringR = crAge * crip.speed;
        const distToRing = Math.abs(d - ringR);
        const width = R * 0.12; // wide band for prominent visual
        if (distToRing < width) {
          const proximity = 1 - distToRing / width;
          const fade = Math.exp(-crAge * 1.5);
          const influence = proximity * fade;
          // Radial push outward
          const pushStr = influence * crip.strength * intensityP;
          if (d > 0.001) {
            dx += (bx / d) * pushStr;
            dy += (by / d) * pushStr;
          }
          rippleInfluence = Math.min(1, rippleInfluence + influence);
        }
      }

      const totalDisp = Math.sqrt(dx * dx + dy * dy);

      // Position
      pos[i * 3] = bx + dx;
      pos[i * 3 + 1] = by + dy;
      pos[i * 3 + 2] = 0;

      // Size — kick swell + ripple band + pulse flash
      sz[i] = pixelSize * (1 + kickScale * 0.8 + rippleInfluence * 0.8 + pulseIntensity * 1.2);

      // Color — compute base color from scheme (or palette), then blend toward ripple highlight
      let baseR: number, baseG: number, baseB: number;
      const normD = d / R;
      const dispFrac = Math.min(1, totalDisp / (R * 0.1));

      // Gradient blend factor: combines radial distance + angular position for rich 2D gradient
      const angleNorm = (a + Math.PI) / (Math.PI * 2); // 0→1 around circle
      const gradT = normD * 0.6 + angleNorm * 0.4; // blend of radius and angle
      const organic = Math.sin(a * 3.0 + normD * 8.0) * Math.sin(a * 5.0 - normD * 4.0) * 0.5 + 0.5;

      if (hasPalette && paletteStops) {
        // Palette-driven gradient: interpolate across primary → secondary → accent → highlight
        const pt = Math.min(1, Math.max(0, gradT + organic * 0.1));
        // Find surrounding stops
        let lo = 0;
        for (let si = 0; si < paletteStops.length - 1; si++) {
          if (pt >= paletteStops[si].t) lo = si;
        }
        const hi = Math.min(lo + 1, paletteStops.length - 1);
        const seg = paletteStops[hi].t - paletteStops[lo].t;
        const frac = seg > 0 ? (pt - paletteStops[lo].t) / seg : 0;
        // Shortest-path hue interpolation (hue is circular 0-1)
        let dh = paletteStops[hi].h - paletteStops[lo].h;
        if (dh > 0.5) dh -= 1;
        else if (dh < -0.5) dh += 1;
        const h = (paletteStops[lo].h + dh * frac + 1) % 1;
        const s = paletteStops[lo].s + (paletteStops[hi].s - paletteStops[lo].s) * frac;
        const l = paletteStops[lo].l + (paletteStops[hi].l - paletteStops[lo].l) * frac;
        // Deepen: boost saturation, darken lightness to match the rich look of hardcoded schemes
        const deepS = Math.min(1, Math.max(0.6, s * 1.2 + 0.1 + dispFrac * 0.05));
        const deepL = Math.min(0.55, l * 0.7 + 0.08 + dispFrac * 0.08);
        sc.setHSL(h, deepS, deepL);
      } else if (scheme === 0) {
        // Crimson Sunrise: hot pink center → fiery red → coral → golden yellow edges
        const h = (0.92 + gradT * 0.2 + organic * 0.05) % 1;
        const s = 1.0 - gradT * 0.1 + organic * 0.05 + dispFrac * 0.1;
        const l = 0.38 + gradT * 0.22 + organic * 0.12 + dispFrac * 0.12;
        sc.setHSL(h, Math.min(1, Math.max(0.6, s)), Math.min(0.82, l));
      } else if (scheme === 1) {
        // Ocean Depths: deep blue center → teal → emerald green → warm gold edges
        const h = (0.58 - gradT * 0.35 - organic * 0.05 + 1) % 1;
        const s = 0.85 - gradT * 0.1 + organic * 0.1 + dispFrac * 0.1;
        const l = 0.32 + gradT * 0.25 + organic * 0.1 + dispFrac * 0.12;
        sc.setHSL(h, Math.min(1, Math.max(0.45, s)), Math.min(0.82, l));
      } else {
        // Aurora Borealis: deep indigo center → violet → magenta → electric cyan/green edges
        const hBase = gradT < 0.5
          ? 0.72 + gradT * 0.36
          : 0.9 - (gradT - 0.5) * 0.7;
        const h = (hBase + organic * 0.06) % 1;
        const s = 0.85 + gradT * 0.1 + organic * 0.05 + dispFrac * 0.05;
        const l = 0.34 + gradT * 0.24 + organic * 0.12 + dispFrac * 0.15;
        sc.setHSL(h % 1, Math.min(1, s), Math.min(0.85, l));
      }
      baseR = sc.r; baseG = sc.g; baseB = sc.b;

      // Blend toward ripple highlight color
      const ri = rippleInfluence;
      let finalR = baseR + (rippleColor.r - baseR) * ri;
      let finalG = baseG + (rippleColor.g - baseG) * ri;
      let finalB = baseB + (rippleColor.b - baseB) * ri;

      // Color pulse — radial sweep using complementary hue from the color scheme
      if (pulseIntensity > 0) {
        // Radial wave: particles near center flash first, outer ones follow
        const sweepRadius = pulseAge * R * 4;
        const distToSweep = Math.abs(d - sweepRadius);
        const sweepWidth = R * 0.4;
        const sweepBoost = distToSweep < sweepWidth
          ? (1 - distToSweep / sweepWidth) * 0.5 : 0;
        const localPulse = Math.min(1, pulseIntensity + sweepBoost);

        // Two-phase: bright flash of the scheme color, then complementary hue
        const flashPhase = Math.max(0, 1 - pulseAge * 12); // bright flash first ~80ms
        // Complementary hue, full saturation, boosted lightness
        const compH = (schemeH + 0.5) % 1;
        const pulseL = Math.min(1, schemeL + 0.35);
        sc.setHSL(compH, Math.min(1, schemeS + 0.2), pulseL);
        const compR = sc.r, compG = sc.g, compB = sc.b;
        // Bright flash: same hue family but very high lightness
        sc.setHSL(schemeH, schemeS * 0.5, Math.min(1, schemeL + 0.5));
        const flashR = sc.r, flashG = sc.g, flashB = sc.b;
        // Lerp between flash and complementary based on age
        const targetR = compR + (flashR - compR) * flashPhase;
        const targetG = compG + (flashG - compG) * flashPhase;
        const targetB = compB + (flashB - compB) * flashPhase;

        finalR = finalR + (targetR - finalR) * localPulse;
        finalG = finalG + (targetG - finalG) * localPulse;
        finalB = finalB + (targetB - finalB) * localPulse;
      }

      col[i * 3] = finalR;
      col[i * 3 + 1] = finalG;
      col[i * 3 + 2] = finalB;
    }

    // Flag attributes for GPU upload
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    const sizeAttr = geom.getAttribute('aSize') as THREE.BufferAttribute;
    const colorAttr = geom.getAttribute('aColor') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
  });

  useEffect(() => {
    return () => {
      if (pointsObj.current && rootRef.current)
        rootRef.current.remove(pointsObj.current);
      geomRef.current?.dispose();
      matRef.current?.dispose();
    };
  }, []);

  return <group ref={rootRef} />;
}

// --- Instrument export ---

export const DotField: Instrument = {
  id: 'dotField',
  name: 'Dot Field',
  description:
    'Central particle field with golden-angle distribution, bass shake, 10 displacement effects, disruptor blades, and water ripples',
  icon: '✦',
  color: '#4a9eff',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',
  noteRange: { min: PITCH_BASS_RIPPLE_MIN, max: PITCH_COLOR_PULSE },
  rangeLabels: [
    { startPitch: PITCH_BASS_RIPPLE_MIN, endPitch: PITCH_BASS_RIPPLE_MAX, label: 'Bass Shake' },
    { startPitch: PITCH_RIPPLE, endPitch: PITCH_RIPPLE, label: 'Ripple' },
    { startPitch: PITCH_SINE, endPitch: PITCH_SINE, label: 'Sine Wave' },
    { startPitch: PITCH_SPIRAL, endPitch: PITCH_SPIRAL, label: 'Spiral' },
    { startPitch: PITCH_BREATHE, endPitch: PITCH_BREATHE, label: 'Breathe' },
    { startPitch: PITCH_VORTEX, endPitch: PITCH_VORTEX, label: 'Vortex' },
    { startPitch: PITCH_ROSE, endPitch: PITCH_ROSE, label: 'Rose Curve' },
    { startPitch: PITCH_SHOCKWAVE, endPitch: PITCH_SHOCKWAVE, label: 'Shockwave' },
    { startPitch: PITCH_GALAXY, endPitch: PITCH_GALAXY, label: 'Galaxy' },
    { startPitch: PITCH_HEARTBEAT, endPitch: PITCH_HEARTBEAT, label: 'Heartbeat' },
    { startPitch: PITCH_ORGANIC, endPitch: PITCH_ORGANIC, label: 'Organic Flow' },
    { startPitch: PITCH_DISRUPTOR, endPitch: PITCH_DISRUPTOR, label: 'Disruptor' },
    { startPitch: PITCH_DISRUPTOR_ALGO, endPitch: PITCH_DISRUPTOR_ALGO, label: 'Cycle Algo' },
    { startPitch: PITCH_WATER_RIPPLE, endPitch: PITCH_WATER_RIPPLE, label: 'Water Ripple' },
    { startPitch: PITCH_COLOR_MODE, endPitch: PITCH_COLOR_MODE, label: 'Color Scheme' },
    { startPitch: PITCH_CENTER_RIPPLE, endPitch: PITCH_CENTER_RIPPLE, label: 'Center Ripple' },
    { startPitch: PITCH_SCALE_KICK, endPitch: PITCH_SCALE_KICK, label: 'Scale Kick' },
    { startPitch: PITCH_COLOR_PULSE, endPitch: PITCH_COLOR_PULSE, label: 'Color Pulse' },
  ],

  defaultSettings: { ...DEFAULTS },

  settingsSchema: {
    particleCount: {
      type: 'number', label: 'Particles', min: 50, max: 2000, step: 50,
      default: DEFAULTS.particleCount,
    },
    dotSize: {
      type: 'number', label: 'Dot Size', min: 1, max: 10, step: 0.5,
      default: DEFAULTS.dotSize,
    },
    speed: {
      type: 'number', label: 'Speed', min: 0.1, max: 3, step: 0.1,
      default: DEFAULTS.speed,
    },
    intensity: {
      type: 'number', label: 'Intensity', min: 0, max: 20, step: 0.1,
      default: DEFAULTS.intensity,
    },
    bladeCount: {
      type: 'number', label: 'Blade Count', min: 1, max: 8, step: 1,
      default: DEFAULTS.bladeCount,
    },
    disruptorStrength: {
      type: 'number', label: 'Disruptor Strength', min: 0.01, max: 0.3, step: 0.01,
      default: DEFAULTS.disruptorStrength,
    },
    disruptorSpeed: {
      type: 'number', label: 'Disruptor Speed', min: 0.5, max: 5, step: 0.1,
      default: DEFAULTS.disruptorSpeed,
    },
    disruptorLifetime: {
      type: 'number', label: 'Disruptor Life (s)', min: 0.5, max: 5, step: 0.1,
      default: DEFAULTS.disruptorLifetime,
    },
    rippleSpeed: {
      type: 'number', label: 'Ripple Speed', min: 0.3, max: 3, step: 0.1,
      default: DEFAULTS.rippleSpeed,
    },
    rippleStrength: {
      type: 'number', label: 'Ripple Strength', min: 0.01, max: 0.2, step: 0.01,
      default: DEFAULTS.rippleStrength,
    },
    opacity: {
      type: 'number', label: 'Opacity', min: 0, max: 1, step: 0.05,
      default: DEFAULTS.opacity,
    },
  },

  VisualComponent: DotFieldVisual,
};

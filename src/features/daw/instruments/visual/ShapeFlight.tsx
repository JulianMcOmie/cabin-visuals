'use client';

import { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine, interpolateLane } from '@daw/core/visualPlayback';
import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore } from '@daw/stores/projectStore';
import { Instrument } from '../types';
import { hexToHsl } from '@daw/core/colorPalette';
import { virtualClock } from '@daw/core/virtualClock';

interface Props {
  trackId: string;
}

// --- Geometry helpers ---

function gcd(a: number, b: number): number {
  let x = Math.round(a * 10000);
  let y = Math.round(b * 10000);
  while (y) { const t = y; y = x % y; x = t; }
  return x / 10000;
}

const geometryCache = new Map<string, Float32Array>();

function evictCache() {
  if (geometryCache.size > 300) {
    const iter = geometryCache.keys();
    for (let i = 0; i < 80; i++) {
      const k = iter.next().value;
      if (k) geometryCache.delete(k);
    }
  }
}

// Returns flat Float32Array of [x,y, x,y, ...] pairs for the shape vertices
function getPolygonVerts(sides: number): Float32Array {
  const key = `poly_${sides}`;
  let verts = geometryCache.get(key);
  if (verts) return verts;

  verts = new Float32Array(sides * 2);
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
    verts[i * 2] = Math.cos(angle);
    verts[i * 2 + 1] = Math.sin(angle);
  }
  geometryCache.set(key, verts);
  return verts;
}

function getPolarVerts(petals: number, offset: number): Float32Array {
  const oQ = Math.round(offset * 100) / 100;
  const key = `polar_${petals}_${oQ}`;
  let verts = geometryCache.get(key);
  if (verts) return verts;

  const segments = 256;
  const tMax = Math.PI * 2;
  verts = new Float32Array(segments * 2);
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * tMax;
    const r = Math.cos(petals * theta) + oQ;
    verts[i * 2] = r * Math.cos(theta);
    verts[i * 2 + 1] = r * Math.sin(theta);
  }
  geometryCache.set(key, verts);
  evictCache();
  return verts;
}

function getSpirographVerts(petals: number, r: number, d: number): Float32Array {
  const rQ = Math.round(r * 100) / 100;
  const dQ = Math.round(d * 100) / 100;
  const key = `spiro_${petals}_${rQ}_${dQ}`;

  let verts = geometryCache.get(key);
  if (verts) return verts;

  const R = 1;
  const innerR = rQ;
  const segments = 256;
  const revolutions = Math.max(1, Math.round(innerR / gcd(R, innerR)));
  const tMax = revolutions * Math.PI * 2;

  verts = new Float32Array(segments * 2);
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * tMax;
    verts[i * 2] = (R - innerR) * Math.cos(t) + dQ * Math.cos(((R - innerR) / innerR) * t);
    verts[i * 2 + 1] = (R - innerR) * Math.sin(t) - dQ * Math.sin(((R - innerR) / innerR) * t);
  }

  geometryCache.set(key, verts);
  evictCache();
  return verts;
}

type ShapeMode = 'spirograph' | 'polygon' | 'polar';
type BurstMode = 'noisy' | 'linear' | 'spiralOut' | 'spiralIn';

function getShapeVerts(mode: ShapeMode, petals: number, r: number, d: number): Float32Array {
  switch (mode) {
    case 'polygon':
      return getPolygonVerts(petals);
    case 'polar':
      return getPolarVerts(petals, d);
    case 'spirograph':
    default:
      return getSpirographVerts(petals, r, d);
  }
}

// --- Constants ---

const _tmpColor = new THREE.Color();

// Pitch routing
const WAVE_PITCH_MIN = 0;
const WAVE_PITCH_MAX = 5;
const WARP_PITCH_MIN = 6;
const WARP_PITCH_MAX = 11;
const SHAKE_PITCH_MIN = 12;
const SHAKE_PITCH_MAX = 23;
const PULSE_PITCH_MIN = 24;
const PULSE_PITCH_MAX = 35;
const SHAPE_PITCH_MIN = 36;
const SHAPE_PITCH_MAX = 84;
const GLOW_PITCH_MIN = 85;
const GLOW_PITCH_MAX = 96;

// Wobble defaults
const WAVE_FREQ_MIN = 2.0;
const WAVE_FREQ_MAX = 14.0;
const WAVE_SPEED = 1.8;
const WARP_FOLD_MIN = 3.0;
const WARP_FOLD_MAX = 8.0;
const EFFECT_LERP = 0.08;

// Max vertices across all batched shapes (4 per edge now)
const MAX_VERTS = 80000;

// --- Shaders for thick lines ---
const vertShader = /* glsl */ `
attribute vec3 aOther;
attribute float aSide;
varying float vEdgeDist;
varying vec3 vColor;

uniform vec2 uResolution;
uniform float uLineWidth;

void main() {
  vColor = color;
  vEdgeDist = aSide;

  vec4 clipThis = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 clipOther = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);

  vec2 ndcThis = clipThis.xy / clipThis.w;
  vec2 ndcOther = clipOther.xy / clipOther.w;

  vec2 dir = ndcOther - ndcThis;
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  dir *= aspect;
  vec2 perp = normalize(vec2(-dir.y, dir.x));
  perp /= aspect;

  float thickNDC = uLineWidth / uResolution.y;
  clipThis.xy += perp * aSide * thickNDC * clipThis.w;

  gl_Position = clipThis;
}
`;

const fragShader = /* glsl */ `
varying float vEdgeDist;
varying vec3 vColor;

void main() {
  float dist = abs(vEdgeDist);
  float alpha = 1.0 - smoothstep(0.3, 1.0, dist);
  gl_FragColor = vec4(vColor * alpha, 1.0);
}
`;

// --- CPU displacement (matches the GPU GLSL version) ---

function applyWaveDisp(x: number, y: number, amp: number, freq: number, speed: number, time: number): [number, number] {
  const nx = x + Math.sin(y * freq + time * speed) * amp;
  const ny = y + Math.sin(x * freq * 1.3 + time * speed * 0.7) * amp;
  return [nx, ny];
}

function applyWarpDisp(x: number, y: number, amp: number, fold: number, time: number): [number, number] {
  const r = Math.sqrt(x * x + y * y) + 0.001;
  const theta = Math.atan2(y, x);
  const cosT = x / r;
  const sinT = y / r;
  const N = fold;
  const ts = time * 0.6;

  let dr = Math.sin(N * theta + ts * 1.3) * Math.cos(r * 3.0 + ts);
  dr += 0.5 * Math.sin(r * N + ts * 0.7) * Math.cos(N * theta - ts * 0.9);
  dr += 0.35 * Math.sin(2.0 * N * theta - ts * 1.1) * Math.sin(r * 4.0 + ts * 1.5);

  let dt = 0.4 * Math.sin((N - 1) * theta + ts * 0.8) * Math.cos(r * 2.0 + ts * 1.2);
  dt += 0.25 * Math.cos((N + 1) * theta - ts) * Math.sin(r * 3.5 - ts * 0.6);

  return [
    x + (dr * cosT - dt * sinT) * amp,
    y + (dr * sinT + dt * cosT) * amp,
  ];
}

function ShapeFlightVisual({ trackId }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const engineRef = useRef(getVisualPlaybackEngine());
  const accRotationRef = useRef(0);
  const lastBeatRef = useRef(-1);
  const accHueOffsetRef = useRef(0);
  const lastPulseCountRef = useRef(0);
  // Smooth interpolation targets for wobble
  const waveAmpSmooth = useRef(0);
  const waveFreqSmooth = useRef(WAVE_FREQ_MIN);
  const warpAmpSmooth = useRef(0);
  const warpFoldSmooth = useRef(WARP_FOLD_MIN);
  // Cached palette
  const cachedPaletteRef = useRef<{ key: string; stops: { t: number; h: number; s: number; l: number }[] } | null>(null);

  // Pre-allocated batch buffers
  const batchPos = useMemo(() => new Float32Array(MAX_VERTS * 3), []);
  const batchCol = useMemo(() => new Float32Array(MAX_VERTS * 3), []);
  const batchOther = useMemo(() => new Float32Array(MAX_VERTS * 3), []);
  const batchSide = useMemo(() => new Float32Array(MAX_VERTS), []);
  // Pre-filled index buffer: [0,1,2, 0,2,3, 4,5,6, 4,6,7, ...]
  const indexBuf = useMemo(() => {
    const maxQuads = MAX_VERTS / 4;
    const buf = new Uint32Array(maxQuads * 6);
    for (let q = 0; q < maxQuads; q++) {
      const base = q * 4;
      const idx = q * 6;
      buf[idx]     = base;
      buf[idx + 1] = base + 1;
      buf[idx + 2] = base + 2;
      buf[idx + 3] = base;
      buf[idx + 4] = base + 2;
      buf[idx + 5] = base + 3;
    }
    return buf;
  }, []);

  const geoRef = useRef<THREE.BufferGeometry>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();

  const uniforms = useMemo(() => ({
    uResolution: { value: new THREE.Vector2(size.width, size.height) },
    uLineWidth: { value: 6.0 },
  }), []);

  // Create the BufferGeometry with attributes once
  useEffect(() => {
    const geo = geoRef.current;
    if (!geo) return;
    geo.setAttribute('position', new THREE.BufferAttribute(batchPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(batchCol, 3));
    geo.setAttribute('aOther', new THREE.BufferAttribute(batchOther, 3));
    geo.setAttribute('aSide', new THREE.BufferAttribute(batchSide, 1));
    geo.setIndex(new THREE.BufferAttribute(indexBuf, 1));
    geo.setDrawRange(0, 0);
  }, [batchPos, batchCol, batchOther, batchSide, indexBuf]);

  useFrame(() => {
    const group = groupRef.current;
    const geo = geoRef.current;
    if (!group || !geo) return;
    const engine = engineRef.current;
    const vs = engine.getTrackState(trackId);
    if (!vs) return;

    const events = engine.getTrackEvents(trackId);
    if (!events || events.length === 0) {
      geo.setDrawRange(0, 0);
      return;
    }

    const hasPalette = vs.activePalette !== null;
    const par = vs.params;
    const speed         = (par.speed as number)         ?? 12;
    const spread        = (par.spread as number)        ?? 0;
    const farZ          = (par.farZ as number)          ?? 40;
    const shapeSize     = (par.shapeSize as number)     ?? 0.4;
    const hueStep       = (par.hueStep as number)       ?? 0.08;
    const baseHue       = (par.baseHue as number)       ?? 0.55;
    const saturation    = (par.saturation as number)    ?? 0.9;
    const lightness     = (par.lightness as number)     ?? 0.85;
    const rotationStep  = (par.rotationStep as number)  ?? 0.15;
    const rBase         = (par.rBase as number)         ?? 0.25;
    const dBase         = (par.dBase as number)         ?? 0.7;
    const shapeMode     = (par.shapeMode as ShapeMode)  ?? 'spirograph';
    const spawnRateDefault = (par.spawnRate as number)  ?? 8;
    const scaleDefault  = (par.scale as number)         ?? 1;
    const fadeOutZ      = (par.fadeOutZ as number)       ?? 10;
    const pulseSpeed    = (par.pulseSpeed as number)     ?? 200;
    const pulseDuration = (par.pulseDuration as number)  ?? 0.4;
    const pulseHue      = (par.pulseHue as number)       ?? 0.1;
    const shakeAmount   = (par.shakeAmount as number)    ?? 0.5;
    const shakeDecaySpd = (par.shakeDecay as number)     ?? 20;
    const shakeScale    = (par.shakeScale as number)     ?? 0.5;
    const burstMode     = (par.burstMode as BurstMode)   ?? 'noisy';
    const burstRadius   = (par.burstRadius as number)    ?? 3;
    const burstTwists   = (par.burstTwists as number)    ?? 4;
    const curveXDefault = (par.curveX as number)         ?? 0;
    const curveYDefault = (par.curveY as number)         ?? 0;
    const wobbleAmpScale = (par.wobbleAmp as number)     ?? 0.15;
    const warpAmpScale   = (par.warpAmp as number)       ?? 0.25;
    const glowAmount     = (par.glowAmount as number)    ?? 1;
    const glowPulseAmt   = (par.glowPulseAmount as number) ?? 3;
    const glowPulseDecay = (par.glowPulseDecay as number)  ?? 8;
    const approachGrowth = (par.approachGrowth as number)  ?? 0;
    const lineWidth      = (par.lineWidth as number)       ?? 6;

    // Update shader uniforms
    if (matRef.current) {
      matRef.current.uniforms.uResolution.value.set(size.width, size.height);
      matRef.current.uniforms.uLineWidth.value = lineWidth;
    }

    const currentBeat = useUIStore.getState().currentBeat;
    const bpm = useProjectStore.getState().project.bpm;
    const secPerBeat = 60 / bpm;
    const time = virtualClock.now() * 0.001;

    // Accumulate rotation
    const prevBeat = lastBeatRef.current;
    if (prevBeat >= 0) {
      const beatDelta = currentBeat - prevBeat;
      if (beatDelta > 0 && beatDelta < 2) {
        accRotationRef.current += rotationStep * beatDelta;
      }
    }
    lastBeatRef.current = currentBeat;

    // --- Collect effect events (pulse + shake) ---
    const pulseWindow = pulseDuration + farZ / pulseSpeed;
    interface PulseEvent { startSec: number; velocity: number; pitch: number; }
    interface ShakeEvent { startSec: number; velocity: number; }
    const activePulses: PulseEvent[] = [];
    const activeShakes: ShakeEvent[] = [];
    let pulseTotal = 0;

    let waveTarget = 0;
    let waveFreqTarget = waveFreqSmooth.current;
    let warpTarget = 0;
    let warpFoldTarget = warpFoldSmooth.current;
    let glowPulseBoost = 0;

    // Compute visible beat window for early exit on shape events
    const maxVisibleSecAgo = fadeOutZ / speed;
    const maxFutureSecAhead = farZ / speed;
    const minVisibleBeat = currentBeat - maxVisibleSecAgo / secPerBeat;
    const maxVisibleBeat = currentBeat + maxFutureSecAhead / secPerBeat;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.pitch >= SHAPE_PITCH_MIN && ev.pitch <= SHAPE_PITCH_MAX) {
        // Skip shape events that are clearly outside visible window
        if (ev.startTimeInBeats + ev.duration < minVisibleBeat) continue;
        if (ev.startTimeInBeats > maxVisibleBeat) break; // events are sorted
        continue;
      }

      const timeSinceBeats = currentBeat - ev.startTimeInBeats;
      const timeSinceSec = timeSinceBeats * secPerBeat;
      if (timeSinceSec < 0) continue;

      // Wobble: wave (0-5) and warp (6-11) — active while note is held
      if (ev.pitch <= WARP_PITCH_MAX) {
        const noteDurSec = ev.duration * secPerBeat;
        if (timeSinceSec <= noteDurSec) {
          if (ev.pitch <= WAVE_PITCH_MAX) {
            const t = (ev.pitch - WAVE_PITCH_MIN) / Math.max(1, WAVE_PITCH_MAX - WAVE_PITCH_MIN);
            waveFreqTarget = WAVE_FREQ_MIN + t * (WAVE_FREQ_MAX - WAVE_FREQ_MIN);
            waveTarget = (ev.velocity / 127) * wobbleAmpScale;
          } else {
            const t = (ev.pitch - WARP_PITCH_MIN) / Math.max(1, WARP_PITCH_MAX - WARP_PITCH_MIN);
            warpFoldTarget = WARP_FOLD_MIN + t * (WARP_FOLD_MAX - WARP_FOLD_MIN);
            warpTarget = (ev.velocity / 127) * warpAmpScale;
          }
        }
        continue;
      }

      if (ev.pitch < SHAKE_PITCH_MIN) continue;

      if (ev.pitch <= SHAKE_PITCH_MAX) {
        if (timeSinceSec < 0.5) {
          activeShakes.push({ startSec: timeSinceSec, velocity: ev.velocity });
        }
      } else if (ev.pitch <= PULSE_PITCH_MAX) {
        pulseTotal++;
        if (timeSinceSec < pulseWindow) {
          activePulses.push({ startSec: timeSinceSec, velocity: ev.velocity, pitch: ev.pitch });
        }
      } else if (ev.pitch >= GLOW_PITCH_MIN && ev.pitch <= GLOW_PITCH_MAX) {
        const glowDecay = Math.exp(-timeSinceSec * glowPulseDecay);
        if (glowDecay > 0.005) {
          glowPulseBoost += (ev.velocity / 127) * glowPulseAmt * glowDecay;
        }
      }
    }

    // Permanently jump accumulated hue offset for each new pulse event
    const prevPulseCount = lastPulseCountRef.current;
    if (!hasPalette) {
      if (pulseTotal > prevPulseCount) {
        accHueOffsetRef.current += (pulseTotal - prevPulseCount) * pulseHue;
      } else if (pulseTotal < prevPulseCount) {
        accHueOffsetRef.current = pulseTotal * pulseHue;
      }
    }
    lastPulseCountRef.current = pulseTotal;

    // --- Shake ---
    let shakeX = 0, shakeY = 0;
    let shakeScaleBump = 0;
    for (let si = 0; si < activeShakes.length; si++) {
      const s = activeShakes[si];
      const decay = Math.exp(-s.startSec * shakeDecaySpd);
      const intensity = (s.velocity / 127) * shakeAmount * decay;
      shakeX += Math.sin(s.startSec * 80 + si * 1.7) * intensity;
      shakeY += Math.cos(s.startSec * 97 + si * 2.3) * intensity;
      shakeScaleBump += (s.velocity / 127) * shakeScale * decay;
    }
    group.position.set(shakeX, shakeY, 0);

    // --- Wobble: smooth lerp ---
    waveAmpSmooth.current += (waveTarget - waveAmpSmooth.current) * EFFECT_LERP;
    waveFreqSmooth.current += (waveFreqTarget - waveFreqSmooth.current) * EFFECT_LERP;
    warpAmpSmooth.current += (warpTarget - warpAmpSmooth.current) * EFFECT_LERP;
    warpFoldSmooth.current += (warpFoldTarget - warpFoldSmooth.current) * EFFECT_LERP;

    const waveAmp = waveAmpSmooth.current;
    const waveFreq = waveFreqSmooth.current;
    const warpAmp = warpAmpSmooth.current;
    const warpFold = warpFoldSmooth.current;
    const hasWave = waveAmp > 0.0001;
    const hasWarp = warpAmp > 0.0001;

    // --- Build palette gradient stops (cached) ---
    let paletteStops: { t: number; h: number; s: number; l: number }[] | null = null;
    if (hasPalette && vs.activePalette) {
      const p = vs.activePalette;
      const key = `${p.primary}${p.secondary}${p.accent}${p.highlight}`;
      if (cachedPaletteRef.current?.key === key) {
        paletteStops = cachedPaletteRef.current.stops;
      } else {
        const pri = hexToHsl(p.primary);
        const sec = hexToHsl(p.secondary);
        const acc = hexToHsl(p.accent);
        const hlt = hexToHsl(p.highlight);
        paletteStops = [
          { t: 0,    h: pri.h, s: pri.s, l: pri.l },
          { t: 0.33, h: sec.h, s: sec.s, l: sec.l },
          { t: 0.66, h: acc.h, s: acc.s, l: acc.l },
          { t: 1,    h: hlt.h, s: hlt.s, l: hlt.l },
        ];
        cachedPaletteRef.current = { key, stops: paletteStops };
      }
    }

    // Cache automation lane lookups once per frame (avoids .find() per copy)
    const laneCurveX = engine.getAutomationLane(trackId, 'curveX');
    const laneCurveY = engine.getAutomationLane(trackId, 'curveY');
    const laneScale = engine.getAutomationLane(trackId, 'scale');
    const laneSpawnRate = engine.getAutomationLane(trackId, 'spawnRate');

    // === Batch rendering: write all shape vertices into a single geometry ===
    let vertIdx = 0;
    let shapeIdx = 0;

    for (let ei = 0; ei < events.length; ei++) {
      const ev = events[ei];
      if (ev.pitch < SHAPE_PITCH_MIN || ev.pitch > SHAPE_PITCH_MAX) continue;

      // Early exit: events sorted by startTimeInBeats
      if (ev.startTimeInBeats > maxVisibleBeat) break;
      if (ev.startTimeInBeats + ev.duration < minVisibleBeat) continue;

      // Derive shape from pitch
      const petals = Math.min(Math.max(ev.pitch - 45, 3), 20);
      const pitchNorm = (ev.pitch % 24) / 24;
      const r = rBase + pitchNorm * 0.3;
      const d = dBase + pitchNorm * 0.25;
      const copySpacing = 0.1 * (0.5 + (ev.pitch % 12) / 12 * 1.5);

      const noteSpawnRate = interpolateLane(laneSpawnRate, ev.startTimeInBeats, spawnRateDefault);
      const spawnInterval = 1 / noteSpawnRate;
      const noteEnd = ev.startTimeInBeats + ev.duration;
      const numCopies = Math.floor(ev.duration * noteSpawnRate);

      // Color for this note
      let hue: number, sat: number, lit: number;
      if (paletteStops) {
        const t = (shapeIdx * 0.35) % 1;
        let lo = 0;
        for (let si = 0; si < paletteStops.length - 1; si++) {
          if (t >= paletteStops[si].t) lo = si;
        }
        const hi = Math.min(lo + 1, paletteStops.length - 1);
        const seg = paletteStops[hi].t - paletteStops[lo].t;
        const frac = seg > 0 ? (t - paletteStops[lo].t) / seg : 0;
        let dh = paletteStops[hi].h - paletteStops[lo].h;
        if (dh > 0.5) dh -= 1;
        else if (dh < -0.5) dh += 1;
        hue = (paletteStops[lo].h + dh * frac + 1) % 1;
        sat = paletteStops[lo].s + (paletteStops[hi].s - paletteStops[lo].s) * frac;
        lit = paletteStops[lo].l + (paletteStops[hi].l - paletteStops[lo].l) * frac;
      } else {
        hue = (baseHue + shapeIdx * hueStep + accHueOffsetRef.current) % 1;
        sat = saturation;
        lit = lightness;
      }

      const spreadX = spread > 0 ? (Math.sin(shapeIdx * 7.31 + 0.5) * spread) : 0;
      const spreadY = spread > 0 ? (Math.cos(shapeIdx * 13.17 + 0.3) * spread) : 0;

      const shapeVerts = getShapeVerts(shapeMode, petals, r, d);
      const vertCount = shapeVerts.length / 2;

      for (let ci = 0; ci <= numCopies; ci++) {
        const copyBeat = ev.startTimeInBeats + ci * spawnInterval;
        if (copyBeat > noteEnd) break;

        const beatsAgo = currentBeat - copyBeat;
        const secondsAgo = beatsAgo * secPerBeat;
        const z = secondsAgo * speed;

        if (z < -farZ || z > fadeOutZ) continue;

        // Check if we have room in the batch (4 verts per edge)
        if (vertIdx + vertCount * 4 > MAX_VERTS) break;

        const approachProgress = 1 - Math.max(0, -z) / farZ;

        // --- Burst mode ---
        let bx = spreadX;
        let by = spreadY;
        const goldenAngle = 2.399963;
        const copyAngle = ci * goldenAngle + shapeIdx * 1.618;

        if (burstMode === 'linear') {
          const radius = approachProgress * burstRadius;
          bx = Math.cos(copyAngle) * radius;
          by = Math.sin(copyAngle) * radius;
        } else if (burstMode === 'spiralOut') {
          const radius = approachProgress * burstRadius;
          const windAngle = copyAngle + approachProgress * burstTwists * Math.PI * 2;
          const theta = approachProgress * Math.PI;
          const roseR = radius * (0.5 + 0.5 * Math.sin(burstTwists * theta));
          bx = roseR * Math.cos(windAngle);
          by = roseR * Math.sin(windAngle);
        } else if (burstMode === 'spiralIn') {
          const invProgress = 1 - approachProgress;
          const phi = copyAngle + approachProgress * burstTwists * Math.PI * 2;
          const theta = approachProgress * Math.PI * 0.8;
          const rosePetals = Math.max(2, Math.round(burstTwists));
          const roseModulation = 0.6 + 0.4 * Math.cos(rosePetals * phi);
          const radius = invProgress * burstRadius * roseModulation;
          bx = radius * Math.sin(theta) * Math.cos(phi);
          by = radius * Math.sin(theta) * Math.sin(phi);
        }

        // --- Curved flight path ---
        const cvx = interpolateLane(laneCurveX, copyBeat, curveXDefault);
        const cvy = interpolateLane(laneCurveY, copyBeat, curveYDefault);
        const invT = 1 - approachProgress;
        const posX = bx + cvx * invT * invT;
        const posY = by + cvy * invT * invT;
        const posZ = z;

        // Scale
        const copyScale = interpolateLane(laneScale, copyBeat, scaleDefault);
        const finalScale = shapeSize * copyScale * (1 + approachProgress * approachGrowth) * (1 + shakeScaleBump);

        // Rotation
        const rot = accRotationRef.current + ci * copySpacing;
        const cosR = Math.cos(rot);
        const sinR = Math.sin(rot);

        // --- Color pulse ---
        let pulseBlend = 0;
        for (let pi = 0; pi < activePulses.length; pi++) {
          const pulse = activePulses[pi];
          const distFromCamera = Math.max(0, -z);
          const travelTime = distFromCamera / pulseSpeed;
          const timeSinceArrival = pulse.startSec - travelTime;
          if (timeSinceArrival >= 0 && timeSinceArrival < pulseDuration) {
            const norm = timeSinceArrival / pulseDuration;
            const envelope = Math.exp(-norm * 3);
            const pitchN = (pulse.pitch - PULSE_PITCH_MIN) / (PULSE_PITCH_MAX - PULSE_PITCH_MIN);
            const pitchIntensity = 0.15 + pitchN * 0.85;
            const distanceFade = 1 - distFromCamera / farZ;
            const intensity = envelope * distanceFade * pitchIntensity * (pulse.velocity / 127);
            pulseBlend = Math.min(1, pulseBlend + intensity);
          }
        }

        // Glow
        const shapeLit = paletteStops ? lit : lightness;
        const shapeSat = paletteStops ? sat : saturation;
        const glowLightness = shapeLit + pulseBlend * (1 - shapeLit);
        // glowAmount is a direct brightness multiplier (0 = dim, 1 = normal, >1 = bloom)
        const pulseGlow = (1 + pulseBlend * 25) * glowPulseBoost;
        const glowBoost = glowAmount + pulseGlow * approachProgress;
        _tmpColor.setHSL(hue, shapeSat * (1 - pulseBlend * 0.7), glowLightness);
        _tmpColor.multiplyScalar(glowBoost);

        // Opacity baked into color (additive blending: darker = more transparent)
        let opacity: number;
        if (z > 0) {
          opacity = Math.max(0, 1 - z / fadeOutZ);
        } else {
          opacity = approachProgress;
        }
        const cr = _tmpColor.r * opacity;
        const cg = _tmpColor.g * opacity;
        const cb = _tmpColor.b * opacity;

        // Write quad vertices: for each edge v[i]→v[i+1], emit 4 vertices
        for (let v = 0; v < vertCount; v++) {
          const v0i = v;
          const v1i = (v + 1) % vertCount;

          // Local coords
          let lx0 = shapeVerts[v0i * 2], ly0 = shapeVerts[v0i * 2 + 1];
          let lx1 = shapeVerts[v1i * 2], ly1 = shapeVerts[v1i * 2 + 1];

          // Apply CPU displacement in local space (before transform)
          if (hasWave) {
            [lx0, ly0] = applyWaveDisp(lx0, ly0, waveAmp, waveFreq, WAVE_SPEED, time);
            [lx1, ly1] = applyWaveDisp(lx1, ly1, waveAmp, waveFreq, WAVE_SPEED, time);
          }
          if (hasWarp) {
            [lx0, ly0] = applyWarpDisp(lx0, ly0, warpAmp, warpFold, time);
            [lx1, ly1] = applyWarpDisp(lx1, ly1, warpAmp, warpFold, time);
          }

          // Scale + rotate (2D) + translate to world
          const wx0 = (lx0 * cosR - ly0 * sinR) * finalScale + posX;
          const wy0 = (lx0 * sinR + ly0 * cosR) * finalScale + posY;
          const wx1 = (lx1 * cosR - ly1 * sinR) * finalScale + posX;
          const wy1 = (lx1 * sinR + ly1 * cosR) * finalScale + posY;

          // v0: pos=A, other=B, side=-1
          const off0 = vertIdx * 3;
          batchPos[off0] = wx0; batchPos[off0 + 1] = wy0; batchPos[off0 + 2] = posZ;
          batchOther[off0] = wx1; batchOther[off0 + 1] = wy1; batchOther[off0 + 2] = posZ;
          batchCol[off0] = cr; batchCol[off0 + 1] = cg; batchCol[off0 + 2] = cb;
          batchSide[vertIdx] = -1;
          vertIdx++;

          // v1: pos=A, other=B, side=+1
          const off1 = vertIdx * 3;
          batchPos[off1] = wx0; batchPos[off1 + 1] = wy0; batchPos[off1 + 2] = posZ;
          batchOther[off1] = wx1; batchOther[off1 + 1] = wy1; batchOther[off1 + 2] = posZ;
          batchCol[off1] = cr; batchCol[off1 + 1] = cg; batchCol[off1 + 2] = cb;
          batchSide[vertIdx] = 1;
          vertIdx++;

          // v2: pos=B, other=A, side=+1
          const off2 = vertIdx * 3;
          batchPos[off2] = wx1; batchPos[off2 + 1] = wy1; batchPos[off2 + 2] = posZ;
          batchOther[off2] = wx0; batchOther[off2 + 1] = wy0; batchOther[off2 + 2] = posZ;
          batchCol[off2] = cr; batchCol[off2 + 1] = cg; batchCol[off2 + 2] = cb;
          batchSide[vertIdx] = 1;
          vertIdx++;

          // v3: pos=B, other=A, side=-1
          const off3 = vertIdx * 3;
          batchPos[off3] = wx1; batchPos[off3 + 1] = wy1; batchPos[off3 + 2] = posZ;
          batchOther[off3] = wx0; batchOther[off3 + 1] = wy0; batchOther[off3 + 2] = posZ;
          batchCol[off3] = cr; batchCol[off3 + 1] = cg; batchCol[off3 + 2] = cb;
          batchSide[vertIdx] = -1;
          vertIdx++;
        }
      }
      shapeIdx++;
    }

    // Update geometry
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
    const otherAttr = geo.getAttribute('aOther') as THREE.BufferAttribute;
    const sideAttr = geo.getAttribute('aSide') as THREE.BufferAttribute;
    if (!posAttr || !colAttr || !otherAttr || !sideAttr) return;
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    otherAttr.needsUpdate = true;
    sideAttr.needsUpdate = true;
    // Draw indexed triangles: vertIdx verts → (vertIdx / 4) quads → (vertIdx / 4) * 6 indices
    const numIndices = Math.floor(vertIdx / 4) * 6;
    geo.setDrawRange(0, numIndices);
  });

  return (
    <group ref={groupRef}>
      <mesh frustumCulled={false}>
        <bufferGeometry ref={geoRef} />
        <shaderMaterial
          ref={matRef}
          vertexShader={vertShader}
          fragmentShader={fragShader}
          uniforms={uniforms}
          vertexColors
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

export const ShapeFlight: Instrument = {
  id: 'shapeFlight',
  name: 'Shape Flight',
  description: 'Spirograph shapes stream toward the camera during MIDI notes, dissolving on arrival',
  icon: '🔷',
  color: '#8b5cf6',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',

  noteRange: { min: 0, max: 96 },
  rangeLabels: [
    { startPitch: 0, endPitch: 5, label: 'Wave' },
    { startPitch: 6, endPitch: 11, label: 'Warp' },
    { startPitch: 12, endPitch: 23, label: 'Shake' },
    { startPitch: 24, endPitch: 35, label: 'Pulse' },
    { startPitch: 36, endPitch: 84, label: 'Shapes' },
    { startPitch: 85, endPitch: 96, label: 'Glow' },
  ],

  defaultSettings: {
    speed: 12,
    spread: 0,
    farZ: 40,
    shapeSize: 0.4,
    shapeMode: 'spirograph',
    spawnRate: 8,
    scale: 1,
    rotationStep: 0.15,
    fadeOutZ: 10,
    hueStep: 0.08,
    baseHue: 0.55,
    saturation: 1.0,
    lightness: 0.55,
    rBase: 0.25,
    dBase: 0.7,
    pulseSpeed: 200,
    pulseDuration: 0.4,
    pulseHue: 0.25,
    shakeAmount: 0.5,
    shakeDecay: 20,
    shakeScale: 0.5,
    burstMode: 'noisy',
    burstRadius: 3,
    burstTwists: 4,
    curveX: 0,
    curveY: 0,
    wobbleAmp: 0.15,
    warpAmp: 0.25,
    glowAmount: 1.0,
    glowPulseAmount: 3,
    glowPulseDecay: 8,
    approachGrowth: 0,
    lineWidth: 6,
  },

  settingsSchema: {
    shapeMode:     { type: 'select', label: 'Shape Mode', options: [{ value: 'spirograph', label: 'Spirograph' }, { value: 'polygon', label: 'Polygon' }, { value: 'polar', label: 'Polar Graph' }], default: 'spirograph' },
    speed:         { type: 'number', label: 'Flight Speed',      min: 2,    max: 40,   step: 1,     default: 12 },
    spawnRate:     { type: 'number', label: 'Copies per Beat',    min: 1,    max: 32,   step: 1,     default: 8 },
    scale:         { type: 'number', label: 'Scale',              min: 0.1,  max: 5,    step: 0.1,   default: 1 },
    rotationStep:  { type: 'number', label: 'Rotation Step',      min: -1,   max: 1,    step: 0.01,  default: 0.15 },
    spread:        { type: 'number', label: 'Spread',             min: 0,    max: 10,   step: 0.5,   default: 0 },
    farZ:          { type: 'number', label: 'Spawn Depth',        min: 10,   max: 100,  step: 5,     default: 40 },
    shapeSize:     { type: 'number', label: 'Shape Size',         min: 0.1,  max: 2,    step: 0.1,   default: 0.4 },
    fadeOutZ:      { type: 'number', label: 'Fade Out Distance',  min: 2,    max: 30,   step: 1,     default: 10 },
    hueStep:       { type: 'number', label: 'Hue Step',           min: 0,    max: 0.5,  step: 0.01,  default: 0.08 },
    baseHue:       { type: 'number', label: 'Base Hue',           min: 0,    max: 1,    step: 0.05,  default: 0.55 },
    saturation:    { type: 'number', label: 'Saturation',         min: 0,    max: 1,    step: 0.05,  default: 1.0 },
    lightness:     { type: 'number', label: 'Lightness',          min: 0.1,  max: 1,    step: 0.05,  default: 0.55 },
    rBase:         { type: 'number', label: 'R Base',              min: 0.05, max: 0.5,  step: 0.01,  default: 0.25 },
    dBase:         { type: 'number', label: 'D Base',              min: 0.1,  max: 1.0,  step: 0.05,  default: 0.7 },
    pulseSpeed:    { type: 'number', label: 'Pulse Speed',         min: 5,    max: 500,  step: 5,     default: 200 },
    pulseDuration: { type: 'number', label: 'Pulse Duration',      min: 0.1,  max: 2,    step: 0.05,  default: 0.4 },
    pulseHue:      { type: 'number', label: 'Pulse Hue Jump',        min: -0.5, max: 0.5,  step: 0.05,  default: 0.25 },
    shakeAmount:   { type: 'number', label: 'Shake Amount',        min: 0.1,  max: 3,    step: 0.1,   default: 0.5 },
    shakeDecay:    { type: 'number', label: 'Shake Decay',         min: 5,    max: 50,   step: 1,     default: 20 },
    shakeScale:    { type: 'number', label: 'Shake Scale Bump',    min: 0,    max: 2,    step: 0.1,   default: 0.5 },
    burstMode:     { type: 'select', label: 'Burst Mode', options: [{ value: 'noisy', label: 'Noisy (Random)' }, { value: 'linear', label: 'Linear Radial' }, { value: 'spiralOut', label: 'Spiral Out' }, { value: 'spiralIn', label: 'Spiral In' }], default: 'noisy' },
    burstRadius:   { type: 'number', label: 'Burst Radius',        min: 0.5,  max: 10,   step: 0.5,   default: 3 },
    burstTwists:   { type: 'number', label: 'Burst Twists',        min: 1,    max: 12,   step: 0.5,   default: 4 },
    curveX:        { type: 'number', label: 'Path Curve X',        min: -20,  max: 20,   step: 0.5,   default: 0 },
    curveY:        { type: 'number', label: 'Path Curve Y',        min: -20,  max: 20,   step: 0.5,   default: 0 },
    wobbleAmp:     { type: 'number', label: 'Wave Wobble Amp',     min: 0.01, max: 1,    step: 0.01,  default: 0.15 },
    warpAmp:       { type: 'number', label: 'Warp Wobble Amp',     min: 0.01, max: 1,    step: 0.01,  default: 0.25 },
    glowAmount:    { type: 'number', label: 'Glow Amount',          min: 0,    max: 5,    step: 0.1,   default: 1.0 },
    glowPulseAmount: { type: 'number', label: 'Glow Pulse Amount', min: 0.5,  max: 15,   step: 0.5,   default: 3 },
    glowPulseDecay:  { type: 'number', label: 'Glow Pulse Decay',  min: 1,    max: 30,   step: 1,     default: 8 },
    approachGrowth:  { type: 'number', label: 'Approach Growth',    min: 0,    max: 20,   step: 0.5,   default: 0 },
    lineWidth:       { type: 'number', label: 'Line Width',         min: 1,    max: 100,  step: 0.5,   default: 6 },
  },

  colorRoleMapping: [
    { role: 'primary', param: 'baseHue',    type: 'hsl-hue' },
    { role: 'primary', param: 'saturation', type: 'hsl-sat' },
    { role: 'primary', param: 'lightness',  type: 'hsl-light' },
  ],

  VisualComponent: ShapeFlightVisual,
};

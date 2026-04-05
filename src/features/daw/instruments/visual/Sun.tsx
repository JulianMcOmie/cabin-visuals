'use client';

import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { Instrument } from '../types';
import { virtualClock } from '@daw/core/virtualClock';

// MIDI pitch mappings
const PITCH_FLASH = 48;
const PITCH_COLOR_PULSE = 49;

// Vivid color cycle for color pulse (HSV hues)
const PULSE_COLORS = [
  0.58,  // Electric blue
  0.83,  // Hot magenta
  0.30,  // Neon green
  0.12,  // Gold
  0.50,  // Cyan
  0.75,  // Purple
];

const DEFAULTS = {
  size: 3,
  intensity: 1.5,
  baseHue: 0.08,
  turbulence: 0.8,
  speed: 0.5,
  coronaSize: 0.3,
  z: -10,
};

const vertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uBaseHue;
  uniform float uTurbulence;
  uniform float uSpeed;
  uniform float uFlashMix;   // 0 = normal, 1 = full flash
  uniform float uFlashPhase; // 0 = complementary afterglow, 1 = white-hot initial burst
  uniform float uColorPulseMix;
  uniform float uColorPulseHue;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;

  // Simplex-style noise helpers
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  float fbm(vec3 p) {
    float f = 0.0;
    f += 0.5 * snoise(p); p *= 2.01;
    f += 0.25 * snoise(p); p *= 2.02;
    f += 0.125 * snoise(p); p *= 2.03;
    f += 0.0625 * snoise(p);
    return f;
  }

  // HSV to RGB
  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    float t = uTime * uSpeed;

    // Spherical coordinates for noise sampling
    vec3 noisePos = vPosition * 1.5 + vec3(t * 0.3, t * 0.2, t * 0.1);
    float noise = fbm(noisePos * uTurbulence) * uTurbulence;

    // Viewing angle for limb darkening
    float facing = dot(vNormal, vec3(0.0, 0.0, 1.0));
    float limbDarkening = pow(max(facing, 0.0), 0.6);

    // Radial gradient: white center -> hue at edges
    float edgeFactor = 1.0 - limbDarkening;

    // Fire color based on hue param + noise
    float hue = uBaseHue + noise * 0.05;
    float saturation = 0.3 + edgeFactor * 0.7 + noise * 0.1;
    float value = (0.8 + noise * 0.2) * limbDarkening * uIntensity;

    // Core is whiter (lower saturation, higher value)
    float coreFactor = pow(limbDarkening, 2.0);
    saturation *= (1.0 - coreFactor * 0.6);
    value = value + coreFactor * 0.5 * uIntensity;

    vec3 baseColor = hsv2rgb(vec3(hue, clamp(saturation, 0.0, 1.0), clamp(value, 0.0, 3.0)));

    // Flash effect: two-phase color shift
    if (uFlashMix > 0.0) {
      vec3 flashWhite = hsv2rgb(vec3(hue, saturation * 0.15, clamp(value * 2.5, 0.0, 4.0)));
      float compHue = fract(hue + 0.5);
      vec3 flashComp = hsv2rgb(vec3(compHue, clamp(saturation + 0.3, 0.0, 1.0), clamp(value * 1.8, 0.0, 3.5)));
      vec3 flashColor = mix(flashComp, flashWhite, uFlashPhase);
      baseColor = mix(baseColor, flashColor, uFlashMix);
    }

    // Color pulse: vivid saturated color wash
    if (uColorPulseMix > 0.0) {
      float pulseValue = clamp(value * 2.0, 0.0, 3.5);
      // Bright core, saturated edges
      float pulseSat = mix(0.7, 0.95, edgeFactor);
      vec3 pulseColor = hsv2rgb(vec3(uColorPulseHue, pulseSat, pulseValue));
      baseColor = mix(baseColor, pulseColor, uColorPulseMix);
    }

    gl_FragColor = vec4(baseColor, 1.0);
  }
`;

const coronaVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const coronaFragmentShader = `
  uniform float uIntensity;
  uniform float uBaseHue;
  uniform float uCoronaSize;
  uniform float uTime;
  uniform float uSpeed;
  uniform float uTurbulence;
  uniform float uFlashMix;
  uniform float uFlashPhase;
  uniform float uColorPulseMix;
  uniform float uColorPulseHue;

  varying vec2 vUv;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 center = vUv * 2.0 - 1.0;
    float dist = length(center);

    // Inner sphere occupies ~0.5 of the quad, corona extends beyond
    float innerRadius = 0.5;
    float outerRadius = innerRadius + uCoronaSize * 0.5;

    if (dist < innerRadius || dist > outerRadius) discard;

    float t = uTime * uSpeed;
    float angle = atan(center.y, center.x);
    float noiseVal = snoise(vec3(angle * 2.0, dist * 3.0, t * 0.5)) * uTurbulence * 0.5;

    float falloff = 1.0 - smoothstep(innerRadius, outerRadius, dist - noiseVal * 0.1);
    falloff = pow(falloff, 2.0);

    float hue = uBaseHue + noiseVal * 0.03;
    vec3 baseColor = hsv2rgb(vec3(hue, 0.6, uIntensity * falloff));
    float baseAlpha = falloff * 0.6 * uIntensity;

    if (uFlashMix > 0.0) {
      vec3 flashWhite = hsv2rgb(vec3(hue, 0.1, uIntensity * falloff * 2.5));
      float compHue = fract(hue + 0.5);
      vec3 flashComp = hsv2rgb(vec3(compHue, 0.8, uIntensity * falloff * 1.8));
      vec3 flashColor = mix(flashComp, flashWhite, uFlashPhase);
      baseColor = mix(baseColor, flashColor, uFlashMix);
      baseAlpha = mix(baseAlpha, min(1.0, baseAlpha * 2.0), uFlashMix);
    }

    if (uColorPulseMix > 0.0) {
      vec3 pulseColor = hsv2rgb(vec3(uColorPulseHue, 0.85, uIntensity * falloff * 2.0));
      baseColor = mix(baseColor, pulseColor, uColorPulseMix);
      baseAlpha = mix(baseAlpha, min(1.0, baseAlpha * 1.8), uColorPulseMix);
    }

    gl_FragColor = vec4(baseColor, baseAlpha);
  }
`;

function SunVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const engineRef = useRef(getVisualPlaybackEngine());
  const sunMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const coronaMatRef = useRef<THREE.ShaderMaterial | null>(null);
  const sunMeshRef = useRef<THREE.Mesh | null>(null);
  const coronaMeshRef = useRef<THREE.Mesh | null>(null);
  const elapsedRef = useRef(0);
  const prevCounts = useRef(new Map<number, number>());

  // Flash state: array of spawn times for overlapping flashes
  interface FlashEvent { spawnTime: number; }
  const flashes = useRef<FlashEvent[]>([]);

  // Color pulse state
  interface ColorPulseEvent { spawnTime: number; hue: number; }
  const colorPulses = useRef<ColorPulseEvent[]>([]);
  const pulseColorIdx = useRef(0);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    // Sun sphere
    const sunGeom = new THREE.SphereGeometry(1, 64, 64);
    const sunMat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: DEFAULTS.intensity },
        uBaseHue: { value: DEFAULTS.baseHue },
        uTurbulence: { value: DEFAULTS.turbulence },
        uSpeed: { value: DEFAULTS.speed },
        uFlashMix: { value: 0 },
        uFlashPhase: { value: 0 },
        uColorPulseMix: { value: 0 },
        uColorPulseHue: { value: 0 },
      },
    });
    const sunMesh = new THREE.Mesh(sunGeom, sunMat);
    group.add(sunMesh);
    sunMeshRef.current = sunMesh;
    sunMatRef.current = sunMat;

    // Corona quad (billboard plane)
    const coronaGeom = new THREE.PlaneGeometry(1, 1);
    const coronaMat = new THREE.ShaderMaterial({
      vertexShader: coronaVertexShader,
      fragmentShader: coronaFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: DEFAULTS.intensity },
        uBaseHue: { value: DEFAULTS.baseHue },
        uCoronaSize: { value: DEFAULTS.coronaSize },
        uSpeed: { value: DEFAULTS.speed },
        uTurbulence: { value: DEFAULTS.turbulence },
        uFlashMix: { value: 0 },
        uFlashPhase: { value: 0 },
        uColorPulseMix: { value: 0 },
        uColorPulseHue: { value: 0 },
      },
    });
    const coronaMesh = new THREE.Mesh(coronaGeom, coronaMat);
    group.add(coronaMesh);
    coronaMeshRef.current = coronaMesh;
    coronaMatRef.current = coronaMat;

    return () => {
      group.remove(sunMesh);
      group.remove(coronaMesh);
      sunGeom.dispose();
      sunMat.dispose();
      coronaGeom.dispose();
      coronaMat.dispose();
    };
  }, []);

  useFrame((_state, delta) => {
    const group = groupRef.current;
    const sunMat = sunMatRef.current;
    const coronaMat = coronaMatRef.current;
    if (!group || !sunMat || !coronaMat) return;

    const tState = engineRef.current.getTrackState(trackId);
    if (!tState) return;

    const dt = Math.min(delta, 0.05);
    elapsedRef.current += dt;

    const size = (tState.params.size as number) ?? DEFAULTS.size;
    const intensity = (tState.params.intensity as number) ?? DEFAULTS.intensity;
    const baseHue = (tState.params.baseHue as number) ?? DEFAULTS.baseHue;
    const turbulence = (tState.params.turbulence as number) ?? DEFAULTS.turbulence;
    const speed = (tState.params.speed as number) ?? DEFAULTS.speed;
    const coronaSize = (tState.params.coronaSize as number) ?? DEFAULTS.coronaSize;
    const z = (tState.params.z as number) ?? DEFAULTS.z;

    // MIDI flash on beat
    const now = virtualClock.now();
    const prev = prevCounts.current;
    for (const [pitch, cnt] of tState.pitchNoteOnCounts) {
      const prevVal = prev.get(pitch) ?? 0;
      if (cnt <= prevVal) continue;
      const noteDelta = cnt - prevVal;
      if (pitch === PITCH_FLASH) {
        for (let i = 0; i < noteDelta; i++) {
          flashes.current.push({ spawnTime: now });
        }
      }
      if (pitch === PITCH_COLOR_PULSE) {
        for (let i = 0; i < noteDelta; i++) {
          const hue = PULSE_COLORS[pulseColorIdx.current % PULSE_COLORS.length];
          pulseColorIdx.current++;
          colorPulses.current.push({ spawnTime: now, hue });
        }
      }
    }
    prevCounts.current = new Map(tState.pitchNoteOnCounts);

    // Clean expired flashes (600ms lifetime)
    flashes.current = flashes.current.filter(f => now - f.spawnTime < 600);
    colorPulses.current = colorPulses.current.filter(f => now - f.spawnTime < 800);

    // Compute flash envelope (instant attack, exponential release)
    let flashMix = 0;
    let newestSpawn = 0;
    for (let i = 0; i < flashes.current.length; i++) {
      const spawn = flashes.current[i].spawnTime;
      const age = (now - spawn) / 1000;
      const attack = Math.min(1, age / 0.008); // ~8ms attack
      const release = Math.exp(-age * 8);
      flashMix = Math.min(1, flashMix + attack * release);
      if (spawn > newestSpawn) newestSpawn = spawn;
    }
    const flashAge = newestSpawn > 0 ? (now - newestSpawn) / 1000 : 0;
    const flashPhase = Math.max(0, 1 - flashAge * 12);

    // Compute color pulse envelope (slower decay for lingering color wash)
    let colorPulseMix = 0;
    let colorPulseHue = 0;
    let newestPulseSpawn = 0;
    for (let i = 0; i < colorPulses.current.length; i++) {
      const pulse = colorPulses.current[i];
      const age = (now - pulse.spawnTime) / 1000;
      const attack = Math.min(1, age / 0.01);
      const release = Math.exp(-age * 5);
      const contribution = attack * release;
      if (pulse.spawnTime > newestPulseSpawn) {
        newestPulseSpawn = pulse.spawnTime;
        colorPulseHue = pulse.hue;
      }
      colorPulseMix = Math.min(1, colorPulseMix + contribution);
    }

    const totalIntensity = intensity + flashMix * 2.0 + colorPulseMix * 1.0;

    // Position & scale — flash adds a scale punch
    group.position.z = z;
    const scalePunch = 1 + flashMix * 0.15 * flashPhase; // brief 15% swell on hit
    group.scale.setScalar(size * scalePunch);

    // Scale corona quad — corona flares out more during flash
    const coronaMesh = coronaMeshRef.current;
    if (coronaMesh) {
      const coronaFlare = coronaSize + flashMix * 0.8; // corona expands during flash
      const coronaScale = 2.0 + coronaFlare * 2.0;
      coronaMesh.scale.set(coronaScale, coronaScale, 1);
    }

    // Update sun uniforms
    const t = elapsedRef.current;
    sunMat.uniforms.uTime.value = t;
    sunMat.uniforms.uIntensity.value = totalIntensity;
    sunMat.uniforms.uBaseHue.value = baseHue;
    sunMat.uniforms.uTurbulence.value = turbulence;
    sunMat.uniforms.uSpeed.value = speed;
    sunMat.uniforms.uFlashMix.value = flashMix;
    sunMat.uniforms.uFlashPhase.value = flashPhase;
    sunMat.uniforms.uColorPulseMix.value = colorPulseMix;
    sunMat.uniforms.uColorPulseHue.value = colorPulseHue;

    // Update corona uniforms
    coronaMat.uniforms.uTime.value = t;
    coronaMat.uniforms.uIntensity.value = totalIntensity;
    coronaMat.uniforms.uBaseHue.value = baseHue;
    coronaMat.uniforms.uCoronaSize.value = coronaSize + flashMix * 0.8;
    coronaMat.uniforms.uSpeed.value = speed;
    coronaMat.uniforms.uTurbulence.value = turbulence;
    coronaMat.uniforms.uFlashMix.value = flashMix;
    coronaMat.uniforms.uFlashPhase.value = flashPhase;
    coronaMat.uniforms.uColorPulseMix.value = colorPulseMix;
    coronaMat.uniforms.uColorPulseHue.value = colorPulseHue;
  });

  return <group ref={groupRef} />;
}

export const Sun: Instrument = {
  id: 'sun',
  name: 'Sun',
  description: 'Fiery glowing orb with animated noise surface, limb darkening, and corona glow',
  icon: '☀',
  color: '#ff9d00',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',
  noteRange: { min: 36, max: 96 },
  rangeLabels: [
    { startPitch: PITCH_FLASH, endPitch: PITCH_FLASH, label: 'Flash' },
    { startPitch: PITCH_COLOR_PULSE, endPitch: PITCH_COLOR_PULSE, label: 'Color Pulse' },
  ],

  defaultSettings: { ...DEFAULTS },

  settingsSchema: {
    size: {
      type: 'number', label: 'Size', min: 0.01, max: 50, step: 0.1,
      default: DEFAULTS.size,
    },
    intensity: {
      type: 'number', label: 'Intensity', min: 0.1, max: 3, step: 0.1,
      default: DEFAULTS.intensity,
    },
    baseHue: {
      type: 'number', label: 'Base Hue', min: 0, max: 1, step: 0.01,
      default: DEFAULTS.baseHue,
    },
    turbulence: {
      type: 'number', label: 'Turbulence', min: 0, max: 2, step: 0.1,
      default: DEFAULTS.turbulence,
    },
    speed: {
      type: 'number', label: 'Speed', min: 0, max: 3, step: 0.1,
      default: DEFAULTS.speed,
    },
    coronaSize: {
      type: 'number', label: 'Corona Size', min: 0, max: 2, step: 0.1,
      default: DEFAULTS.coronaSize,
    },
    z: {
      type: 'number', label: 'Depth (Z)', min: -200, max: 0, step: 0.5,
      default: DEFAULTS.z,
    },
  },

  VisualComponent: SunVisual,
};

'use client';

import { useRef, useEffect } from 'react';
import { useFrame, extend, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { Instrument } from '../types';

extend({ Line2, LineMaterial, LineGeometry });

// --- Configuration ---
const POINT_COUNT = 2048;
const DEFAULT_CYCLES = 8;
const DEFAULT_MIN_RADIUS = 0;
const DEFAULT_MAX_RADIUS = 5;
const LINE_WIDTH = 1.5;

// --- Color palettes (DotField HSL scheme) ---
// Each palette defines hue (0-360), saturation (0-100), lightness (0-100)
interface PolarPalette {
  hue: number;
  saturation: number;
  lightness: number;
}

const PALETTES: Record<string, PolarPalette> = {
  gold:    { hue: 45,  saturation: 80, lightness: 55 },
  azure:   { hue: 200, saturation: 70, lightness: 50 },
  rose:    { hue: 340, saturation: 75, lightness: 55 },
  emerald: { hue: 150, saturation: 65, lightness: 45 },
  violet:  { hue: 270, saturation: 70, lightness: 55 },
};

// --- MIDI pitch mappings ---
// Jitter + freq shift: 48-59 (12 notes)
const PITCH_JITTER_MIN = 48;
const PITCH_JITTER_MAX = 59;
// Palette toggles: 60-63
const PITCH_PAL_AZURE = 60;
const PITCH_PAL_ROSE = 61;
const PITCH_PAL_EMERALD = 62;
const PITCH_PAL_VIOLET = 63;

// --- Oscillator layer definitions ---

interface OscillatorDef {
  freqBase: number;
  freqDrift: number;
  freqRate: number;
  ampBase: number;
  ampDrift: number;
  ampRate: number;
  phaseRate: number;
  phaseModDepth: number;
  phaseModRate: number;
  lightnessOffset: number; // added to palette lightness for per-layer depth
}

const OSCILLATORS: OscillatorDef[] = [
  {
    freqBase: 3.0, freqDrift: 0.6, freqRate: 0.09,
    ampBase: 0.55, ampDrift: 0.15, ampRate: 0.13,
    phaseRate: 0.05, phaseModDepth: 0.4, phaseModRate: 0.07,
    lightnessOffset: 0.02,
  },
  {
    freqBase: 5.0, freqDrift: 0.9, freqRate: 0.07,
    ampBase: 0.42, ampDrift: 0.12, ampRate: 0.19,
    phaseRate: -0.08, phaseModDepth: 0.5, phaseModRate: 0.11,
    lightnessOffset: 0.05,
  },
  {
    freqBase: 8.0, freqDrift: 1.4, freqRate: 0.11,
    ampBase: 0.32, ampDrift: 0.10, ampRate: 0.23,
    phaseRate: 0.12, phaseModDepth: 0.6, phaseModRate: 0.09,
    lightnessOffset: 0.08,
  },
  {
    freqBase: 13.0, freqDrift: 1.8, freqRate: 0.05,
    ampBase: 0.22, ampDrift: 0.08, ampRate: 0.31,
    phaseRate: -0.15, phaseModDepth: 0.8, phaseModRate: 0.13,
    lightnessOffset: 0.10,
  },
  {
    freqBase: 6.5, freqDrift: 2.2, freqRate: 0.06,
    ampBase: 0.35, ampDrift: 0.10, ampRate: 0.17,
    phaseRate: 0.03, phaseModDepth: 0.5, phaseModRate: 0.08,
    lightnessOffset: 0.04,
  },
  {
    freqBase: 2.0, freqDrift: 0.4, freqRate: 0.13,
    ampBase: 0.30, ampDrift: 0.10, ampRate: 0.11,
    phaseRate: 0.04, phaseModDepth: 0.3, phaseModRate: 0.05,
    lightnessOffset: -0.02,
  },
];

const LAYER_COUNT = OSCILLATORS.length;

// Frequency multiplier per jitter note (0-11)
const FREQ_MULTIPLIERS = [
  0.60, 0.70, 0.80, 0.90, 1.00, 1.10,
  1.25, 1.40, 1.60, 1.80, 2.00, 2.30,
];

// --- Types ---

interface CurveObjects {
  line: Line2;
  geometry: LineGeometry;
  material: LineMaterial;
}

interface JitterNote {
  pitchIdx: number;
  velScale: number;
}

// ---------------------------------------------------------------------------
// Radius computation
// ---------------------------------------------------------------------------

function layerRadius(
  theta: number,
  t: number,
  phi: number,
  osc: OscillatorDef,
  speed: number,
  freqMult: number,
  minR: number,
  maxR: number,
): number {
  const st = t * speed;

  const baseR =
    1.0 +
    0.12 * Math.sin(st * 0.19 + phi) +
    0.08 * Math.sin(st * 0.31 + phi * 0.5);

  const freq =
    (osc.freqBase * freqMult) +
    osc.freqDrift * Math.sin(st * osc.freqRate + phi * 0.3);

  const amp = osc.ampBase + osc.ampDrift * Math.sin(st * osc.ampRate + phi * 1.3);

  const phase =
    st * osc.phaseRate +
    osc.phaseModDepth * Math.sin(st * osc.phaseModRate + phi * 0.7);

  const raw = baseR + minR + amp * Math.cos(freq * theta + phase);

  return Math.min(maxR, raw);
}

// ---------------------------------------------------------------------------
// Line helpers
// ---------------------------------------------------------------------------

function makeLine(
  group: THREE.Group,
  resolution: THREE.Vector2,
  lineWidth: number,
): CurveObjects {
  const positions = new Array((POINT_COUNT + 1) * 3).fill(0);
  for (let i = 0; i <= POINT_COUNT; i++) {
    const a = (i / POINT_COUNT) * Math.PI * 2;
    positions[i * 3] = Math.cos(a);
    positions[i * 3 + 1] = Math.sin(a);
  }

  const geometry = new LineGeometry();
  geometry.setPositions(positions);

  const material = new LineMaterial({
    color: 0xffffff,
    linewidth: lineWidth,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    resolution,
    worldUnits: false,
  });

  const line = new Line2(geometry, material);
  line.computeLineDistances();
  group.add(line);

  return { line, geometry, material };
}

function updateLayerCurve(
  geometry: LineGeometry,
  line: Line2,
  t: number,
  phi: number,
  osc: OscillatorDef,
  speed: number,
  cycles: number,
  freqMult: number,
  jitterNotes: JitterNote[],
  minR: number,
  maxR: number,
): void {
  const positions: number[] = [];
  const totalAngle = cycles * Math.PI * 2;

  for (let i = 0; i <= POINT_COUNT; i++) {
    const theta = (i / POINT_COUNT) * totalAngle;
    let r = layerRadius(theta, t, phi, osc, speed, freqMult, minR, maxR);

    // Jitter from held MIDI notes
    for (let j = 0; j < jitterNotes.length; j++) {
      const { pitchIdx, velScale } = jitterNotes[j];
      const normPitch = pitchIdx / 11;
      const amp = 0.02 + normPitch * 0.06;
      const freq = 30 + pitchIdx * 7;
      const pPhase = theta * (1 + pitchIdx * 0.5);
      const sharpness = 0.2 + normPitch * 0.6;
      const raw = Math.sin(t * freq + pPhase);
      const shaped = Math.sign(raw) * Math.pow(Math.abs(raw), 1 - sharpness);
      r += shaped * amp * velScale;
    }

    positions.push(r * Math.cos(theta), r * Math.sin(theta), 0);
  }

  geometry.setPositions(positions);
  line.computeLineDistances();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function NeonPolarVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const engineRef = useRef(getVisualPlaybackEngine());
  const layerLinesRef = useRef<CurveObjects[]>([]);
  const timeRef = useRef(0);
  const paletteKey = useRef('gold');
  const prevCounts = useRef(new Map<number, number>());
  const { size } = useThree();
  const resolutionRef = useRef(new THREE.Vector2(size.width, size.height));
  const scratchColor = useRef(new THREE.Color());

  useEffect(() => {
    resolutionRef.current.set(size.width, size.height);
    for (const c of layerLinesRef.current)
      c.material.resolution.set(size.width, size.height);
  }, [size.width, size.height]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;

    const lines: CurveObjects[] = [];
    for (let i = 0; i < LAYER_COUNT; i++) {
      lines.push(makeLine(group, resolutionRef.current, LINE_WIDTH));
    }
    layerLinesRef.current = lines;

    return () => {
      for (const c of layerLinesRef.current) {
        group.remove(c.line);
        c.geometry.dispose();
        c.material.dispose();
      }
      layerLinesRef.current = [];
    };
  }, []);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const state = engineRef.current.getTrackState(trackId);
    if (!state) return;

    const speed = (state.params.speed as number) ?? 1;
    const complexity = (state.params.complexity as number) ?? 1;
    const lineWidth = (state.params.lineWidth as number) ?? LINE_WIDTH;
    const cycles = (state.params.cycles as number) ?? DEFAULT_CYCLES;
    const minRadius = (state.params.minRadius as number) ?? DEFAULT_MIN_RADIUS;
    const maxRadius = (state.params.maxRadius as number) ?? DEFAULT_MAX_RADIUS;

    timeRef.current += delta;
    const t = timeRef.current;

    const prev = prevCounts.current;

    // --- MIDI: jitter notes + freq shift + palette toggles ---
    const jitterNotes: JitterNote[] = [];
    let freqMult = 1.0;
    let heldCount = 0;
    let multAccum = 0;

    for (const [pitch, event] of state.activeNotes) {
      if (pitch >= PITCH_JITTER_MIN && pitch <= PITCH_JITTER_MAX) {
        const pitchIdx = pitch - PITCH_JITTER_MIN;
        jitterNotes.push({ pitchIdx, velScale: event.velocity / 127 });
        multAccum += FREQ_MULTIPLIERS[pitchIdx];
        heldCount++;
      }
    }
    if (heldCount > 0) {
      freqMult = multAccum / heldCount;
    }

    // Palette toggles (MetronomeBalls paradigm: odd note-on count toggles)
    const palPitches: [number, string][] = [
      [PITCH_PAL_AZURE, 'azure'],
      [PITCH_PAL_ROSE, 'rose'],
      [PITCH_PAL_EMERALD, 'emerald'],
      [PITCH_PAL_VIOLET, 'violet'],
    ];

    for (const [pp, key] of palPitches) {
      const cnt = state.pitchNoteOnCounts.get(pp) ?? 0;
      const prevVal = prev.get(pp) ?? 0;
      const d = cnt - prevVal;
      if (d > 0 && d % 2 === 1) {
        paletteKey.current = paletteKey.current === key ? 'gold' : key;
      }
    }

    prevCounts.current = new Map(state.pitchNoteOnCounts);

    // --- Resolve current palette ---
    const pal = PALETTES[paletteKey.current] ?? PALETTES.gold;
    const baseH = pal.hue / 360;
    const baseS = pal.saturation / 100;
    const baseL = pal.lightness / 100;

    const sc = scratchColor.current;

    // --- Update each oscillator layer ---
    for (let i = 0; i < layerLinesRef.current.length; i++) {
      const curve = layerLinesRef.current[i];
      const osc = OSCILLATORS[i];

      const effectiveOsc =
        i >= 2
          ? { ...osc, ampBase: osc.ampBase * complexity, ampDrift: osc.ampDrift * complexity }
          : osc;

      updateLayerCurve(
        curve.geometry, curve.line, t, 0, effectiveOsc, speed, cycles,
        freqMult, jitterNotes, minRadius, maxRadius,
      );

      // Color from palette + per-layer lightness offset
      const layerL = Math.max(0.1, Math.min(0.9, baseL + osc.lightnessOffset));
      sc.setHSL(baseH, baseS, layerL);
      curve.material.color.copy(sc);
      curve.material.opacity = 0.75;
      curve.material.linewidth = lineWidth;
    }
  });

  return <group ref={groupRef} />;
}

// ---------------------------------------------------------------------------
// Instrument export
// ---------------------------------------------------------------------------

export const NeonPolar: Instrument = {
  id: 'neonPolar',
  name: 'Neon Polar',
  description:
    'Polar harmonograph — 6 oscillator layers with drifting frequencies, MIDI jitter, frequency shifting, and palette control',
  icon: '💫',
  color: '#d4a843',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',
  noteRange: { min: PITCH_JITTER_MIN, max: PITCH_PAL_VIOLET },
  rangeLabels: [
    { startPitch: PITCH_JITTER_MIN, endPitch: PITCH_JITTER_MAX, label: 'Jitter + Freq Shift' },
    { startPitch: PITCH_PAL_AZURE, endPitch: PITCH_PAL_AZURE, label: 'Azure' },
    { startPitch: PITCH_PAL_ROSE, endPitch: PITCH_PAL_ROSE, label: 'Rose' },
    { startPitch: PITCH_PAL_EMERALD, endPitch: PITCH_PAL_EMERALD, label: 'Emerald' },
    { startPitch: PITCH_PAL_VIOLET, endPitch: PITCH_PAL_VIOLET, label: 'Violet' },
  ],

  defaultSettings: {
    speed: 1,
    complexity: 1,
    lineWidth: LINE_WIDTH,
    cycles: DEFAULT_CYCLES,
    minRadius: DEFAULT_MIN_RADIUS,
    maxRadius: DEFAULT_MAX_RADIUS,
  },

  settingsSchema: {
    speed: {
      type: 'number', label: 'Speed', min: 0.1, max: 3, step: 0.1, default: 1,
    },
    complexity: {
      type: 'number', label: 'Complexity', min: 0.2, max: 2, step: 0.1, default: 1,
    },
    lineWidth: {
      type: 'number', label: 'Line Width', min: 0.5, max: 5, step: 0.5, default: LINE_WIDTH,
    },
    cycles: {
      type: 'number', label: 'Cycles', min: 1, max: 20, step: 1, default: DEFAULT_CYCLES,
    },
    minRadius: {
      type: 'number', label: 'Min Radius', min: -3, max: 3, step: 0.1, default: DEFAULT_MIN_RADIUS,
    },
    maxRadius: {
      type: 'number', label: 'Max Radius', min: 1, max: 10, step: 0.1, default: DEFAULT_MAX_RADIUS,
    },
  },

  VisualComponent: NeonPolarVisual,
};

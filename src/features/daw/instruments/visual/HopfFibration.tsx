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

// ────────────────────────────────────────────
// Hopf Fibration Mathematics
//
// The Hopf map S³ → S² sends each point on the 3-sphere to the 2-sphere,
// where every point on S² has a full circle (fiber) as its preimage.
// Stereographic projection S³ → R³ lets us visualize these fiber circles
// as a family of interlocking curves that weave into nested tori.
// ────────────────────────────────────────────

/**
 * A point on the Hopf fiber over base point (θ, φ) ∈ S².
 * The fiber circle is parameterized by t ∈ [0, 2π):
 *   (cos(θ/2)·e^{it}, sin(θ/2)·e^{i(φ+t)}) ∈ S³ ⊂ C²
 */
function hopfFiberPoint(theta: number, phi: number, t: number): [number, number, number, number] {
  const ct = Math.cos(theta * 0.5);
  const st = Math.sin(theta * 0.5);
  return [
    ct * Math.cos(t),
    ct * Math.sin(t),
    st * Math.cos(phi + t),
    st * Math.sin(phi + t),
  ];
}

/**
 * Stereographic projection S³ → R³, projecting from the pole (0,0,0,1).
 * When x₄ → 1, the projection explodes outward — this is the "pole burst"
 * effect. We soft-clamp to maxDist to keep it visually bounded while
 * preserving the dramatic stretching.
 */
function stereoProject(
  x1: number, x2: number, x3: number, x4: number,
  scale: number, maxDist: number,
): [number, number, number] {
  const denom = 1 - x4;
  const d = Math.abs(denom) < 0.02 ? (denom >= 0 ? 0.02 : -0.02) : denom;
  let X = (x1 / d) * scale;
  let Y = (x2 / d) * scale;
  let Z = (x3 / d) * scale;

  // Soft clamp: exponential compression beyond maxDist
  const dist = Math.sqrt(X * X + Y * Y + Z * Z);
  if (dist > maxDist) {
    const f = maxDist * (1 - Math.exp(-(dist / maxDist))) / dist;
    X *= f; Y *= f; Z *= f;
  }

  return [X, Y, Z];
}

/** Generate all 3D positions for one fiber circle. */
function generateFiberPositions(
  theta: number, phi: number,
  numPoints: number, phaseOffset: number,
  scale: number, maxDist: number,
): number[] {
  const positions: number[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = (i / numPoints) * Math.PI * 2 + phaseOffset;
    const [x1, x2, x3, x4] = hopfFiberPoint(theta, phi, t);
    const [X, Y, Z] = stereoProject(x1, x2, x3, x4, scale, maxDist);
    positions.push(X, Y, Z);
  }
  return positions;
}

// ────────────────────────────────────────────
// Neon line rendering (core + glow pass)
// ────────────────────────────────────────────

interface NeonFiber {
  core: { line: Line2; geometry: LineGeometry; material: LineMaterial };
  glow: { line: Line2; geometry: LineGeometry; material: LineMaterial };
}

function createNeonFiber(
  parent: THREE.Group,
  resolution: THREE.Vector2,
  coreWidth: number,
  glowWidth: number,
  positions: number[],
): NeonFiber {
  const makePass = (width: number, opacity: number) => {
    const geometry = new LineGeometry();
    geometry.setPositions(positions);
    const material = new LineMaterial({
      color: 0xffffff,
      linewidth: width,
      transparent: true,
      opacity,
      depthWrite: false,
      resolution,
      worldUnits: false,
    });
    material.blending = THREE.AdditiveBlending;
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    parent.add(line);
    return { line, geometry, material };
  };

  return {
    glow: makePass(glowWidth, 0.18),
    core: makePass(coreWidth, 0.85),
  };
}

function disposeNeonFiber(parent: THREE.Group, fiber: NeonFiber) {
  for (const pass of [fiber.core, fiber.glow]) {
    parent.remove(pass.line);
    pass.geometry.dispose();
    pass.material.dispose();
  }
}

// ────────────────────────────────────────────
// Fibration state (smooth + MIDI-discrete)
// ────────────────────────────────────────────

interface HopfState {
  // Continuous — evolve smoothly each frame
  rotX: number; rotY: number; rotZ: number;
  phaseFlow: number;

  // Discrete — changed instantly by MIDI note-ons
  thetaBase: number;    // Base latitude on S² (which torus family)
  polePulse: number;    // Pole burst intensity (decays)
  brightPulse: number;  // Flash intensity (decays)
  layerCount: number;   // Number of nested tori
  projSign: number;     // +1 or −1 (inside-out toggle)
  thetaShift: number;   // Accumulated θ rotation
  phiShift: number;     // Accumulated φ rotation
  twist: number;        // Dehn twist phase offset
  axisFlip: number;     // Mirror toggle (+1 or −1)
  scalePulse: number;   // Scale burst (decays to 1)
  hueOffset: number;    // Color palette rotation
  rotDir: number;       // Rotation direction toggle
}

// ────────────────────────────────────────────
// MIDI Transformation Reference
//
// All notes loop by octave (pitch % 12), so C4 = C5 = C6 etc.
// Velocity (0–127) scales the magnitude of accumulate/pulse effects.
//
//  C  (0)  — Shift fiber family: θ base jumps → different torus emerges
//  C# (1)  — Pole burst: fibers stretch toward ∞ then snap back
//  D  (2)  — Add torus layer: new nested ring appears
//  D# (3)  — Remove torus layer: simplify structure
//  E  (4)  — Invert projection: inside-out topological flip
//  F  (5)  — θ rotate 60°: torus orientation restructures
//  F# (6)  — φ rotate 90°: fiber sampling rotates around equator
//  G  (7)  — Dehn twist: visible fiber pattern shifts phase
//  G# (8)  — Mirror: Y-axis reflection
//  A  (9)  — Scale burst: rapid expand then contract
//  A# (10) — Hue shift: rotate entire color palette
//  B  (11) — Reverse rotation: flip direction of all motion
// ────────────────────────────────────────────

// Reusable color to avoid per-frame allocations
const _tmpColor = new THREE.Color();

interface Props { trackId: string }

function HopfFibrationVisual({ trackId }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const engineRef = useRef(getVisualPlaybackEngine());
  const fibersRef = useRef<NeonFiber[]>([]);
  const hsRef = useRef<HopfState>({
    rotX: 0, rotY: 0, rotZ: 0,
    phaseFlow: 0,
    thetaBase: Math.PI / 2, // Start at Clifford torus (most symmetric)
    polePulse: 0,
    brightPulse: 0,
    layerCount: 3,
    projSign: 1,
    thetaShift: 0,
    phiShift: 0,
    twist: 0,
    axisFlip: 1,
    scalePulse: 1,
    hueOffset: 0,
    rotDir: 1,
  });
  const lastCountRef = useRef(0);
  const prevPitchesRef = useRef<Set<number>>(new Set());
  const timeRef = useRef(0);
  const { size } = useThree();
  const resRef = useRef(new THREE.Vector2(size.width, size.height));

  // Sync resolution on resize
  useEffect(() => {
    resRef.current.set(size.width, size.height);
    for (const f of fibersRef.current) {
      f.core.material.resolution.set(size.width, size.height);
      f.glow.material.resolution.set(size.width, size.height);
    }
  }, [size.width, size.height]);

  // Cleanup on unmount
  useEffect(() => () => {
    const g = groupRef.current;
    if (g) fibersRef.current.forEach(f => disposeNeonFiber(g, f));
    fibersRef.current = [];
  }, []);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const vs = engineRef.current.getTrackState(trackId);
    if (!vs) return;

    // ── Read settings ──
    const par = vs.params;
    const coreW   = (par.coreWidth as number)       ?? 2.5;
    const glowW   = (par.glowWidth as number)       ?? 8;
    const pScale  = (par.projScale as number)        ?? 1.5;
    const maxD    = (par.maxDist as number)           ?? 8;
    const drift   = (par.driftSpeed as number)        ?? 0.08;
    const rSpeed  = (par.rotationSpeed as number)     ?? 0.2;
    const nPts    = (par.pointsPerFiber as number)    ?? 80;
    const fpl     = (par.fibersPerLayer as number)    ?? 10;
    const flowSpd = (par.flowSpeed as number)         ?? 0.15;
    const tSpread = (par.thetaSpread as number)       ?? 0.9;

    const hs = hsRef.current;
    timeRef.current += delta;
    const t = timeRef.current;

    // ── Process MIDI note-ons ──
    const curPitches = new Set<number>();
    for (const [pitch] of vs.activeNotes) curPitches.add(pitch);

    const rawDelta = vs.noteOnCount - lastCountRef.current;
    lastCountRef.current = vs.noteOnCount;

    // Only process MIDI if delta is positive and reasonable (skip large scrub jumps)
    if (rawDelta > 0 && rawDelta <= 8) {
      for (const [pitch, ev] of vs.activeNotes) {
        if (!prevPitchesRef.current.has(pitch)) {
          const n = pitch % 12;
          const v = ev.velocity / 127;

          switch (n) {
            case 0: // C — Shift fiber family θ
              hs.thetaBase += (Math.PI / 6) * (0.5 + v * 0.5);
              if (hs.thetaBase > Math.PI * 2) hs.thetaBase -= Math.PI * 2;
              hs.brightPulse = Math.max(hs.brightPulse, v * 0.5);
              break;

            case 1: // C# — Pole burst
              hs.polePulse = 0.4 + v * 0.6;
              hs.brightPulse = Math.max(hs.brightPulse, v);
              break;

            case 2: // D — Add torus layer
              hs.layerCount = Math.min(hs.layerCount + 1, 6);
              hs.brightPulse = Math.max(hs.brightPulse, 0.3);
              break;

            case 3: // D# — Remove torus layer
              hs.layerCount = Math.max(1, hs.layerCount - 1);
              break;

            case 4: // E — Invert projection (inside-out)
              hs.projSign *= -1;
              hs.brightPulse = Math.max(hs.brightPulse, v * 0.7);
              break;

            case 5: // F — θ rotation 60°
              hs.thetaShift += (Math.PI / 3) * (0.5 + v * 0.5);
              hs.brightPulse = Math.max(hs.brightPulse, v * 0.4);
              break;

            case 6: // F# — φ rotation 90°
              hs.phiShift += (Math.PI / 2) * (0.5 + v * 0.5);
              break;

            case 7: // G — Dehn twist (phase offset)
              hs.twist += (Math.PI / 4) * (0.5 + v * 0.5);
              break;

            case 8: // G# — Mirror flip
              hs.axisFlip *= -1;
              hs.brightPulse = Math.max(hs.brightPulse, v * 0.5);
              break;

            case 9: // A — Scale burst
              hs.scalePulse = 1.5 + v * 1.0;
              hs.brightPulse = Math.max(hs.brightPulse, v * 0.8);
              break;

            case 10: // A# — Hue rotation
              hs.hueOffset = (hs.hueOffset + 1 / 6 + v / 6) % 1;
              break;

            case 11: // B — Reverse rotation
              hs.rotDir *= -1;
              break;
          }
        }
      }
    }
    prevPitchesRef.current = curPitches;

    // ── Decay pulse effects ──
    hs.polePulse *= Math.pow(0.01, delta);
    if (hs.polePulse < 0.005) hs.polePulse = 0;

    hs.brightPulse *= Math.pow(0.05, delta);
    if (hs.brightPulse < 0.005) hs.brightPulse = 0;

    hs.scalePulse += (1 - hs.scalePulse) * Math.min(delta * 5, 1);

    // ── Smooth continuous evolution ──
    hs.rotX += delta * rSpeed * 0.6 * hs.rotDir;
    hs.rotY += delta * rSpeed * hs.rotDir;
    hs.rotZ += delta * rSpeed * 0.25 * hs.rotDir;
    hs.phaseFlow += delta * flowSpd;

    // ── Resize fiber pool ──
    const totalFibers = hs.layerCount * fpl;
    const dummyPos = new Array((nPts + 1) * 3).fill(0);

    while (fibersRef.current.length < totalFibers) {
      fibersRef.current.push(createNeonFiber(group, resRef.current, coreW, glowW, dummyPos));
    }
    while (fibersRef.current.length > totalFibers) {
      disposeNeonFiber(group, fibersRef.current.pop()!);
    }

    // ── Update each fiber ──
    const effScale = pScale * hs.scalePulse * hs.projSign;

    for (let li = 0; li < hs.layerCount; li++) {
      // Each layer = a torus at a different latitude θ on S²
      const lf = hs.layerCount === 1 ? 0.5 : li / (hs.layerCount - 1);
      const baseTheta = hs.thetaBase + hs.thetaShift + (lf - 0.5) * tSpread;

      // Gentle breathing oscillation
      const breathe = Math.sin(t * drift + li * 1.3) * 0.08;
      let theta = baseTheta + breathe;

      // Wrap θ into [0, π] range (valid S² latitude)
      theta = ((theta % Math.PI) + Math.PI) % Math.PI;
      theta = Math.max(0.12, Math.min(Math.PI - 0.12, theta));

      // During pole pulse: push toward π (projection singularity at w→1)
      // This makes fibers stretch dramatically toward infinity
      theta = theta + hs.polePulse * (Math.PI * 0.95 - theta);

      // Layer color band
      const layerHue = (li / Math.max(hs.layerCount, 1)) * 0.35 + hs.hueOffset;

      for (let fi = 0; fi < fpl; fi++) {
        const idx = li * fpl + fi;
        if (idx >= fibersRef.current.length) break;
        const fiber = fibersRef.current[idx];
        const ff = fi / fpl;

        // Distribute fibers evenly around the torus (φ direction)
        const phi = ff * Math.PI * 2 + hs.phiShift
          + Math.cos(t * drift * 0.7 + fi * 0.4) * 0.06;

        // Phase offset: Dehn twist + continuous flow + per-fiber offset
        const phase = hs.twist + hs.phaseFlow + ff * Math.PI * 0.3 + li * 0.4;

        // Generate 3D positions via Hopf → stereographic projection
        const pos = generateFiberPositions(theta, phi, nPts, phase, effScale, maxD);

        // Apply mirror (axis flip)
        if (hs.axisFlip < 0) {
          for (let j = 1; j < pos.length; j += 3) pos[j] = -pos[j];
        }

        // Upload geometry to both core and glow passes
        for (const pass of [fiber.core, fiber.glow]) {
          pass.geometry.setPositions(pos);
          pass.line.computeLineDistances();
        }

        // ── Neon coloring ──
        const hue = ((layerHue + ff * 0.12) % 1 + 1) % 1;
        const bright = 0.6 + hs.polePulse * 0.3 + hs.brightPulse * 0.2;

        // Core: bright saturated thin line
        _tmpColor.setHSL(hue, 1.0, Math.min(bright, 0.95));
        fiber.core.material.color.copy(_tmpColor);
        fiber.core.material.linewidth = coreW;
        fiber.core.material.opacity = 0.8 + hs.brightPulse * 0.2;

        // Glow: wider, dimmer halo (additive blending makes overlaps glow)
        _tmpColor.setHSL(hue, 0.6, Math.min(bright * 0.65, 0.7));
        fiber.glow.material.color.copy(_tmpColor);
        fiber.glow.material.linewidth = glowW + hs.polePulse * 6;
        fiber.glow.material.opacity = 0.15 + hs.polePulse * 0.25 + hs.brightPulse * 0.1;
      }
    }

    // ── Apply smooth 3-axis rotation to entire structure ──
    group.rotation.x = hs.rotX;
    group.rotation.y = hs.rotY;
    group.rotation.z = hs.rotZ;
  });

  return <group ref={groupRef} />;
}

// ────────────────────────────────────────────
// Instrument Definition
// ────────────────────────────────────────────

export const HopfFibration: Instrument = {
  id: 'hopfFibration',
  name: 'Hopf Fibration',
  description:
    'Neon 3D Hopf fibration — nested interlocking tori with 12 MIDI-triggered topological transformations (octave-looped)',
  icon: '🔮',
  color: '#a855f7',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',

  defaultSettings: {
    coreWidth: 2.5,
    glowWidth: 8,
    projScale: 1.5,
    maxDist: 8,
    driftSpeed: 0.08,
    rotationSpeed: 0.2,
    pointsPerFiber: 80,
    fibersPerLayer: 10,
    flowSpeed: 0.15,
    thetaSpread: 0.9,
  },

  settingsSchema: {
    coreWidth:      { type: 'number', label: 'Core Width',       min: 0.5, max: 6,   step: 0.5,  default: 2.5 },
    glowWidth:      { type: 'number', label: 'Glow Width',       min: 2,   max: 20,  step: 1,    default: 8 },
    projScale:      { type: 'number', label: 'Projection Scale', min: 0.5, max: 4,   step: 0.1,  default: 1.5 },
    maxDist:        { type: 'number', label: 'Max Distance',     min: 3,   max: 15,  step: 1,    default: 8 },
    driftSpeed:     { type: 'number', label: 'Drift',            min: 0,   max: 0.3, step: 0.01, default: 0.08 },
    rotationSpeed:  { type: 'number', label: 'Rotation',         min: 0,   max: 1,   step: 0.05, default: 0.2 },
    pointsPerFiber: { type: 'number', label: 'Fiber Detail',     min: 32,  max: 200, step: 8,    default: 80 },
    fibersPerLayer: { type: 'number', label: 'Fibers / Torus',   min: 4,   max: 20,  step: 1,    default: 10 },
    flowSpeed:      { type: 'number', label: 'Flow Speed',       min: 0,   max: 0.5, step: 0.01, default: 0.15 },
    thetaSpread:    { type: 'number', label: 'Torus Spread',     min: 0.2, max: 2.0, step: 0.1,  default: 0.9 },
  },

  VisualComponent: HopfFibrationVisual,
};

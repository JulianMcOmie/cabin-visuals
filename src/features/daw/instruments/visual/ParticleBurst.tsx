'use client';

import React, { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getVisualPlaybackEngine } from '@daw/core/visualPlayback';
import { hexToHsl } from '@daw/core/colorPalette';
import { Instrument } from '../types';

// ── Easing (from KickScene9) ────────────────────────────────────────────────

type EaseCurve = 'log' | 'expo' | 'power' | 'circ' | 'sine';
type BurstType = 'sphere' | 'cone' | 'jet' | 'spiralOut' | 'polarRose' | 'ring' | 'doubleHelix';

function applyEase(curve: EaseCurve, t: number, power: number): number {
  switch (curve) {
    case 'log':
      return Math.log(1 + t * (Math.pow(10, power) - 1)) / (power * Math.LN10);
    case 'expo':
      return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t * power);
    case 'power':
      return 1 - Math.pow(1 - t, power);
    case 'circ':
      return Math.sqrt(1 - Math.pow(t - 1, 2));
    case 'sine':
      return Math.sin(t * Math.PI * 0.5);
  }
}

// ── Color presets ───────────────────────────────────────────────────────────
// Each preset defines color stops that blend across the sphere surface.
// t ∈ [0,1] maps from south pole to north pole of the particle sphere.
// Multi-stop presets create beautiful gradients across the explosion.

interface ColorStop { t: number; h: number; s: number; l: number }

interface ColorPreset {
  name: string;
  stops: ColorStop[];
}

// Pitch 36–71 (36 presets)
const PITCH_MIN = 36;
const PITCH_MAX = 71;

const COLOR_PRESETS: ColorPreset[] = [
  // ── Single-hue solids (warm → cool) ──
  { name: 'Ember',           stops: [{ t: 0, h: 0.02, s: 1.0, l: 0.45 }, { t: 1, h: 0.06, s: 0.95, l: 0.55 }] },
  { name: 'Molten Gold',     stops: [{ t: 0, h: 0.08, s: 1.0, l: 0.5 },  { t: 1, h: 0.12, s: 0.9, l: 0.6 }] },
  { name: 'Amber',           stops: [{ t: 0, h: 0.07, s: 0.95, l: 0.5 }, { t: 1, h: 0.10, s: 0.85, l: 0.55 }] },
  { name: 'Tangerine',       stops: [{ t: 0, h: 0.04, s: 1.0, l: 0.45 }, { t: 1, h: 0.08, s: 0.9, l: 0.55 }] },
  { name: 'Rose',            stops: [{ t: 0, h: 0.95, s: 0.9, l: 0.5 },  { t: 1, h: 0.98, s: 0.8, l: 0.6 }] },
  { name: 'Hot Pink',        stops: [{ t: 0, h: 0.9, s: 1.0, l: 0.45 },  { t: 1, h: 0.93, s: 0.9, l: 0.55 }] },
  { name: 'Magenta',         stops: [{ t: 0, h: 0.83, s: 1.0, l: 0.5 },  { t: 1, h: 0.87, s: 0.9, l: 0.55 }] },
  { name: 'Violet',          stops: [{ t: 0, h: 0.77, s: 0.9, l: 0.45 }, { t: 1, h: 0.80, s: 0.8, l: 0.55 }] },
  { name: 'Royal Purple',    stops: [{ t: 0, h: 0.73, s: 0.85, l: 0.45 },{ t: 1, h: 0.76, s: 0.9, l: 0.55 }] },
  { name: 'Electric Blue',   stops: [{ t: 0, h: 0.6, s: 1.0, l: 0.5 },   { t: 1, h: 0.63, s: 0.9, l: 0.55 }] },
  { name: 'Cyan',            stops: [{ t: 0, h: 0.5, s: 1.0, l: 0.5 },   { t: 1, h: 0.53, s: 0.85, l: 0.55 }] },
  { name: 'Seafoam',         stops: [{ t: 0, h: 0.45, s: 0.8, l: 0.5 },  { t: 1, h: 0.48, s: 0.7, l: 0.55 }] },
  { name: 'Emerald',         stops: [{ t: 0, h: 0.38, s: 0.9, l: 0.45 }, { t: 1, h: 0.42, s: 0.8, l: 0.55 }] },
  { name: 'Lime',            stops: [{ t: 0, h: 0.25, s: 1.0, l: 0.5 },  { t: 1, h: 0.30, s: 0.9, l: 0.55 }] },
  { name: 'Pure White',      stops: [{ t: 0, h: 0, s: 0, l: 0.75 },      { t: 1, h: 0, s: 0, l: 0.85 }] },
  { name: 'Silver Ghost',    stops: [{ t: 0, h: 0.6, s: 0.1, l: 0.55 },  { t: 1, h: 0.6, s: 0.05, l: 0.75 }] },

  // ── Multi-color gradients ──
  { name: 'Sunrise',         stops: [
    { t: 0, h: 0.0, s: 1.0, l: 0.45 }, { t: 0.3, h: 0.04, s: 1.0, l: 0.45 },
    { t: 0.6, h: 0.1, s: 0.95, l: 0.55 }, { t: 1, h: 0.14, s: 0.9, l: 0.65 },
  ]},
  { name: 'Sunset',          stops: [
    { t: 0, h: 0.83, s: 0.9, l: 0.5 }, { t: 0.35, h: 0.0, s: 1.0, l: 0.45 },
    { t: 0.7, h: 0.06, s: 1.0, l: 0.5 }, { t: 1, h: 0.12, s: 0.9, l: 0.6 },
  ]},
  { name: 'Aurora Borealis', stops: [
    { t: 0, h: 0.55, s: 0.9, l: 0.4 }, { t: 0.25, h: 0.45, s: 1.0, l: 0.45 },
    { t: 0.5, h: 0.35, s: 0.9, l: 0.5 }, { t: 0.75, h: 0.78, s: 0.8, l: 0.45 },
    { t: 1, h: 0.85, s: 0.7, l: 0.55 },
  ]},
  { name: 'Ocean Depths',    stops: [
    { t: 0, h: 0.55, s: 0.9, l: 0.3 }, { t: 0.4, h: 0.5, s: 1.0, l: 0.5 },
    { t: 0.7, h: 0.47, s: 0.85, l: 0.5 }, { t: 1, h: 0.53, s: 0.7, l: 0.6 },
  ]},
  { name: 'Nebula',          stops: [
    { t: 0, h: 0.75, s: 1.0, l: 0.4 }, { t: 0.3, h: 0.85, s: 0.9, l: 0.45 },
    { t: 0.6, h: 0.6, s: 0.8, l: 0.5 }, { t: 1, h: 0.55, s: 0.9, l: 0.55 },
  ]},
  { name: 'Fire & Ice',      stops: [
    { t: 0, h: 0.0, s: 1.0, l: 0.5 }, { t: 0.3, h: 0.05, s: 1.0, l: 0.5 },
    { t: 0.5, h: 0.0, s: 0.0, l: 0.7 },
    { t: 0.7, h: 0.55, s: 0.9, l: 0.5 }, { t: 1, h: 0.6, s: 1.0, l: 0.5 },
  ]},
  { name: 'Sakura',          stops: [
    { t: 0, h: 0.93, s: 0.6, l: 0.65 }, { t: 0.4, h: 0.95, s: 0.8, l: 0.55 },
    { t: 0.7, h: 0.0, s: 0.5, l: 0.75 }, { t: 1, h: 0.97, s: 0.4, l: 0.8 },
  ]},
  { name: 'Prism',           stops: [
    { t: 0, h: 0.0, s: 1.0, l: 0.45 }, { t: 0.17, h: 0.08, s: 1.0, l: 0.45 },
    { t: 0.33, h: 0.16, s: 1.0, l: 0.5 }, { t: 0.5, h: 0.33, s: 1.0, l: 0.45 },
    { t: 0.67, h: 0.55, s: 1.0, l: 0.5 }, { t: 0.83, h: 0.73, s: 1.0, l: 0.5 },
    { t: 1, h: 0.9, s: 1.0, l: 0.45 },
  ]},
  { name: 'Enchanted Forest',stops: [
    { t: 0, h: 0.3, s: 0.8, l: 0.35 }, { t: 0.3, h: 0.35, s: 0.9, l: 0.5 },
    { t: 0.6, h: 0.45, s: 0.7, l: 0.45 }, { t: 0.85, h: 0.15, s: 0.6, l: 0.55 },
    { t: 1, h: 0.1, s: 0.8, l: 0.6 },
  ]},
  { name: 'Candy',           stops: [
    { t: 0, h: 0.85, s: 0.9, l: 0.55 }, { t: 0.25, h: 0.95, s: 1.0, l: 0.55 },
    { t: 0.5, h: 0.5, s: 0.8, l: 0.55 }, { t: 0.75, h: 0.15, s: 0.9, l: 0.55 },
    { t: 1, h: 0.8, s: 0.85, l: 0.6 },
  ]},
  { name: 'Lava Flow',       stops: [
    { t: 0, h: 0.0, s: 1.0, l: 0.4 }, { t: 0.25, h: 0.03, s: 1.0, l: 0.5 },
    { t: 0.5, h: 0.07, s: 1.0, l: 0.45 }, { t: 0.75, h: 0.04, s: 0.9, l: 0.4 },
    { t: 1, h: 0.0, s: 0.8, l: 0.3 },
  ]},
  { name: 'Cosmic Dust',     stops: [
    { t: 0, h: 0.7, s: 0.6, l: 0.5 }, { t: 0.3, h: 0.6, s: 0.3, l: 0.55 },
    { t: 0.5, h: 0.1, s: 0.8, l: 0.55 }, { t: 0.7, h: 0.55, s: 0.4, l: 0.6 },
    { t: 1, h: 0.8, s: 0.5, l: 0.65 },
  ]},
  { name: 'Vaporwave',       stops: [
    { t: 0, h: 0.83, s: 1.0, l: 0.45 }, { t: 0.3, h: 0.9, s: 0.9, l: 0.5 },
    { t: 0.6, h: 0.5, s: 1.0, l: 0.45 }, { t: 1, h: 0.55, s: 0.8, l: 0.55 },
  ]},
  { name: 'Solar Flare',     stops: [
    { t: 0, h: 0.1, s: 1.0, l: 0.65 }, { t: 0.2, h: 0.08, s: 1.0, l: 0.5 },
    { t: 0.5, h: 0.04, s: 1.0, l: 0.5 }, { t: 0.8, h: 0.0, s: 1.0, l: 0.4 },
    { t: 1, h: 0.98, s: 0.9, l: 0.35 },
  ]},
  { name: 'Mystic Twilight', stops: [
    { t: 0, h: 0.7, s: 0.7, l: 0.35 }, { t: 0.25, h: 0.78, s: 0.9, l: 0.5 },
    { t: 0.5, h: 0.85, s: 0.8, l: 0.45 }, { t: 0.75, h: 0.0, s: 0.7, l: 0.5 },
    { t: 1, h: 0.05, s: 0.9, l: 0.55 },
  ]},
  { name: 'Diamond',         stops: [
    { t: 0, h: 0.55, s: 0.15, l: 0.65 }, { t: 0.25, h: 0.0, s: 0.0, l: 0.8 },
    { t: 0.5, h: 0.6, s: 0.2, l: 0.7 }, { t: 0.75, h: 0.0, s: 0.0, l: 0.85 },
    { t: 1, h: 0.08, s: 0.15, l: 0.75 },
  ]},
  { name: 'Tropical Storm',  stops: [
    { t: 0, h: 0.5, s: 1.0, l: 0.45 }, { t: 0.25, h: 0.4, s: 0.9, l: 0.5 },
    { t: 0.5, h: 0.15, s: 1.0, l: 0.45 }, { t: 0.75, h: 0.08, s: 1.0, l: 0.5 },
    { t: 1, h: 0.95, s: 0.9, l: 0.45 },
  ]},
  { name: 'Bioluminescence', stops: [
    { t: 0, h: 0.5, s: 1.0, l: 0.35 }, { t: 0.3, h: 0.45, s: 1.0, l: 0.45 },
    { t: 0.5, h: 0.4, s: 0.9, l: 0.55 }, { t: 0.7, h: 0.5, s: 1.0, l: 0.5 },
    { t: 1, h: 0.55, s: 0.8, l: 0.55 },
  ]},
  { name: 'Pearlescent',     stops: [
    { t: 0, h: 0.55, s: 0.3, l: 0.65 }, { t: 0.2, h: 0.85, s: 0.3, l: 0.7 },
    { t: 0.4, h: 0.1, s: 0.25, l: 0.73 }, { t: 0.6, h: 0.45, s: 0.3, l: 0.67 },
    { t: 0.8, h: 0.7, s: 0.25, l: 0.72 }, { t: 1, h: 0.0, s: 0.2, l: 0.77 },
  ]},
  { name: 'Blood Moon',      stops: [
    { t: 0, h: 0.0, s: 1.0, l: 0.3 }, { t: 0.4, h: 0.98, s: 0.9, l: 0.45 },
    { t: 0.7, h: 0.03, s: 0.8, l: 0.35 }, { t: 1, h: 0.0, s: 0.6, l: 0.2 },
  ]},
];

// Sample a color from the preset's gradient at position t ∈ [0,1]
function samplePreset(preset: ColorPreset, t: number): { h: number; s: number; l: number } {
  const stops = preset.stops;
  if (t <= stops[0].t) return stops[0];
  if (t >= stops[stops.length - 1].t) return stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      const frac = (t - stops[i].t) / (stops[i + 1].t - stops[i].t);
      // Lerp hue on shortest path
      let dh = stops[i + 1].h - stops[i].h;
      if (dh > 0.5) dh -= 1;
      if (dh < -0.5) dh += 1;
      return {
        h: (stops[i].h + dh * frac + 1) % 1,
        s: stops[i].s + (stops[i + 1].s - stops[i].s) * frac,
        l: stops[i].l + (stops[i + 1].l - stops[i].l) * frac,
      };
    }
  }
  return stops[0];
}

// ── Particle distribution (golden ratio sphere) ─────────────────────────────

interface Particle {
  nx: number; ny: number; nz: number;
  r: number;
  jx: number; jy: number; jz: number;
  dissolveMul: number;
  // Pre-computed per-particle values for burst modes
  theta: number;  // azimuthal angle on sphere
  phi: number;    // polar angle (0=top, PI=bottom)
  iNorm: number;  // normalized index [0,1]
}

function buildParticles(count: number): Particle[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    const nx = Math.cos(theta) * r;
    const ny = y;
    const nz = Math.sin(theta) * r;
    const jTheta = Math.random() * Math.PI * 2;
    const jPhi = Math.acos(2 * Math.random() - 1);
    const jStr = 0.3;
    out.push({
      nx, ny, nz,
      r: Math.pow(Math.random(), 0.5),
      jx: Math.sin(jPhi) * Math.cos(jTheta) * jStr,
      jy: Math.sin(jPhi) * Math.sin(jTheta) * jStr,
      jz: Math.cos(jPhi) * jStr,
      dissolveMul: 0.6 + Math.random() * 0.8,
      theta: theta % (Math.PI * 2),
      phi: Math.acos(y),
      iNorm: i / (count - 1),
    });
  }
  return out;
}

// ── Single burst instance (InstancedMesh) ───────────────────────────────────

interface BurstInstanceProps {
  birthTime: number;
  clockRef: React.MutableRefObject<number>;
  trackId: string;
  preset: ColorPreset;
  count: number;
}

function BurstInstance({ birthTime, clockRef, trackId, preset, count }: BurstInstanceProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorArr = useMemo(() => new Float32Array(count * 3), [count]);
  const tempColor = useMemo(() => new THREE.Color(), []);
  const particles = useMemo(() => buildParticles(count), [count]);
  const engineRef = useRef(getVisualPlaybackEngine());

  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // Read params fresh from engine each frame (handles automation)
    const vs = engineRef.current.getTrackState(trackId);
    const par = vs?.params ?? {};
    const pointSize      = (par.pointSize as number)      ?? 0.035;
    const burstRadius    = (par.burstRadius as number)    ?? 4;
    const dissolveSpread = (par.dissolveSpread as number) ?? 5;
    const fadePower      = (par.fadePower as number)      ?? 0.6;
    const burstPower     = (par.burstPower as number)     ?? 2;
    const burstCurve     = (par.burstCurve as EaseCurve)  ?? 'log';
    const burstLifetime  = (par.burstLifetime as number)  ?? 4;
    const cylinderRadius = (par.cylinderRadius as number) ?? 0;
    const burstType      = (par.burstType as BurstType)   ?? 'sphere';
    const coneAngle      = (par.coneAngle as number)      ?? 0.8;
    const spiralTwists   = (par.spiralTwists as number)   ?? 3;
    const polarPetals    = (par.polarPetals as number)    ?? 5;

    const age = clockRef.current - birthTime;
    const t = Math.min(age / burstLifetime, 1);
    const expand = applyEase(burstCurve, t, burstPower);
    const alpha = Math.max(0, Math.pow(1 - t, fadePower));

    if (alpha < 0.005) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    // Compute camera forward direction for cone/jet modes and cylinder clipping.
    const camDir = _tmpVec3A;
    const particlePos = _tmpVec3B;
    camera.getWorldDirection(camDir);

    const toCamera = _tmpVec3C.copy(camDir).negate();
    const arbUp = Math.abs(toCamera.y) < 0.99 ? _tmpVec3D.set(0, 1, 0) : _tmpVec3D.set(1, 0, 0);
    const right = _tmpVec3E.crossVectors(toCamera, arbUp).normalize();
    const up = _tmpVec3F.crossVectors(right, toCamera).normalize();

    for (let i = 0; i < count; i++) {
      const pt = particles[i];

      let x: number, y: number, z: number;

      if (burstType === 'sphere') {
        const totalRadius = burstRadius * pt.r + expand * dissolveSpread * pt.dissolveMul;
        const rad = totalRadius * expand;
        const jAmt = expand * dissolveSpread * 0.3 * pt.dissolveMul;
        x = (pt.nx + pt.jx * jAmt) * rad;
        y = (pt.ny + pt.jy * jAmt) * rad;
        z = (pt.nz + pt.jz * jAmt) * rad;

      } else if (burstType === 'cone') {
        const conePhi = Math.pow(pt.iNorm, 0.6) * coneAngle;
        const coneTheta = pt.theta;
        const rad = (burstRadius * pt.r + expand * dissolveSpread * pt.dissolveMul) * expand;
        const sinP = Math.sin(conePhi);
        const cosP = Math.cos(conePhi);
        const lx = sinP * Math.cos(coneTheta) * rad;
        const ly = sinP * Math.sin(coneTheta) * rad;
        const lz = cosP * rad;
        x = right.x * lx + up.x * ly + toCamera.x * lz;
        y = right.y * lx + up.y * ly + toCamera.y * lz;
        z = right.z * lx + up.z * ly + toCamera.z * lz;

      } else if (burstType === 'jet') {
        const jetAngle = coneAngle * 0.3;
        const jetPhi = Math.sqrt(pt.iNorm) * jetAngle;
        const jetTheta = pt.theta;
        const depthVariation = 0.5 + pt.r * 1.5;
        const rad = (burstRadius + expand * dissolveSpread * pt.dissolveMul) * expand * depthVariation;
        const sinP = Math.sin(jetPhi);
        const cosP = Math.cos(jetPhi);
        const lx = sinP * Math.cos(jetTheta) * rad;
        const ly = sinP * Math.sin(jetTheta) * rad;
        const lz = cosP * rad;
        x = right.x * lx + up.x * ly + toCamera.x * lz;
        y = right.y * lx + up.y * ly + toCamera.y * lz;
        z = right.z * lx + up.z * ly + toCamera.z * lz;

      } else if (burstType === 'spiralOut') {
        const armAngle = pt.theta + expand * spiralTwists * Math.PI * 2;
        const radialDist = pt.iNorm * burstRadius * expand;
        const forwardDist = (burstRadius * pt.r + expand * dissolveSpread * pt.dissolveMul) * expand;
        const lx = Math.cos(armAngle) * radialDist;
        const ly = Math.sin(armAngle) * radialDist;
        const lz = forwardDist * (0.3 + pt.iNorm * 0.7);
        x = right.x * lx + up.x * ly + toCamera.x * lz;
        y = right.y * lx + up.y * ly + toCamera.y * lz;
        z = right.z * lx + up.z * ly + toCamera.z * lz;

      } else if (burstType === 'polarRose') {
        const roseTheta = pt.theta;
        const roseR = Math.abs(Math.cos(polarPetals * roseTheta));
        const rad = roseR * burstRadius * expand * (0.4 + pt.r * 0.6);
        const forwardDist = (burstRadius * 0.5 + expand * dissolveSpread * pt.dissolveMul * 0.5) * expand;
        const phiSpread = (pt.phi - Math.PI * 0.5) * 0.4;
        const lx = Math.cos(roseTheta) * rad * Math.cos(phiSpread);
        const ly = Math.sin(roseTheta) * rad * Math.cos(phiSpread);
        const lz = forwardDist + Math.sin(phiSpread) * rad * 0.3;
        x = right.x * lx + up.x * ly + toCamera.x * lz;
        y = right.y * lx + up.y * ly + toCamera.y * lz;
        z = right.z * lx + up.z * ly + toCamera.z * lz;

      } else if (burstType === 'ring') {
        const ringTheta = pt.theta;
        const majorR = burstRadius * expand;
        const minorR = burstRadius * 0.25 * expand * pt.r;
        const minorAngle = pt.phi;
        const ringX = (majorR + minorR * Math.cos(minorAngle)) * Math.cos(ringTheta);
        const ringY = (majorR + minorR * Math.cos(minorAngle)) * Math.sin(ringTheta);
        const ringZ = minorR * Math.sin(minorAngle) + expand * dissolveSpread * pt.dissolveMul * 0.3;
        x = right.x * ringX + up.x * ringY + toCamera.x * ringZ;
        y = right.y * ringX + up.y * ringY + toCamera.y * ringZ;
        z = right.z * ringX + up.z * ringY + toCamera.z * ringZ;

      } else {
        const helixArm = i % 2 === 0 ? 0 : Math.PI;
        const helixT = pt.iNorm;
        const helixAngle = helixArm + helixT * spiralTwists * Math.PI * 2;
        const helixRadius = burstRadius * 0.6 * expand * (0.5 + 0.5 * Math.sin(helixT * Math.PI));
        const forwardDist = helixT * burstRadius * expand * 2;
        const jAmt = expand * 0.2 * pt.dissolveMul;
        const lx = Math.cos(helixAngle) * helixRadius + pt.jx * jAmt;
        const ly = Math.sin(helixAngle) * helixRadius + pt.jy * jAmt;
        const lz = forwardDist + pt.jz * jAmt;
        x = right.x * lx + up.x * ly + toCamera.x * lz;
        y = right.y * lx + up.y * ly + toCamera.y * lz;
        z = right.z * lx + up.z * ly + toCamera.z * lz;
      }

      // Cylinder clipping
      let cylAlpha = 1;
      if (cylinderRadius > 0) {
        particlePos.set(x, y, z);
        const dot = particlePos.dot(camDir);
        const perpDistSq = particlePos.lengthSq() - dot * dot;
        const perpDist = Math.sqrt(Math.max(0, perpDistSq));
        const edgeStart = cylinderRadius * 0.9;
        if (perpDist > cylinderRadius) {
          cylAlpha = 0;
        } else if (perpDist > edgeStart) {
          cylAlpha = 1 - (perpDist - edgeStart) / (cylinderRadius - edgeStart);
          cylAlpha *= cylAlpha;
        }
      }

      const finalAlpha = alpha * cylAlpha;

      dummy.position.set(x, y, z);
      dummy.scale.setScalar(cylAlpha > 0 ? pointSize * Math.max(finalAlpha, 0.01) : 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const colorT = pt.ny * 0.5 + 0.5;
      const col = samplePreset(preset, colorT);
      tempColor.setHSL(col.h, col.s, col.l * finalAlpha);
      colorArr[i * 3] = tempColor.r;
      colorArr[i * 3 + 1] = tempColor.g;
      colorArr[i * 3 + 2] = tempColor.b;
    }
    mesh.instanceMatrix.needsUpdate = true;
    const colorAttr = mesh.geometry.getAttribute('color') as THREE.InstancedBufferAttribute;
    if (colorAttr) {
      colorAttr.array.set(colorArr);
      colorAttr.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[1, 4, 4]}>
        <instancedBufferAttribute
          attach="attributes-color"
          args={[colorArr, 3]}
          itemSize={3}
          count={count}
        />
      </sphereGeometry>
      <meshBasicMaterial vertexColors toneMapped={false} transparent opacity={0.85}
        blending={THREE.AdditiveBlending} depthWrite={false} />
    </instancedMesh>
  );
}

// Reusable temp vectors to avoid per-frame allocation
const _tmpVec3A = new THREE.Vector3();
const _tmpVec3B = new THREE.Vector3();
const _tmpVec3C = new THREE.Vector3();
const _tmpVec3D = new THREE.Vector3();
const _tmpVec3E = new THREE.Vector3();
const _tmpVec3F = new THREE.Vector3();

// ── Main visual component ───────────────────────────────────────────────────

interface BurstEntry {
  id: number;
  birthTime: number;
  presetIndex: number;
  palettePreset: ColorPreset | null; // snapshot of palette at burst creation time
}

interface Props {
  trackId: string;
}

function ParticleBurstVisual({ trackId }: Props) {
  const engineRef = useRef(getVisualPlaybackEngine());
  const prevCountsRef = useRef(new Map<number, number>());
  const burstsRef = useRef<BurstEntry[]>([]);
  const idCounter = useRef(0);
  const clockRef = useRef(0);
  // Cache palette preset — only rebuild when palette hex values change
  const cachedPaletteRef = useRef<{ key: string; preset: ColorPreset } | null>(null);

  useEffect(() => () => {
    burstsRef.current = [];
  }, []);

  useFrame((_, delta) => {
    const vs = engineRef.current.getTrackState(trackId);
    if (!vs) return;

    clockRef.current += delta;
    const now = clockRef.current;

    const par = vs.params;
    const burstLifetime = (par.burstLifetime as number) ?? 4;

    // Snapshot current palette (if any) for new bursts — cached
    let currentPalettePreset: ColorPreset | null = null;
    const palette = vs.activePalette;
    if (palette) {
      const key = `${palette.background}${palette.secondary}${palette.primary}${palette.accent}${palette.highlight}`;
      if (cachedPaletteRef.current?.key === key) {
        currentPalettePreset = cachedPaletteRef.current.preset;
      } else {
        const bg = hexToHsl(palette.background);
        const sec = hexToHsl(palette.secondary);
        const pri = hexToHsl(palette.primary);
        const acc = hexToHsl(palette.accent);
        const hi = hexToHsl(palette.highlight);
        currentPalettePreset = {
          name: 'Palette',
          stops: [
            { t: 0,    h: bg.h,  s: bg.s,  l: bg.l },
            { t: 0.25, h: sec.h, s: sec.s, l: sec.l },
            { t: 0.5,  h: pri.h, s: pri.s, l: pri.l },
            { t: 0.75, h: acc.h, s: acc.s, l: acc.l },
            { t: 1,    h: hi.h,  s: hi.s,  l: hi.l },
          ],
        };
        cachedPaletteRef.current = { key, preset: currentPalettePreset };
      }
    }

    // Detect new note-ons — each pitch maps to a color preset
    const prevCounts = prevCountsRef.current;
    for (const [pitch, noteCount] of vs.pitchNoteOnCounts) {
      const prev = prevCounts.get(pitch) ?? 0;
      const newHits = noteCount - prev;
      if (newHits > 0) {
        const presetIndex = Math.max(0, Math.min(pitch - PITCH_MIN, COLOR_PRESETS.length - 1));
        for (let i = 0; i < Math.min(newHits, 3); i++) {
          burstsRef.current.push({
            id: idCounter.current++,
            birthTime: now,
            presetIndex,
            palettePreset: currentPalettePreset,
          });
        }
      }
    }
    // Reuse Map: clear and repopulate instead of allocating new
    prevCounts.clear();
    for (const [pitch, noteCount] of vs.pitchNoteOnCounts) {
      prevCounts.set(pitch, noteCount);
    }

    burstsRef.current = burstsRef.current.filter(b => (now - b.birthTime) < burstLifetime);
  });

  return (
    <group>
      <BurstRenderer
        trackId={trackId}
        burstsRef={burstsRef}
        clockRef={clockRef}
      />
    </group>
  );
}

// Only re-renders when burst list membership changes (not every frame)
function BurstRenderer({
  trackId, burstsRef, clockRef,
}: {
  trackId: string;
  burstsRef: React.MutableRefObject<BurstEntry[]>;
  clockRef: React.MutableRefObject<number>;
}) {
  const engineRef = useRef(getVisualPlaybackEngine());
  const [activeBursts, setActiveBursts] = useState<BurstEntry[]>([]);
  const lastIdsRef = useRef('');

  useFrame(() => {
    const bursts = burstsRef.current;
    // Only trigger React re-render when burst IDs change (add/remove)
    const ids = bursts.map(b => b.id).join(',');
    if (ids !== lastIdsRef.current) {
      lastIdsRef.current = ids;
      setActiveBursts([...bursts]);
    }
  });

  const vs = engineRef.current.getTrackState(trackId);
  const count = ((vs?.params?.count as number) ?? 3000);

  return (
    <>
      {activeBursts.map(b => (
        <BurstInstance
          key={b.id}
          birthTime={b.birthTime}
          clockRef={clockRef}
          trackId={trackId}
          preset={b.palettePreset ?? COLOR_PRESETS[b.presetIndex]}
          count={count}
        />
      ))}
    </>
  );
}

// ── Range labels for MIDI editor ────────────────────────────────────────────

const rangeLabels = COLOR_PRESETS.map((preset, i) => ({
  startPitch: PITCH_MIN + i,
  endPitch: PITCH_MIN + i,
  label: preset.name,
}));

// ── Instrument export ───────────────────────────────────────────────────────

export const ParticleBurst: Instrument = {
  id: 'particleBurst',
  name: 'Particle Burst',
  description: 'Explosive particle bursts with logarithmic expansion — each pitch triggers a different color palette',
  icon: '💥',
  color: '#f59e0b',
  hasAudio: false,
  hasVisual: true,
  editorType: 'generic',
  noteRange: { min: PITCH_MIN, max: PITCH_MAX },
  rangeLabels,

  defaultSettings: {
    count: 3000,
    pointSize: 0.035,
    burstRadius: 4,
    dissolveSpread: 5,
    fadePower: 0.6,
    burstPower: 2,
    burstCurve: 'log',
    burstLifetime: 4,
    cylinderRadius: 0,
    burstType: 'sphere',
    coneAngle: 0.8,
    spiralTwists: 3,
    polarPetals: 5,
  },

  settingsSchema: {
    burstType:      { type: 'select', label: 'Burst Type',      options: [
      { value: 'sphere',      label: 'Sphere' },
      { value: 'cone',        label: 'Cone' },
      { value: 'jet',         label: 'Jet' },
      { value: 'spiralOut',   label: 'Spiral Out' },
      { value: 'polarRose',   label: 'Polar Rose' },
      { value: 'ring',        label: 'Ring' },
      { value: 'doubleHelix', label: 'Double Helix' },
    ], default: 'sphere' },
    count:          { type: 'number', label: 'Particles',       min: 500,  max: 8000, step: 500,   default: 3000 },
    pointSize:      { type: 'number', label: 'Dot Size',        min: 0.01, max: 0.1,  step: 0.005, default: 0.035 },
    burstRadius:    { type: 'number', label: 'Burst Radius',    min: 1,    max: 10,   step: 0.25,  default: 4 },
    dissolveSpread: { type: 'number', label: 'Dissolve Spread', min: 0,    max: 15,   step: 0.25,  default: 5 },
    fadePower:      { type: 'number', label: 'Fade Tail',       min: 0.2,  max: 2,    step: 0.05,  default: 0.6 },
    burstPower:     { type: 'number', label: 'Curve Power',     min: 0.5,  max: 5,    step: 0.1,   default: 2 },
    burstCurve:     { type: 'select', label: 'Ease Curve',      options: [
      { value: 'log',   label: 'Logarithmic' },
      { value: 'expo',  label: 'Exponential' },
      { value: 'power', label: 'Power' },
      { value: 'circ',  label: 'Circular' },
      { value: 'sine',  label: 'Sine' },
    ], default: 'log' },
    burstLifetime:  { type: 'number', label: 'Lifetime (s)',    min: 1,    max: 8,    step: 0.25,  default: 4 },
    coneAngle:      { type: 'number', label: 'Cone Angle',      min: 0.1,  max: 1.5,  step: 0.05,  default: 0.8 },
    spiralTwists:   { type: 'number', label: 'Spiral Twists',   min: 1,    max: 10,   step: 0.5,   default: 3 },
    polarPetals:    { type: 'number', label: 'Polar Petals',    min: 2,    max: 12,   step: 1,     default: 5 },
    cylinderRadius: { type: 'number', label: 'Cylinder Radius', min: 0,    max: 20,   step: 0.25,  default: 0 },
  },

  VisualComponent: ParticleBurstVisual,
};

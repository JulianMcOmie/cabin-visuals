import { useMemo, useRef, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import {
  InstancedMesh, InstancedBufferAttribute, SphereGeometry, MeshBasicMaterial,
  Object3D, Color, Vector3, AdditiveBlending,
} from 'three'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW's ParticleBurst. Each note is an InstancedMesh burst of
// particles that expands outward (7 selectable burst geometries + 5 ease curves) and fades.
// Bursts are derived fresh each frame from the note stream (age = beats since onset, in
// seconds at the current tempo), so they're fully scrub-accurate - no spawn-time state.
// Pitch (36–71) picks one of Tyler's hardcoded colour presets; velocity scales brightness.
// Tyler's palette colour-mode is dropped (no palettes here). Burst math + golden-ratio
// sphere distribution + easing are Tyler's verbatim; only state reads + params are rewired.

// ── Easing (Tyler verbatim) ─────────────────────────────────────────────────
type EaseCurve = 'log' | 'expo' | 'power' | 'circ' | 'sine'
type BurstType = 'sphere' | 'cone' | 'jet' | 'spiralOut' | 'polarRose' | 'ring' | 'doubleHelix'

function applyEase(curve: EaseCurve, t: number, power: number): number {
  switch (curve) {
    case 'log':
      return Math.log(1 + t * (Math.pow(10, power) - 1)) / (power * Math.LN10)
    case 'expo':
      return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t * power)
    case 'power':
      return 1 - Math.pow(1 - t, power)
    case 'circ':
      return Math.sqrt(1 - Math.pow(t - 1, 2))
    case 'sine':
      return Math.sin(t * Math.PI * 0.5)
  }
}

// Index → mode string mappings for the select params (indices match option order below).
const BURST_TYPES: BurstType[] = ['sphere', 'cone', 'jet', 'spiralOut', 'polarRose', 'ring', 'doubleHelix']
const EASE_CURVES: EaseCurve[] = ['log', 'expo', 'power', 'circ', 'sine']

// ── Color presets (Tyler verbatim) ──────────────────────────────────────────
interface ColorStop { t: number; h: number; s: number; l: number }
interface ColorPreset { name: string; stops: ColorStop[] }

// Pitch 36–71 (36 presets)
const PITCH_MIN = 36
const PITCH_MAX = 71

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
]

// Sample a color from the preset's gradient at position t ∈ [0,1] (Tyler verbatim)
function samplePreset(preset: ColorPreset, t: number): { h: number; s: number; l: number } {
  const stops = preset.stops
  if (t <= stops[0].t) return stops[0]
  if (t >= stops[stops.length - 1].t) return stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) {
      const frac = (t - stops[i].t) / (stops[i + 1].t - stops[i].t)
      // Lerp hue on shortest path
      let dh = stops[i + 1].h - stops[i].h
      if (dh > 0.5) dh -= 1
      if (dh < -0.5) dh += 1
      return {
        h: (stops[i].h + dh * frac + 1) % 1,
        s: stops[i].s + (stops[i + 1].s - stops[i].s) * frac,
        l: stops[i].l + (stops[i + 1].l - stops[i].l) * frac,
      }
    }
  }
  return stops[0]
}

// ── Particle distribution (golden ratio sphere, Tyler's layout with the random
// jitter swapped for seededRand so the table is identical across mounts) ──────
interface Particle {
  nx: number; ny: number; nz: number
  r: number
  jx: number; jy: number; jz: number
  dissolveMul: number
  theta: number  // azimuthal angle on sphere
  phi: number    // polar angle (0=top, PI=bottom)
  iNorm: number  // normalized index [0,1]
}

function buildParticles(count: number): Particle[] {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const out: Particle[] = []
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const theta = golden * i
    const nx = Math.cos(theta) * r
    const ny = y
    const nz = Math.sin(theta) * r
    const jTheta = seededRand(i * 4 + 1) * Math.PI * 2
    const jPhi = Math.acos(2 * seededRand(i * 4 + 2) - 1)
    const jStr = 0.3
    out.push({
      nx, ny, nz,
      r: Math.pow(seededRand(i * 4 + 3), 0.5),
      jx: Math.sin(jPhi) * Math.cos(jTheta) * jStr,
      jy: Math.sin(jPhi) * Math.sin(jTheta) * jStr,
      jz: Math.cos(jPhi) * jStr,
      dissolveMul: 0.6 + seededRand(i * 4 + 4) * 0.8,
      theta: theta % (Math.PI * 2),
      phi: Math.acos(y),
      iNorm: i / (count - 1),
    })
  }
  return out
}

// ── Config ──────────────────────────────────────────────────────────────────
const MAX_PARTICLES = 8000
const MAX_ACTIVE_BURSTS = 6

// A live burst this frame: t ∈ [0,1) is its normalized age, derived from the beat.
interface BurstEntry { t: number; preset: ColorPreset }

// Reusable temp vectors to avoid per-frame allocation (Tyler's names)
const _tmpVec3A = new Vector3()
const _tmpVec3B = new Vector3()
const _tmpVec3C = new Vector3()
const _tmpVec3D = new Vector3()
const _tmpVec3E = new Vector3()
const _tmpVec3F = new Vector3()

const PARAMS: ParamDef[] = [
  { key: 'burstType', label: 'Burst Type', type: 'select', options: [
    { value: 0, label: 'Sphere' },
    { value: 1, label: 'Cone' },
    { value: 2, label: 'Jet' },
    { value: 3, label: 'Spiral Out' },
    { value: 4, label: 'Polar Rose' },
    { value: 5, label: 'Ring' },
    { value: 6, label: 'Double Helix' },
  ], default: 0 },
  { key: 'count', label: 'Particles', min: 500, max: MAX_PARTICLES, step: 500, default: 3000 },
  { key: 'pointSize', label: 'Dot Size', min: 0.01, max: 0.1, step: 0.005, default: 0.035 },
  { key: 'burstRadius', label: 'Burst Radius', min: 1, max: 10, step: 0.25, default: 4 },
  { key: 'dissolveSpread', label: 'Dissolve Spread', min: 0, max: 15, step: 0.25, default: 5 },
  { key: 'fadePower', label: 'Fade Tail', min: 0.2, max: 2, step: 0.05, default: 0.6 },
  { key: 'burstPower', label: 'Curve Power', min: 0.5, max: 5, step: 0.1, default: 2 },
  { key: 'burstCurve', label: 'Ease Curve', type: 'select', options: [
    { value: 0, label: 'Logarithmic' },
    { value: 1, label: 'Exponential' },
    { value: 2, label: 'Power' },
    { value: 3, label: 'Circular' },
    { value: 4, label: 'Sine' },
  ], default: 0 },
  { key: 'burstLifetime', label: 'Lifetime (s)', min: 1, max: 8, step: 0.25, default: 4 },
  { key: 'coneAngle', label: 'Cone Angle', min: 0.1, max: 1.5, step: 0.05, default: 0.8 },
  { key: 'spiralTwists', label: 'Spiral Twists', min: 1, max: 10, step: 0.5, default: 3 },
  { key: 'polarPetals', label: 'Polar Petals', min: 2, max: 12, step: 1, default: 5 },
  { key: 'cylinderRadius', label: 'Cylinder Radius', min: 0, max: 20, step: 0.25, default: 0 },
]

function ParticleBurstVisual({ trackId }: { trackId: string }) {
  const meshRef = useRef<InstancedMesh>(null)
  const { camera } = useThree()

  // Build a single InstancedMesh sized for MAX_PARTICLES * MAX_ACTIVE_BURSTS instances.
  const particles = useMemo(() => buildParticles(MAX_PARTICLES), [])
  const dummy = useMemo(() => new Object3D(), [])
  const tempColor = useMemo(() => new Color(), [])
  const maxInstances = MAX_PARTICLES * MAX_ACTIVE_BURSTS
  const colorArr = useMemo(() => new Float32Array(maxInstances * 3), [maxInstances])
  const geometry = useMemo(() => {
    const g = new SphereGeometry(1, 4, 4)
    g.setAttribute('color', new InstancedBufferAttribute(new Float32Array(maxInstances * 3), 3))
    return g
  }, [maxInstances])
  const material = useMemo(() => new MeshBasicMaterial({
    vertexColors: true, toneMapped: false, transparent: true, opacity: 0.85,
    blending: AdditiveBlending, depthWrite: false,
  }), [])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    if (!mesh) return

    const par = state.params
    const burstType = BURST_TYPES[Math.round(par.burstType ?? 0)] ?? 'sphere'
    const burstCurve = EASE_CURVES[Math.round(par.burstCurve ?? 0)] ?? 'log'
    const count = Math.max(1, Math.min(Math.floor(par.count ?? 3000), MAX_PARTICLES))
    const pointSize = par.pointSize ?? 0.035
    const burstRadius = par.burstRadius ?? 4
    const dissolveSpread = par.dissolveSpread ?? 5
    const fadePower = par.fadePower ?? 0.6
    const burstPower = par.burstPower ?? 2
    const burstLifetime = par.burstLifetime ?? 4
    const cylinderRadius = par.cylinderRadius ?? 0
    const coneAngle = par.coneAngle ?? 0.8
    const spiralTwists = par.spiralTwists ?? 3
    const polarPetals = par.polarPetals ?? 5

    // Derive the live bursts from the note stream: a note is a burst while its age
    // (seconds since onset at the current tempo) is inside burstLifetime. Pure
    // function of state.beat, so a paused playhead holds still and scrub == playback.
    const alive: BurstEntry[] = []
    for (const n of state.notes) {
      if (n.beat > state.beat) break  // notes are sorted; the rest are in the future
      if (n.pitch < PITCH_MIN || n.pitch > PITCH_MAX) continue
      const ageSec = (state.beat - n.beat) * state.secPerBeat
      if (ageSec >= burstLifetime) continue
      const presetIndex = Math.max(0, Math.min(n.pitch - PITCH_MIN, COLOR_PRESETS.length - 1))
      alive.push({ t: ageSec / burstLifetime, preset: COLOR_PRESETS[presetIndex] })
    }
    const bursts = alive.slice(-MAX_ACTIVE_BURSTS)  // keep the newest, like Tyler's cap

    if (bursts.length === 0) { mesh.count = 0; return }

    // Camera basis for cone/jet/etc. modes and cylinder clipping (Tyler verbatim).
    const camDir = _tmpVec3A
    const particlePos = _tmpVec3B
    camera.getWorldDirection(camDir)
    const toCamera = _tmpVec3C.copy(camDir).negate()
    const arbUp = Math.abs(toCamera.y) < 0.99 ? _tmpVec3D.set(0, 1, 0) : _tmpVec3D.set(1, 0, 0)
    const right = _tmpVec3E.crossVectors(toCamera, arbUp).normalize()
    const up = _tmpVec3F.crossVectors(right, toCamera).normalize()

    let cursor = 0
    for (const burst of bursts) {
      const t = burst.t
      const expand = applyEase(burstCurve, t, burstPower)
      const alpha = Math.max(0, Math.pow(1 - t, fadePower))
      if (alpha < 0.005) continue

      for (let i = 0; i < count; i++) {
        const pt = particles[i]

        let x: number, y: number, z: number

        if (burstType === 'sphere') {
          const totalRadius = burstRadius * pt.r + expand * dissolveSpread * pt.dissolveMul
          const rad = totalRadius * expand
          const jAmt = expand * dissolveSpread * 0.3 * pt.dissolveMul
          x = (pt.nx + pt.jx * jAmt) * rad
          y = (pt.ny + pt.jy * jAmt) * rad
          z = (pt.nz + pt.jz * jAmt) * rad

        } else if (burstType === 'cone') {
          const conePhi = Math.pow(pt.iNorm, 0.6) * coneAngle
          const coneTheta = pt.theta
          const rad = (burstRadius * pt.r + expand * dissolveSpread * pt.dissolveMul) * expand
          const sinP = Math.sin(conePhi)
          const cosP = Math.cos(conePhi)
          const lx = sinP * Math.cos(coneTheta) * rad
          const ly = sinP * Math.sin(coneTheta) * rad
          const lz = cosP * rad
          x = right.x * lx + up.x * ly + toCamera.x * lz
          y = right.y * lx + up.y * ly + toCamera.y * lz
          z = right.z * lx + up.z * ly + toCamera.z * lz

        } else if (burstType === 'jet') {
          const jetAngle = coneAngle * 0.3
          const jetPhi = Math.sqrt(pt.iNorm) * jetAngle
          const jetTheta = pt.theta
          const depthVariation = 0.5 + pt.r * 1.5
          const rad = (burstRadius + expand * dissolveSpread * pt.dissolveMul) * expand * depthVariation
          const sinP = Math.sin(jetPhi)
          const cosP = Math.cos(jetPhi)
          const lx = sinP * Math.cos(jetTheta) * rad
          const ly = sinP * Math.sin(jetTheta) * rad
          const lz = cosP * rad
          x = right.x * lx + up.x * ly + toCamera.x * lz
          y = right.y * lx + up.y * ly + toCamera.y * lz
          z = right.z * lx + up.z * ly + toCamera.z * lz

        } else if (burstType === 'spiralOut') {
          const armAngle = pt.theta + expand * spiralTwists * Math.PI * 2
          const radialDist = pt.iNorm * burstRadius * expand
          const forwardDist = (burstRadius * pt.r + expand * dissolveSpread * pt.dissolveMul) * expand
          const lx = Math.cos(armAngle) * radialDist
          const ly = Math.sin(armAngle) * radialDist
          const lz = forwardDist * (0.3 + pt.iNorm * 0.7)
          x = right.x * lx + up.x * ly + toCamera.x * lz
          y = right.y * lx + up.y * ly + toCamera.y * lz
          z = right.z * lx + up.z * ly + toCamera.z * lz

        } else if (burstType === 'polarRose') {
          const roseTheta = pt.theta
          const roseR = Math.abs(Math.cos(polarPetals * roseTheta))
          const rad = roseR * burstRadius * expand * (0.4 + pt.r * 0.6)
          const forwardDist = (burstRadius * 0.5 + expand * dissolveSpread * pt.dissolveMul * 0.5) * expand
          const phiSpread = (pt.phi - Math.PI * 0.5) * 0.4
          const lx = Math.cos(roseTheta) * rad * Math.cos(phiSpread)
          const ly = Math.sin(roseTheta) * rad * Math.cos(phiSpread)
          const lz = forwardDist + Math.sin(phiSpread) * rad * 0.3
          x = right.x * lx + up.x * ly + toCamera.x * lz
          y = right.y * lx + up.y * ly + toCamera.y * lz
          z = right.z * lx + up.z * ly + toCamera.z * lz

        } else if (burstType === 'ring') {
          const ringTheta = pt.theta
          const majorR = burstRadius * expand
          const minorR = burstRadius * 0.25 * expand * pt.r
          const minorAngle = pt.phi
          const ringX = (majorR + minorR * Math.cos(minorAngle)) * Math.cos(ringTheta)
          const ringY = (majorR + minorR * Math.cos(minorAngle)) * Math.sin(ringTheta)
          const ringZ = minorR * Math.sin(minorAngle) + expand * dissolveSpread * pt.dissolveMul * 0.3
          x = right.x * ringX + up.x * ringY + toCamera.x * ringZ
          y = right.y * ringX + up.y * ringY + toCamera.y * ringZ
          z = right.z * ringX + up.z * ringY + toCamera.z * ringZ

        } else {
          const helixArm = i % 2 === 0 ? 0 : Math.PI
          const helixT = pt.iNorm
          const helixAngle = helixArm + helixT * spiralTwists * Math.PI * 2
          const helixRadius = burstRadius * 0.6 * expand * (0.5 + 0.5 * Math.sin(helixT * Math.PI))
          const forwardDist = helixT * burstRadius * expand * 2
          const jAmt = expand * 0.2 * pt.dissolveMul
          const lx = Math.cos(helixAngle) * helixRadius + pt.jx * jAmt
          const ly = Math.sin(helixAngle) * helixRadius + pt.jy * jAmt
          const lz = forwardDist + pt.jz * jAmt
          x = right.x * lx + up.x * ly + toCamera.x * lz
          y = right.y * lx + up.y * ly + toCamera.y * lz
          z = right.z * lx + up.z * ly + toCamera.z * lz
        }

        // Cylinder clipping (Tyler verbatim)
        let cylAlpha = 1
        if (cylinderRadius > 0) {
          particlePos.set(x, y, z)
          const dot = particlePos.dot(camDir)
          const perpDistSq = particlePos.lengthSq() - dot * dot
          const perpDist = Math.sqrt(Math.max(0, perpDistSq))
          const edgeStart = cylinderRadius * 0.9
          if (perpDist > cylinderRadius) {
            cylAlpha = 0
          } else if (perpDist > edgeStart) {
            cylAlpha = 1 - (perpDist - edgeStart) / (cylinderRadius - edgeStart)
            cylAlpha *= cylAlpha
          }
        }

        const finalAlpha = alpha * cylAlpha

        dummy.position.set(x, y, z)
        dummy.scale.setScalar(cylAlpha > 0 ? pointSize * Math.max(finalAlpha, 0.01) : 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(cursor, dummy.matrix)

        const colorT = pt.ny * 0.5 + 0.5
        const col = samplePreset(burst.preset, colorT)
        tempColor.setHSL(col.h, col.s, col.l * finalAlpha)
        colorArr[cursor * 3] = tempColor.r
        colorArr[cursor * 3 + 1] = tempColor.g
        colorArr[cursor * 3 + 2] = tempColor.b
        cursor++
      }
    }

    mesh.count = cursor
    mesh.instanceMatrix.needsUpdate = true
    const colorAttr = mesh.geometry.getAttribute('color') as InstancedBufferAttribute
    if (colorAttr) {
      ;(colorAttr.array as Float32Array).set(colorArr.subarray(0, cursor * 3))
      colorAttr.needsUpdate = true
    }
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, maxInstances]}
      frustumCulled={false}
      renderOrder={10}
    />
  )
}

export const particleBurstInstrument: ObjectInstrumentDef = {
  id: 'particleBurst',
  name: 'Particle Burst',
  kind: 'object',
  userInterfaceRenderer: 'particleBurst',
  params: PARAMS,
  // Pitch (36-71) selects one of the 36 color presets (pitch - 36 = preset index);
  // velocity scales brightness. Ten representative presets spanning the range
  // (higher pitch on top); in-between pitches pick the presets between them.
  midiRows: [
    { pitch: 71, label: 'Burst · Blood Moon', color: '#992626' },
    { pitch: 67, label: 'Burst · Diamond', color: '#a9b6bd' },
    { pitch: 64, label: 'Burst · Vaporwave', color: '#e600b8' },
    { pitch: 59, label: 'Burst · Prism (rainbow)', color: '#e61717' },
    { pitch: 54, label: 'Burst · Aurora Borealis', color: '#0a9bb8' },
    { pitch: 50, label: 'Burst · Pure White', color: '#bfbfbf' },
    { pitch: 48, label: 'Burst · Emerald', color: '#0bd06a' },
    { pitch: 45, label: 'Burst · Electric Blue', color: '#0066ff' },
    { pitch: 40, label: 'Burst · Rose', color: '#f20d59' },
    { pitch: 36, label: 'Burst · Ember', color: '#e62b00', emphasized: true },
  ],
  component: ParticleBurstVisual,
}

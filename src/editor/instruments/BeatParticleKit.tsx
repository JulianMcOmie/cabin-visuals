import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferGeometry, BufferAttribute, DynamicDrawUsage, ShaderMaterial, Color, Vector3, Points,
} from 'three'
import { getObjectState } from '../core/engine/VisualEngine'
import { useProjectStore } from '../store/ProjectStore'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW's BeatParticleKit. A white-background drum/guitar/chord kit
// where each drum pitch triggers its own bespoke particle effect: kick/snare/clap/rim/hat/
// cymbal spheres, three triangle "pings", a chord flash, and a morphing guitar-note crystal
// wall. Note-onsets are detected per (pitch,beat) key; each pitch maps to its own effect
// exactly as Tyler does. All particle geometry, ADSR, rotation and shader math are Tyler's
// verbatim; only the state reads, onset detection and param schema are rewired. Tyler's
// palette/activePalette and seekGeneration reset are dropped.

// ── Drum-pitch map (Tyler's DRUM_PITCHES + hardcoded pitches, verbatim) ───────
const PITCH_KICK = 36
const PITCH_RIM = 37
const PITCH_SNARE = 38
const PITCH_CLAP = 39
const PITCH_RIM_PAIR = 40
const PITCH_HIHAT = 42
const PITCH_TRIANGLE_A = 44
const PITCH_TRIANGLE_B = 46
const PITCH_TRIANGLE_C = 47
const PITCH_CHORD = 48
const PITCH_CYMBAL = 49
const GUITAR_MIN = 52
const GUITAR_MAX = 83

const MAX_SPHERE_PARTICLES = 2400
const MAX_GUITAR_PARTICLES = 2400
const MAX_CHORD_PARTICLES = 900
const MAX_TOTAL_POINTS = MAX_SPHERE_PARTICLES * 9 + MAX_GUITAR_PARTICLES + MAX_CHORD_PARTICLES

type CrystalMode = 'freeform' | 'octahedron' | 'helix' | 'cubic' | 'quasicrystal'
type HitKey = 'kick' | 'rim' | 'rimPair' | 'snare' | 'clap' | 'hihat' | 'cymbal' | 'triangleA' | 'triangleB' | 'triangleC' | 'chord'
type SphereKind = 'kick' | 'rim' | 'rimPair' | 'snare' | 'clap' | 'hihat' | 'cymbal'
type TriangleKind = 'triangleA' | 'triangleB' | 'triangleC'

// Index → mode string mappings for the select params (order matches the options below).
const COLOR_MODES = ['mono', 'color'] as const
const CRYSTAL_MODES: CrystalMode[] = ['freeform', 'octahedron', 'helix', 'cubic', 'quasicrystal']

interface SphereParticle {
  x: number
  y: number
  z: number
  depthShade: number
  phase: number
  weight: number
  dotScale: number
}

interface GuitarParticle {
  wall: Vector3
  octahedron: Vector3
  helix: Vector3
  cubic: Vector3
  quasicrystal: Vector3
  side: -1 | 1
  phase: number
  strand: number
}

interface ChordParticle {
  x: number
  y: number
  z: number
  ring: number
  phase: number
}

interface HitState {
  time: number
  velocity: number
  gate: number
}

interface GuitarHit {
  time: number
  velocity: number
  gate: number
  pitch: number
}

const DEFAULTS = {
  detail: 3,
  dotSize: 7,
  colorMode: 0, // 0 = mono, 1 = color
  showGuitar: 0,
  guitarShape: 0, // 0 = freeform
  morphSpeed: 5,
  rotationSpeed: 1,
  rotationAmount: 1,
  kickOpacity: 1,
  rimOpacity: 1,
  rimPairOpacity: 1,
  snareOpacity: 1,
  clapOpacity: 1,
  hatOpacity: 1,
  cymbalOpacity: 1,
  triangleAOpacity: 1,
  triangleBOpacity: 1,
  triangleCOpacity: 1,
  chordOpacity: 1,
  guitarOpacity: 1,
  snareAttack: 0.003,
  snareDecay: 0.085,
  snareSustain: 0.22,
  snareRelease: 0.22,
  kickAttack: 0.006,
  kickDecay: 0.18,
  kickSustain: 0.28,
  kickRelease: 0.38,
  rimAttack: 0.002,
  rimDecay: 0.055,
  rimSustain: 0.18,
  rimRelease: 0.14,
  rimPairSpacing: 4.65,
  hatAttack: 0.0015,
  hatDecay: 0.026,
  hatSustain: 0.32,
  hatRelease: 0.075,
  cymbalAttack: 0.002,
  cymbalDecay: 0.12,
  cymbalSustain: 0.34,
  cymbalRelease: 0.62,
  clapAttack: 0.003,
  clapDecay: 0.07,
  clapSustain: 0.2,
  clapRelease: 0.16,
  triangleAttack: 0.001,
  triangleDecay: 0.042,
  triangleSustain: 0.18,
  triangleRelease: 0.22,
  guitarAttack: 0.018,
  guitarDecay: 0.22,
  guitarSustain: 0.68,
  guitarRelease: 1.15,
  chordAttack: 0.01,
  chordDecay: 0.16,
  chordSustain: 0.38,
  chordRelease: 0.85,
}

const vertexShader = `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float perspective = 9.0 / max(1.0, -mvPosition.z);
    gl_PointSize = aSize * perspective;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    float edge = 1.0 - smoothstep(0.72, 1.0, r);
    gl_FragColor = vec4(vColor, vAlpha * edge);
  }
`

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function smooth01(value: number): number {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

// Numeric param read (state.params holds numbers).
function num(params: Record<string, number>, key: string, fallback: number): number {
  return typeof params[key] === 'number' ? params[key] : fallback
}

function adsr(now: number, hit: HitState, attack: number, decay: number, sustain: number, release: number): number {
  const t = now - hit.time
  if (t < 0) return 0
  const attackCurve = 1 - Math.exp(-t / Math.max(0.0005, attack))
  const transient = Math.exp(-t / Math.max(0.001, decay))
  const body = Math.exp(-t / Math.max(0.001, release))
  const bodyMix = clamp(sustain, 0, 1)
  return clamp(attackCurve * (transient * (1 - bodyMix) + body * bodyMix) * hit.velocity, 0, 1)
}

function rotatePoint(
  x: number,
  y: number,
  z: number,
  rotateX: number,
  rotateY: number,
  rotateZ: number
): { x: number; y: number; z: number } {
  const cosX = Math.cos(rotateX)
  const sinX = Math.sin(rotateX)
  const y1 = y * cosX - z * sinX
  const z1 = y * sinX + z * cosX

  const cosY = Math.cos(rotateY)
  const sinY = Math.sin(rotateY)
  const x2 = x * cosY + z1 * sinY
  const z2 = -x * sinY + z1 * cosY

  const cosZ = Math.cos(rotateZ)
  const sinZ = Math.sin(rotateZ)

  return {
    x: x2 * cosZ - y1 * sinZ,
    y: x2 * sinZ + y1 * cosZ,
    z: z2,
  }
}

function makeSphereParticles(count: number): SphereParticle[] {
  const golden = Math.PI * (3 - Math.sqrt(5))
  const out: SphereParticle[] = []
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = i * golden
    const x = Math.cos(theta) * radius
    const z = Math.sin(theta) * radius
    const pseudo = Math.sin(i * 12.9898) * 43758.5453
    const rand = pseudo - Math.floor(pseudo)
    out.push({
      x,
      y,
      z,
      depthShade: 0.72 + (z + 1) * 0.14,
      phase: theta + rand * Math.PI * 2,
      weight: 0.55 + rand * 0.45,
      dotScale: 0.65 + ((rand * 1.61803398875) % 1) * 0.85,
    })
  }
  return out
}

function cubeEdgePoint(i: number, count: number, side: -1 | 1): Vector3 {
  const edge = i % 12
  const t = ((i * 0.61803398875) % 1) * 2 - 1
  const s = 1.15 + ((i % 3) * 0.28)
  const v = new Vector3()
  const axis = Math.floor(edge / 4)
  const corner = edge % 4
  const a = corner < 2 ? -s : s
  const b = corner % 2 === 0 ? -s : s
  if (axis === 0) v.set(t * s, a, b)
  if (axis === 1) v.set(a, t * s, b)
  if (axis === 2) v.set(a, b, t * s)
  v.x = side * (3.85 + v.x * 0.36)
  return v
}

function makeGuitarParticles(count: number): GuitarParticle[] {
  const out: GuitarParticle[] = []
  for (let i = 0; i < count; i++) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1
    const local = Math.floor(i / 2)
    const u = (local * 0.61803398875) % 1
    const v = (local * 0.41421356237) % 1
    const w = (local * 0.73205080757) % 1
    const y = (u * 2 - 1) * 3.15
    const z = (v * 2 - 1) * 1.35
    const wallX = side * (3.25 + w * 1.25)

    const sphereY = 1 - (u * 2)
    const sphereR = Math.sqrt(Math.max(0, 1 - sphereY * sphereY))
    const theta = local * Math.PI * (3 - Math.sqrt(5))
    const sx = Math.cos(theta) * sphereR
    const sz = Math.sin(theta) * sphereR
    const denom = Math.abs(sx) + Math.abs(sphereY) + Math.abs(sz) || 1

    const helixT = u * Math.PI * 8
    const helixRadius = 0.58 + (local % 4) * 0.12

    const qTheta = local * 2.399963229728653
    const qRad = 0.25 + Math.sqrt(u) * 1.35
    const qY = Math.sin(qTheta * 2.5) * 1.05 + (v * 2 - 1) * 0.55

    out.push({
      wall: new Vector3(wallX, y, z),
      octahedron: new Vector3(
        side * (3.85 + (sx / denom) * 1.45),
        (sphereY / denom) * 2.4,
        (sz / denom) * 1.65
      ),
      helix: new Vector3(
        side * (3.85 + Math.cos(helixT) * helixRadius),
        (u * 2 - 1) * 2.7,
        Math.sin(helixT) * helixRadius
      ),
      cubic: cubeEdgePoint(local, count, side),
      quasicrystal: new Vector3(
        side * (3.85 + Math.cos(qTheta) * qRad * 0.54),
        qY,
        Math.sin(qTheta * 1.618) * 0.95
      ),
      side,
      phase: qTheta,
      strand: local % 5,
    })
  }
  return out
}

function makeChordParticles(count: number): ChordParticle[] {
  const out: ChordParticle[] = []
  for (let i = 0; i < count; i++) {
    const ring = i % 9
    const theta = (i * 2.399963229728653) % (Math.PI * 2)
    const radius = 0.45 + ring * 0.42 + ((i * 0.37) % 0.16)
    out.push({
      x: Math.cos(theta) * radius,
      y: Math.sin(theta) * radius,
      z: -1.8 - (ring % 3) * 0.12,
      ring,
      phase: theta,
    })
  }
  return out
}

function colorFor(kind: string, colorMode: string, hueShift = 0): Color {
  if (colorMode !== 'color') return new Color(0x000000)
  const color = new Color()
  const hueByKind: Record<string, number> = {
    kick: 0.58,
    rim: 0.98,
    rimPair: 0.99,
    snare: 0.92,
    clap: 0.02,
    hihat: 0.13,
    cymbal: 0.1,
    triangleA: 0.47,
    triangleB: 0.53,
    triangleC: 0.58,
    chord: 0.72,
    guitar: 0.36,
  }
  color.setHSL((hueByKind[kind] + hueShift) % 1, 0.8, kind === 'hihat' ? 0.36 : kind.startsWith('triangle') ? 0.48 : 0.42)
  return color
}

function makeInitialHits(): Record<HitKey, HitState> {
  return {
    kick: { time: -999, velocity: 0, gate: 0.08 },
    rim: { time: -999, velocity: 0, gate: 0.07 },
    rimPair: { time: -999, velocity: 0, gate: 0.07 },
    snare: { time: -999, velocity: 0, gate: 0.1 },
    clap: { time: -999, velocity: 0, gate: 0.09 },
    hihat: { time: -999, velocity: 0, gate: 0.04 },
    cymbal: { time: -999, velocity: 0, gate: 0.28 },
    triangleA: { time: -999, velocity: 0, gate: 0.05 },
    triangleB: { time: -999, velocity: 0, gate: 0.05 },
    triangleC: { time: -999, velocity: 0, gate: 0.05 },
    chord: { time: -999, velocity: 0, gate: 0.4 },
  }
}

const PARAMS: ParamDef[] = [
  { key: 'detail', label: 'Particle Detail', min: 0.5, max: 3, step: 0.25, default: DEFAULTS.detail },
  { key: 'dotSize', label: 'Dot Size', min: 2, max: 14, step: 0.5, default: DEFAULTS.dotSize },
  { key: 'colorMode', label: 'Color Mode', type: 'select', options: [
    { value: 0, label: 'Black on White' },
    { value: 1, label: 'Instrument Color' },
  ], default: DEFAULTS.colorMode },
  { key: 'showGuitar', label: 'Show Guitar', type: 'boolean', default: DEFAULTS.showGuitar },
  { key: 'guitarShape', label: 'Guitar Shape', type: 'select', options: [
    { value: 0, label: 'Fuzzy Walls' },
    { value: 1, label: 'Octahedron' },
    { value: 2, label: 'Double Helix' },
    { value: 3, label: 'Nested Cubes' },
    { value: 4, label: 'Quasicrystal' },
  ], default: DEFAULTS.guitarShape },
  { key: 'morphSpeed', label: 'Crystal Morph', min: 0.5, max: 12, step: 0.5, default: DEFAULTS.morphSpeed },
  { key: 'rotationSpeed', label: 'Rotation Speed', min: 0, max: 3, step: 0.05, default: DEFAULTS.rotationSpeed },
  { key: 'rotationAmount', label: 'Rotation Amount', min: 0, max: 2, step: 0.05, default: DEFAULTS.rotationAmount },
  { key: 'kickOpacity', label: 'Kick Opacity', min: 0, max: 1, step: 0.01, default: DEFAULTS.kickOpacity },
  { key: 'rimOpacity', label: 'Rim Opacity', min: 0, max: 1, step: 0.01, default: DEFAULTS.rimOpacity },
  { key: 'rimPairOpacity', label: 'Rim Pair Opacity', min: 0, max: 1, step: 0.01, default: DEFAULTS.rimPairOpacity },
  { key: 'snareOpacity', label: 'Snare Opacity', min: 0, max: 1, step: 0.01, default: DEFAULTS.snareOpacity },
  { key: 'clapOpacity', label: 'Clap Opacity', min: 0, max: 1, step: 0.01, default: DEFAULTS.clapOpacity },
  { key: 'hatOpacity', label: 'Hat Opacity', min: 0, max: 1, step: 0.01, default: DEFAULTS.hatOpacity },
  { key: 'cymbalOpacity', label: 'Cymbal Opacity', min: 0, max: 1, step: 0.01, default: DEFAULTS.cymbalOpacity },
  { key: 'triangleAOpacity', label: 'Triangle S Opacity', min: 0, max: 1, step: 0.01, default: DEFAULTS.triangleAOpacity },
  { key: 'triangleBOpacity', label: 'Triangle L Opacity', min: 0, max: 1, step: 0.01, default: DEFAULTS.triangleBOpacity },
  { key: 'triangleCOpacity', label: 'Triangle Drop Opacity', min: 0, max: 1, step: 0.01, default: DEFAULTS.triangleCOpacity },
  { key: 'chordOpacity', label: 'Chord Opacity', min: 0, max: 1, step: 0.01, default: DEFAULTS.chordOpacity },
  { key: 'guitarOpacity', label: 'Guitar Opacity', min: 0, max: 1, step: 0.01, default: DEFAULTS.guitarOpacity },
  { key: 'snareAttack', label: 'Snare Attack', min: 0.001, max: 0.1, step: 0.001, default: DEFAULTS.snareAttack },
  { key: 'snareDecay', label: 'Snare Decay', min: 0.01, max: 0.5, step: 0.01, default: DEFAULTS.snareDecay },
  { key: 'snareSustain', label: 'Snare Sustain', min: 0, max: 1, step: 0.01, default: DEFAULTS.snareSustain },
  { key: 'snareRelease', label: 'Snare Release', min: 0.02, max: 1.5, step: 0.01, default: DEFAULTS.snareRelease },
  { key: 'kickAttack', label: 'Kick Attack', min: 0.001, max: 0.1, step: 0.001, default: DEFAULTS.kickAttack },
  { key: 'kickDecay', label: 'Kick Decay', min: 0.01, max: 0.5, step: 0.01, default: DEFAULTS.kickDecay },
  { key: 'kickSustain', label: 'Kick Sustain', min: 0, max: 1, step: 0.01, default: DEFAULTS.kickSustain },
  { key: 'kickRelease', label: 'Kick Release', min: 0.02, max: 1.5, step: 0.01, default: DEFAULTS.kickRelease },
  { key: 'rimAttack', label: 'Rim Attack', min: 0.001, max: 0.1, step: 0.001, default: DEFAULTS.rimAttack },
  { key: 'rimDecay', label: 'Rim Decay', min: 0.01, max: 0.5, step: 0.01, default: DEFAULTS.rimDecay },
  { key: 'rimSustain', label: 'Rim Sustain', min: 0, max: 1, step: 0.01, default: DEFAULTS.rimSustain },
  { key: 'rimRelease', label: 'Rim Release', min: 0.02, max: 1.5, step: 0.01, default: DEFAULTS.rimRelease },
  { key: 'rimPairSpacing', label: 'Rim Pair Spacing', min: 0, max: 7, step: 0.05, default: DEFAULTS.rimPairSpacing },
  { key: 'hatAttack', label: 'Hat Attack', min: 0.001, max: 0.05, step: 0.001, default: DEFAULTS.hatAttack },
  { key: 'hatDecay', label: 'Hat Decay', min: 0.005, max: 0.2, step: 0.005, default: DEFAULTS.hatDecay },
  { key: 'hatSustain', label: 'Hat Sustain', min: 0, max: 1, step: 0.01, default: DEFAULTS.hatSustain },
  { key: 'hatRelease', label: 'Hat Release', min: 0.01, max: 0.5, step: 0.01, default: DEFAULTS.hatRelease },
  { key: 'cymbalAttack', label: 'Cymbal Attack', min: 0.001, max: 0.1, step: 0.001, default: DEFAULTS.cymbalAttack },
  { key: 'cymbalDecay', label: 'Cymbal Decay', min: 0.01, max: 1, step: 0.01, default: DEFAULTS.cymbalDecay },
  { key: 'cymbalSustain', label: 'Cymbal Sustain', min: 0, max: 1, step: 0.01, default: DEFAULTS.cymbalSustain },
  { key: 'cymbalRelease', label: 'Cymbal Release', min: 0.02, max: 2, step: 0.01, default: DEFAULTS.cymbalRelease },
  { key: 'clapAttack', label: 'Clap Attack', min: 0.001, max: 0.1, step: 0.001, default: DEFAULTS.clapAttack },
  { key: 'clapDecay', label: 'Clap Decay', min: 0.01, max: 0.5, step: 0.01, default: DEFAULTS.clapDecay },
  { key: 'clapSustain', label: 'Clap Sustain', min: 0, max: 1, step: 0.01, default: DEFAULTS.clapSustain },
  { key: 'clapRelease', label: 'Clap Release', min: 0.02, max: 1.5, step: 0.01, default: DEFAULTS.clapRelease },
  { key: 'triangleAttack', label: 'Triangle Attack', min: 0.001, max: 0.08, step: 0.001, default: DEFAULTS.triangleAttack },
  { key: 'triangleDecay', label: 'Triangle Decay', min: 0.01, max: 0.5, step: 0.01, default: DEFAULTS.triangleDecay },
  { key: 'triangleSustain', label: 'Triangle Sustain', min: 0, max: 1, step: 0.01, default: DEFAULTS.triangleSustain },
  { key: 'triangleRelease', label: 'Triangle Release', min: 0.02, max: 1.5, step: 0.01, default: DEFAULTS.triangleRelease },
  { key: 'guitarAttack', label: 'Guitar Attack', min: 0.001, max: 0.4, step: 0.001, default: DEFAULTS.guitarAttack },
  { key: 'guitarDecay', label: 'Guitar Decay', min: 0.01, max: 1, step: 0.01, default: DEFAULTS.guitarDecay },
  { key: 'guitarSustain', label: 'Guitar Sustain', min: 0, max: 1, step: 0.01, default: DEFAULTS.guitarSustain },
  { key: 'guitarRelease', label: 'Guitar Release', min: 0.02, max: 2, step: 0.01, default: DEFAULTS.guitarRelease },
  { key: 'chordAttack', label: 'Chord Attack', min: 0.001, max: 0.2, step: 0.001, default: DEFAULTS.chordAttack },
  { key: 'chordDecay', label: 'Chord Decay', min: 0.01, max: 1, step: 0.01, default: DEFAULTS.chordDecay },
  { key: 'chordSustain', label: 'Chord Sustain', min: 0, max: 1, step: 0.01, default: DEFAULTS.chordSustain },
  { key: 'chordRelease', label: 'Chord Release', min: 0.02, max: 2, step: 0.01, default: DEFAULTS.chordRelease },
]

const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

function BeatParticleKitVisual({ trackId }: { trackId: string }) {
  const pointsRef = useRef<Points>(null)
  // Note-onset detection: newly-seen (pitch,beat) keys are fresh note-ons this frame.
  const prevKeys = useRef<Set<string>>(new Set())
  const guitarHitsRef = useRef<GuitarHit[]>([])
  const currentGuitarRef = useRef<Float32Array | null>(null)

  const hitRef = useRef<Record<HitKey, HitState>>(makeInitialHits())

  const sphereParticles = useMemo(() => makeSphereParticles(MAX_SPHERE_PARTICLES), [])
  const guitarParticles = useMemo(() => makeGuitarParticles(MAX_GUITAR_PARTICLES), [])
  const chordParticles = useMemo(() => makeChordParticles(MAX_CHORD_PARTICLES), [])

  const geometry = useMemo(() => {
    const geom = new BufferGeometry()
    const positions = new Float32Array(MAX_TOTAL_POINTS * 3)
    const sizes = new Float32Array(MAX_TOTAL_POINTS)
    const alphas = new Float32Array(MAX_TOTAL_POINTS)
    const colors = new Float32Array(MAX_TOTAL_POINTS * 3)

    geom.setAttribute('position', new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage))
    geom.setAttribute('aSize', new BufferAttribute(sizes, 1).setUsage(DynamicDrawUsage))
    geom.setAttribute('aAlpha', new BufferAttribute(alphas, 1).setUsage(DynamicDrawUsage))
    geom.setAttribute('aColor', new BufferAttribute(colors, 3).setUsage(DynamicDrawUsage))
    geom.setDrawRange(0, 0)
    return geom
  }, [])

  const material = useMemo(() => new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }), [])

  useEffect(() => () => {
    guitarHitsRef.current = []
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  useFrame(({ clock }, delta) => {
    const state = getObjectState(trackId)
    if (!state) return

    const now = clock.elapsedTime
    const params = state.params
    const detail = clamp(num(params, 'detail', DEFAULTS.detail), 0.5, 3)
    const dotSize = num(params, 'dotSize', DEFAULTS.dotSize)
    const colorMode = COLOR_MODES[Math.round(num(params, 'colorMode', DEFAULTS.colorMode))] ?? 'mono'
    const showGuitar = num(params, 'showGuitar', DEFAULTS.showGuitar) >= 0.5
    const crystalMode = CRYSTAL_MODES[Math.round(num(params, 'guitarShape', DEFAULTS.guitarShape))] ?? 'freeform'
    const morphSpeed = num(params, 'morphSpeed', DEFAULTS.morphSpeed)
    const rotationSpeed = num(params, 'rotationSpeed', DEFAULTS.rotationSpeed)
    const rotationAmount = num(params, 'rotationAmount', DEFAULTS.rotationAmount)
    const rimPairSpacing = num(params, 'rimPairSpacing', DEFAULTS.rimPairSpacing)
    const kickOpacity = clamp(num(params, 'kickOpacity', DEFAULTS.kickOpacity), 0, 1)
    const rimOpacity = clamp(num(params, 'rimOpacity', DEFAULTS.rimOpacity), 0, 1)
    const rimPairOpacity = clamp(num(params, 'rimPairOpacity', DEFAULTS.rimPairOpacity), 0, 1)
    const snareOpacity = clamp(num(params, 'snareOpacity', DEFAULTS.snareOpacity), 0, 1)
    const clapOpacity = clamp(num(params, 'clapOpacity', DEFAULTS.clapOpacity), 0, 1)
    const hatOpacity = clamp(num(params, 'hatOpacity', DEFAULTS.hatOpacity), 0, 1)
    const cymbalOpacity = clamp(num(params, 'cymbalOpacity', DEFAULTS.cymbalOpacity), 0, 1)
    const triangleAOpacity = clamp(num(params, 'triangleAOpacity', DEFAULTS.triangleAOpacity), 0, 1)
    const triangleBOpacity = clamp(num(params, 'triangleBOpacity', DEFAULTS.triangleBOpacity), 0, 1)
    const triangleCOpacity = clamp(num(params, 'triangleCOpacity', DEFAULTS.triangleCOpacity), 0, 1)
    const chordOpacity = clamp(num(params, 'chordOpacity', DEFAULTS.chordOpacity), 0, 1)
    const guitarOpacity = clamp(num(params, 'guitarOpacity', DEFAULTS.guitarOpacity), 0, 1)

    // Onset detection: a note-on is a (pitch,beat) key newly present in activeNotes.
    const secPerBeat = 60 / useProjectStore.getState().bpm
    const keys = new Set(state.activeNotes.map((n) => `${n.pitch}:${n.beat}`))
    for (const n of state.activeNotes) {
      const key = `${n.pitch}:${n.beat}`
      if (prevKeys.current.has(key)) continue

      const pitch = n.pitch
      const velocity = clamp((n.velocity <= 1 ? n.velocity : n.velocity / 127), 0.05, 1)
      const durationSec = Math.max(0, n.durationBeats || 0) * secPerBeat
      const gate = Math.max(0.025, durationSec * 0.5)

      if (pitch === PITCH_KICK) hitRef.current.kick = { time: now, velocity, gate }
      else if (pitch === PITCH_RIM) hitRef.current.rim = { time: now, velocity, gate: Math.min(gate, 0.08) }
      else if (pitch === PITCH_RIM_PAIR) hitRef.current.rimPair = { time: now, velocity, gate: Math.min(gate, 0.08) }
      else if (pitch === PITCH_SNARE) hitRef.current.snare = { time: now, velocity, gate }
      else if (pitch === PITCH_CLAP) hitRef.current.clap = { time: now, velocity, gate }
      else if (pitch === PITCH_HIHAT) hitRef.current.hihat = { time: now, velocity, gate: Math.min(gate, 0.08) }
      else if (pitch === PITCH_CYMBAL) hitRef.current.cymbal = { time: now, velocity, gate: Math.max(gate, 0.28) }
      else if (pitch === PITCH_TRIANGLE_A) hitRef.current.triangleA = { time: now, velocity, gate: Math.min(gate, 0.08) }
      else if (pitch === PITCH_TRIANGLE_B) hitRef.current.triangleB = { time: now, velocity, gate: Math.min(gate, 0.08) }
      else if (pitch === PITCH_TRIANGLE_C) hitRef.current.triangleC = { time: now, velocity, gate: Math.min(gate, 0.08) }
      else if (pitch === PITCH_CHORD) hitRef.current.chord = { time: now, velocity, gate: Math.max(gate, 0.25) }
      else if (pitch >= GUITAR_MIN && pitch <= GUITAR_MAX) {
        guitarHitsRef.current.push({ time: now, velocity, gate: Math.max(gate, 0.08), pitch })
      }
    }
    prevKeys.current = keys

    const kickAmp = adsr(
      now,
      hitRef.current.kick,
      num(params, 'kickAttack', DEFAULTS.kickAttack),
      num(params, 'kickDecay', DEFAULTS.kickDecay),
      num(params, 'kickSustain', DEFAULTS.kickSustain),
      num(params, 'kickRelease', DEFAULTS.kickRelease)
    )
    const snareAmp = adsr(
      now,
      hitRef.current.snare,
      num(params, 'snareAttack', DEFAULTS.snareAttack),
      num(params, 'snareDecay', DEFAULTS.snareDecay),
      num(params, 'snareSustain', DEFAULTS.snareSustain),
      num(params, 'snareRelease', DEFAULTS.snareRelease)
    )
    const rimAmp = adsr(
      now,
      hitRef.current.rim,
      num(params, 'rimAttack', DEFAULTS.rimAttack),
      num(params, 'rimDecay', DEFAULTS.rimDecay),
      num(params, 'rimSustain', DEFAULTS.rimSustain),
      num(params, 'rimRelease', DEFAULTS.rimRelease)
    )
    const rimPairAmp = adsr(
      now,
      hitRef.current.rimPair,
      num(params, 'rimAttack', DEFAULTS.rimAttack),
      num(params, 'rimDecay', DEFAULTS.rimDecay),
      num(params, 'rimSustain', DEFAULTS.rimSustain),
      num(params, 'rimRelease', DEFAULTS.rimRelease)
    )
    const clapAmp = adsr(
      now,
      hitRef.current.clap,
      num(params, 'clapAttack', DEFAULTS.clapAttack),
      num(params, 'clapDecay', DEFAULTS.clapDecay),
      num(params, 'clapSustain', DEFAULTS.clapSustain),
      num(params, 'clapRelease', DEFAULTS.clapRelease)
    )
    const hatAmp = adsr(
      now,
      hitRef.current.hihat,
      num(params, 'hatAttack', DEFAULTS.hatAttack),
      num(params, 'hatDecay', DEFAULTS.hatDecay),
      num(params, 'hatSustain', DEFAULTS.hatSustain),
      num(params, 'hatRelease', DEFAULTS.hatRelease)
    )
    const cymbalAmp = adsr(
      now,
      hitRef.current.cymbal,
      num(params, 'cymbalAttack', DEFAULTS.cymbalAttack),
      num(params, 'cymbalDecay', DEFAULTS.cymbalDecay),
      num(params, 'cymbalSustain', DEFAULTS.cymbalSustain),
      num(params, 'cymbalRelease', DEFAULTS.cymbalRelease)
    )
    const triangleAmpA = adsr(
      now,
      hitRef.current.triangleA,
      num(params, 'triangleAttack', DEFAULTS.triangleAttack),
      num(params, 'triangleDecay', DEFAULTS.triangleDecay),
      num(params, 'triangleSustain', DEFAULTS.triangleSustain),
      num(params, 'triangleRelease', DEFAULTS.triangleRelease)
    )
    const triangleAmpB = adsr(
      now,
      hitRef.current.triangleB,
      num(params, 'triangleAttack', DEFAULTS.triangleAttack),
      num(params, 'triangleDecay', DEFAULTS.triangleDecay) * 1.25,
      num(params, 'triangleSustain', DEFAULTS.triangleSustain),
      num(params, 'triangleRelease', DEFAULTS.triangleRelease) * 1.2
    )
    const triangleAmpC = adsr(
      now,
      hitRef.current.triangleC,
      num(params, 'triangleAttack', DEFAULTS.triangleAttack),
      num(params, 'triangleDecay', DEFAULTS.triangleDecay) * 1.1,
      num(params, 'triangleSustain', DEFAULTS.triangleSustain),
      num(params, 'triangleRelease', DEFAULTS.triangleRelease) * 1.35
    )
    const chordAmp = adsr(
      now,
      hitRef.current.chord,
      num(params, 'chordAttack', DEFAULTS.chordAttack),
      num(params, 'chordDecay', DEFAULTS.chordDecay),
      num(params, 'chordSustain', DEFAULTS.chordSustain),
      num(params, 'chordRelease', DEFAULTS.chordRelease)
    )

    guitarHitsRef.current = guitarHitsRef.current.filter((hit) => now - hit.time < 2.5)
    let guitarAmp = 0
    let guitarPitchHue = 0
    for (const hit of guitarHitsRef.current) {
      const amp = adsr(
        now,
        hit,
        num(params, 'guitarAttack', DEFAULTS.guitarAttack),
        num(params, 'guitarDecay', DEFAULTS.guitarDecay),
        num(params, 'guitarSustain', DEFAULTS.guitarSustain),
        num(params, 'guitarRelease', DEFAULTS.guitarRelease)
      )
      guitarAmp += amp
      guitarPitchHue += amp * (((hit.pitch - GUITAR_MIN) % 12) / 12)
    }
    guitarAmp = clamp(guitarAmp, 0, 1.6)
    guitarPitchHue = guitarAmp > 0 ? guitarPitchHue / guitarAmp : 0

    const positions = geometry.getAttribute('position') as BufferAttribute
    const sizes = geometry.getAttribute('aSize') as BufferAttribute
    const alphas = geometry.getAttribute('aAlpha') as BufferAttribute
    const colors = geometry.getAttribute('aColor') as BufferAttribute
    const pos = positions.array as Float32Array
    const size = sizes.array as Float32Array
    const alpha = alphas.array as Float32Array
    const col = colors.array as Float32Array
    let cursor = 0

    const writePoint = (x: number, y: number, z: number, pointSize: number, opacity: number, color: Color) => {
      if (cursor >= MAX_TOTAL_POINTS || opacity <= 0.002) return
      const i3 = cursor * 3
      pos[i3] = x
      pos[i3 + 1] = y
      pos[i3 + 2] = z
      size[cursor] = pointSize
      alpha[cursor] = clamp(opacity, 0, 1)
      col[i3] = color.r
      col[i3 + 1] = color.g
      col[i3 + 2] = color.b
      cursor++
    }

    const sphereCount = Math.floor(720 * detail)
    const writeSphere = (
      amp: number,
      centerY: number,
      radius: number,
      kind: SphereKind,
      topOnly = false,
      centerX = 0,
      opacityMul = 1
    ) => {
      if (amp <= 0.004) return
      const hitAge = Math.max(0, now - hitRef.current[kind].time)
      const clapLike = kind === 'clap' || kind === 'rim' || kind === 'rimPair'
      const metalLike = kind === 'hihat' || kind === 'cymbal'
      const attackPop = Math.exp(-hitAge / (kind === 'kick' ? 0.055 : kind === 'snare' ? 0.035 : clapLike ? 0.032 : kind === 'cymbal' ? 0.038 : 0.016))
      const bodyPulse = Math.exp(-hitAge / (kind === 'kick' ? 0.24 : kind === 'snare' ? 0.12 : clapLike ? 0.1 : kind === 'cymbal' ? 0.18 : 0.055))
      const spin = rotationSpeed * rotationAmount
      const rotateY = kind === 'kick'
        ? now * 0.34 * spin
        : kind === 'snare'
          ? now * 0.27 * spin
          : clapLike
            ? now * (kind === 'rim' || kind === 'rimPair' ? 0.24 : -0.22) * spin
            : metalLike
              ? now * (kind === 'cymbal' ? 0.14 : 0.22) * spin
              : now * 0.22 * spin
      const rotateX = kind === 'snare'
        ? Math.sin(now * 0.38 * Math.max(0.1, rotationSpeed)) * 0.18 * rotationAmount
        : clapLike
          ? Math.sin(now * (kind === 'rim' ? 0.5 : 0.44) * Math.max(0.1, rotationSpeed)) * 0.12 * rotationAmount
        : metalLike
          ? (kind === 'cymbal' ? 0.96 : 1.08) + Math.sin(now * (kind === 'cymbal' ? 0.42 : 0.62) * Math.max(0.1, rotationSpeed)) * (kind === 'cymbal' ? 0.1 : 0.08) * rotationAmount
          : 0
      const rotateZ = kind === 'snare'
        ? Math.cos(now * 0.21 * Math.max(0.1, rotationSpeed)) * 0.08 * rotationAmount
        : clapLike
          ? Math.cos(now * (kind === 'rim' ? 0.29 : 0.33) * Math.max(0.1, rotationSpeed)) * 0.18 * rotationAmount
          : metalLike
            ? now * (kind === 'cymbal' ? 0.1 : 0.16) * spin
            : 0
      const sphereScale = kind === 'kick'
        ? 1 + attackPop * 0.18 + amp * 0.06
        : kind === 'snare'
          ? 1 + attackPop * 0.08 + amp * 0.04
          : clapLike
            ? 1 + attackPop * 0.14 + amp * 0.035
          : kind === 'cymbal'
            ? 1 + attackPop * 0.06 + amp * 0.08
          : 1
      const turbulence = kind === 'kick'
        ? attackPop * 0.018
        : kind === 'snare'
          ? attackPop * 0.07 + amp * 0.018
          : clapLike
            ? attackPop * 0.1 + amp * 0.026
          : kind === 'cymbal'
            ? attackPop * 0.02 + amp * 0.009
          : attackPop * 0.012
      const color = colorFor(kind, colorMode)

      for (let i = 0; i < sphereCount; i++) {
        const p = sphereParticles[i]
        if (topOnly && p.y < 1 / 3) continue
        const jitter = Math.sin(now * (kind === 'hihat' ? 120 : kind === 'cymbal' ? 72 : 38) + p.phase * (metalLike ? 3.2 : 1)) * turbulence * p.weight
        const localX = p.x * sphereScale + p.x * jitter
        const localY = p.y * sphereScale + p.y * jitter + (kind === 'kick' ? attackPop * 0.055 + amp * 0.025 : 0)
        const localZ = p.z * sphereScale + p.z * jitter
        const rotated = rotatePoint(localX, localY, localZ, rotateX, rotateY, rotateZ)
        const depth01 = clamp((rotated.z + 1.2) / 2.4, 0, 1)
        const x = centerX + rotated.x * radius
        const y = centerY + rotated.y * radius
        const z = rotated.z * radius * 0.78
        const shade = 0.52 + depth01 * 0.48
        const pointScale = 1
          + attackPop * (kind === 'kick' ? 0.58 : kind === 'snare' ? 0.42 : clapLike ? 0.5 : 0.1)
          + bodyPulse * (kind === 'hihat' ? 0 : kind === 'cymbal' ? 0.06 : 0.12)
        writePoint(
          x,
          y,
          z,
          dotSize * (kind === 'hihat' ? 0.62 : kind === 'cymbal' ? 0.7 : clapLike ? 0.78 : 0.92) * p.dotScale * pointScale,
          amp * p.weight * shade * opacityMul,
          color
        )
      }
    }

    const writeTrianglePing = (
      amp: number,
      centerX: number,
      centerY: number,
      radius: number,
      kind: TriangleKind,
      bottomWidth = 1,
      bottomDrop = 0,
      descend = 0,
      opacityMul = 1
    ) => {
      if (amp <= 0.004) return
      const hitAge = Math.max(0, now - hitRef.current[kind].time)
      const attackPop = Math.exp(-hitAge / 0.018)
      const pingGlow = Math.exp(-hitAge / (kind === 'triangleA' ? 0.11 : kind === 'triangleB' ? 0.16 : 0.19))
      const descendProgress = clamp(hitAge / 0.42, 0, 1)
      const currentCenterY = centerY - descend * (1 - Math.pow(1 - descendProgress, 3))
      const count = Math.floor((kind === 'triangleA' ? 170 : kind === 'triangleB' ? 220 : 240) * detail)
      const color = colorFor(kind, colorMode)
      const dotMotion = Math.max(0.15, rotationSpeed * rotationAmount)
      const flowSpeed = (kind === 'triangleA' ? 0.34 : kind === 'triangleB' ? -0.26 : 0.18) * dotMotion
      const centroidY = -bottomDrop * 2 / 3
      const verts = [
        { x: 0, y: 1 },
        { x: -0.866 * bottomWidth, y: -0.5 - bottomDrop },
        { x: 0.866 * bottomWidth, y: -0.5 - bottomDrop },
      ]

      for (let i = 0; i < count; i++) {
        const p = sphereParticles[i]
        const edgePos = (i * 0.61803398875) % 3
        const edge = Math.floor(edgePos)
        const rawEdgeT = edgePos - edge + hitAge * flowSpeed + Math.sin(p.phase) * 0.006
        const edgeT = ((rawEdgeT % 1) + 1) % 1
        const prev = verts[(edge + 2) % 3]
        const a = verts[edge]
        const b = verts[(edge + 1) % 3]
        const sideX = b.x - a.x
        const sideY = b.y - a.y
        const sideLen = Math.sqrt(sideX * sideX + sideY * sideY) || 1
        const prevX = prev.x - a.x
        const prevY = prev.y - a.y
        const prevLen = Math.sqrt(prevX * prevX + prevY * prevY) || 1
        const dirNextX = sideX / sideLen
        const dirNextY = sideY / sideLen
        const dirPrevX = prevX / prevLen
        const dirPrevY = prevY / prevLen
        const cornerRadius = Math.min(sideLen * 0.25, prevLen * 0.25, 0.36)
        const cornerT = clamp(cornerRadius / sideLen, 0.08, 0.28)

        let baseX: number
        let baseY: number
        let tangentX: number
        let tangentY: number
        if (edgeT < cornerT) {
          const u = edgeT / cornerT
          const inv = 1 - u
          const p0x = a.x + dirPrevX * cornerRadius
          const p0y = a.y + dirPrevY * cornerRadius
          const p1x = a.x + dirNextX * cornerRadius
          const p1y = a.y + dirNextY * cornerRadius
          baseX = inv * inv * p0x + 2 * inv * u * a.x + u * u * p1x
          baseY = inv * inv * p0y + 2 * inv * u * a.y + u * u * p1y
          tangentX = 2 * inv * (a.x - p0x) + 2 * u * (p1x - a.x)
          tangentY = 2 * inv * (a.y - p0y) + 2 * u * (p1y - a.y)
        } else {
          const u = (edgeT - cornerT) / (1 - cornerT)
          const p0x = a.x + dirNextX * cornerRadius
          const p0y = a.y + dirNextY * cornerRadius
          const p1x = b.x - dirNextX * cornerRadius
          const p1y = b.y - dirNextY * cornerRadius
          baseX = p0x + (p1x - p0x) * u
          baseY = p0y + (p1y - p0y) * u
          tangentX = p1x - p0x
          tangentY = p1y - p0y
        }

        const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY) || 1
        tangentX /= tangentLen
        tangentY /= tangentLen
        let normalX = -tangentY
        let normalY = tangentX
        if (normalX * -baseX + normalY * (centroidY - baseY) < 0) {
          normalX *= -1
          normalY *= -1
        }

        const shimmer = Math.sin(now * (kind === 'triangleA' ? 78 : 64) + p.phase * 2.4 + edge * 1.7)
        const orbitPhase = now * (1.8 + dotMotion * 0.35) + p.phase + edge * 1.9
        const edgeJitter = (p.weight - 0.75) * 0.022 + shimmer * attackPop * 0.012
        const inwardPulse = (0.008 + pingGlow * 0.016) * Math.max(0, Math.sin(orbitPhase))
        const tangentDrift = Math.cos(orbitPhase) * 0.018 * (0.35 + pingGlow)
        const localX = baseX + normalX * (edgeJitter + inwardPulse) + tangentX * tangentDrift
        const localY = baseY + normalY * (edgeJitter + inwardPulse) + tangentY * tangentDrift
        const localZ = p.z * 0.09 + shimmer * (0.035 + attackPop * 0.055) + Math.sin(orbitPhase + edge) * 0.028
        const sparkle = 0.55 + Math.max(0, shimmer) * 0.45

        writePoint(
          centerX + localX * radius,
          currentCenterY + localY * radius,
          localZ * radius * 0.75,
          dotSize * (kind === 'triangleA' ? 0.46 : kind === 'triangleB' ? 0.52 : 0.48) * p.dotScale * (1 + attackPop * 0.9),
          amp * (0.28 + pingGlow * 0.72) * p.weight * sparkle * opacityMul,
          color
        )
      }
    }

    writeSphere(snareAmp, 0, 2.55, 'snare', false, 0, snareOpacity)
    writeSphere(clapAmp, 1.55, 1.55, 'clap', false, 0, clapOpacity)
    writeSphere(rimAmp, -1.55, 1.55, 'rim', false, 0, rimOpacity)
    const rimPairHalfSpacing = Math.max(0, rimPairSpacing) * 0.5
    writeSphere(rimPairAmp, -1.55, 1.55, 'rimPair', false, -rimPairHalfSpacing, rimPairOpacity)
    writeSphere(rimPairAmp, -1.55, 1.55, 'rimPair', false, rimPairHalfSpacing, rimPairOpacity)
    writeSphere(kickAmp, -4.9, 2.55, 'kick', true, 0, kickOpacity)
    writeSphere(hatAmp, 3.08, 0.58, 'hihat', false, 0, hatOpacity)
    writeSphere(cymbalAmp, 3.08, 1.06, 'cymbal', false, 0, cymbalOpacity)
    writeTrianglePing(triangleAmpA, 0, 2.68, 0.78, 'triangleA', 1, 0, 0, triangleAOpacity)
    writeTrianglePing(triangleAmpB, 0, 2.42, 0.9, 'triangleB', 1.32, 0.08, 0, triangleBOpacity)
    writeTrianglePing(triangleAmpC, 0, 2.86, 0.72, 'triangleC', 0.9, 0, 0.56, triangleCOpacity)

    if (chordAmp > 0.004) {
      const chordCount = Math.floor(260 * detail)
      const color = colorFor('chord', colorMode)
      for (let i = 0; i < chordCount; i++) {
        const p = chordParticles[i]
        const breathe = 1 + chordAmp * 0.32 + Math.sin(now * 3 + p.phase) * 0.015
        writePoint(
          p.x * breathe,
          p.y * breathe,
          p.z,
          dotSize * (0.58 + p.ring * 0.025),
          chordAmp * 0.32 * chordOpacity,
          color
        )
      }
    }

    const guitarCount = showGuitar ? Math.floor(760 * detail) : 0
    if (showGuitar && (!currentGuitarRef.current || currentGuitarRef.current.length !== guitarCount * 3)) {
      currentGuitarRef.current = new Float32Array(guitarCount * 3)
      for (let i = 0; i < guitarCount; i++) {
        const p = guitarParticles[i]
        currentGuitarRef.current[i * 3] = p.wall.x
        currentGuitarRef.current[i * 3 + 1] = p.wall.y
        currentGuitarRef.current[i * 3 + 2] = p.wall.z
      }
    }

    const guitarPositions = currentGuitarRef.current
    const lerp = clamp(delta * morphSpeed, 0, 1)
    const guitarBaseOpacity = crystalMode === 'freeform' ? 0.12 : 0.18
    const guitarPresence = Math.pow(smooth01(guitarAmp * 1.8), 2.4)
    const guitarColor = colorFor('guitar', colorMode, guitarPitchHue * 0.12)
    for (let i = 0; guitarPositions && i < guitarCount; i++) {
      const p = guitarParticles[i]
      const crystal = crystalMode === 'octahedron'
        ? p.octahedron
        : crystalMode === 'helix'
          ? p.helix
          : crystalMode === 'cubic'
            ? p.cubic
            : crystalMode === 'quasicrystal'
              ? p.quasicrystal
              : p.wall
      const target = crystalMode === 'freeform' ? p.wall : crystal
      const ripple = guitarAmp * (0.2 + (p.strand % 3) * 0.04)
      const wave = Math.sin(now * 1.6 + p.phase + guitarPitchHue * Math.PI * 2) * guitarAmp * 0.1
      const tx = target.x + p.side * ripple
      const ty = target.y + wave
      const tz = target.z + Math.cos(now * 1.2 + p.phase) * guitarAmp * 0.08
      const i3 = i * 3
      guitarPositions[i3] += (tx - guitarPositions[i3]) * lerp
      guitarPositions[i3 + 1] += (ty - guitarPositions[i3 + 1]) * lerp
      guitarPositions[i3 + 2] += (tz - guitarPositions[i3 + 2]) * lerp
      writePoint(
        guitarPositions[i3],
        guitarPositions[i3 + 1],
        guitarPositions[i3 + 2],
        dotSize * 0.42,
        clamp((guitarBaseOpacity + guitarAmp * 0.5) * guitarPresence * guitarOpacity, 0, 0.82),
        guitarColor
      )
    }

    geometry.setDrawRange(0, cursor)
    positions.needsUpdate = true
    sizes.needsUpdate = true
    alphas.needsUpdate = true
    colors.needsUpdate = true
    geometry.computeBoundingSphere()
  })

  return (
    <group>
      <mesh position={[0, 0, -5]} renderOrder={-100} frustumCulled={false}>
        <planeGeometry args={[18, 12]} />
        <meshBasicMaterial color="#ffffff" depthWrite={false} toneMapped={false} />
      </mesh>
      <points
        ref={pointsRef}
        geometry={geometry}
        material={material}
        renderOrder={10}
        frustumCulled={false}
      />
    </group>
  )
}

export const beatParticleKitInstrument: ObjectInstrumentDef = {
  id: 'beatParticleKit',
  name: 'Beat Particle Kit',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: BeatParticleKitVisual,
}

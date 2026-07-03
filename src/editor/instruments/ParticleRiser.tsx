import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, BufferAttribute, DynamicDrawUsage, ShaderMaterial, Color, Mesh } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. A long-building upward particle riser with an accelerating
// pressure-wave front — each note triggers a riser (velocity + note length shape it).
// Tyler's palette color-mode is dropped (no palettes here); colorMode 0 = pitch colours,
// 1 = mono black. Particle simulation math is Tyler's verbatim; only the time source is
// rewired: risers derive purely from `state.notes` + the playhead each frame (onset ages,
// not a spawned list), so a paused playhead is a frozen frame and scrub == playback.

const PITCH_MIN = 24
const PITCH_MAX = 96
const MAX_PARTICLES = 9000
const MAX_ACTIVE_RISERS = 4
const MAX_POINTS = MAX_PARTICLES * MAX_ACTIVE_RISERS
const TWO_PI = Math.PI * 2
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

interface RiserParticle {
  angle: number; radiusNorm: number; heightOffset: number; birthOffset: number
  phase: number; speedMul: number; sizeMul: number; weight: number; drift: number; seed: number
}
interface RiserHit { id: number; age: number; pitch: number; velocity: number; duration: number }

const vertexShader = `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  varying float vAlpha; varying vec3 vColor;
  void main() {
    vAlpha = aAlpha; vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float perspective = 8.0 / max(1.25, -mvPosition.z);
    gl_PointSize = aSize * perspective;
    gl_Position = projectionMatrix * mvPosition;
  }
`
const fragmentShader = `
  varying float vAlpha; varying vec3 vColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float r = dot(p, p);
    if (r > 1.0) discard;
    float softEdge = 1.0 - smoothstep(0.52, 1.0, r);
    gl_FragColor = vec4(vColor, vAlpha * softEdge);
  }
`

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const smooth01 = (v: number) => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t) }
const easeInExpoLite = (v: number, acc: number) => Math.pow(clamp(v, 0, 1), Math.max(0.25, acc))
const rand = (seed: number) => { const x = Math.sin(seed * 12.9898) * 43758.5453123; return x - Math.floor(x) }

function makeParticles(count: number): RiserParticle[] {
  const out: RiserParticle[] = []
  for (let i = 0; i < count; i++) {
    const seed = i * 23.731 + 4.7
    out.push({
      angle: (i * GOLDEN_ANGLE + (rand(seed + 1.8) - 0.5) * 0.08) % TWO_PI,
      radiusNorm: Math.sqrt(rand(seed + 0.9)),
      heightOffset: rand(seed + 3.6), birthOffset: rand(seed + 4.5), phase: rand(seed + 5.4) * TWO_PI,
      speedMul: 0.72 + rand(seed + 6.3) * 0.62, sizeMul: 0.7 + rand(seed + 7.2) * 0.78,
      weight: 0.42 + rand(seed + 8.1) * 0.58, drift: (rand(seed + 9.9) - 0.5) * 2, seed,
    })
  }
  return out
}
function buildGeometry(): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(MAX_POINTS * 3), 3).setUsage(DynamicDrawUsage))
  g.setAttribute('aSize', new BufferAttribute(new Float32Array(MAX_POINTS), 1).setUsage(DynamicDrawUsage))
  g.setAttribute('aAlpha', new BufferAttribute(new Float32Array(MAX_POINTS), 1).setUsage(DynamicDrawUsage))
  g.setAttribute('aColor', new BufferAttribute(new Float32Array(MAX_POINTS * 3), 3).setUsage(DynamicDrawUsage))
  g.setDrawRange(0, 0)
  return g
}
function riserEnvelope(age: number, duration: number, attack: number, release: number): number {
  if (age < 0) return 0
  const attackIn = smooth01(age / Math.max(0.001, attack))
  if (age <= duration) return attackIn
  return clamp(1 - smooth01((age - duration) / Math.max(0.001, release)), 0, 1)
}

const PARAMS: ParamDef[] = [
  { key: 'particleCount', label: 'Particles', min: 400, max: MAX_PARTICLES, step: 100, default: 5200 },
  { key: 'dotSize', label: 'Dot Size', min: 1, max: 14, step: 0.25, default: 5.8 },
  { key: 'duration', label: 'Duration (s)', min: 0.5, max: 24, step: 0.1, default: 6.5 },
  { key: 'noteDurationScale', label: 'Note Length Scale', min: 0, max: 2, step: 0.05, default: 0.35 },
  { key: 'attack', label: 'Attack (s)', min: 0.001, max: 3, step: 0.01, default: 0.35 },
  { key: 'release', label: 'Release (s)', min: 0.05, max: 6, step: 0.05, default: 1.35 },
  { key: 'startY', label: 'Start Y', min: -8, max: 4, step: 0.05, default: -4.6 },
  { key: 'endY', label: 'End Y', min: -2, max: 8, step: 0.05, default: 4.55 },
  { key: 'width', label: 'Width', min: 0.2, max: 6, step: 0.05, default: 2.6 },
  { key: 'depth', label: 'Depth', min: 0, max: 3, step: 0.05, default: 0.85 },
  { key: 'riseSpeed', label: 'Rise Speed', min: 0.02, max: 1.5, step: 0.01, default: 0.22 },
  { key: 'acceleration', label: 'Acceleration', min: 0.4, max: 4, step: 0.05, default: 1.65 },
  { key: 'frontWidth', label: 'Wave Width', min: 0.02, max: 0.6, step: 0.01, default: 0.16 },
  { key: 'pressureBoost', label: 'Pressure Boost', min: 0, max: 5, step: 0.05, default: 2.1 },
  { key: 'densityBuild', label: 'Density Build', min: 0, max: 1, step: 0.01, default: 0.85 },
  { key: 'centerPull', label: 'Center Pull', min: 0, max: 1, step: 0.01, default: 0.28 },
  { key: 'turbulence', label: 'Turbulence', min: 0, max: 0.4, step: 0.005, default: 0.045 },
  { key: 'spiralAmount', label: 'Spiral Amount', min: 0, max: 3, step: 0.05, default: 0.9 },
  { key: 'spiralSpeed', label: 'Spiral Speed', min: -4, max: 4, step: 0.05, default: 1.05 },
  { key: 'shimmer', label: 'Shimmer', min: 0, max: 1, step: 0.01, default: 0.22 },
  { key: 'peakFlash', label: 'Peak Flash', min: 0, max: 2, step: 0.01, default: 0.55 },
  { key: 'colorMode', label: 'Color · 0 Pitch 1 Mono', min: 0, max: 1, step: 1, default: 0 },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

function ParticleRiserVisual({ trackId }: { trackId: string }) {
  const colorRef = useRef(new Color())

  const particles = useMemo(() => makeParticles(MAX_PARTICLES), [])
  const geometry = useMemo(buildGeometry, [])
  const material = useMemo(() => new ShaderMaterial({ vertexShader, fragmentShader, transparent: true, depthTest: false, depthWrite: false }), [])

  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])

  useInstrumentFrame(trackId, (state) => {
    const p = state.params
    const particleCount = Math.floor(clamp(p.particleCount ?? 5200, 400, MAX_PARTICLES))
    const dotSize = p.dotSize ?? 5.8
    const duration = Math.max(0.1, p.duration ?? 6.5)
    const noteDurationScale = p.noteDurationScale ?? 0.35
    const attack = p.attack ?? 0.35
    const release = Math.max(0.01, p.release ?? 1.35)
    const startY = p.startY ?? -4.6
    const endY = p.endY ?? 4.55
    const width = p.width ?? 2.6
    const depth = p.depth ?? 0.85
    const riseSpeed = p.riseSpeed ?? 0.22
    const acceleration = p.acceleration ?? 1.65
    const frontWidth = Math.max(0.01, p.frontWidth ?? 0.16)
    const pressureBoost = p.pressureBoost ?? 2.1
    const densityBuild = p.densityBuild ?? 0.85
    const centerPull = clamp(p.centerPull ?? 0.28, 0, 1)
    const turbulence = p.turbulence ?? 0.045
    const spiralAmount = p.spiralAmount ?? 0.9
    const spiralSpeed = p.spiralSpeed ?? 1.05
    const shimmer = p.shimmer ?? 0.22
    const peakFlash = p.peakFlash ?? 0.55
    const mono = (p.colorMode ?? 0) >= 0.5

    // Beat-time in seconds — the noise/shimmer oscillation frequencies were tuned in seconds.
    const t = state.beat * state.secPerBeat
    const makeDuration = (durSec: number) => Math.max(0.25, duration + Math.max(0, durSec) * noteDurationScale)

    // Derive the alive risers purely from the note list: a riser exists while its onset
    // age is within [0, duration + release]. `id` is the note's onset index among
    // eligible notes (the pure replacement for the old spawn counter — it only offsets
    // each riser's hue and spiral). Newest MAX_ACTIVE_RISERS win, as before.
    const alive: RiserHit[] = []
    let nextId = 0
    for (const n of state.notes) {
      if (n.pitch < PITCH_MIN || n.pitch > PITCH_MAX) continue
      const id = nextId++
      const age = (state.beat - n.beat) * state.secPerBeat
      if (age < 0) continue
      const hitDuration = makeDuration((n.durationBeats || 0) * state.secPerBeat)
      if (age > hitDuration + release) continue
      const velocity = clamp(n.velocity <= 1 ? n.velocity : n.velocity / 127, 0.05, 1)
      alive.push({ id, age, pitch: n.pitch, velocity, duration: hitDuration })
    }
    const hits = alive.slice(-MAX_ACTIVE_RISERS)

    const pos = (geometry.getAttribute('position') as BufferAttribute).array as Float32Array
    const size = (geometry.getAttribute('aSize') as BufferAttribute).array as Float32Array
    const alpha = (geometry.getAttribute('aAlpha') as BufferAttribute).array as Float32Array
    const col = (geometry.getAttribute('aColor') as BufferAttribute).array as Float32Array

    if (hits.length === 0) { geometry.setDrawRange(0, 0); return }

    let cursor = 0
    const writePoint = (x: number, y: number, z: number, ps: number, opacity: number, color: Color) => {
      if (cursor >= MAX_POINTS || opacity <= 0.002) return
      const i3 = cursor * 3
      pos[i3] = x; pos[i3 + 1] = y; pos[i3 + 2] = z
      size[cursor] = ps; alpha[cursor] = clamp(opacity, 0, 1)
      col[i3] = color.r; col[i3 + 1] = color.g; col[i3 + 2] = color.b
      cursor++
    }

    for (const hit of hits) {
      const age = hit.age
      const progress = clamp(age / hit.duration, 0, 1)
      const energy = smooth01(progress)
      const env = riserEnvelope(age, hit.duration, attack, release) * hit.velocity
      if (env <= 0.002) continue
      const head = easeInExpoLite(progress, acceleration)
      const ceiling = clamp(head + frontWidth * (1.15 + densityBuild * energy), 0.04, 1.08)
      const pitchHue = ((hit.pitch % 12) / 12 + hit.id * 0.041) % 1
      const peak = smooth01((progress - 0.78) / 0.22)

      for (let i = 0; i < particleCount; i++) {
        const pt = particles[i]
        const reveal = smooth01((progress - pt.birthOffset * densityBuild) / 0.2)
        if (reveal <= 0.002) continue
        const speed = riseSpeed * pt.speedMul * (0.25 + energy * 1.9)
        const heightNorm = (pt.heightOffset + age * speed) % 1
        const aboveHead = 1 - smooth01((heightNorm - ceiling) / Math.max(0.001, frontWidth))
        if (aboveHead <= 0.002) continue
        const lowerFill = smooth01((heightNorm + 0.04) / Math.max(0.08, ceiling))
        const frontDelta = (heightNorm - head) / frontWidth
        const frontPulse = Math.exp(-frontDelta * frontDelta)
        const pressure = 1 + frontPulse * pressureBoost + peak * peakFlash
        const pull = 1 - centerPull * energy * smooth01(heightNorm)
        const laneWidth = width * (0.34 + pt.radiusNorm * 0.72) * pull
        const spiral = pt.angle + spiralAmount * (age * spiralSpeed * (0.4 + energy) + heightNorm * 4.8 + pt.phase) + hit.id * 0.19
        const noise = Math.sin(t * 7.5 + pt.phase + heightNorm * 8.0) * turbulence * (0.25 + energy)
        const breath = Math.sin(t * (4.0 + shimmer * 8.0) + pt.phase * 1.7) * shimmer * 0.06 * energy
        const radial = laneWidth * (1 + noise + breath)
        const x = Math.cos(spiral) * radial + pt.drift * turbulence * (0.45 + energy)
        const y = startY + heightNorm * (endY - startY)
        const z = Math.sin(spiral) * depth * pt.radiusNorm + frontPulse * 0.24 * peak
        const topGlow = 0.55 + smooth01(heightNorm) * 0.45
        const opacity = env * reveal * aboveHead * lowerFill * pt.weight * topGlow * (0.55 + frontPulse * 0.45)

        if (mono) colorRef.current.setRGB(0.05, 0.05, 0.05)
        else colorRef.current.setHSL((pitchHue + pt.radiusNorm * 0.11 + heightNorm * 0.08) % 1, 0.82, 0.5 + energy * 0.15)

        writePoint(x, y, z, dotSize * pt.sizeMul * (0.55 + pressure * 0.45), opacity, colorRef.current)
      }
    }

    geometry.setDrawRange(0, cursor)
    ;(geometry.getAttribute('position') as BufferAttribute).needsUpdate = true
    ;(geometry.getAttribute('aSize') as BufferAttribute).needsUpdate = true
    ;(geometry.getAttribute('aAlpha') as BufferAttribute).needsUpdate = true
    ;(geometry.getAttribute('aColor') as BufferAttribute).needsUpdate = true
    geometry.computeBoundingSphere()
  })

  return <points geometry={geometry} material={material} renderOrder={10} frustumCulled={false} />
}

export const particleRiserInstrument: ObjectInstrumentDef = {
  id: 'particleRiser',
  name: 'Particle Riser',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: ParticleRiserVisual,
}

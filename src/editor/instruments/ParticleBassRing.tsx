import { useEffect, useMemo, useRef } from 'react'
import { BufferGeometry, BufferAttribute, DynamicDrawUsage, ShaderMaterial, Color, Mesh } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. An 808-style bass ring made of particles that shakes in
// pitch-shaped waves as each note decays. Bass note-ons pulse the ring; the wave
// simulation, envelope, and Points shader are Tyler's verbatim. Tyler's seek/palette
// handling is dropped; all motion derives from `state.beat`, and hit envelopes are
// computed from `state.notes` each frame (note-onset ages, not a spawned list), so
// scrub == playback.

const PITCH_MIN = 24
const PITCH_MAX = 60
const MAX_PARTICLES = 4200
const MAX_ACTIVE_HITS = 8
const TWO_PI = Math.PI * 2
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

interface RingParticle {
  angle: number
  radiusNorm: number
  jitterRadius: number
  phase: number
  weight: number
  dotScale: number
}
interface BassHit {
  ageSec: number
  amp: number
  pitch: number
  velocity: number
  length: number
  phase: number
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
    float edge = 1.0 - smoothstep(0.62, 1.0, r);
    gl_FragColor = vec4(vColor, vAlpha * edge);
  }
`

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
const smooth01 = (v: number) => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t) }
const rand = (seed: number) => { const x = Math.sin(seed * 12.9898) * 43758.5453123; return x - Math.floor(x) }

function makeParticles(count: number): RingParticle[] {
  const particles: RingParticle[] = []
  for (let i = 0; i < count; i++) {
    const radiusNorm = Math.sqrt((i + 0.5) / count)
    const seed = i * 19.19 + 7.7
    particles.push({
      angle: (i * GOLDEN_ANGLE + (rand(seed) - 0.5) * 0.035) % TWO_PI,
      radiusNorm,
      jitterRadius: (rand(seed + 1.4) - 0.5) * 0.018,
      phase: rand(seed + 2.8) * TWO_PI,
      weight: 0.55 + rand(seed + 4.2) * 0.45,
      dotScale: 0.72 + rand(seed + 5.6) * 0.62,
    })
  }
  return particles
}

function bassEnvelope(age: number, velocity: number, length: number, attack: number, decay: number, sustain: number, release: number): number {
  if (age < 0) return 0

  const safeAttack = Math.max(0.001, attack)
  const safeDecay = Math.max(0.001, decay)
  const safeRelease = Math.max(0.001, release)

  if (age < safeAttack) {
    return smooth01(age / safeAttack) * velocity
  }

  const bodyAge = age - safeAttack
  const bodyLevel = sustain + (1 - sustain) * Math.exp(-bodyAge / safeDecay)
  if (bodyAge <= length) {
    return clamp(bodyLevel * velocity, 0, 1)
  }

  const releaseAge = bodyAge - length
  const releaseStart = sustain + (1 - sustain) * Math.exp(-length / safeDecay)
  return clamp(releaseStart * Math.exp(-releaseAge / safeRelease) * velocity, 0, 1)
}

// colorMode: 0 mono (black), 1 pitch color, 2 bass teal.
function setColorFor(color: Color, mode: number, pitch: number, amp: number): void {
  if (mode <= 0.5) { color.setRGB(0, 0, 0); return }
  if (mode >= 1.5) { color.setHSL(0.58, 0.82, 0.26 + amp * 0.12); return }
  color.setHSL(((pitch % 12) / 12 + 0.56) % 1, 0.84, 0.32 + amp * 0.12)
}

const PARAMS: ParamDef[] = [
  { key: 'particleCount', label: 'Particles', min: 300, max: MAX_PARTICLES, step: 100, default: 2200 },
  { key: 'dotSize', label: 'Dot Size', min: 2, max: 14, step: 0.25, default: 6.5 },
  { key: 'innerRadius', label: 'Inner Radius', min: 0.2, max: 4, step: 0.05, default: 1.35 },
  { key: 'outerRadius', label: 'Outer Radius', min: 0.3, max: 5, step: 0.05, default: 2.35 },
  { key: 'centerX', label: 'Center X', min: -5, max: 5, step: 0.05, default: 0 },
  { key: 'centerY', label: 'Center Y', min: -7, max: 2, step: 0.05, default: 0 },
  { key: 'perspectiveDepth', label: 'Plane Depth', min: 0, max: 2, step: 0.05, default: 0.72 },
  { key: 'attack', label: 'Attack', min: 0.001, max: 0.2, step: 0.001, default: 0.012 },
  { key: 'decay', label: 'Decay', min: 0.02, max: 1.5, step: 0.01, default: 0.22 },
  { key: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01, default: 0.74 },
  { key: 'release', label: 'Release', min: 0.05, max: 4, step: 0.01, default: 1.25 },
  { key: 'baseLength', label: 'Base Length', min: 0.04, max: 2, step: 0.01, default: 0.34 },
  { key: 'noteLengthScale', label: 'Note Length Scale', min: 0, max: 1.5, step: 0.01, default: 0.28 },
  { key: 'shakeStrength', label: 'Bass Shake', min: 0, max: 1.5, step: 0.01, default: 0.55 },
  { key: 'waveFrequency', label: 'Wave Frequency', min: 0.5, max: 12, step: 0.1, default: 4.8 },
  { key: 'waveSpeed', label: 'Wave Speed', min: 0.5, max: 18, step: 0.1, default: 7.6 },
  { key: 'noteVariation', label: 'Note Variation', min: 0, max: 2, step: 0.05, default: 1 },
  { key: 'radialPush', label: 'Radial Push', min: 0, max: 0.5, step: 0.01, default: 0.08 },
  { key: 'turbulence', label: 'Turbulence', min: 0, max: 0.2, step: 0.005, default: 0.02 },
  { key: 'rotationSpeed', label: 'Rotation Speed', min: -1, max: 1, step: 0.01, default: 0.12 },
  { key: 'rotationAmount', label: 'Rotation Amount', min: 0, max: 2, step: 0.05, default: 1 },
  {
    key: 'colorMode', label: 'Color Mode', type: 'select', default: 0,
    options: [
      { value: 0, label: 'Black on White' },
      { value: 1, label: 'Pitch Color' },
      { value: 2, label: 'Bass Teal' },
    ],
  },
  { key: 'whiteBackground', label: 'White Background', type: 'boolean', default: 1 },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

function ParticleBassRingVisual({ trackId }: { trackId: string }) {
  const backgroundRef = useRef<Mesh>(null)
  const colorRef = useRef(new Color())

  const particles = useMemo(() => makeParticles(MAX_PARTICLES), [])
  const geometry = useMemo(() => {
    const geom = new BufferGeometry()
    geom.setAttribute('position', new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(DynamicDrawUsage))
    geom.setAttribute('aSize', new BufferAttribute(new Float32Array(MAX_PARTICLES), 1).setUsage(DynamicDrawUsage))
    geom.setAttribute('aAlpha', new BufferAttribute(new Float32Array(MAX_PARTICLES), 1).setUsage(DynamicDrawUsage))
    geom.setAttribute('aColor', new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(DynamicDrawUsage))
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
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  useInstrumentFrame(trackId, (state) => {
    // Beat-time in seconds — the wave/envelope constants were tuned in seconds.
    const t = state.beat * state.secPerBeat
    const params = state.params
    const particleCount = Math.floor(clamp(params.particleCount ?? 2200, 300, MAX_PARTICLES))
    const dotSize = params.dotSize ?? 6.5
    const innerRadius = params.innerRadius ?? 1.35
    const outerRadius = Math.max(innerRadius + 0.05, params.outerRadius ?? 2.35)
    const centerX = params.centerX ?? 0
    const centerY = params.centerY ?? 0
    const perspectiveDepth = params.perspectiveDepth ?? 0.72
    const attack = params.attack ?? 0.012
    const decay = params.decay ?? 0.22
    const sustain = clamp(params.sustain ?? 0.74, 0, 1)
    const release = params.release ?? 1.25
    const baseLength = params.baseLength ?? 0.34
    const noteLengthScale = params.noteLengthScale ?? 0.28
    const shakeStrength = params.shakeStrength ?? 0.55
    const waveFrequency = params.waveFrequency ?? 4.8
    const waveSpeed = params.waveSpeed ?? 7.6
    const noteVariation = params.noteVariation ?? 1
    const radialPush = params.radialPush ?? 0.08
    const turbulence = params.turbulence ?? 0.02
    const rotationSpeed = params.rotationSpeed ?? 0.12
    const rotationAmount = params.rotationAmount ?? 1
    const colorMode = params.colorMode ?? 0

    if (backgroundRef.current) {
      backgroundRef.current.visible = (params.whiteBackground ?? 1) >= 0.5
    }

    // A hit = a bass note whose onset the playhead has passed and whose envelope is
    // still audible — derived purely from state.notes each frame, so scrubbing to any
    // beat reconstructs exactly the hits playback would have live there.
    const minimumHitLife = Math.max(0.03, attack + 0.01)
    const hits: BassHit[] = []
    for (const n of state.notes) {
      if (n.pitch < PITCH_MIN || n.pitch > PITCH_MAX) continue
      const ageSec = (state.beat - n.beat) * state.secPerBeat
      if (ageSec < 0) continue
      const velocity = clamp(n.velocity <= 1 ? n.velocity : n.velocity / 127, 0.05, 1)
      const duration = Math.max(0.05, n.durationBeats || 1)
      const length = Math.max(0.04, baseLength + duration * noteLengthScale)
      const amp = bassEnvelope(ageSec, velocity, length, attack, decay, sustain, release)
      if (ageSec >= minimumHitLife && amp <= 0.003) continue
      hits.push({
        ageSec,
        amp,
        pitch: n.pitch,
        velocity,
        length,
        phase: ((n.pitch % 12) / 12) * TWO_PI,
      })
    }

    const activeHits = hits.slice(-MAX_ACTIVE_HITS)
    const positions = geometry.getAttribute('position') as BufferAttribute
    const sizes = geometry.getAttribute('aSize') as BufferAttribute
    const alphas = geometry.getAttribute('aAlpha') as BufferAttribute
    const colors = geometry.getAttribute('aColor') as BufferAttribute
    const pos = positions.array as Float32Array
    const size = sizes.array as Float32Array
    const alpha = alphas.array as Float32Array
    const col = colors.array as Float32Array

    if (activeHits.length === 0) {
      geometry.setDrawRange(0, 0)
      return
    }

    const rotation = t * rotationSpeed * rotationAmount
    const radiusSpan = outerRadius - innerRadius
    let cursor = 0

    for (let i = 0; i < particleCount; i++) {
      const p = particles[i]
      const radiusNorm = clamp(p.radiusNorm + p.jitterRadius, 0, 1)
      const radius = innerRadius + radiusNorm * radiusSpan
      const angle = p.angle + rotation
      let ampSum = 0
      let zWave = 0
      let radialWave = 0
      let colorPitch = PITCH_MIN

      for (const hit of activeHits) {
        const amp = hit.amp
        if (amp <= 0.003) continue

        const age = hit.ageSec
        const pitchNorm = clamp((hit.pitch - PITCH_MIN) / (PITCH_MAX - PITCH_MIN), 0, 1)
        const arms = 1 + (hit.pitch % 5)
        const direction = hit.pitch % 2 === 0 ? 1 : -1
        const noteFreq = waveFrequency * (0.7 + pitchNorm * 1.15 * noteVariation)
        const noteSpeed = waveSpeed * (0.72 + pitchNorm * 0.58 * noteVariation)
        const radialPhase = radiusNorm * noteFreq - age * noteSpeed + hit.phase
        const angularPhase = angle * arms * direction + hit.phase * 0.7
        const broadWave = Math.sin(radialPhase + angularPhase)
        const subWave = Math.sin(radiusNorm * 2.6 - age * noteSpeed * 0.42 + p.phase + hit.phase)
        const edgeFalloff = 0.72 + (1 - radiusNorm) * 0.28
        const hitAmp = amp * hit.velocity * edgeFalloff

        zWave += hitAmp * (broadWave * 0.76 + subWave * 0.24)
        radialWave += hitAmp * Math.sin(radialPhase * 0.72 + p.phase) * (0.4 + pitchNorm * 0.6)
        ampSum += amp
        colorPitch = hit.pitch
      }

      if (ampSum <= 0.003) continue

      const combinedAmp = clamp(ampSum, 0, 1.6)
      const radiusPushV = radialWave * radialPush
      const noise = Math.sin(t * 18 + p.phase * 1.7) * turbulence * combinedAmp
      const finalRadius = radius + radiusPushV + noise
      const x = centerX + Math.cos(angle) * finalRadius
      const y = centerY + Math.sin(angle) * finalRadius
      const z = zWave * shakeStrength + Math.sin(angle) * perspectiveDepth * radiusNorm * 0.22
      const shade = 0.55 + clamp((z / Math.max(0.001, shakeStrength)) * 0.18 + radiusNorm * 0.22, 0, 0.45)
      const opacity = clamp(combinedAmp * p.weight * shade, 0, 1)
      if (opacity <= 0.002) continue

      setColorFor(colorRef.current, colorMode, colorPitch, combinedAmp)
      const i3 = cursor * 3
      pos[i3] = x
      pos[i3 + 1] = y
      pos[i3 + 2] = z
      size[cursor] = dotSize * p.dotScale * (0.72 + combinedAmp * 0.45 + Math.abs(zWave) * 0.28)
      alpha[cursor] = opacity
      col[i3] = colorRef.current.r
      col[i3 + 1] = colorRef.current.g
      col[i3 + 2] = colorRef.current.b
      cursor++
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
      <mesh ref={backgroundRef} position={[0, 0, -6]} renderOrder={-100} frustumCulled={false}>
        <planeGeometry args={[18, 12]} />
        <meshBasicMaterial color="#ffffff" depthWrite={false} toneMapped={false} />
      </mesh>
      <points geometry={geometry} material={material} renderOrder={10} frustumCulled={false} />
    </group>
  )
}

export const particleBassRingInstrument: ObjectInstrumentDef = {
  id: 'particleBassRing',
  name: 'Particle Bass Ring',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: ParticleBassRingVisual,
}

import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { BufferGeometry, BufferAttribute, DynamicDrawUsage, ShaderMaterial, Color, Vector3, Mesh } from 'three'
import { useInstrumentFrame } from '../core/engine/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. Note-triggered particle strings that rush outward and toward the
// camera in fast fading streams. Each note drives a burst of streams, derived per frame from
// the note list (pure function of the beat — scrub == playback). Tyler's palette color-mode
// is dropped (no palettes here); colorMode 0 = mono black, 1 = pitch colours.
// Particle simulation math + GLSL Points shader are Tyler's verbatim.

const TWO_PI = Math.PI * 2
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const PITCH_MIN = 24
const PITCH_MAX = 96
const MAX_STREAMS = 96
const MAX_PARTICLES_PER_STREAM = 96
const MAX_ACTIVE_BURSTS = 10
const MAX_POINTS = MAX_STREAMS * MAX_PARTICLES_PER_STREAM * MAX_ACTIVE_BURSTS

interface StreamSpec {
  laneX: number; laneY: number; laneRadius: number; speedMul: number; sizeMul: number
  curve: number; phase: number; hue: number; seed: number
}
interface AliveBurst { id: number; ageSec: number; pitch: number; velocity: number; streams: StreamSpec[] }

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
    float perspective = 8.0 / max(1.4, -mvPosition.z);
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
    float softEdge = 1.0 - smoothstep(0.48, 1.0, r);
    gl_FragColor = vec4(vColor, vAlpha * softEdge);
  }
`

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
function smooth01(value: number): number {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}
function easeOutCubic(value: number): number {
  const t = clamp(value, 0, 1)
  return 1 - Math.pow(1 - t, 3)
}
function degToRad(value: number): number {
  return (value * Math.PI) / 180
}
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453123
  return x - Math.floor(x)
}

function makeStreams(count: number, burstId: number, pitch: number): StreamSpec[] {
  const streamCount = Math.max(1, Math.min(MAX_STREAMS, Math.floor(count)))
  const streams: StreamSpec[] = []
  const baseSeed = burstId * 101.3 + pitch * 17.17 + 9.7

  for (let i = 0; i < streamCount; i++) {
    const seed = baseSeed + i * 37.11
    const laneRadius = Math.sqrt((i + 0.5) / streamCount)
    const laneAngle = i * GOLDEN_ANGLE
    streams.push({
      laneX: Math.cos(laneAngle) * laneRadius,
      laneY: Math.sin(laneAngle) * laneRadius,
      laneRadius,
      speedMul: 0.92 + rand(seed + 3.4) * 0.16,
      sizeMul: 0.88 + rand(seed + 4.9) * 0.24,
      curve: (rand(seed + 6.2) - 0.5) * 2,
      phase: rand(seed + 8.8) * TWO_PI,
      hue: rand(seed + 11.4),
      seed,
    })
  }

  return streams
}

function envelope(age: number, attack: number, travel: number, fade: number): number {
  if (age < 0) return 0
  if (age < attack) return smooth01(age / Math.max(0.001, attack))
  if (age < attack + travel) return 1
  return 1 - smooth01((age - attack - travel) / Math.max(0.001, fade))
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

const PARAMS: ParamDef[] = [
  { key: 'streams', label: 'Streams', min: 1, max: MAX_STREAMS, step: 1, default: 28 },
  { key: 'particlesPerStream', label: 'Particles / Stream', min: 4, max: MAX_PARTICLES_PER_STREAM, step: 1, default: 42 },
  { key: 'dotSize', label: 'Dot Size', min: 1, max: 16, step: 0.25, default: 6.5 },
  { key: 'waveParticleCount', label: 'Wave Particles', min: 1, max: 24, step: 1, default: 4 },
  { key: 'waveSizeBoost', label: 'Wave Size Boost', min: 0.5, max: 6, step: 0.1, default: 2.4 },
  { key: 'streamSpeed', label: 'Stream Speed', min: 1, max: 24, step: 0.25, default: 8.5 },
  { key: 'outwardReach', label: 'Bundle Width', min: 0.02, max: 1.5, step: 0.01, default: 0.18 },
  { key: 'cameraReach', label: 'Camera Reach', min: 0.1, max: 3.5, step: 0.05, default: 1.55 },
  { key: 'attackTiltX', label: 'Attack Tilt X', min: -85, max: 85, step: 1, default: 0 },
  { key: 'attackTiltY', label: 'Attack Tilt Y', min: -85, max: 85, step: 1, default: 0 },
  { key: 'attackSpread', label: 'Attack Fan', min: 1, max: 90, step: 1, default: 14 },
  { key: 'runSpread', label: 'Run Spread', min: 0, max: 2.5, step: 0.01, default: 0.42 },
  { key: 'attackDuration', label: 'Attack (s)', min: 0.001, max: 0.4, step: 0.001, default: 0.055 },
  { key: 'travelDuration', label: 'Travel (s)', min: 0.05, max: 2.5, step: 0.01, default: 0.72 },
  { key: 'fadeDuration', label: 'Fade (s)', min: 0.05, max: 3, step: 0.01, default: 1.05 },
  { key: 'trailDuration', label: 'Trail Lag (s)', min: 0.01, max: 1.2, step: 0.01, default: 0.24 },
  { key: 'streamTightness', label: 'Stream Tightness', min: 0, max: 0.2, step: 0.005, default: 0.01 },
  { key: 'turbulence', label: 'Turbulence', min: 0, max: 0.5, step: 0.01, default: 0.035 },
  { key: 'spiralAmount', label: 'Spiral Amount', min: 0, max: 1.5, step: 0.01, default: 0.12 },
  { key: 'spiralSpeed', label: 'Spiral Speed', min: 0, max: 8, step: 0.05, default: 2.8 },
  { key: 'colorMode', label: 'Color · 0 Mono 1 Pitch', min: 0, max: 1, step: 1, default: 0 },
  { key: 'whiteBackground', label: 'White Background', type: 'boolean', default: 1 },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

const _tmpVec3A = new Vector3()
const _tmpVec3B = new Vector3()
const _tmpVec3C = new Vector3()
const _tmpVec3D = new Vector3()
const _tmpVec3E = new Vector3()
const _tmpVec3F = new Vector3()
const _tmpVec3G = new Vector3()

function ParticleStreamsVisual({ trackId }: { trackId: string }) {
  const backgroundRef = useRef<Mesh>(null)
  const { camera } = useThree()
  // Stream specs are deterministic per (note index, pitch, stream count); the cache
  // only avoids reallocating them every frame, it never holds mutable state.
  const streamCache = useRef<Map<string, StreamSpec[]>>(new Map())
  const colorRef = useRef(new Color())

  const geometry = useMemo(buildGeometry, [])
  const material = useMemo(() => new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }), [])

  useEffect(() => () => {
    streamCache.current.clear()
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  useInstrumentFrame(trackId, (state) => {
    const p = state.params
    const streamCount = clamp(p.streams ?? 28, 1, MAX_STREAMS)
    const particlesPerStream = Math.floor(clamp(p.particlesPerStream ?? 42, 4, MAX_PARTICLES_PER_STREAM))
    const dotSize = p.dotSize ?? 6.5
    const streamSpeed = p.streamSpeed ?? 8.5
    const outwardReach = p.outwardReach ?? 0.18
    const cameraReach = p.cameraReach ?? 1.55
    const attackDuration = p.attackDuration ?? 0.055
    const travelDuration = p.travelDuration ?? 0.72
    const fadeDuration = p.fadeDuration ?? 1.05
    const trailDuration = p.trailDuration ?? 0.24
    const streamTightness = p.streamTightness ?? 0.01
    const turbulence = p.turbulence ?? 0.035
    const spiralAmount = p.spiralAmount ?? 0.12
    const spiralSpeed = p.spiralSpeed ?? 2.8
    const attackSpread = clamp(p.attackSpread ?? 14, 1, 90)
    const runSpread = p.runSpread ?? 0.42
    const waveParticleCount = clamp(p.waveParticleCount ?? 4, 1, MAX_PARTICLES_PER_STREAM)
    const waveSizeBoost = p.waveSizeBoost ?? 2.4
    const mono = (p.colorMode ?? 0) < 0.5
    if (backgroundRef.current) {
      backgroundRef.current.visible = (p.whiteBackground ?? 1) >= 0.5
    }

    // Beat-time seconds — the flicker/spiral/breath clock. Matches wall time during
    // playback at default bpm, and freezes with the playhead when paused.
    const tSec = state.beat * state.secPerBeat

    // Alive bursts are derived from the note list every frame (never spawned into a
    // ref), so any scrub — forward or backward — reconstructs exactly the bursts
    // playback shows at that beat. A burst is alive while its note-on age (in
    // seconds, via secPerBeat) is inside the envelope's total lifetime.
    const totalLifetime = attackDuration + travelDuration + fadeDuration + trailDuration
    const cache = streamCache.current
    const notes = state.notes
    const alive: AliveBurst[] = []
    for (let ni = 0; ni < notes.length; ni++) {
      const n = notes[ni]
      if (n.pitch < PITCH_MIN || n.pitch > PITCH_MAX) continue
      const ageSec = (state.beat - n.beat) * state.secPerBeat
      if (ageSec < 0 || ageSec > totalLifetime) continue
      const velocity = clamp(n.velocity <= 1 ? n.velocity : n.velocity / 127, 0.05, 1)
      const cacheKey = `${ni}:${n.pitch}:${streamCount}`
      let streams = cache.get(cacheKey)
      if (!streams) {
        if (cache.size > 512) cache.clear()
        streams = makeStreams(streamCount, ni, n.pitch)
        cache.set(cacheKey, streams)
      }
      alive.push({ id: ni, ageSec, pitch: n.pitch, velocity, streams })
    }
    // Notes are sorted by beat, so the tail holds the most recently started bursts.
    const bursts = alive.length > MAX_ACTIVE_BURSTS ? alive.slice(-MAX_ACTIVE_BURSTS) : alive

    const positions = geometry.getAttribute('position') as BufferAttribute
    const sizes = geometry.getAttribute('aSize') as BufferAttribute
    const alphas = geometry.getAttribute('aAlpha') as BufferAttribute
    const colors = geometry.getAttribute('aColor') as BufferAttribute
    const pos = positions.array as Float32Array
    const size = sizes.array as Float32Array
    const alpha = alphas.array as Float32Array
    const col = colors.array as Float32Array

    const toCamera = _tmpVec3A
    camera.getWorldDirection(toCamera)
    toCamera.negate().normalize()

    const arbUp = Math.abs(toCamera.y) < 0.98 ? _tmpVec3B.set(0, 1, 0) : _tmpVec3B.set(1, 0, 0)
    const baseRight = _tmpVec3C.crossVectors(toCamera, arbUp).normalize()
    const baseUp = _tmpVec3D.crossVectors(baseRight, toCamera).normalize()

    const tiltX = degToRad(p.attackTiltX ?? 0)
    const tiltY = degToRad(p.attackTiltY ?? 0)
    const center = _tmpVec3E
      .copy(toCamera)
      .addScaledVector(baseUp, Math.sin(tiltX))
      .addScaledVector(baseRight, Math.sin(tiltY))
      .normalize()
    const right = _tmpVec3F.crossVectors(center, arbUp).normalize()
    if (right.lengthSq() < 0.0001) right.copy(baseRight)
    const up = _tmpVec3G.crossVectors(right, center).normalize()

    const travelWindow = Math.max(0.001, attackDuration + travelDuration)
    const travelDistance = streamSpeed * travelWindow
    const trailProgress = clamp(trailDuration / travelWindow, 0.015, 0.95)
    const attackFan = Math.sin(degToRad(attackSpread * 0.5))
    const baseLaneScale = outwardReach * (0.35 + attackFan * 1.2)
    const waveWidth = Math.max(0.5, waveParticleCount * 0.55)

    let cursor = 0
    const writePoint = (x: number, y: number, z: number, pointSize: number, opacity: number, color: Color) => {
      if (cursor >= MAX_POINTS || opacity <= 0.002) return
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

    for (const burst of bursts) {
      const age = burst.ageSec
      const env = envelope(age, attackDuration, travelDuration, fadeDuration) * burst.velocity
      if (env <= 0.002) continue

      const headProgress = easeOutCubic(age / travelWindow)
      const pitchHue = ((burst.pitch % 12) / 12 + burst.id * 0.027) % 1

      for (const stream of burst.streams) {
        if (mono) {
          colorRef.current.setRGB(0, 0, 0)
        } else {
          colorRef.current.setHSL((pitchHue + stream.hue * 0.12) % 1, 0.78, 0.38)
        }

        for (let j = 0; j < particlesPerStream; j++) {
          const tailT = particlesPerStream === 1 ? 0 : j / (particlesPerStream - 1)
          const progressRaw = headProgress - tailT * trailProgress
          if (progressRaw <= 0) continue

          const progress = clamp(progressRaw, 0, 1)
          const distance = progress * travelDistance * stream.speedMul
          const stringAlpha = Math.pow(1 - tailT * 0.76, 1.6)
          const flicker = 0.92 + Math.sin(tSec * 24 + stream.phase + j * 0.47) * 0.08
          const waveBoost = Math.exp(-Math.pow(j / waveWidth, 2.35))
          const waveScale = 0.36 + waveBoost * waveSizeBoost
          const spawnFade = smooth01(progressRaw / Math.max(0.001, trailProgress / particlesPerStream))
          const spiral = spiralAmount * (tSec * spiralSpeed + progress * 3.2 + stream.phase)
          const spiralCos = Math.cos(spiral)
          const spiralSin = Math.sin(spiral)
          const laneX = stream.laneX * spiralCos - stream.laneY * spiralSin
          const laneY = stream.laneX * spiralSin + stream.laneY * spiralCos
          const streamBreath = Math.sin(tSec * 5.2 + stream.phase + progress * 4.0) * turbulence * (0.2 + progress)
          const runScale = baseLaneScale + runSpread * progress
          const jitterA = stream.seed + j * 19.19
          const jitterScale = streamTightness * (0.15 + progress) * (0.35 + stream.laneRadius)
          const jitterX = (rand(jitterA) - 0.5) * jitterScale
          const jitterY = (rand(jitterA + 5.5) - 0.5) * jitterScale
          const curve = stream.curve * turbulence * progress * (1 - progress) * 2.4
          const radialX = (laneX + streamBreath * 0.18 + curve) * runScale + jitterX
          const radialY = (laneY + streamBreath * 0.08) * runScale + jitterY
          const forward = distance * cameraReach

          const x = right.x * radialX + up.x * radialY + center.x * forward
          const y = right.y * radialX + up.y * radialY + center.y * forward
          const z = right.z * radialX + up.z * radialY + center.z * forward
          const opacity = env * spawnFade * stringAlpha * flicker * (0.62 + waveBoost * 0.38)

          writePoint(x, y, z, dotSize * stream.sizeMul * waveScale, opacity, colorRef.current)
        }
      }
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
        <planeGeometry args={[28, 16]} />
        <meshBasicMaterial color="#ffffff" depthWrite={false} toneMapped={false} />
      </mesh>
      <points geometry={geometry} material={material} renderOrder={10} frustumCulled={false} />
    </group>
  )
}

export const particleStreamsInstrument: ObjectInstrumentDef = {
  id: 'particleStreams',
  name: 'Particle Streams',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: ParticleStreamsVisual,
}

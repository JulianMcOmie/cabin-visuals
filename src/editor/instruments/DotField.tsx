import { useRef, useEffect, useMemo } from 'react'
import { Group, Points, BufferGeometry, BufferAttribute, DynamicDrawUsage, ShaderMaterial, Color } from 'three'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW's DotField. A 3D field of dots arranged by golden-angle
// (sunflower) distribution, displaced by a rotating roster of wave/displacement effects,
// disruptor blades, and water ripples. NOT full-frame — the field sits in the scene at a
// fixed world radius so the engine's placement/transform chain applies.
//
// Adaptation: Tyler keyed each effect to a specific MIDI pitch via `pitchNoteOnCounts`.
// The cabin engine exposes `activeNotes` plus the full resolved note stream. So:
//   - held notes in the low range (0-11 of the field) drive the bass shake, verbatim;
//   - each note's ordinal position in the stream advances the displacement effect
//     roster and, at intervals, marks disruptor-blade / center-ripple / scale-kick
//     spawns — a lively note-reactive field rather than a control-surface. All of it
//     is derived per frame from `state.beat` + `state.notes` (pause invariant: no
//     wall clock, no spawn lists), with each event aged by beat-distance from its
//     note. Displacement/shake/ripple/blade math is Tyler's verbatim. Tyler's
//     palette color-mode is dropped; colorMode selects one of his three hardcoded
//     schemes.

// Golden angle for sunflower distribution
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const MAX_PARTICLES = 2000

// Field world radius (replaces Tyler's viewport-derived radius).
const FIELD_RADIUS = 3.2

// Pitch range that drives the bass shake (held notes). 12 semitones wide.
const PITCH_BASS_MIN = 36
const PITCH_BASS_MAX = 47

const EFFECT_COUNT = 10
const DISRUPTOR_ALGOS = ['elastic', 'gaussian', 'curl', 'fluid', 'wake'] as const
type DisruptorAlgo = (typeof DISRUPTOR_ALGOS)[number]

const DEFAULTS = {
  particleCount: 800,
  dotSize: 3,
  speed: 1,
  intensity: 1,
  bladeCount: 3,
  disruptorStrength: 0.08,
  disruptorSpeed: 2,
  disruptorLifetime: 2,
  rippleSpeed: 1.2,
  rippleStrength: 0.06,
  opacity: 1,
}

// --- Displacement functions ---
// All return [dx, dy] in world units, scaled relative to field radius R.
type DisplaceFn = (
  bx: number, by: number, dist: number, angle: number, t: number, R: number,
) => [number, number]

const displaceFns: DisplaceFn[] = [
  // 0: Ripple — concentric waves radiating out
  (_bx, _by, d, a, t, R) => {
    const normD = d / R
    const wave = Math.sin(normD * 20 - t * 3) * R * 0.025 * normD
    return [Math.cos(a) * wave, Math.sin(a) * wave]
  },
  // 1: Sine Wave — directional undulation
  (bx, by, _d, _a, t, R) => {
    const dx = Math.sin(by / R * 8 + t) * R * 0.02
    const dy = Math.cos(bx / R * 8 + t) * R * 0.02
    return [dx, dy]
  },
  // 2: Spiral — twist particles around center
  (_bx, _by, d, a, t, R) => {
    const normD = d / R
    const twist = normD * 2 + t * 0.8
    const offset = normD * R * 0.04
    return [
      Math.cos(a + twist) * offset - Math.cos(a) * offset,
      Math.sin(a + twist) * offset - Math.sin(a) * offset,
    ]
  },
  // 3: Breathe — uniform expand/contract
  (bx, by, _d, _a, t, _R) => {
    const scale = Math.sin(t * 1.5) * 0.15
    return [bx * scale, by * scale]
  },
  // 4: Vortex — tangential force + radial pull
  (_bx, _by, d, a, t, R) => {
    const normD = d / R
    const tangential = R * 0.09 / (normD + 0.1)
    const radial = Math.sin(t * 2) * R * 0.04
    const perpA = a + Math.PI / 2
    return [
      Math.cos(perpA) * tangential * normD + Math.cos(a) * radial,
      Math.sin(perpA) * tangential * normD + Math.sin(a) * radial,
    ]
  },
  // 5: Rose Curve — petal-shaped distortion
  (_bx, _by, d, a, t, R) => {
    const normD = d / R
    const rose = Math.sin(5 * (a + t)) * R * 0.03 * normD
    return [Math.cos(a) * rose, Math.sin(a) * rose]
  },
  // 6: Shockwave — single ring travels outward
  (_bx, _by, d, a, t, R) => {
    const waveFront = ((t * 0.5) % 1) * R
    const distToWave = Math.abs(d - waveFront)
    const width = R * 0.08
    if (distToWave > width) return [0, 0]
    const strength = (1 - distToWave / width) * R * 0.04
    return [Math.cos(a) * strength, Math.sin(a) * strength]
  },
  // 7: Galaxy — 3-arm spiral density modulation
  (_bx, _by, d, a, t, R) => {
    const normD = d / R
    const density = Math.sin(3 * (a - normD * 3 + t * 0.5))
    const radial = density * R * 0.015 * normD
    const tangential = density * R * 0.01 * normD
    const perpA = a + Math.PI / 2
    return [
      Math.cos(a) * radial + Math.cos(perpA) * tangential,
      Math.sin(a) * radial + Math.sin(perpA) * tangential,
    ]
  },
  // 8: Heartbeat — pulsing beat
  (_bx, _by, d, a, t, _R) => {
    const beat = Math.pow(Math.sin(t * 3), 2) * Math.exp(-((t * 3) % Math.PI))
    const push = beat * d * 0.08
    return [Math.cos(a) * push, Math.sin(a) * push]
  },
  // 9: Organic Flow — pseudo-noise field
  (bx, by, _d, _a, t, R) => {
    const nx = bx / R, ny = by / R
    const dx = Math.sin(nx * 5 + t) * Math.sin(ny * 7 + t * 0.7) * R * 0.02
    const dy = Math.cos(ny * 5 + t * 0.8) * Math.cos(nx * 6 + t * 1.2) * R * 0.02
    return [dx, dy]
  },
]

// --- Types ---

interface Blade {
  baseAngle: number
  age: number        // seconds since its spawn note (beat-derived)
  travelSpeed: number
  strength: number
  algo: DisruptorAlgo
}

interface CenterRipple {
  age: number        // seconds since its spawn note (beat-derived)
  speed: number      // world units per second
  strength: number   // displacement amplitude in world units
}

interface BassNote {
  pitchIdx: number   // 0-11 within bass range
  velScale: number   // velocity 0-1
}

interface ParticleField {
  baseX: Float32Array
  baseY: Float32Array
  dist: Float32Array
  angle: Float32Array
  count: number
  radius: number
}

// --- Particle generation ---

function generateField(count: number, radius: number): ParticleField {
  const baseX = new Float32Array(count)
  const baseY = new Float32Array(count)
  const dist = new Float32Array(count)
  const angle = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt(i / count)
    const theta = i * GOLDEN_ANGLE
    const x = Math.cos(theta) * r
    const y = Math.sin(theta) * r
    baseX[i] = x
    baseY[i] = y
    dist[i] = r
    angle[i] = Math.atan2(y, x)
  }

  return { baseX, baseY, dist, angle, count, radius }
}

// --- Shaders (verbatim, uOpacity retained) ---

const vertexShader = `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;

  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = `
  uniform float uOpacity;
  varying vec3 vColor;

  void main() {
    vec2 cxy = gl_PointCoord * 2.0 - 1.0;
    float r = dot(cxy, cxy);
    if (r > 1.0) discard;
    float alpha = (1.0 - smoothstep(0.6, 1.0, r)) * uOpacity;
    gl_FragColor = vec4(vColor, alpha);
  }
`

// --- Params / ports ---

const PARAMS: ParamDef[] = [
  { key: 'particleCount', label: 'Particles', min: 50, max: MAX_PARTICLES, step: 50, default: DEFAULTS.particleCount },
  { key: 'dotSize', label: 'Dot Size', min: 1, max: 24, step: 0.5, default: 6 },
  { key: 'speed', label: 'Speed', min: 0.1, max: 3, step: 0.1, default: DEFAULTS.speed },
  { key: 'intensity', label: 'Intensity', min: 0, max: 20, step: 0.1, default: DEFAULTS.intensity },
  {
    key: 'colorMode', label: 'Color Scheme', type: 'select', default: 0,
    options: [
      { value: 0, label: 'Crimson Sunrise' },
      { value: 1, label: 'Ocean Depths' },
      { value: 2, label: 'Aurora Borealis' },
    ],
  },
  { key: 'activeEffects', label: 'Active Effects', min: 0, max: EFFECT_COUNT, step: 1, default: 2 },
  { key: 'bladeCount', label: 'Blade Count', min: 1, max: 8, step: 1, default: DEFAULTS.bladeCount },
  { key: 'disruptorStrength', label: 'Disruptor Strength', min: 0.01, max: 0.3, step: 0.01, default: DEFAULTS.disruptorStrength },
  { key: 'disruptorSpeed', label: 'Disruptor Speed', min: 0.5, max: 5, step: 0.1, default: DEFAULTS.disruptorSpeed },
  { key: 'disruptorLifetime', label: 'Disruptor Life (s)', min: 0.5, max: 5, step: 0.1, default: DEFAULTS.disruptorLifetime },
  { key: 'rippleSpeed', label: 'Ripple Speed', min: 0.3, max: 3, step: 0.1, default: DEFAULTS.rippleSpeed },
  { key: 'rippleStrength', label: 'Ripple Strength', min: 0.01, max: 0.2, step: 0.01, default: DEFAULTS.rippleStrength },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: DEFAULTS.opacity },
]

// --- Component ---

function DotFieldVisual({ trackId }: { trackId: string }) {
  const rootRef = useRef<Group>(null)

  // Scene objects
  const pointsObj = useRef<Points | null>(null)
  const geomRef = useRef<BufferGeometry | null>(null)
  const matRef = useRef<ShaderMaterial | null>(null)
  const fieldRef = useRef<ParticleField | null>(null)

  // Pre-allocated buffers (max size)
  const posBuf = useMemo(() => new Float32Array(MAX_PARTICLES * 3), [])
  const sizeBuf = useMemo(() => new Float32Array(MAX_PARTICLES), [])
  const colBuf = useMemo(() => new Float32Array(MAX_PARTICLES * 3), [])

  // Build tracking
  const builtCount = useRef(0)

  // Scratch color
  const scratchColor = useRef(new Color())
  const rippleColorRef = useRef(new Color())

  function build(count: number) {
    const root = rootRef.current
    if (!root) return

    if (pointsObj.current) root.remove(pointsObj.current)
    geomRef.current?.dispose()
    matRef.current?.dispose()

    fieldRef.current = generateField(count, FIELD_RADIUS)

    const geom = new BufferGeometry()
    const posAttr = new BufferAttribute(posBuf, 3)
    posAttr.setUsage(DynamicDrawUsage)
    const sizeAttr = new BufferAttribute(sizeBuf, 1)
    sizeAttr.setUsage(DynamicDrawUsage)
    const colorAttr = new BufferAttribute(colBuf, 3)
    colorAttr.setUsage(DynamicDrawUsage)

    geom.setAttribute('position', posAttr)
    geom.setAttribute('aSize', sizeAttr)
    geom.setAttribute('aColor', colorAttr)
    geom.setDrawRange(0, count)

    const mat = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uOpacity: { value: 1.0 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    })

    const pts = new Points(geom, mat)
    pts.frustumCulled = false
    pts.renderOrder = 10
    root.add(pts)

    pointsObj.current = pts
    geomRef.current = geom
    matRef.current = mat
    builtCount.current = count

    // Init positions
    const f = fieldRef.current
    for (let i = 0; i < count; i++) {
      posBuf[i * 3] = f.baseX[i]
      posBuf[i * 3 + 1] = f.baseY[i]
      posBuf[i * 3 + 2] = 0
    }
  }

  useInstrumentFrame(trackId, (state) => {
    const root = rootRef.current
    if (!root) return

    const p = state.params

    const particleCount = Math.round(Math.min(
      MAX_PARTICLES,
      p.particleCount ?? DEFAULTS.particleCount,
    ))
    const dotSize = p.dotSize ?? 6
    const speed = p.speed ?? DEFAULTS.speed
    const intensityP = p.intensity ?? DEFAULTS.intensity
    const activeEffects = Math.round(Math.max(0, Math.min(EFFECT_COUNT, p.activeEffects ?? 2)))
    const bladeCount = Math.round(p.bladeCount ?? DEFAULTS.bladeCount)
    const disruptorStrength = p.disruptorStrength ?? DEFAULTS.disruptorStrength
    const disruptorSpeed = p.disruptorSpeed ?? DEFAULTS.disruptorSpeed
    const disruptorLifetime = p.disruptorLifetime ?? DEFAULTS.disruptorLifetime
    const rippleSpeed = p.rippleSpeed ?? DEFAULTS.rippleSpeed
    const rippleStrength = p.rippleStrength ?? DEFAULTS.rippleStrength
    const opacity = p.opacity ?? DEFAULTS.opacity
    const scheme = Math.round(p.colorMode ?? 0) % 3

    // Rebuild if particle count changed
    if (particleCount !== builtCount.current) {
      build(particleCount)
    }

    const f = fieldRef.current
    const geom = geomRef.current
    if (!f || !geom) return

    const n = f.count
    const R = f.radius
    const t = state.beat * state.secPerBeat * speed

    // --- Derive spawn events purely from the note stream (pause invariant) ---
    // Each note's ordinal position in the sorted stream stands in for the old
    // onset counter: every note advances the roster and kicks the field scale,
    // every 2nd emits a center ripple, every 4th spawns a set of disruptor blades
    // (its algo cycling per spawn). Ages come from beat-distance to the note, so
    // a scrub to any beat reconstructs the exact same events — no spawn lists.
    const blades: Blade[] = []
    const cRipples: CenterRipple[] = []
    let kickScale = 0
    let ordinal = 0
    let bladeSpawnIdx = 0
    for (const nt of state.notes) {
      if (nt.beat > state.beat) break
      ordinal++
      const ageSec = (state.beat - nt.beat) * state.secPerBeat

      // Every 4th note, a set of disruptor blades (deterministic spawn angle).
      if (ordinal % 4 === 0) {
        const algo = DISRUPTOR_ALGOS[bladeSpawnIdx % DISRUPTOR_ALGOS.length]
        bladeSpawnIdx++
        if (ageSec < disruptorLifetime) {
          const baseA = seededRand(nt.beat * 13 + nt.pitch * 7) * Math.PI * 2
          for (let kk = 0; kk < bladeCount; kk++) {
            blades.push({
              baseAngle: baseA + (kk * Math.PI * 2) / bladeCount,
              age: ageSec,
              travelSpeed: disruptorSpeed * R,
              strength: disruptorStrength * R,
              algo,
            })
          }
        }
      }

      // Every 2nd note, a center ripple (lives 3s).
      if (ordinal % 2 === 0 && ageSec < 3) {
        cRipples.push({
          age: ageSec,
          speed: rippleSpeed * R,
          strength: rippleStrength * R,
        })
      }

      // Each note kicks the field scale, scaled by velocity (lives 0.7s).
      // Damped spring: outward burst → contracts past rest → settles
      if (ageSec < 0.7) {
        const velocity = nt.velocity <= 1 ? nt.velocity : nt.velocity / 127
        const envelope = Math.exp(-ageSec * 7) * Math.cos(ageSec * 14)
        kickScale += (0.35 + velocity * 0.3) * envelope
      }
    }
    // The displacement roster's window start advances once per note.
    const effectStart = ordinal % EFFECT_COUNT

    // --- Collect active bass shake notes (held notes → shake) ---
    const bassNotes: BassNote[] = []
    for (const nt of state.activeNotes) {
      if (nt.pitch >= PITCH_BASS_MIN && nt.pitch <= PITCH_BASS_MAX) {
        bassNotes.push({
          pitchIdx: nt.pitch - PITCH_BASS_MIN,
          velScale: nt.velocity <= 1 ? nt.velocity : nt.velocity / 127,
        })
      }
    }

    // --- Per-particle update ---
    const sc = scratchColor.current
    const pixelSize = dotSize

    // Scheme-specific base parameters (used for ripple highlight)
    const schemeH = scheme === 0 ? 0.0 : scheme === 1 ? 0.48 : 0.75
    const schemeS = scheme === 0 ? 0.9 : scheme === 1 ? 0.75 : 0.85
    const schemeL = scheme === 0 ? 0.45 : scheme === 1 ? 0.45 : 0.4

    // Ripple highlight: contrasting accent color
    const rippleH = scheme === 0 ? 0.1 : scheme === 1 ? 0.15 : 0.52
    const rippleColor = rippleColorRef.current.setHSL(
      rippleH,
      Math.min(1, schemeS + 0.1),
      Math.min(0.85, schemeL + 0.3),
    )

    // Update opacity uniform
    if (matRef.current) {
      matRef.current.uniforms.uOpacity.value = opacity
    }

    const pos = posBuf
    const sz = sizeBuf
    const col = colBuf

    for (let i = 0; i < n; i++) {
      const bx = f.baseX[i]
      const by = f.baseY[i]
      const d = f.dist[i]
      const a = f.angle[i]

      let dx = bx * kickScale,
        dy = by * kickScale

      // Sum active displacement effects — a rolling window of the roster.
      for (let e = 0; e < activeEffects; e++) {
        const idx = (effectStart + e) % EFFECT_COUNT
        const [ex, ey] = displaceFns[idx](bx, by, d, a, t, R)
        dx += ex * intensityP
        dy += ey * intensityP
      }

      // Disruptor blades
      for (let b = 0; b < blades.length; b++) {
        const blade = blades[b]
        const age = blade.age
        const cosB = Math.cos(blade.baseAngle)
        const sinB = Math.sin(blade.baseAngle)

        const projDist = bx * cosB + by * sinB
        const perpDist = Math.abs(-bx * sinB + by * cosB)

        const localAge = age - (projDist + R) / blade.travelSpeed
        if (localAge < 0 || localAge > 1.5) continue

        const ramp = Math.min(1, localAge / 0.06)
        const perpFalloff = Math.exp(
          (-perpDist * perpDist) / (R * R * 0.01),
        )
        const decay = Math.exp(-localAge * 3)

        let bdx = 0,
          bdy = 0

        switch (blade.algo) {
          case 'elastic': {
            const spring = Math.cos(localAge * 8) * decay * ramp
            bdx = cosB * spring * blade.strength
            bdy = sinB * spring * blade.strength
            break
          }
          case 'gaussian': {
            const push = decay * ramp
            bdx = cosB * push * blade.strength
            bdy = sinB * push * blade.strength
            break
          }
          case 'curl': {
            const fwd = decay * ramp
            const perp =
              Math.sin(localAge * 6) * decay * ramp * 0.5
            const perpCos = Math.cos(blade.baseAngle + Math.PI / 2)
            const perpSin = Math.sin(blade.baseAngle + Math.PI / 2)
            bdx =
              cosB * fwd * blade.strength +
              perpCos * perp * blade.strength
            bdy =
              sinB * fwd * blade.strength +
              perpSin * perp * blade.strength
            break
          }
          case 'fluid': {
            const push =
              localAge < 0.3
                ? decay * ramp
                : -decay * ramp * 0.3
            bdx = cosB * push * blade.strength
            bdy = sinB * push * blade.strength
            break
          }
          case 'wake': {
            const perpCos = Math.cos(blade.baseAngle + Math.PI / 2)
            const perpSin = Math.sin(blade.baseAngle + Math.PI / 2)
            const wake = Math.sin(localAge * 10) * decay * ramp
            bdx = perpCos * wake * blade.strength
            bdy = perpSin * wake * blade.strength
            break
          }
        }

        dx += bdx * perpFalloff
        dy += bdy * perpFalloff
      }

      // Bass shake — fast micro zig-zag from held notes
      for (let bn = 0; bn < bassNotes.length; bn++) {
        const { pitchIdx, velScale } = bassNotes[bn]
        const normPitch = pitchIdx / 11 // 0→1 across the octave

        // Amplitude: very small base, scales up with pitch
        const amp = R * (0.003 + normPitch * 0.007)

        // Zig-zag frequency: fast, increases with pitch
        const freq = 30 + pitchIdx * 7

        // Direction: each pitch shakes along a different axis (30° apart)
        const dir = pitchIdx * (Math.PI / 6)

        // Per-particle phase offset → organic spatial variation (grows with pitch)
        const pPhase = a * (1 + pitchIdx * 0.5) + (d / R) * pitchIdx * 2

        // Shape the wave: lower pitches are smooth sine, higher pitches sharpen
        // toward a square wave for a harder zig-zag feel
        const sharpness = 0.2 + normPitch * 0.6 // 0.2 (soft) → 0.8 (sharp)
        const raw = Math.sin(t * freq + pPhase)
        const shaped = Math.sign(raw) * Math.pow(Math.abs(raw), 1 - sharpness)

        dx += Math.cos(dir) * shaped * amp * velScale * intensityP
        dy += Math.sin(dir) * shaped * amp * velScale * intensityP
      }

      // Center ripples — expanding ring from origin, displaces + colors
      let rippleInfluence = 0
      for (let cr = 0; cr < cRipples.length; cr++) {
        const crip = cRipples[cr]
        const crAge = crip.age
        const ringR = crAge * crip.speed
        const distToRing = Math.abs(d - ringR)
        const width = R * 0.12 // wide band for prominent visual
        if (distToRing < width) {
          const proximity = 1 - distToRing / width
          const fade = Math.exp(-crAge * 1.5)
          const influence = proximity * fade
          // Radial push outward
          const pushStr = influence * crip.strength * intensityP
          if (d > 0.001) {
            dx += (bx / d) * pushStr
            dy += (by / d) * pushStr
          }
          rippleInfluence = Math.min(1, rippleInfluence + influence)
        }
      }

      const totalDisp = Math.sqrt(dx * dx + dy * dy)

      // Position
      pos[i * 3] = bx + dx
      pos[i * 3 + 1] = by + dy
      pos[i * 3 + 2] = 0

      // Size — kick swell + ripple band
      sz[i] = pixelSize * (1 + kickScale * 0.8 + rippleInfluence * 0.8)

      // Color — compute base color from scheme, then blend toward ripple highlight
      let baseR: number, baseG: number, baseB: number
      const normD = d / R
      const dispFrac = Math.min(1, totalDisp / (R * 0.1))

      // Gradient blend factor: combines radial distance + angular position for rich 2D gradient
      const angleNorm = (a + Math.PI) / (Math.PI * 2) // 0→1 around circle
      const gradT = normD * 0.6 + angleNorm * 0.4 // blend of radius and angle
      const organic = Math.sin(a * 3.0 + normD * 8.0) * Math.sin(a * 5.0 - normD * 4.0) * 0.5 + 0.5

      if (scheme === 0) {
        // Crimson Sunrise: hot pink center → fiery red → coral → golden yellow edges
        const h = (0.92 + gradT * 0.2 + organic * 0.05) % 1
        const s = 1.0 - gradT * 0.1 + organic * 0.05 + dispFrac * 0.1
        const l = 0.38 + gradT * 0.22 + organic * 0.12 + dispFrac * 0.12
        sc.setHSL(h, Math.min(1, Math.max(0.6, s)), Math.min(0.82, l))
      } else if (scheme === 1) {
        // Ocean Depths: deep blue center → teal → emerald green → warm gold edges
        const h = (0.58 - gradT * 0.35 - organic * 0.05 + 1) % 1
        const s = 0.85 - gradT * 0.1 + organic * 0.1 + dispFrac * 0.1
        const l = 0.32 + gradT * 0.25 + organic * 0.1 + dispFrac * 0.12
        sc.setHSL(h, Math.min(1, Math.max(0.45, s)), Math.min(0.82, l))
      } else {
        // Aurora Borealis: deep indigo center → violet → magenta → electric cyan/green edges
        const hBase = gradT < 0.5
          ? 0.72 + gradT * 0.36
          : 0.9 - (gradT - 0.5) * 0.7
        const h = (hBase + organic * 0.06) % 1
        const s = 0.85 + gradT * 0.1 + organic * 0.05 + dispFrac * 0.05
        const l = 0.34 + gradT * 0.24 + organic * 0.12 + dispFrac * 0.15
        sc.setHSL(h % 1, Math.min(1, s), Math.min(0.85, l))
      }
      baseR = sc.r; baseG = sc.g; baseB = sc.b

      // Blend toward ripple highlight color
      const ri = rippleInfluence
      const finalR = baseR + (rippleColor.r - baseR) * ri
      const finalG = baseG + (rippleColor.g - baseG) * ri
      const finalB = baseB + (rippleColor.b - baseB) * ri

      col[i * 3] = finalR
      col[i * 3 + 1] = finalG
      col[i * 3 + 2] = finalB
    }

    // Flag attributes for GPU upload
    const posAttr = geom.getAttribute('position') as BufferAttribute
    const sizeAttr = geom.getAttribute('aSize') as BufferAttribute
    const colorAttr = geom.getAttribute('aColor') as BufferAttribute
    posAttr.needsUpdate = true
    sizeAttr.needsUpdate = true
    colorAttr.needsUpdate = true
  })

  useEffect(() => {
    return () => {
      if (pointsObj.current && rootRef.current)
        rootRef.current.remove(pointsObj.current)
      geomRef.current?.dispose()
      matRef.current?.dispose()
    }
  }, [])

  return <group ref={rootRef} />
}

// --- Instrument export ---

export const dotFieldInstrument: ObjectInstrumentDef = {
  id: 'dotField',
  name: 'Dot Field',
  kind: 'object',
  params: PARAMS,
  component: DotFieldVisual,
  fullFrame: true,
}

import { useRef, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW. A 3D warp starfield around the camera: parallax star drift
// with directional warp/drift, barrel roll, tumble, pulse burst, streak, and per-pitch
// background themes - all driven by notes on the object's own lane. Every frame is a
// pure function of the current beat (the pause invariant): drift/warp are per-note
// first-order velocity responses integrated in closed form, roll/tumble angles and the
// pulse/streak/background envelopes are closed-form in note age, so a static playhead
// is a static frame and scrub == playback. The Points shaders are copied verbatim.

const MAX_STARS = 3000

// MIDI pitch mappings
const PITCH_WARP_FWD = 48
const PITCH_WARP_BWD = 49
const PITCH_DRIFT_RIGHT = 50
const PITCH_DRIFT_LEFT = 51
const PITCH_DRIFT_UP = 52
const PITCH_DRIFT_DOWN = 53
const PITCH_BARREL_CW = 54
const PITCH_BARREL_CCW = 55
const PITCH_TUMBLE = 56
const PITCH_PULSE = 57
const PITCH_BRAKE = 58
const PITCH_STREAK = 59

// Background theme pitches - one per theme
const PITCH_BG_VOID = 60
const PITCH_BG_DEEP_SPACE = 61
const PITCH_BG_NEBULA = 62
const PITCH_BG_CRIMSON = 63
const PITCH_BG_OCEAN = 64
const PITCH_BG_FOREST = 65
const PITCH_BG_AMBER = 66
const PITCH_BG_MIDNIGHT = 67

const BG_THEMES: Record<number, string> = {
  [PITCH_BG_VOID]: '#0a0a0f',
  [PITCH_BG_DEEP_SPACE]: '#05051a',
  [PITCH_BG_NEBULA]: '#1a0a2e',
  [PITCH_BG_CRIMSON]: '#1a0505',
  [PITCH_BG_OCEAN]: '#051a1a',
  [PITCH_BG_FOREST]: '#0a1a05',
  [PITCH_BG_AMBER]: '#1a1005',
  [PITCH_BG_MIDNIGHT]: '#0a0a1f',
}

const DEFAULTS = {
  starCount: 1500,
  dotSize: 2,
  speed: 1,
  spread: 6,
  depth: 15,
  drift: 0.1,
  tint: 220,
  bgColor: '#0a0a0f',
  ground: 0,
  groundY: -3,
  groundColor: '#4a3a8a',
}

// --- Shaders (verbatim from Tyler's Stars) ---

const vertexShader = `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStreak;
  uniform float uStreakFactor;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (1.0 + uStreakFactor * 2.0);
    gl_Position = projectionMatrix * mvPosition;
    vStreak = uStreakFactor;
  }
`

const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vStreak;

  void main() {
    vec2 cxy = gl_PointCoord * 2.0 - 1.0;
    // Stretch horizontally when streaking for an elongated look
    float r;
    if (vStreak > 0.0) {
      float sx = cxy.x / (1.0 + vStreak * 3.0);
      r = sx * sx + cxy.y * cxy.y;
    } else {
      r = dot(cxy, cxy);
    }
    if (r > 1.0) discard;
    float alpha = vAlpha * (1.0 - smoothstep(0.4, 1.0, r));
    gl_FragColor = vec4(vColor, alpha);
  }
`

// --- Star generation (seeded, so a reload regenerates the identical layout) ---

function generateStarfield(count: number, spread: number, depth: number): Float32Array {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (seededRand(i * 3) - 0.5) * spread * 2
    positions[i * 3 + 1] = (seededRand(i * 3 + 1) - 0.5) * spread * 2
    positions[i * 3 + 2] = (seededRand(i * 3 + 2) - 0.5) * depth
  }
  return positions
}

// Wrap a coordinate into [-half, half) (translation displacement can be many spans out)
function wrapCentered(v: number, half: number): number {
  const span = half * 2
  return ((((v + half) % span) + span) % span) - half
}

// Closed-form displacement of the old per-frame velocity smoothing: velocity chases a
// boxcar target (V while the note holds, 0 after release) at rate 3/s - 8/s while a
// brake note is held - and displacement is the exact integral, walked over the segments
// between hold/brake boundaries. Re-evaluated from note data every frame, so it is pure
// in the current time: no integration state, and scrubbing in any direction agrees.
function noteDisplacement(
  onSec: number,
  durSec: number,
  V: number,
  tSec: number,
  brakes: Array<[number, number]>,
): number {
  if (tSec <= onSec) return 0
  const relSec = onSec + durSec
  let v = 0
  let disp = 0
  let s = onSec
  while (s < tSec - 1e-9) {
    // Next boundary: the note's release or a brake edge, else now
    let e = tSec
    if (relSec > s && relSec < e) e = relSec
    for (const b of brakes) {
      if (b[0] > s && b[0] < e) e = b[0]
      if (b[1] > s && b[1] < e) e = b[1]
    }
    const mid = (s + e) / 2
    let braked = false
    for (const b of brakes) {
      if (mid >= b[0] && mid < b[1]) { braked = true; break }
    }
    const k = braked ? 8 : 3
    const target = mid < relSec ? V : 0
    const seg = e - s
    const decay = Math.exp(-k * seg)
    disp += target * seg + ((v - target) * (1 - decay)) / k
    v = target + (v - target) * decay
    s = e
  }
  return disp
}

const PARAMS: ParamDef[] = [
  { key: 'starCount', label: 'Stars', min: 200, max: MAX_STARS, step: 100, default: DEFAULTS.starCount },
  { key: 'dotSize', label: 'Dot Size', min: 0, max: 6, step: 0.5, default: DEFAULTS.dotSize },
  { key: 'speed', label: 'Speed', min: 0, max: 20, step: 0.1, default: DEFAULTS.speed },
  { key: 'spread', label: 'Spread', min: 2, max: 12, step: 0.5, default: DEFAULTS.spread },
  { key: 'depth', label: 'Depth', min: 5, max: 30, step: 1, default: DEFAULTS.depth },
  { key: 'drift', label: 'Idle Drift', min: 0, max: 1, step: 0.05, default: DEFAULTS.drift },
  { key: 'tint', label: 'Tint Hue', min: 0, max: 360, step: 1, default: DEFAULTS.tint },
  { key: 'bgColor', label: 'Background Color', type: 'color', default: DEFAULTS.bgColor },
  { key: 'ground', label: 'Ground Plane', type: 'boolean', default: DEFAULTS.ground },
  { key: 'groundY', label: 'Ground Height', min: -50, max: 50, step: 0.5, default: DEFAULTS.groundY, showIf: 'ground' },
  { key: 'groundColor', label: 'Ground Color', type: 'color', default: DEFAULTS.groundColor, showIf: 'ground' },
]
function StarsVisual({ trackId }: { trackId: string }) {
  const rootRef = useRef<THREE.Group>(null)
  const { scene } = useThree()
  const bgColorObj = useRef(new THREE.Color(DEFAULTS.bgColor))
  const bgTargetColor = useRef(new THREE.Color(DEFAULTS.bgColor))

  // Scene objects
  const pointsObj = useRef<THREE.Points | null>(null)
  const geomRef = useRef<THREE.BufferGeometry | null>(null)
  const matRef = useRef<THREE.ShaderMaterial | null>(null)

  // Pre-allocated buffers (max size)
  const basePosBuf = useRef(new Float32Array(MAX_STARS * 3))
  const parallaxBuf = useRef(new Float32Array(MAX_STARS))
  const posBuf = useRef(new Float32Array(MAX_STARS * 3))
  const sizeBuf = useRef(new Float32Array(MAX_STARS))
  const colBuf = useRef(new Float32Array(MAX_STARS * 3))
  const alphaBuf = useRef(new Float32Array(MAX_STARS))

  // Build tracking
  const builtCount = useRef(0)
  const builtSpread = useRef(0)
  const builtDepth = useRef(0)

  // Ground plane
  const groundGroup = useRef<THREE.Group | null>(null)
  const groundBuilt = useRef(false)

  // Scratch color
  const scratchColor = useRef(new THREE.Color())

  function build(count: number, spread: number, depth: number) {
    const root = rootRef.current
    if (!root) return

    if (pointsObj.current) root.remove(pointsObj.current)
    geomRef.current?.dispose()
    matRef.current?.dispose()

    // Generate the home layout; rendered positions are derived from it each frame
    const initPos = generateStarfield(count, spread, depth)
    basePosBuf.current.set(initPos)
    posBuf.current.set(initPos)

    // Fixed per-star parallax from the star's home depth: closer stars move faster.
    // (The old code recomputed parallax from the live z each frame, so stars sped up
    // as they neared the camera; a fixed factor keeps displacement closed-form.)
    const depthHalf = depth / 2
    for (let i = 0; i < count; i++) {
      parallaxBuf.current[i] = depthHalf / (Math.abs(initPos[i * 3 + 2]) + 0.5)
    }

    const geom = new THREE.BufferGeometry()
    const posAttr = new THREE.BufferAttribute(posBuf.current, 3)
    posAttr.setUsage(THREE.DynamicDrawUsage)
    const sizeAttr = new THREE.BufferAttribute(sizeBuf.current, 1)
    sizeAttr.setUsage(THREE.DynamicDrawUsage)
    const colorAttr = new THREE.BufferAttribute(colBuf.current, 3)
    colorAttr.setUsage(THREE.DynamicDrawUsage)
    const alphaAttr = new THREE.BufferAttribute(alphaBuf.current, 1)
    alphaAttr.setUsage(THREE.DynamicDrawUsage)

    geom.setAttribute('position', posAttr)
    geom.setAttribute('aSize', sizeAttr)
    geom.setAttribute('aColor', colorAttr)
    geom.setAttribute('aAlpha', alphaAttr)
    geom.setDrawRange(0, count)

    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uStreakFactor: { value: 0 },
      },
    })

    const pts = new THREE.Points(geom, mat)
    root.add(pts)

    pointsObj.current = pts
    geomRef.current = geom
    matRef.current = mat
    builtCount.current = count
    builtSpread.current = spread
    builtDepth.current = depth
  }

  function buildGround(spread: number, depth: number, groundY: number, color: string) {
    const root = rootRef.current
    if (!root) return

    // Remove old ground
    if (groundGroup.current) {
      root.remove(groundGroup.current)
      groundGroup.current.traverse((child) => {
        if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose()
        if ((child as THREE.Mesh).material) ((child as THREE.Mesh).material as THREE.Material).dispose()
      })
    }

    const grp = new THREE.Group()
    grp.position.y = groundY

    const gridSize = spread * 4
    const divisions = 40
    const step = gridSize / divisions
    const gridDepth = depth * 2
    const depthDivisions = Math.ceil(gridDepth / step)

    const gridColor = new THREE.Color(color)

    // Create grid lines as a single LineSegments geometry
    const vertices: number[] = []

    // Lines along X (rows at different Z)
    for (let i = 0; i <= depthDivisions; i++) {
      const z = -gridDepth / 2 + i * step
      vertices.push(-gridSize / 2, 0, z, gridSize / 2, 0, z)
    }

    // Lines along Z (columns at different X)
    for (let i = 0; i <= divisions; i++) {
      const x = -gridSize / 2 + i * step
      vertices.push(x, 0, -gridDepth / 2, x, 0, gridDepth / 2)
    }

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))

    const mat = new THREE.LineBasicMaterial({
      color: gridColor,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    })

    const lines = new THREE.LineSegments(geom, mat)
    grp.add(lines)

    root.add(grp)
    groundGroup.current = grp
    groundBuilt.current = true
  }

  useInstrumentFrame(trackId, (state) => {
    const root = rootRef.current
    if (!root) return false

    // Read settings
    const p = state.params
    const starCount = Math.round(Math.min(MAX_STARS, p.starCount ?? DEFAULTS.starCount))
    const dotSize = p.dotSize ?? DEFAULTS.dotSize
    const speed = p.speed ?? DEFAULTS.speed
    const spread = p.spread ?? DEFAULTS.spread
    const depth = p.depth ?? DEFAULTS.depth
    const driftSpeed = p.drift ?? DEFAULTS.drift
    const tint = p.tint ?? DEFAULTS.tint

    const depthHalf = depth / 2

    // Rebuild if settings changed
    if (
      starCount !== builtCount.current ||
      Math.abs(spread - builtSpread.current) > 0.01 ||
      Math.abs(depth - builtDepth.current) > 0.01
    ) {
      build(starCount, spread, depth)
    }

    const geom = geomRef.current
    const mat = matRef.current
    if (!geom || !mat) return false

    const n = starCount
    const secPerBeat = state.secPerBeat
    const tSec = state.beat * secPerBeat
    const notes = state.notes

    // --- Brake intervals (in seconds, merged) - while a brake note holds, every
    // velocity response below decays at 8/s instead of 3/s ---
    let brakes: Array<[number, number]> = []
    for (const nt of notes) {
      if (nt.pitch !== PITCH_BRAKE) continue
      const on = nt.beat * secPerBeat
      if (on >= tSec) continue
      brakes.push([on, on + nt.durationBeats * secPerBeat])
    }
    if (brakes.length > 1) {
      brakes.sort((a, b) => a[0] - b[0])
      const merged: Array<[number, number]> = [brakes[0]]
      for (let j = 1; j < brakes.length; j++) {
        const last = merged[merged.length - 1]
        if (brakes[j][0] <= last[1]) last[1] = Math.max(last[1], brakes[j][1])
        else merged.push(brakes[j])
      }
      brakes = merged
    }

    // --- Closed-form motion state at the current beat, summed over past notes ---
    let dispX = 0
    let dispY = 0
    let dispZ = driftSpeed * tSec // Idle forward drift
    let rollAngle = 0
    let tumbleSec = 0
    let pulseAmount = 0
    let streakToggles = 0
    let lastStreakOn = -Infinity

    for (const nt of notes) {
      const onSec = nt.beat * secPerBeat
      if (onSec > tSec) continue
      const durSec = nt.durationBeats * secPerBeat
      const age = tSec - onSec
      const heldSec = Math.min(age, durSec)
      const v = nt.velocity
      const velScale = ((v <= 1 ? v : v / 127)) * speed

      switch (nt.pitch) {
        case PITCH_WARP_FWD:
          dispZ += noteDisplacement(onSec, durSec, 3 * velScale, tSec, brakes)
          break
        case PITCH_WARP_BWD:
          dispZ -= noteDisplacement(onSec, durSec, 3 * velScale, tSec, brakes)
          break
        case PITCH_DRIFT_RIGHT:
          dispX += noteDisplacement(onSec, durSec, 2 * velScale, tSec, brakes)
          break
        case PITCH_DRIFT_LEFT:
          dispX -= noteDisplacement(onSec, durSec, 2 * velScale, tSec, brakes)
          break
        case PITCH_DRIFT_UP:
          dispY += noteDisplacement(onSec, durSec, 2 * velScale, tSec, brakes)
          break
        case PITCH_DRIFT_DOWN:
          dispY -= noteDisplacement(onSec, durSec, 2 * velScale, tSec, brakes)
          break
        case PITCH_BARREL_CW:
          rollAngle += 1.5 * velScale * heldSec
          break
        case PITCH_BARREL_CCW:
          rollAngle -= 1.5 * velScale * heldSec
          break
        case PITCH_TUMBLE:
          tumbleSec += heldSec
          break
        case PITCH_PULSE:
          // Exact integral of the old exp(-age * 8) burst push - each pulse
          // permanently displaces stars outward by a bounded amount
          pulseAmount += 0.5 * (1 - Math.exp(-age * 8))
          break
        case PITCH_STREAK:
          streakToggles++
          if (onSec > lastStreakOn) lastStreakOn = onSec
          break
      }
    }

    // Tumble angle and axis precession - pure functions of accumulated hold time
    const tumbleAngle = tumbleSec * 2 * speed
    const tt = tumbleSec * 0.3
    let tax = Math.sin(tt * 1.3) * 0.5 + Math.cos(tt * 0.7) * 0.5
    let tay = Math.cos(tt * 0.9) * 0.5 + Math.sin(tt * 1.1) * 0.5
    let taz = Math.sin(tt * 0.5) * 0.3
    const talen = Math.sqrt(tax * tax + tay * tay + taz * taz)
    if (talen > 0) {
      tax /= talen
      tay /= talen
      taz /= talen
    }

    // Streak factor for shader: streak notes toggle the state; the factor eases
    // toward the current parity from the most recent toggle (was a per-frame lerp)
    const streakParity = streakToggles % 2
    mat.uniforms.uStreakFactor.value =
      streakToggles === 0
        ? 0
        : streakParity + (1 - 2 * streakParity) * Math.exp(-6 * (tSec - lastStreakOn))

    // Tint color for distant stars
    const tintHue = tint / 360
    const sc = scratchColor.current

    const base = basePosBuf.current
    const par = parallaxBuf.current
    const pos = posBuf.current
    const sz = sizeBuf.current
    const col = colBuf.current
    const alp = alphaBuf.current

    const cosRoll = Math.cos(rollAngle)
    const sinRoll = Math.sin(rollAngle)
    const cosT = Math.cos(tumbleAngle)
    const sinT = Math.sin(tumbleAngle)

    for (let i = 0; i < n; i++) {
      const parallax = par[i]

      // Translation displacement with parallax, wrapped back into the volume
      let x = wrapCentered(base[i * 3] + dispX * parallax, spread)
      let y = wrapCentered(base[i * 3 + 1] + dispY * parallax, spread)
      let z = wrapCentered(base[i * 3 + 2] + dispZ * parallax, depthHalf)

      // Pulse burst - radial push outward from center in XY
      if (pulseAmount > 0) {
        const pDist = Math.sqrt(x * x + y * y)
        if (pDist > 0.01) {
          const pushStr = pulseAmount * parallax
          x += (x / pDist) * pushStr
          y += (y / pDist) * pushStr
        }
      }

      // Barrel roll (rotate XY around Z axis by the accumulated roll angle)
      if (rollAngle !== 0) {
        const tmpX = x
        const tmpY = y
        x = tmpX * cosRoll - tmpY * sinRoll
        y = tmpX * sinRoll + tmpY * cosRoll
      }

      // Tumble (arbitrary axis rotation by the accumulated tumble angle)
      if (tumbleAngle > 0) {
        const dot = tax * x + tay * y + taz * z
        const cx = tay * z - taz * y
        const cy = taz * x - tax * z
        const cz = tax * y - tay * x
        const nx = x * cosT + cx * sinT + tax * dot * (1 - cosT)
        const ny = y * cosT + cy * sinT + tay * dot * (1 - cosT)
        const nz = z * cosT + cz * sinT + taz * dot * (1 - cosT)
        x = nx
        y = ny
        z = nz
      }

      // Wrap coordinates (pulse push and rotations can carry stars back out)
      x = wrapCentered(x, spread)
      y = wrapCentered(y, spread)
      z = wrapCentered(z, depthHalf)

      pos[i * 3] = x
      pos[i * 3 + 1] = y
      pos[i * 3 + 2] = z

      // Size: perspective scaling - closer = bigger
      const absZ = Math.abs(z) + 0.5
      const perspSize = dotSize * (depthHalf / absZ)
      sz[i] = Math.max(0.5, perspSize)

      // Color: near stars are white, far stars pick up tint
      const depthFrac = Math.abs(z) / depthHalf // 0 = near, 1 = far
      if (tintHue === 0 || depthFrac < 0.1) {
        // Pure white for near stars or no tint
        col[i * 3] = 1
        col[i * 3 + 1] = 1
        col[i * 3 + 2] = 1
      } else {
        // Blend toward tinted color with distance
        sc.setHSL(tintHue, 0.4 * depthFrac, 0.9 - 0.3 * depthFrac)
        const blend = depthFrac * 0.6
        col[i * 3] = 1 + (sc.r - 1) * blend
        col[i * 3 + 1] = 1 + (sc.g - 1) * blend
        col[i * 3 + 2] = 1 + (sc.b - 1) * blend
      }

      // Alpha: near = fully opaque, far = dimmer
      alp[i] = 1.0 - depthFrac * 0.7
    }

    // --- Background color ---
    // Target = theme of a held BG note (latest onset wins), else the setting color.
    // The old per-frame lerp becomes a closed-form ease from whichever color held just
    // before the most recent BG on/off boundary (assumes that earlier transition had
    // settled - history further back isn't replayed).
    const bgColorParam = state.stringParams.bgColor ?? DEFAULTS.bgColor
    const bgThemeAt = (sec: number): string => {
      let bestOn = -Infinity
      let theme = bgColorParam
      for (const nt of notes) {
        if (!(nt.pitch in BG_THEMES)) continue
        const on = nt.beat * secPerBeat
        if (sec < on || sec >= on + nt.durationBeats * secPerBeat) continue
        if (on > bestOn) {
          bestOn = on
          theme = BG_THEMES[nt.pitch]
        }
      }
      return theme
    }
    let lastBgBoundary = -Infinity
    for (const nt of notes) {
      if (!(nt.pitch in BG_THEMES)) continue
      const on = nt.beat * secPerBeat
      const off = on + nt.durationBeats * secPerBeat
      if (on <= tSec && on > lastBgBoundary) lastBgBoundary = on
      if (off <= tSec && off > lastBgBoundary) lastBgBoundary = off
    }
    bgTargetColor.current.set(bgThemeAt(tSec))
    if (lastBgBoundary > -Infinity) {
      bgColorObj.current.set(bgThemeAt(lastBgBoundary - 1e-4))
      bgColorObj.current.lerp(bgTargetColor.current, 1 - Math.exp(-4 * (tSec - lastBgBoundary)))
    } else {
      bgColorObj.current.copy(bgTargetColor.current)
    }
    scene.background = bgColorObj.current
    // Also update fog color to match
    if (scene.fog && scene.fog instanceof THREE.Fog) {
      scene.fog.color.copy(bgColorObj.current)
    }

    // --- Ground plane ---
    const showGround = (p.ground ?? DEFAULTS.ground) >= 0.5
    const groundY = p.groundY ?? DEFAULTS.groundY
    const groundColor = state.stringParams.groundColor ?? DEFAULTS.groundColor

    if (showGround && !groundBuilt.current) {
      buildGround(spread, depth, groundY, groundColor)
    } else if (!showGround && groundBuilt.current) {
      if (groundGroup.current && rootRef.current) {
        rootRef.current.remove(groundGroup.current)
        groundGroup.current.traverse((child) => {
          if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose()
          if ((child as THREE.Mesh).material) ((child as THREE.Mesh).material as THREE.Material).dispose()
        })
        groundGroup.current = null
      }
      groundBuilt.current = false
    }

    if (showGround && groundGroup.current) {
      groundGroup.current.position.y = groundY

      // Scroll the ground with the flight displacement, wrapping to one grid cell
      const gStep = (spread * 4) / 40 // grid cell size
      groundGroup.current.position.x = ((dispX % gStep) + gStep) % gStep
      groundGroup.current.position.z = ((dispZ % gStep) + gStep) % gStep

      // Roll rotation follows the accumulated barrel-roll angle
      groundGroup.current.rotation.z = rollAngle

      // Fade ground based on distance effect
      const lineMat = (groundGroup.current.children[0] as THREE.LineSegments)?.material as THREE.LineBasicMaterial
      if (lineMat) {
        lineMat.color.set(groundColor)
      }
    }

    // Flag attributes for GPU upload
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute
    const sizeAttr = geom.getAttribute('aSize') as THREE.BufferAttribute
    const colorAttr = geom.getAttribute('aColor') as THREE.BufferAttribute
    const alphaAttr = geom.getAttribute('aAlpha') as THREE.BufferAttribute
    posAttr.needsUpdate = true
    sizeAttr.needsUpdate = true
    colorAttr.needsUpdate = true
    alphaAttr.needsUpdate = true
  })

  useEffect(() => {
    return () => {
      // Restore default background
      scene.background = new THREE.Color('#0a0a0f')
      if (scene.fog && scene.fog instanceof THREE.Fog) {
        scene.fog.color.set('#0a0a0f')
      }
      if (pointsObj.current && rootRef.current)
        rootRef.current.remove(pointsObj.current)
      geomRef.current?.dispose()
      matRef.current?.dispose()
      if (groundGroup.current && rootRef.current) {
        rootRef.current.remove(groundGroup.current)
        groundGroup.current.traverse((child) => {
          if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose()
          if ((child as THREE.Mesh).material) ((child as THREE.Mesh).material as THREE.Material).dispose()
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <group ref={rootRef} />
}

export const starsInstrument: ObjectInstrumentDef = {
  id: 'stars',
  name: 'Stars',
  kind: 'object',
  userInterfaceRenderer: 'stars',
  params: PARAMS,
  midiRows: [
    { pitch: PITCH_WARP_FWD, label: 'Warp forward (hold)', emphasized: true },
    { pitch: PITCH_WARP_BWD, label: 'Warp backward (hold)' },
    { pitch: PITCH_PULSE, label: 'Radial pulse burst', emphasized: true },
    { pitch: PITCH_TUMBLE, label: 'Tumble spin (hold)' },
    { pitch: PITCH_STREAK, label: 'Streak trails on/off' },
    { pitch: PITCH_BRAKE, label: 'Brake · slow all motion (hold)' },
    { pitch: PITCH_DRIFT_RIGHT, label: 'Drift right (hold)' },
    { pitch: PITCH_DRIFT_LEFT, label: 'Drift left (hold)' },
    { pitch: PITCH_DRIFT_UP, label: 'Drift up (hold)' },
    { pitch: PITCH_DRIFT_DOWN, label: 'Drift down (hold)' },
    { pitch: PITCH_BARREL_CW, label: 'Barrel roll clockwise (hold)' },
    { pitch: PITCH_BARREL_CCW, label: 'Barrel roll counter-clockwise (hold)' },
    { pitch: PITCH_BG_VOID, label: 'Background · Void (hold)', color: '#0a0a0f' },
    { pitch: PITCH_BG_DEEP_SPACE, label: 'Background · Deep Space (hold)', color: '#05051a' },
    { pitch: PITCH_BG_NEBULA, label: 'Background · Nebula (hold)', color: '#1a0a2e' },
    { pitch: PITCH_BG_CRIMSON, label: 'Background · Crimson (hold)', color: '#1a0505' },
    { pitch: PITCH_BG_OCEAN, label: 'Background · Ocean (hold)', color: '#051a1a' },
    { pitch: PITCH_BG_FOREST, label: 'Background · Forest (hold)', color: '#0a1a05' },
    { pitch: PITCH_BG_AMBER, label: 'Background · Amber (hold)', color: '#1a1005' },
    { pitch: PITCH_BG_MIDNIGHT, label: 'Background · Midnight (hold)', color: '#0a0a1f' },
  ],
  component: StarsVisual,
}

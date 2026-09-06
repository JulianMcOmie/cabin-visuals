import { useRef, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import {
  createStarsUniforms, createStarsMotionState, updateStarsMotion, writeStarsPickPositions,
  STARS_VERTEX_SHADER, STARS_FRAGMENT_SHADER, type StarsUniforms, type StarsMotionState,
} from './starsGpu'
import {
  MAX_STARS,
  PITCH_WARP_FWD, PITCH_WARP_BWD, PITCH_DRIFT_RIGHT, PITCH_DRIFT_LEFT, PITCH_DRIFT_UP, PITCH_DRIFT_DOWN,
  PITCH_BARREL_CW, PITCH_BARREL_CCW, PITCH_TUMBLE, PITCH_PULSE, PITCH_BRAKE, PITCH_STREAK,
  BG_THEMES, DEFAULTS,
} from './Stars'

// The Stars visual - the lazy half of ./Stars (see that file's header for what
// this is and why every motion term is closed-form in note age).

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


export function StarsVisual({ trackId }: { trackId: string }) {
  const rootRef = useRef<THREE.Group>(null)
  const { scene } = useThree()
  const bgColorObj = useRef(new THREE.Color(DEFAULTS.bgColor))
  const bgTargetColor = useRef(new THREE.Color(DEFAULTS.bgColor))

  // Scene objects
  const pointsObj = useRef<THREE.Points | null>(null)
  const geomRef = useRef<THREE.BufferGeometry | null>(null)
  const matRef = useRef<THREE.ShaderMaterial | null>(null)

  // Positions and parallax upload on layout changes and occasional coordinate
  // rebases. All regular per-star frame work runs in the shader.
  const uniformsRef = useRef<StarsUniforms | null>(null)
  const motionRef = useRef<StarsMotionState | null>(null)
  const pickGeometryRef = useRef<THREE.BufferGeometry | null>(null)
  // Build tracking
  const builtCount = useRef(0)
  const builtSpread = useRef(0)
  const builtDepth = useRef(0)

  // Ground plane
  const groundGroup = useRef<THREE.Group | null>(null)
  const groundBuilt = useRef(false)

  function build(count: number, spread: number, depth: number) {
    const root = rootRef.current
    if (!root) return

    if (pointsObj.current) root.remove(pointsObj.current)
    geomRef.current?.dispose()
    matRef.current?.dispose()
    pickGeometryRef.current?.dispose()
    pickGeometryRef.current = null

    // Generate the home layout; rendered positions are derived from it each frame
    const initPos = generateStarfield(count, spread, depth)
    const parallax = new Float32Array(count)

    // Fixed per-star parallax from the star's home depth: closer stars move faster.
    // (The old code recomputed parallax from the live z each frame, so stars sped up
    // as they neared the camera; a fixed factor keeps displacement closed-form.)
    const depthHalf = depth / 2
    for (let i = 0; i < count; i++) {
      parallax[i] = depthHalf / (Math.abs(initPos[i * 3 + 2]) + 0.5)
    }

    const motion = createStarsMotionState(initPos, parallax)
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(motion.positions, 3))
    geom.setAttribute('aParallax', new THREE.BufferAttribute(parallax, 1))
    geom.setDrawRange(0, count)
    // Home-position bounds alone miss stars that have moved on the GPU. Every
    // final position is wrapped back into this volume, even after a pulse.
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(spread, spread, depthHalf))

    const uniforms = createStarsUniforms()
    const mat = new THREE.ShaderMaterial({
      vertexShader: STARS_VERTEX_SHADER,
      fragmentShader: STARS_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      userData: { [FORCE_TRANSPARENT_KEY]: true },
      uniforms,
    })

    const pts = new THREE.Points(geom, mat)
    pts.name = 'Stars GPU'
    // Native Points.raycast reads CPU positions. Reconstruct them only when
    // the user picks a star; the separate geometry never enters the renderer.
    let pickPoints: THREE.Points | null = null
    pts.raycast = (raycaster, intersections) => {
      if (!pickPoints) {
        const pickGeometry = new THREE.BufferGeometry()
        pickGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
        pickGeometry.boundingSphere = geom.boundingSphere!.clone()
        pickGeometryRef.current = pickGeometry
        pickPoints = new THREE.Points(pickGeometry, mat)
      }
      writeStarsPickPositions(motion.positions, parallax, uniforms, pickPoints.geometry.attributes.position.array as Float32Array)
      pickPoints.geometry.boundingSphere!.copy(geom.boundingSphere!)
      pickPoints.matrixWorld.copy(pts.matrixWorld)
      const start = intersections.length
      pickPoints.raycast(raycaster, intersections)
      for (let i = start; i < intersections.length; i++) intersections[i].object = pts
    }
    root.add(pts)

    pointsObj.current = pts
    geomRef.current = geom
    matRef.current = mat
    uniformsRef.current = uniforms
    motionRef.current = motion
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
    const uniforms = uniformsRef.current
    const motion = motionRef.current
    if (!geom || !mat || !uniforms || !motion) return false

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

    if (updateStarsMotion(motion, uniforms, {
      displacement: [dispX, dispY, dispZ], spread, depth, pulseAmount,
      rollAngle, tumbleAngle, tumbleAxis: [tax, tay, taz], dotSize, tint,
    })) geom.attributes.position.needsUpdate = true
    geom.boundingSphere!.radius = Math.hypot(spread, spread, depth / 2)

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

  })

  useEffect(() => {
    const root = rootRef.current
    return () => {
      // Restore default background
      scene.background = new THREE.Color('#0a0a0f')
      if (scene.fog && scene.fog instanceof THREE.Fog) {
        scene.fog.color.set('#0a0a0f')
      }
      if (pointsObj.current && root)
        root.remove(pointsObj.current)
      geomRef.current?.dispose()
      matRef.current?.dispose()
      pickGeometryRef.current?.dispose()
      if (groundGroup.current && root) {
        root.remove(groundGroup.current)
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

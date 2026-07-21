import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import {
  BufferGeometry,
  BufferAttribute,
  Group,
  Points,
  ShaderMaterial,
} from 'three'
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js'
import { useInstrumentFrame, beatInBlock } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import type { ObjectInstrumentDef, ParamDef } from './types'

// A noise-warped point tube you fly through, from Bobby Roe's three.js wormhole demo.
// The vertex lattice, the radial noise displacement and the `0.5 - colorNoise` hue ramp
// are the original's verbatim; everything that MOVED had to be rebuilt, because the
// original is a requestAnimationFrame loop and this engine forbids one:
//
//  - `points.rotation.y += 0.005` and `points.position.z += speed` were accumulators.
//    Both are now closed-form in `tSec` (spin = tSec * spin, scroll = a modulo of
//    tSec * speed), so scrubbing to a beat lands on exactly the frame playback shows.
//  - The camera orbit (`camera.position.x = cos(t)`) is gone - the camera belongs to
//    the cameraControl instrument. The tube sways by the negative offset instead,
//    which is the same relative motion from a fixed camera.
//  - `scene.fog = FogExp2` mutated the shared scene, which would have fogged every
//    other track. The same exp2 falloff is computed per-point in the shader and
//    applied to ALPHA, so distant points fade out over whatever is behind them
//    rather than fading toward a hardcoded black.
//  - The 4096-segment cylinder (~528k points, drawn twice) is down to a
//    parameterised lattice defaulting to ~49k, shared by both tubes.
//
// Two tubes chase each other end-to-end; when the leader passes the camera it wraps
// to the back, so the flight never ends. Notes drive a forward lurch and a brightness
// flash, both summed from the note list every frame (never spawned into a ref).

const TUBE_LENGTH = 200
const BASE_RADIUS = 3
// The original's magic numbers, kept as the parameter midpoints.
const HUE_NOISE_FREQ = 0.005
const MAX_RADIAL = 192
const MAX_LENGTH = 768

const vertexShader = `
  attribute vec3 aColor;
  uniform float uSize;
  uniform float uScale;
  uniform float uFogDensity;
  varying vec3 vColor;
  varying float vFog;

  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float dist = max(0.001, -mvPosition.z);
    // FogExp2, exactly as three computes it - but consumed as alpha, not colour.
    float f = uFogDensity * dist;
    vFog = 1.0 - exp(-f * f);
    gl_PointSize = uSize * (uScale / dist);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = `
  uniform float uOpacity;
  uniform float uBrightness;
  uniform float uHue;
  varying vec3 vColor;
  varying float vFog;

  vec3 hueRotate(vec3 color, float turns) {
    vec3 axis = normalize(vec3(1.0));
    float angle = turns * 6.28318530718;
    return color * cos(angle)
      + cross(axis, color) * sin(angle)
      + axis * dot(axis, color) * (1.0 - cos(angle));
  }

  void main() {
    vec2 pc = gl_PointCoord * 2.0 - 1.0;
    float r = dot(pc, pc);
    if (r > 1.0) discard;
    float softEdge = 1.0 - smoothstep(0.45, 1.0, r);
    vec3 c = hueRotate(vColor, uHue) * uBrightness;
    gl_FragColor = vec4(c, uOpacity * softEdge * (1.0 - vFog));
  }
`

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** The original's cylinder lattice, generated directly. CylinderGeometry(openEnded)
 *  lays vertices out as (lengthSeg + 1) rows of (radialSeg + 1) columns; we want the
 *  point positions and nothing else, so building them here skips the index buffer,
 *  normals and UVs the demo allocated and threw away. */
function buildTube(
  radialSeg: number,
  lengthSeg: number,
  noiseFreq: number,
  noiseAmp: number,
): BufferGeometry {
  const noise = new ImprovedNoise()
  const cols = radialSeg + 1
  const rows = lengthSeg + 1
  const count = cols * rows
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)

  let i = 0
  for (let iy = 0; iy < rows; iy++) {
    const v = iy / lengthSeg
    const py = TUBE_LENGTH / 2 - v * TUBE_LENGTH
    for (let ix = 0; ix < cols; ix++) {
      const theta = (ix / radialSeg) * Math.PI * 2
      const px = BASE_RADIUS * Math.sin(theta)
      const pz = BASE_RADIUS * Math.cos(theta)

      // The wobble: noise scales the vertex along its own vector, so the tube wall
      // bulges in and out radially. Only x/z are written back - y stays on its ring,
      // which is what keeps the lattice reading as a tube instead of a cloud.
      const vertexNoise = noise.noise(px * noiseFreq, py * noiseFreq, pz)
      const k = 1 + vertexNoise * noiseAmp
      const nx = px * k
      const ny = py * k
      const nz = pz * k

      const i3 = i * 3
      positions[i3] = nx
      positions[i3 + 1] = py
      positions[i3 + 2] = nz

      // Note the asymmetry, and it is the original's: the colour noise samples the
      // fully displaced y (ny), while the position keeps the undisplaced py. Feeding
      // it py instead visibly flattens the hue banding.
      const colorNoise = noise.noise(nx * HUE_NOISE_FREQ, ny * HUE_NOISE_FREQ, i * 0.001 * HUE_NOISE_FREQ)
      // setHSL(0.5 - colorNoise, 1, 0.5) inlined - the cyan-through-magenta ramp.
      const h = 0.5 - colorNoise
      const hue = h - Math.floor(h)
      const seg = hue * 6
      const x = 1 - Math.abs((seg % 2) - 1)
      let r = 0, g = 0, b = 0
      if (seg < 1) { r = 1; g = x }
      else if (seg < 2) { r = x; g = 1 }
      else if (seg < 3) { g = 1; b = x }
      else if (seg < 4) { g = x; b = 1 }
      else if (seg < 5) { r = x; b = 1 }
      else { r = 1; b = x }
      colors[i3] = r
      colors[i3 + 1] = g
      colors[i3 + 2] = b

      i++
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3))
  geometry.computeBoundingSphere()
  return geometry
}

const PARAMS: ParamDef[] = [
  { key: 'speed', label: 'Flight Speed', min: 0, max: 40, step: 0.5, default: 12 },
  { key: 'spin', label: 'Spin', min: -2, max: 2, step: 0.05, default: 0.3 },
  { key: 'radius', label: 'Tunnel Width', min: 0.5, max: 8, step: 0.1, default: 3 },
  { key: 'viewDistance', label: 'View Distance', min: 0.004, max: 0.08, step: 0.002, default: 0.025 },
  { key: 'dotSize', label: 'Dot Size', min: 0.005, max: 0.2, step: 0.005, default: 0.03 },
  { key: 'brightness', label: 'Brightness', min: 0, max: 3, step: 0.05, default: 1 },
  { key: 'hue', label: 'Hue Shift', min: 0, max: 1, step: 0.01, default: 0 },
  { key: 'sway', label: 'Sway', min: 0, max: 4, step: 0.1, default: 1.5 },
  { key: 'swaySpeed', label: 'Sway Speed', min: 0, max: 4, step: 0.05, default: 1 },
  { key: 'noiseAmount', label: 'Wall Warp', min: 0, max: 2, step: 0.05, default: 0.5 },
  { key: 'noiseScale', label: 'Warp Scale', min: 0.01, max: 0.5, step: 0.01, default: 0.1 },
  { key: 'ringDetail', label: 'Ring Detail', min: 16, max: MAX_RADIAL, step: 8, default: 128 },
  { key: 'lengthDetail', label: 'Length Detail', min: 64, max: MAX_LENGTH, step: 32, default: 384 },
  { key: 'noteThrust', label: 'Note Thrust', min: 0, max: 30, step: 0.5, default: 6 },
  { key: 'noteFlash', label: 'Note Flash', min: 0, max: 2, step: 0.05, default: 0.6 },
  { key: 'noteDecay', label: 'Note Decay (s)', min: 0.05, max: 2, step: 0.05, default: 0.35 },
]

function WormholeVisual({ trackId }: { trackId: string }) {
  const rootRef = useRef<Group>(null)
  const { size, viewport } = useThree()

  const geometryRef = useRef<BufferGeometry | null>(null)
  const tubesRef = useRef<Points[]>([])
  // Signature of the lattice currently built, so a slider that does not affect
  // geometry never pays for a rebuild.
  const builtRef = useRef('')

  const material = useMemo(() => new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uSize: { value: 0.03 },
      uScale: { value: 400 },
      uFogDensity: { value: 0.025 },
      uOpacity: { value: 1 },
      uBrightness: { value: 1 },
      uHue: { value: 0 },
    },
  }), [])

  // These points blend as transparent geometry whatever their opacity; without the
  // flag the opacity wrapper clears `transparent` at opacity 1 and the tube starts
  // occluding itself.
  useEffect(() => {
    material.userData[FORCE_TRANSPARENT_KEY] = true
  }, [material])

  useEffect(() => () => {
    geometryRef.current?.dispose()
    geometryRef.current = null
    tubesRef.current = []
    material.dispose()
  }, [material])

  useInstrumentFrame(trackId, (state) => {
    const root = rootRef.current
    if (!root) return false

    // No block at the playhead = nothing on screen. The tube is an ambient layer,
    // so without this it would fly forever outside its own blocks.
    const inBlock = beatInBlock(state)
    root.visible = inBlock
    if (!inBlock) return

    const p = state.params
    const radialSeg = Math.round(clamp(p.ringDetail ?? 128, 16, MAX_RADIAL))
    const lengthSeg = Math.round(clamp(p.lengthDetail ?? 384, 64, MAX_LENGTH))
    const noiseAmp = p.noiseAmount ?? 0.5
    const noiseFreq = p.noiseScale ?? 0.1

    const signature = `${radialSeg}:${lengthSeg}:${noiseAmp}:${noiseFreq}`
    if (signature !== builtRef.current) {
      const previous = geometryRef.current
      const geometry = buildTube(radialSeg, lengthSeg, noiseFreq, noiseAmp)
      geometryRef.current = geometry

      if (tubesRef.current.length === 0) {
        // Both tubes share one geometry and one material - they differ only by the
        // z offset applied below, so a second copy of ~50k points would be waste.
        for (let i = 0; i < 2; i++) {
          const points = new Points(geometry, material)
          points.rotation.x = Math.PI * 0.5
          points.frustumCulled = false
          root.add(points)
          tubesRef.current.push(points)
        }
      } else {
        for (const tube of tubesRef.current) tube.geometry = geometry
      }
      previous?.dispose()
      builtRef.current = signature
    }

    const tubes = tubesRef.current
    if (tubes.length < 2) return false

    // Beat-time seconds: matches wall time at the project's tempo and freezes with
    // the playhead. Every motion term below is a function of this and nothing else.
    const tSec = state.beat * state.secPerBeat

    // Note response. Thrust is the closed-form integral of a decaying speed bump, so
    // each note leaves a permanent forward offset that eases in over `decay` rather
    // than a velocity we would have to accumulate. Flash is the bump itself.
    const decay = Math.max(0.01, p.noteDecay ?? 0.35)
    const thrustAmount = p.noteThrust ?? 6
    const flashAmount = p.noteFlash ?? 0.6
    let thrust = 0
    let flash = 0
    for (const n of state.notes) {
      const age = (state.beat - n.beat) * state.secPerBeat
      if (age < 0) continue
      const velocity = clamp(n.velocity <= 1 ? n.velocity : n.velocity / 127, 0.05, 1)
      const fall = Math.exp(-age / decay)
      thrust += thrustAmount * velocity * (1 - fall)
      flash += flashAmount * velocity * fall
    }

    const distance = tSec * (p.speed ?? 12) + thrust
    const spin = tSec * (p.spin ?? 0.3)

    // The wrap: two tubes 200 apart on a 400-unit cycle, so as the leader clears the
    // camera it reappears behind the trailer and the seam never enters view.
    const span = TUBE_LENGTH * 2
    for (let i = 0; i < 2; i++) {
      const raw = distance - TUBE_LENGTH * i + TUBE_LENGTH
      const wrapped = ((raw % span) + span) % span
      tubes[i].position.z = wrapped - TUBE_LENGTH
      tubes[i].rotation.y = spin
    }

    // Sway replaces the demo's orbiting camera - equal and opposite, so the tunnel
    // drifts across the view the same way.
    const sway = p.sway ?? 1.5
    const swayPhase = tSec * (p.swaySpeed ?? 1)
    root.position.set(-Math.cos(swayPhase) * sway, -Math.sin(swayPhase) * sway, 0)

    const radiusScale = (p.radius ?? BASE_RADIUS) / BASE_RADIUS
    root.scale.set(radiusScale, radiusScale, 1)

    const uniforms = material.uniforms
    uniforms.uSize.value = p.dotSize ?? 0.03
    // Mirrors three's own point-size attenuation, which is in device pixels - without
    // it the dots would shrink in a high-res export relative to the editor preview.
    uniforms.uScale.value = Math.max(1, size.height * viewport.dpr) * 0.5
    uniforms.uFogDensity.value = p.viewDistance ?? 0.025
    // The engine's opacity wrapper writes material.opacity, which a ShaderMaterial
    // ignores, so the value is pulled from state instead. Caveat: this is the track's
    // opacity, not the per-copy product the wrapper composes - a clone effect's
    // per-copy opacity will not reach these points.
    uniforms.uOpacity.value = state.opacity
    uniforms.uBrightness.value = Math.max(0, (p.brightness ?? 1) + flash)
    uniforms.uHue.value = p.hue ?? 0
  })

  return <group ref={rootRef} />
}

export const wormholeInstrument: ObjectInstrumentDef = {
  id: 'wormhole',
  name: 'Wormhole',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  // Pitch is ignored - every note is the same lurch forward plus a brightness flash,
  // scaled by velocity. Held notes do nothing extra; it is the onset that kicks.
  midiRows: [
    { pitch: 60, label: 'Thrust · lurch + flash', emphasized: true },
  ],
  component: WormholeVisual,
  // The tube has to surround the camera to read as a tunnel, so it opts out of the
  // placement transform the way the other immersive instruments do.
  fullFrame: true,
}

import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import {
  BufferGeometry,
  BufferAttribute,
  Color,
  Group,
  Points,
  ShaderMaterial,
  Vector3,
} from 'three'
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import type { ObjectInstrumentDef, ParamDef } from './types'

// A noise-warped point tube you fly through, from Bobby Roe's three.js wormhole demo.
// The vertex lattice, the radial noise displacement and the hue ramp are the
// original's verbatim; everything that MOVED had to be rebuilt, because the original
// is a requestAnimationFrame loop and this engine forbids one:
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
// DELIBERATELY NOT BLOCK-GATED. Every other ambient instrument here renders nothing
// without a block at the playhead; Julia asked for the opposite on this one, so the
// tunnel flies continuously and the MIDI grid is a pulse-intensity lane instead of an
// on/off region. Blocks still bound where notes live - they just no longer gate the
// tube itself. If this ever needs to go back, `beatInBlock(state)` from
// core/visual/instrumentFrame is the one-line restore.
//
// Two tubes chase each other end-to-end; when the leader passes the camera it wraps
// to the back, so the flight never ends.

const TUBE_LENGTH = 200
const BASE_RADIUS = 3
// The original's magic numbers, kept as the parameter midpoints.
const HUE_NOISE_FREQ = 0.005
const MAX_RADIAL = 192
const MAX_LENGTH = 768

// The pulse ladder: eight contiguous rows, low pitch = subtle, top = full force.
// Contiguous (not a scale) so the grid reads like a fader rather than a keyboard.
const PULSE_LOW = 60
const PULSE_HIGH = 67
// The gaps GROW as you climb, rather than the old equal 0.125 apart which made the
// middle of the grid feel like one indistinct setting.
//
// Note it is the STEPS that are geometric, not the values. Making the values
// geometric (0.125 × r^i) looks equivalent and is not: anchoring row 1 forces the
// first step down to 0.061, BELOW the old 0.125, so rows 2-5 come out quieter than
// they started - gaps that widen, but from a lower floor. Growing the steps from the
// old step size instead keeps every row at least where it was, row 1 exactly where it
// was, and every gap wider than the one beneath it.
const PULSE_BASE = 0.125
const PULSE_GROWTH = 1.32

const vertexShader = `
  attribute float aNoise;
  uniform float uSize;
  uniform float uScale;
  uniform float uFogDensity;
  uniform vec3 uBaseHSL;
  uniform float uSpread;
  varying vec3 vColor;
  varying float vFog;

  float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0 / 2.0) return q;
    if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
    return p;
  }

  // Matches three's Color.setHSL, so the default (#00ffff, spread 1) reproduces the
  // original's setHSL(0.5 - colorNoise, 1, 0.5) ramp exactly.
  vec3 hsl2rgb(float h, float s, float l) {
    h = fract(h);
    if (s <= 0.0) return vec3(l);
    float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
    float p = 2.0 * l - q;
    return vec3(hue2rgb(p, q, h + 1.0 / 3.0), hue2rgb(p, q, h), hue2rgb(p, q, h - 1.0 / 3.0));
  }

  void main() {
    // Hue is the picked colour's, fanned away from it by the baked noise. Spread 0
    // collapses the whole tube to one flat colour; 1 is the full original rainbow.
    vColor = hsl2rgb(uBaseHSL.x - aNoise * uSpread, uBaseHSL.y, uBaseHSL.z);

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
  varying vec3 vColor;
  varying float vFog;

  void main() {
    vec2 pc = gl_PointCoord * 2.0 - 1.0;
    float r = dot(pc, pc);
    if (r > 1.0) discard;
    float softEdge = 1.0 - smoothstep(0.45, 1.0, r);
    gl_FragColor = vec4(vColor * uBrightness, uOpacity * softEdge * (1.0 - vFog));
  }
`

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** The original's cylinder lattice, generated directly. CylinderGeometry(openEnded)
 *  lays vertices out as (lengthSeg + 1) rows of (radialSeg + 1) columns; we want the
 *  point positions and nothing else, so building them here skips the index buffer,
 *  normals and UVs the demo allocated and threw away. Colour is baked as the raw
 *  noise SCALAR, not RGB - the shader turns it into a hue, so recolouring is free. */
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
  const hueNoise = new Float32Array(count)

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
      hueNoise[i] = noise.noise(nx * HUE_NOISE_FREQ, ny * HUE_NOISE_FREQ, i * 0.001 * HUE_NOISE_FREQ)

      i++
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('aNoise', new BufferAttribute(hueNoise, 1))
  geometry.computeBoundingSphere()
  return geometry
}

const PARAMS: ParamDef[] = [
  // Ceiling raised from 40: the Wormhole template pins this to the top, which is
  // a sign the range ran out before the look did. Nothing else needs to change -
  // scroll position is a modulo of the tube's 400-unit cycle, so higher speeds
  // wrap exactly as before rather than running off the end.
  { key: 'speed', label: 'Flight Speed', min: 0, max: 200, step: 1, default: 12 },
  { key: 'spin', label: 'Spin', min: -2, max: 2, step: 0.05, default: 0.3 },
  { key: 'radius', label: 'Tunnel Width', min: 0.5, max: 8, step: 0.1, default: 3 },
  // World units, NOT fog density. This slider used to be the density itself, so
  // dragging it up thickened the fog and you saw LESS - backwards from its label.
  // It is now the distance at which points fade out, and the reciprocal is taken
  // at the uniform. Bigger = see further.
  { key: 'viewDistance', label: 'View Distance', min: 10, max: 250, step: 1, default: 40 },
  { key: 'dotSize', label: 'Dot Size', min: 0.005, max: 0.2, step: 0.005, default: 0.03 },
  { key: 'brightness', label: 'Brightness', min: 0, max: 3, step: 0.05, default: 1 },
  // Cyan at full saturation is HSL(0.5, 1, 0.5) - the exact centre of the original's
  // ramp, so the defaults here are pixel-identical to the demo.
  { key: 'color', label: 'Color', type: 'color', default: '#00ffff' },
  { key: 'colorSpread', label: 'Color Spread', min: 0, max: 1, step: 0.02, default: 1 },
  { key: 'sway', label: 'Sway', min: 0, max: 4, step: 0.1, default: 1.5 },
  { key: 'swaySpeed', label: 'Sway Speed', min: 0, max: 4, step: 0.05, default: 1 },
  { key: 'noiseAmount', label: 'Wall Warp', min: 0, max: 2, step: 0.05, default: 0.5 },
  { key: 'noiseScale', label: 'Warp Scale', min: 0.01, max: 0.5, step: 0.01, default: 0.1 },
  { key: 'ringDetail', label: 'Ring Detail', min: 16, max: MAX_RADIAL, step: 8, default: 128 },
  { key: 'lengthDetail', label: 'Length Detail', min: 64, max: MAX_LENGTH, step: 32, default: 384 },
  // The pulse channels, roughly in order of how strongly they read from INSIDE the
  // tube. Size and Depth were added after Widen alone turned out to be nearly
  // invisible from in there (see the frame callback for why).
  { key: 'pulseSize', label: 'Pulse · Dot Size', min: 0, max: 4, step: 0.05, default: 1.4 },
  { key: 'pulseDepth', label: 'Pulse · See Deeper', min: 0, max: 1, step: 0.02, default: 0.55 },
  { key: 'pulseFlash', label: 'Pulse · Flash', min: 0, max: 4, step: 0.05, default: 1.3 },
  { key: 'pulseWidth', label: 'Pulse · Widen', min: 0, max: 2, step: 0.05, default: 0.4 },
  { key: 'pulseThrust', label: 'Pulse · Thrust', min: 0, max: 30, step: 0.5, default: 2 },
  { key: 'pulseAttack', label: 'Pulse · Attack (s)', min: 0.02, max: 1, step: 0.01, default: 0.12 },
  { key: 'pulseDecay', label: 'Pulse · Decay (s)', min: 0.05, max: 2.5, step: 0.05, default: 0.45 },
]

/** Where a note sits on the ladder. Pitches outside the eight rows clamp in, so notes
 *  pasted from another instrument still land somewhere sensible. */
function pulseStrength(pitch: number): number {
  const row = clamp(pitch, PULSE_LOW, PULSE_HIGH) - PULSE_LOW
  // Row 0 is the base; each row above adds a step, and the steps form a geometric
  // series starting at exactly the old flat step. Summing it closed-form keeps this
  // a pure lookup rather than a loop per note per frame.
  const steps = (Math.pow(PULSE_GROWTH, row) - 1) / (PULSE_GROWTH - 1)
  return PULSE_BASE * (1 + steps)
}

function WormholeVisual({ trackId }: { trackId: string }) {
  const rootRef = useRef<Group>(null)
  const { size, viewport } = useThree()

  const geometryRef = useRef<BufferGeometry | null>(null)
  const tubesRef = useRef<Points[]>([])
  // Signature of the lattice currently built, so a slider that does not affect
  // geometry never pays for a rebuild.
  const builtRef = useRef('')
  const colorRef = useRef(new Color())
  const hslRef = useRef({ h: 0.5, s: 1, l: 0.5 })

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
      uBaseHSL: { value: new Vector3(0.5, 1, 0.5) },
      uSpread: { value: 1 },
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

    // The pulse. Each note's row sets its size, velocity scales it, and the whole
    // thing is summed from the note list every frame - never spawned into a ref - so
    // scrubbing backward reconstructs exactly what playback showed.
    //
    // The envelope is two quadratic arcs meeting at the peak, then nothing. Earlier
    // shapes each failed for their own reason, and the comments are kept because the
    // failures are not obvious from the formulas:
    //   - plain e^(-t/decay) hit 95% magnitude on the note's FIRST frame: a twitch,
    //     with no swell for the eye to follow;
    //   - a double exponential fixed the attack but only rose and sagged;
    //   - a damped spring bounced, but rang for eight zero-crossings, so a note was
    //     still wiggling the tube seconds later under notes unrelated to it;
    //   - one truncated half-cycle of that spring fixed the ringing and the dip, but
    //     welded attack to decay - a single Length scaled both, so a fast hit with a
    //     long tail was not expressible.
    //
    // Two arcs decouple them. Rise is 1-(1-u)², which leaves zero at full speed and
    // eases into the peak; fall is (1-v)², which drops immediately and lands soft.
    // Both stay in [0,1] and meet at exactly 1, so there is still no dip and no
    // discontinuity - only a deliberate corner at the crest, which is what a hit
    // should feel like.
    const thrustAmount = p.pulseThrust ?? 2

    const attackT = Math.max(0.02, p.pulseAttack ?? 0.12)
    const decayT = Math.max(0.05, p.pulseDecay ?? 0.45)
    const totalT = attackT + decayT
    // ∫ of the two arcs over their full spans: 2A/3 from the rise, D/3 from the fall.
    // Dividing by it lands thrust on exactly its full offset as the pulse ends.
    const cumTotal = (2 * attackT + decayT) / 3

    let thrust = 0
    let pulse = 0
    for (const n of state.notes) {
      const age = (state.beat - n.beat) * state.secPerBeat
      if (age < 0) continue
      const velocity = clamp(n.velocity <= 1 ? n.velocity : n.velocity / 127, 0.05, 1)
      const strength = pulseStrength(n.pitch) * velocity
      // Past its span a note is inert: it keeps the forward ground it took and stops
      // contributing to the visual pulse entirely. Also makes old notes near-free.
      if (age >= totalT) {
        thrust += thrustAmount * strength
        continue
      }
      let env: number
      let cum: number
      if (age < attackT) {
        const u = age / attackT
        const inv = 1 - u
        env = 1 - inv * inv
        cum = attackT * (u + (inv * inv * inv) / 3 - 1 / 3)
      } else {
        const v = (age - attackT) / decayT
        const inv = 1 - v
        env = inv * inv
        cum = (2 * attackT) / 3 + (decayT / 3) * (1 - inv * inv * inv)
      }
      pulse += strength * env
      thrust += thrustAmount * strength * (cum / cumTotal)
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

    // Widening alone barely registers from INSIDE the tube: the far end sits at the
    // vanishing point whatever the radius, so a radial scale only moves the near wall,
    // which is the most fogged, most off-frame part of the shot. That is why the pulse
    // originally read as pure forward motion. It now drives dot size, fog depth and
    // brightness too - all of which change what fills the CENTRE of frame - and Widen
    // is demoted to a supporting channel.
    //
    // `pulse` is non-negative now that the envelope is a half-wave, so these channel
    // multipliers only ever swell above 1. The floors are kept as cheap guards against
    // an inverted tube or a zeroed fog divisor if the envelope is ever reshaped again.
    const radiusScale = ((p.radius ?? BASE_RADIUS) / BASE_RADIUS)
      * Math.max(0.1, 1 + pulse * (p.pulseWidth ?? 0.4))
    root.scale.set(radiusScale, radiusScale, 1)

    const uniforms = material.uniforms
    // Dot size is the strongest pulse channel by a distance - every point in frame
    // swells at once, including the dense ones near the vanishing point.
    uniforms.uSize.value = (p.dotSize ?? 0.03) * Math.max(0.05, 1 + pulse * (p.pulseSize ?? 1.4))
    // Mirrors three's own point-size attenuation, which is in device pixels - without
    // it the dots would shrink in a high-res export relative to the editor preview.
    uniforms.uScale.value = Math.max(1, size.height * viewport.dpr) * 0.5
    // A pulse pushes the view further out, so the far wall rushes into view and falls
    // back. Reads as the tube inhaling, and costs nothing but a uniform.
    //
    // The shader wants FogExp2 density, which is the reciprocal of a distance - so the
    // slider is inverted here rather than in the slider itself. Both terms therefore
    // read the right way round: a bigger View Distance and a bigger pulse both mean
    // seeing further, where before both were divisors and meant the opposite.
    const seeDistance = (p.viewDistance ?? 40) * Math.max(0.15, 1 + pulse * (p.pulseDepth ?? 0.55))
    uniforms.uFogDensity.value = 1 / Math.max(1, seeDistance)
    // The engine's opacity wrapper writes material.opacity, which a ShaderMaterial
    // ignores, so the value is pulled from state instead. Caveat: this is the track's
    // opacity, not the per-copy product the wrapper composes - a clone effect's
    // per-copy opacity will not reach these points.
    uniforms.uOpacity.value = state.opacity
    uniforms.uBrightness.value = Math.max(0, (p.brightness ?? 1) * (1 + pulse * (p.pulseFlash ?? 1.3)))

    const hsl = colorRef.current.set(state.stringParams.color ?? '#00ffff').getHSL(hslRef.current)
    ;(uniforms.uBaseHSL.value as Vector3).set(hsl.h, hsl.s, hsl.l)
    uniforms.uSpread.value = p.colorSpread ?? 1
  })

  return <group ref={rootRef} />
}

export const wormholeInstrument: ObjectInstrumentDef = {
  id: 'wormhole',
  name: 'Wormhole',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  // An intensity ladder, not a keyboard: the row sets how hard the tunnel throbs,
  // velocity scales it further. Eight contiguous rows so the grid reads like a fader,
  // coloured cool-to-hot to match. Notes outside the range clamp to the nearest row.
  midiRows: [
    { pitch: 67, label: 'Pulse 8 · full force', color: '#db2777' },
    { pitch: 66, label: 'Pulse 7', color: '#dc2626' },
    { pitch: 65, label: 'Pulse 6', color: '#ea580c' },
    { pitch: 64, label: 'Pulse 5', color: '#ca8a04' },
    { pitch: 63, label: 'Pulse 4', color: '#059669' },
    { pitch: 62, label: 'Pulse 3', color: '#0891b2' },
    { pitch: 61, label: 'Pulse 2', color: '#1d4ed8' },
    { pitch: 60, label: 'Pulse 1 · subtle', color: '#1e3a8a', emphasized: true },
  ],
  component: WormholeVisual,
  // The tube has to surround the camera to read as a tunnel, so it opts out of the
  // placement transform the way the other immersive instruments do.
  fullFrame: true,
}

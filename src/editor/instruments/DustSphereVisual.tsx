import { useEffect, useMemo } from 'react'
import {
  BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, Sphere, Vector3, Vector4,
  type Intersection, type Raycaster,
} from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { previewParticleCount } from '../core/visual/liveParticleBudget'
import { midiVelocity } from '../utils/midiVelocity'
import { paramDefault, stringParamDefault } from './types'
import { DUST_SPHERE_MAX_GRAINS, DUST_SPHERE_RADIUS, dustSphereInstrument } from './DustSphere'
import {
  buildDustDirections, collectDustSpheres, dustGrainSpacing, dustSphereLifeBeats, dustSphereSeed,
} from './dustSphereCore'

// Every grain is one GL point whose whole life is computed in the vertex shader
// from (its direction on the ball, the sphere's age in beats). Nothing is
// integrated and nothing is uploaded per frame - a frame is a handful of
// uniforms - which is what lets one sphere be a million grains, and what keeps
// scrub == playback == export for free.

/** Spheres that can be crumbling at once; older ones are dropped past this. */
const MAX_SPHERES = 8

/** The preview particle budget (core/visual/particleBudget.ts) is sized for
 *  instruments that place each particle on the CPU. A grain here costs a vertex
 *  shader run and nothing else, so the same quality setting buys this many
 *  times more of them - still honouring Fast/Fastest, just from a base that
 *  leaves a ball rather than a sprinkle. Final and export are unlimited. */
const GPU_BUDGET_SCALE = 32

// ── The grain directions: one buffer for every Dust Sphere in the app ────────
// Three keys GL buffers by BufferAttribute, so every mount's geometry pointing
// at this one attribute shares one upload (12 bytes a grain). Each mount still
// owns its GEOMETRY, because the draw range lives there and two tracks may ask
// for different counts.
const sharedGrains = { attribute: null as BufferAttribute | null, users: 0 }

function grainAttribute(count: number): BufferAttribute {
  const current = sharedGrains.attribute
  if (current && current.count >= count) return current
  // Grow in powers of two so dragging the GRAINS knob does not rebuild per tick.
  const size = Math.min(DUST_SPHERE_MAX_GRAINS, 2 ** Math.ceil(Math.log2(Math.max(1024, count))))
  sharedGrains.attribute = new BufferAttribute(buildDustDirections(size), 3)
  return sharedGrains.attribute
}

const VERTEX_SHADER = /* glsl */ `
uniform vec3 uCenter;
uniform float uAge;
uniform float uSeed;
uniform float uBright;
uniform vec3 uColor;
uniform vec3 uEmber;
uniform vec3 uWind;
uniform float uGlow;
uniform float uRadius;
uniform float uGrain;
uniform float uDissolve;
uniform float uLife;
uniform float uDrift;
uniform float uTurb;
uniform float uViewportHeight;
varying vec3 vColor;

float hash13(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

float valueNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

void main() {
  vec3 dir = position;
  float r1 = hash13(dir * 37.0 + uSeed);
  float r2 = hash13(dir * 53.0 + uSeed + 11.0);
  float r3 = hash13(dir * 71.0 + uSeed + 23.0);

  // The front starts on the DOWNWIND side - those grains have nothing behind
  // them to hold them - and crosses the ball against the wind. Low-frequency
  // noise tears its edge into tongues; the per-grain term frays it.
  float front = 0.5 - 0.5 * dot(dir, uWind);
  front = clamp(front * 0.7 + valueNoise(dir * 3.5 + uSeed) * 0.3 + (r1 - 0.5) * 0.05, 0.0, 1.0);
  float sinceFree = uAge - front * uDissolve;
  float t = max(sinceFree, 0.0);
  float isFree = step(0.0, sinceFree);

  // uLife is the longest-lived grain; the rest go sooner, which is the fade -
  // the cloud thins grain by grain rather than dimming as a sheet.
  float life = uLife * (0.35 + 0.65 * r2);
  float spent = t / life;
  if (spent >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }

  // Everything below is zero at t = 0, so a grain leaves from exactly where it
  // sat. 'travel' eases in and then runs linear: a grain is picked up, not shot.
  float travel = t * t / (t + 0.4);
  vec3 q = dir * 2.5 + uSeed;
  vec3 swirl = vec3(
    sin(q.y * 2.3 + t * 1.7 + r1 * 6.2832) + 0.5 * sin(q.z * 5.1 - t * 2.9),
    sin(q.z * 2.1 + t * 1.3 + r2 * 6.2832) + 0.5 * sin(q.x * 4.7 + t * 2.3),
    sin(q.x * 2.7 - t * 1.1 + r3 * 6.2832) + 0.5 * sin(q.y * 5.3 + t * 3.1));
  vec3 p = uCenter + dir * uRadius
    + uWind * uDrift * travel * (0.45 + 0.9 * r3)
    + swirl * uTurb * 0.35 * travel
    + dir * uRadius * 0.3 * r1 * (1.0 - exp(-t * 3.0));

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  // Grains are sized in WORLD units and projected by hand, so the ball is as
  // solid in a 4K export or a half-res effect pass as in the preview. Intact
  // grains are uniform (that is what closes the surface); free ones vary and
  // shrink away.
  float size = uGrain * mix(1.0, (0.55 + 0.9 * r1) * pow(1.0 - spent, 0.6), isFree);
  float worldScale = length(modelMatrix[0].xyz);
  gl_PointSize = size * worldScale * projectionMatrix[1][1] * uViewportHeight * 0.5 / max(-mv.z, 0.001);

  // View-space key light: enough form to read as a ball in the instant before
  // it goes, with no dependence on the scene's light tracks.
  vec3 n = normalize(normalMatrix * dir);
  float shade = 0.3 + 0.7 * max(dot(n, normalize(vec3(-0.45, 0.6, 0.65))), 0.0);
  // The burn line: grains heat up just before they let go and cool as they fly.
  float heat = mix(0.8 * smoothstep(-0.12, 0.0, sinceFree), exp(-t * 3.5), isFree);
  vec3 dust = uColor * shade * uBright * mix(1.0, 0.8, spent);
  vColor = mix(dust, uEmber * (1.0 + uGlow), heat);
}
`

const FRAGMENT_SHADER = /* glsl */ `
varying vec3 vColor;
uniform float uOpacity;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  if (dot(c, c) > 1.0) discard;
  gl_FragColor = vec4(vColor, uOpacity);
}
`

interface Slot {
  points: Points
  material: ShaderMaterial
  center: Vector3
  age: { value: number }
  seed: { value: number }
  bright: { value: number }
}

function createRig() {
  // Shared by every slot: one write reaches all eight materials.
  const shared = {
    uColor: { value: new Color() },
    uEmber: { value: new Color() },
    uWind: { value: new Vector3(1, 0, 0) },
    uGlow: { value: 0 },
    uRadius: { value: DUST_SPHERE_RADIUS },
    uGrain: { value: 0.01 },
    uDissolve: { value: 1 },
    uLife: { value: 1 },
    uDrift: { value: 1 },
    uTurb: { value: 0 },
    uViewportHeight: { value: 1080 },
  }
  const geometry = new BufferGeometry()
  const viewport = new Vector4()
  const pickSphere = new Sphere()
  const pickPoint = new Vector3()

  const slots: Slot[] = Array.from({ length: MAX_SPHERES }, () => {
    const center = new Vector3()
    const age = { value: 0 }
    const seed = { value: 0 }
    const bright = { value: 1 }
    // Opaque and depth-writing on purpose: dust is flecks, not light. The
    // front of the ball hides its back until the front has gone, and a million
    // grains cost no blending. The placement wrapper flips `transparent` and
    // feeds uOpacity when the track itself fades.
    const material = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: { ...shared, uCenter: { value: center }, uAge: age, uSeed: seed, uBright: bright, uOpacity: { value: 1 } },
    })
    material.onBeforeRender = (renderer) => {
      // The pass being drawn, not the canvas: offscreen effect rigs and the
      // export target have their own heights.
      shared.uViewportHeight.value = Math.max(1, renderer.getCurrentViewport(viewport).w)
      material.uniformsNeedUpdate = true
    }
    const points = new Points(geometry, material)
    points.name = 'Dust Sphere'
    points.frustumCulled = false
    points.visible = false
    // Points.raycast would walk a million CPU positions that are not where the
    // grains are drawn anyway. Pick the ball itself.
    points.raycast = (raycaster: Raycaster, intersections: Intersection[]) => {
      if (!points.visible) return
      pickSphere.set(center, DUST_SPHERE_RADIUS).applyMatrix4(points.matrixWorld)
      if (!raycaster.ray.intersectSphere(pickSphere, pickPoint)) return
      const distance = raycaster.ray.origin.distanceTo(pickPoint)
      if (distance < raycaster.near || distance > raycaster.far) return
      intersections.push({ distance, point: pickPoint.clone(), object: points })
    }
    return { points, material, center, age, seed, bright }
  })
  return { shared, geometry, slots }
}

export function DustSphereVisual({ trackId }: { trackId: string }) {
  const rig = useMemo(createRig, [])

  useEffect(() => {
    sharedGrains.users++
    return () => {
      rig.geometry.dispose()
      for (const slot of rig.slots) slot.material.dispose()
      if (--sharedGrains.users === 0) sharedGrains.attribute = null
    }
  }, [rig])

  useInstrumentFrame(trackId, (state) => {
    const { shared, geometry, slots } = rig
    const par = state.params
    const read = (key: string) => par[key] ?? paramDefault(dustSphereInstrument, key)

    const dissolve = Math.max(0.01, read('dissolve'))
    const life = Math.max(0.01, read('life'))
    const spheres = collectDustSpheres(state, dustSphereLifeBeats(dissolve, life), MAX_SPHERES)
    for (let i = 0; i < slots.length; i++) slots[i].points.visible = i < spheres.length
    if (spheres.length === 0) return

    const requested = Math.max(1, Math.min(Math.round(read('count')), DUST_SPHERE_MAX_GRAINS))
    const grains = Math.min(requested, previewParticleCount(Math.ceil(requested / GPU_BUDGET_SCALE)) * GPU_BUDGET_SCALE)
    const attribute = grainAttribute(grains)
    if (geometry.getAttribute('position') !== attribute) geometry.setAttribute('position', attribute)
    geometry.setDrawRange(0, grains)

    shared.uColor.value.set(state.stringParams.color || stringParamDefault(dustSphereInstrument, 'color'))
    shared.uEmber.value.set(state.stringParams.ember || stringParamDefault(dustSphereInstrument, 'ember'))
    const wind = read('windAngle') * Math.PI / 180
    shared.uWind.value.set(Math.cos(wind), Math.sin(wind), 0)
    shared.uGlow.value = read('glow')
    // A multiple of the spacing at the count ACTUALLY drawn: a budgeted
    // preview shows coarser dust, never a ball with holes in it.
    shared.uGrain.value = DUST_SPHERE_RADIUS * dustGrainSpacing(grains) * read('grain')
    shared.uDissolve.value = dissolve
    shared.uLife.value = life
    shared.uDrift.value = read('drift')
    shared.uTurb.value = read('turbulence')

    const spread = read('spread')
    for (let i = 0; i < spheres.length; i++) {
      const sphere = spheres[i]
      const slot = slots[i]
      slot.center.set(sphere.x * spread, sphere.y * spread, sphere.z * spread)
      slot.age.value = state.beat - sphere.beat
      slot.seed.value = dustSphereSeed(sphere)
      slot.bright.value = 0.4 + 0.6 * Math.min(1, midiVelocity(sphere.velocity))
    }
  })

  return (
    <group>
      {rig.slots.map((slot, i) => <primitive key={i} object={slot.points} />)}
    </group>
  )
}

import { useMemo, useRef, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import {
  InstancedMesh, InstancedBufferAttribute, PlaneGeometry, MeshBasicMaterial,
  Object3D, Color, CanvasTexture, AdditiveBlending,
} from 'three'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import {
  INSTANCES_PER_DROP, MAX_ACTIVE_DROPS, MAX_ARMS, MAX_BEADS, MAX_DROPLETS,
  WATER_DROP_LEVELS, WATER_DROP_PITCH_MIN,
  collectLiveDrops, waterDropHeight,
} from './waterDropCore'
import { paramDefault, type MidiRowDef, type ObjectInstrumentDef, type ParamDef } from './types'

// Water Drop: each note is a drop of ink released into still water.
//
// The gesture is *release then diffuse*, not *explode*: a compact bead appears,
// throws a crown of tendrils outward, and the tendrils curl, thin, and dissolve.
// Particle Burst already owns "explode"; this one is deliberately slower and
// wetter, and its silhouette is a filled organic blob rather than a dust cloud.
//
// PITCH IS ALTITUDE. Eleven rows, one per height, spread evenly over
// `heightSpan` - so a rising line in the piano roll is a rising line on stage
// and the track plays like a vertical instrument. Nothing else about the drop
// changes with pitch; velocity owns size and density instead.
//
// The blob is a cluster of overlapping soft discs (see makeInkTexture): no
// silhouette of their own, so neighbours dissolve into one continuous mass with
// a wobbly outline - the edge quality liquid has. A raymarched SDF would be
// prettier and far more expensive for something that has to run 10 at a time.
//
// Everything is derived fresh from the note stream each frame (age = beats
// since onset), so there is no spawn-time state and scrub == playback.

// The "which drops exist, and how high" half lives in ./waterDropCore so it can
// be tested without dragging the engine in through `instrumentFrame`.

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const TAU = Math.PI * 2

const PARAMS: ParamDef[] = [
  { key: 'color', label: 'Ink', type: 'color', default: '#2f8fff' },
  { key: 'tipColor', label: 'Tendril Tips', type: 'color', default: '#bff3ff' },
  // Defaults are sized for the editor's default camera (z = 5, 55° fov, so
  // roughly 5 world units of visible height at the origin): the ladder fits
  // inside the frame and one drop reads as an object, not as weather.
  { key: 'heightSpan', label: 'Pitch Height Span', min: 0, max: 20, step: 0.25, default: 3.6 },
  { key: 'dropSize', label: 'Drop Size', min: 0.02, max: 1, step: 0.01, default: 0.09 },
  { key: 'spread', label: 'Spread', min: 0.2, max: 8, step: 0.1, default: 1.1 },
  { key: 'lifetime', label: 'Lifetime (s)', min: 0.5, max: 12, step: 0.25, default: 3 },
  { key: 'arms', label: 'Tendrils', min: 3, max: MAX_ARMS, step: 1, default: 12 },
  { key: 'beads', label: 'Tendril Length', min: 1, max: MAX_BEADS, step: 1, default: 5 },
  { key: 'wobble', label: 'Curl', min: 0, max: 2, step: 0.05, default: 0.9 },
  { key: 'droplets', label: 'Droplets', min: 0, max: MAX_DROPLETS, step: 1, default: 6 },
  { key: 'drift', label: 'Drift', min: -4, max: 4, step: 0.1, default: 0.35 },
  { key: 'scatter', label: 'Scatter', min: 0, max: 8, step: 0.1, default: 0.7 },
  { key: 'fadePower', label: 'Fade', min: 0.3, max: 3, step: 0.05, default: 1.3 },
  { key: 'density', label: 'Density', min: 0.05, max: 1, step: 0.01, default: 0.4 },
]

/**
 * The soft round bead every drop is built out of: a radial gradient baked to a
 * texture once, drawn on camera-facing quads.
 *
 * Spheres were the obvious choice and they look wrong - a tessellated sphere
 * has a hard polygon silhouette, so a cluster of them reads as a bag of
 * marbles. A disc with no silhouette at all lets neighbouring beads dissolve
 * into one another, which is what makes the cluster read as liquid. It is also
 * far cheaper: two triangles instead of ~160.
 *
 * The gradient is baked rather than computed in a patched shader. Editing
 * three's own GLSL through `onBeforeCompile` is a chain of silent failures -
 * `uv` is not even declared unless the material carries a map, and a bad
 * `smoothstep` argument order is undefined rather than an error - and every one
 * of them fails to a plain opaque quad with nothing logged. A texture cannot
 * fail that way.
 */
function makeInkTexture(): CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  // Solid core, long soft shoulder, zero at the rim. The wide shoulder is what
  // blends overlapping beads into one continuous mass.
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.92)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

/**
 * Per-instance opacity is folded into the instance COLOUR rather than carried
 * as its own attribute, because instancing gives us RGB and no alpha. That
 * choice forces additive blending: with normal blending a faded bead would
 * darken toward black instead of disappearing. Additive suits the instrument -
 * ink lit from within, and overlapping tendrils thicken where they cross.
 */
function makeInkMaterial(texture: CanvasTexture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map: texture,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  })
}

function WaterDropVisual({ trackId }: { trackId: string }) {
  const meshRef = useRef<InstancedMesh>(null)
  const { camera } = useThree()

  const maxInstances = INSTANCES_PER_DROP * MAX_ACTIVE_DROPS
  const dummy = useMemo(() => new Object3D(), [])
  const inkColor = useMemo(() => new Color(), [])
  const tipColor = useMemo(() => new Color(), [])
  const beadColor = useMemo(() => new Color(), [])
  const colorArr = useMemo(() => new Float32Array(maxInstances * 3), [maxInstances])
  const geometry = useMemo(() => {
    // A unit quad; each instance scales it to the bead's diameter and takes the
    // camera's orientation, so the soft disc always faces the viewer.
    const g = new PlaneGeometry(1, 1)
    g.setAttribute('color', new InstancedBufferAttribute(new Float32Array(maxInstances * 3), 3))
    return g
  }, [maxInstances])
  const texture = useMemo(() => makeInkTexture(), [])
  const material = useMemo(() => makeInkMaterial(texture), [texture])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
    texture.dispose()
  }, [geometry, material, texture])

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    if (!mesh) return false

    // Fallbacks read the schema rather than repeating its numbers: a track
    // whose params predate a new key (or was built without any) must land on
    // the SAME value the panel shows, or the instrument silently renders at
    // settings no slider is displaying.
    const par = state.params
    const num = (key: string) => par[key] ?? paramDefault(waterDropInstrument, key)
    const heightSpan = num('heightSpan')
    const dropSize = num('dropSize')
    const spread = num('spread')
    const lifetime = Math.max(0.05, num('lifetime'))
    const arms = Math.max(1, Math.min(MAX_ARMS, Math.round(num('arms'))))
    const beads = Math.max(1, Math.min(MAX_BEADS, Math.round(num('beads'))))
    const wobble = num('wobble')
    const droplets = Math.max(0, Math.min(MAX_DROPLETS, Math.round(num('droplets'))))
    const drift = num('drift')
    const scatter = num('scatter')
    const fadePower = num('fadePower')
    const density = num('density') * state.opacity

    const drops = state.blackedOut ? [] : collectLiveDrops(state, lifetime)
    if (drops.length === 0 || density <= 0.001) {
      mesh.count = 0
      return
    }

    inkColor.set(state.stringParams.color ?? '#2f8fff')
    tipColor.set(state.stringParams.tipColor ?? '#bff3ff')

    let cursor = 0
    const push = (x: number, y: number, z: number, radius: number, alpha: number, mix: number) => {
      if (alpha <= 0.004 || radius <= 0.0005) return
      dummy.position.set(x, y, z)
      // The quad faces the camera; `radius` is a radius, the quad is a diameter
      // across, and the soft shoulder eats the outer edge - so scale generously.
      dummy.quaternion.copy(camera.quaternion)
      dummy.scale.setScalar(radius * 2.6)
      dummy.updateMatrix()
      mesh.setMatrixAt(cursor, dummy.matrix)
      // Alpha rides in the colour (see makeInkMaterial): under additive
      // blending, dimming IS fading.
      beadColor.copy(inkColor).lerp(tipColor, mix).multiplyScalar(alpha)
      colorArr[cursor * 3] = beadColor.r
      colorArr[cursor * 3 + 1] = beadColor.g
      colorArr[cursor * 3 + 2] = beadColor.b
      cursor++
    }

    for (const drop of drops) {
      const { t, seed } = drop
      // Diffusion, not ballistics: nearly all of the reach happens early and
      // then the front creeps, the way a dye front slows as it dilutes.
      const e = 1 - Math.pow(1 - t, 2.6)
      const fade = Math.pow(1 - t, fadePower) * density
      if (fade <= 0.004) continue

      // Velocity buys mass: a hard note is a bigger bead that throws further.
      const sizeMul = 0.55 + 0.75 * drop.velocity
      const reach = spread * sizeMul

      const cx = (seededRand(seed + 1) - 0.5) * 2 * scatter
      const cz = (seededRand(seed + 2) - 0.5) * 2 * scatter
      // Pitch owns height exactly - no jitter here, or the eleven rows stop
      // reading as a ladder. Drift then carries the whole blob up or down,
      // decelerating like something losing buoyancy.
      const cy = waterDropHeight(drop.pitch, heightSpan) + drift * (1 - Math.pow(1 - t, 2))

      // The core bead: swells as it lets go of its ink, then dissolves.
      push(cx, cy, cz, dropSize * sizeMul * (0.85 + 0.9 * e), fade * 0.95, 0)

      // One seeded rotation per drop keeps the fibonacci crown from being the
      // same crown every time while the arms stay evenly spaced within a drop.
      const spin = seededRand(seed + 3) * TAU
      const cosSpin = Math.cos(spin)
      const sinSpin = Math.sin(spin)

      for (let a = 0; a < arms; a++) {
        const ay = arms === 1 ? 0 : 1 - (a / (arms - 1)) * 2
        const ar = Math.sqrt(Math.max(0, 1 - ay * ay))
        const ath = GOLDEN_ANGLE * a
        const rawX = Math.cos(ath) * ar
        const rawZ = Math.sin(ath) * ar
        const dx = rawX * cosSpin - rawZ * sinSpin
        const dy = ay
        const dz = rawX * sinSpin + rawZ * cosSpin

        // A tangent frame for the curl. Any perpendicular pair will do; the
        // seeded phase below is what decorrelates the arms. `up` swaps to +X
        // near the poles, where cross(dir, +Y) degenerates. (Both candidates
        // have z = 0, which is why t1 below drops the upZ terms.)
        const upX = Math.abs(dy) < 0.95 ? 0 : 1
        const upY = Math.abs(dy) < 0.95 ? 1 : 0
        let t1x = -dz * upY, t1y = dz * upX, t1z = dx * upY - dy * upX
        const t1Len = Math.hypot(t1x, t1y, t1z) || 1
        t1x /= t1Len; t1y /= t1Len; t1z /= t1Len
        const t2x = dy * t1z - dz * t1y
        const t2y = dz * t1x - dx * t1z
        const t2z = dx * t1y - dy * t1x

        const armLen = reach * (0.45 + 0.55 * seededRand(seed + a * 5 + 11))
        const phase = seededRand(seed + a * 5 + 12) * TAU
        const armThin = 0.7 + 0.6 * seededRand(seed + a * 5 + 13)

        for (let b = 0; b < beads; b++) {
          const f = (b + 1) / beads          // 0..1 along the tendril
          const dist = armLen * e * f
          // Curl grows toward the tip and keeps turning as the drop ages, so a
          // straight crown becomes a tangle rather than a starburst.
          const swirl = phase + f * 3.4 + e * 2.4
          const amp = wobble * armLen * f * f * 0.32
          const ox = Math.cos(swirl) * amp
          const oz = Math.sin(swirl) * amp
          const x = cx + dx * dist + t1x * ox + t2x * oz
          const y = cy + dy * dist + t1y * ox + t2y * oz
          const z = cz + dz * dist + t1z * ox + t2z * oz
          const radius = dropSize * sizeMul * armThin * (0.85 - 0.45 * f) * (0.55 + 0.75 * e)
          push(x, y, z, radius, fade * (1 - 0.5 * f), f * 0.55)
        }
      }

      // Droplets: thrown clear on impact, decelerating harder than the tendrils
      // and gone sooner. They are what sells the moment of release.
      for (let d = 0; d < droplets; d++) {
        const s = seed + d * 7 + 101
        const dTheta = seededRand(s) * TAU
        const dPhi = Math.acos(2 * seededRand(s + 1) - 1)
        const sinP = Math.sin(dPhi)
        const dist = reach * (1.15 + 0.65 * seededRand(s + 2)) * (1 - Math.pow(1 - t, 3.4))
        const x = cx + sinP * Math.cos(dTheta) * dist
        const y = cy + Math.cos(dPhi) * dist
        const z = cz + sinP * Math.sin(dTheta) * dist
        const radius = dropSize * sizeMul * (0.16 + 0.2 * seededRand(s + 3))
        push(x, y, z, radius, fade * Math.pow(1 - t, 1.2), 1)
      }
    }

    mesh.count = cursor
    mesh.instanceMatrix.needsUpdate = true
    const colorAttr = mesh.geometry.getAttribute('color') as InstancedBufferAttribute
    if (colorAttr) {
      ;(colorAttr.array as Float32Array).set(colorArr.subarray(0, cursor * 3))
      colorAttr.needsUpdate = true
    }
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, maxInstances]}
      frustumCulled={false}
      renderOrder={6}
    />
  )
}

// Eleven rows, top of the list = top of the stage. The color ramp is the same
// deep-to-shallow read a body of water has, so the piano roll shows altitude
// before you read a single label.
const ROW_COLORS = [
  '#1e3a8a', '#1b4bab', '#185ec7', '#1471dd', '#1084ea', '#0b97f0',
  '#0aa9ef', '#17bbea', '#35cce4', '#62dbe2', '#9aeae6',
]

const WATER_DROP_ROWS: MidiRowDef[] = Array.from({ length: WATER_DROP_LEVELS }, (_, i) => {
  const level = WATER_DROP_LEVELS - 1 - i  // first entry renders at the top
  return {
    pitch: WATER_DROP_PITCH_MIN + level,
    label: level === WATER_DROP_LEVELS - 1
      ? 'Drop · height 11 (top)'
      : level === 0
        ? 'Drop · height 1 (bottom)'
        : `Drop · height ${level + 1}`,
    color: ROW_COLORS[level],
    emphasized: level === 0,
  }
})

export const waterDropInstrument: ObjectInstrumentDef = {
  id: 'waterDrop',
  name: 'Water Drop',
  kind: 'object',
  identityColor: { param: 'color' },
  params: PARAMS,
  userInterfaceRenderer: 'parameters',
  midiRows: WATER_DROP_ROWS,
  component: WaterDropVisual,
}

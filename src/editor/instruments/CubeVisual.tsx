import { useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, Color, Euler, Group, Matrix4, Mesh, MeshPhysicalMaterial, Quaternion, Vector3 } from 'three'
import { InstancedMesh2 } from '@three.ez/instanced-mesh'
import { cubeSpinRotation } from '../core/visual/cubeSpin'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { useInstancedCopyFrame } from '../core/visual/instancedFrame'
import type { ObjectState } from '../core/visual/types'
import {
  FUNDAMENTAL_MATERIAL_PROPS,
  FundamentalMesh,
  SIDED_GEOMETRIES,
  TUBED_GEOMETRIES,
  applyFundamentalSurface,
  buildFundamentalGeometry,
  normalizeFundamentalGeometry,
  normalizeSides,
  type FundamentalGeometryId,
} from './FundamentalGeometry'
import { createInstancedPosterMaterial, createPosterMaterial } from './posterShading'
import { paramDefault } from './types'
import { DEFAULT_BASE_COLOR, cubeInstrument } from './Cube'

// The 3D Shape visual - the lazy half of ./Cube (see that file for the def:
// params, rows, the Shatter ability and the local transform).

// Eight evenly distributed directions for the fragments to fly along.
const CORNERS: [number, number, number][] = [
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
  [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
]

/** Shatter: sample this track's Shatter lane at the current beat - a pure
 * function of the beat, so scrubbing mirrors playback exactly. The burst is MAX
 * at the note onset and decays back over the note (the cube flies apart, then
 * reassembles), so the on-grid beat you actually land on when scrubbing (the
 * playhead snaps to 1/4 beat) is the peak - not a zero-crossing. Overlapping
 * notes take the strongest. Shared by both render paths so they cannot drift. */
function shatterAt(state: ObjectState): { a: number; spread: number } {
  const beat = state.beat
  const events = state.abilityEvents.get('shatter') ?? []
  let a = 0
  let vel = 0
  for (const n of events) {
    const dur = n.durationBeats || 0.5
    if (beat >= n.beat && beat < n.beat + dur) {
      const env = Math.pow(1 - (beat - n.beat) / dur, 1.3)
      if (env > a) { a = env; vel = n.velocity }
    }
  }
  const nvel = vel <= 1 ? vel : vel / 127 // tolerate 0–1 or 0–127 velocity scales
  return { a, spread: 1.4 + Math.min(1, nvel) * 2.2 }
}

/** The track's base color as '#rrggbb', legacy baseHue included - the one
 *  source both render paths tint from. */
function cubeBaseHex(state: ObjectState, scratch: Color): string {
  const baseColor = state.stringParams.baseColor
  if (baseColor) return baseColor
  const legacyBaseHue = state.params.baseHue
  if (legacyBaseHue !== undefined) {
    scratch.setHSL(legacyBaseHue / 360, 0.65, 0.6)
    return `#${scratch.getHexString()}`
  }
  return DEFAULT_BASE_COLOR
}

// One selected solid per Cube track. The transform (world matrix) and mute blackout are applied
// by ObjectRenderer's placement group; this draws the mesh at local origin and owns
// appearance (color/emissive/surface toggles) plus its signature Shatter ability.
export function Cube({ trackId }: { trackId: string }) {
  const spinRef = useRef<Group>(null)
  const meshRef = useRef<Mesh | null>(null)
  const fragRefs = useRef<(Mesh | null)[]>([])
  // ONE mounted mesh whose geometry follows the GEOMETRY / TUBE / SIDES params
  // imperatively (the component never re-renders on a param edit). It used to
  // be twelve mounted meshes with eleven hidden - twelve materials and eleven
  // dead scene-graph nodes per COPY once a splitter multiplies the track - and
  // the instanced path already proved the single-live-geometry shape.
  const built = useRef<{ id: FundamentalGeometryId | null; value: number }>({ id: null, value: 0 })
  const tint = useRef(new Color()).current
  // The Matte finish's poster surface (shared with the Overlap instruments) -
  // swapped onto the mesh; its own physical material is remembered so Gloss
  // can take it back.
  const posterMaterial = useMemo(() => createPosterMaterial(), [])
  const glossMaterials = useRef(new WeakMap<Mesh, Mesh['material']>()).current

  useEffect(() => () => {
    // The imperative geometry is invisible to r3f's auto-dispose.
    meshRef.current?.geometry.dispose()
    posterMaterial.dispose()
  }, [posterMaterial])

  useInstrumentFrame(trackId, (state) => {
    if (!spinRef.current) return false
    const geometry = normalizeFundamentalGeometry(state.stringParams.geometry)
    const mesh = meshRef.current
    if (!mesh) return false
    // Keep the solid's geometry in step with its params: the id picks the
    // solid, TUBE drives the torus family, SIDES the prism/cone family.
    const tube = state.params.tube ?? paramDefault(cubeInstrument, 'tube')
    const sides = normalizeSides(state.params.sides ?? paramDefault(cubeInstrument, 'sides'))
    const paramValue = TUBED_GEOMETRIES.has(geometry) ? tube : SIDED_GEOMETRIES.has(geometry) ? sides : 0
    if (built.current.id !== geometry || Math.abs(built.current.value - paramValue) > 1e-4) {
      // First build replaces the mesh's default empty BufferGeometry.
      mesh.geometry.dispose()
      mesh.geometry = buildFundamentalGeometry(geometry, tube, sides)
      built.current = { id: geometry, value: paramValue }
    }
    const spinSpeed = state.params.spinSpeed ?? paramDefault(cubeInstrument, 'spinSpeed')
    spinRef.current.rotation.set(...cubeSpinRotation(state.beat, spinSpeed))
    // The note-pulse signal, computed directly from the object's own notes.
    const energy = state.energy
    tint.set(cubeBaseHex(state, tint))

    const matte = (state.params.finish ?? paramDefault(cubeInstrument, 'finish')) < 0.5
    if (matte) {
      if (mesh.material !== posterMaterial) {
        glossMaterials.set(mesh, mesh.material)
        mesh.material = posterMaterial
      }
      const uniforms = posterMaterial.uniforms
      ;(uniforms.uColor.value as Color).copy(tint)
      uniforms.uShade.value = state.params.shading ?? paramDefault(cubeInstrument, 'shading')
      uniforms.uEnergy.value = energy
    } else {
      const gloss = glossMaterials.get(mesh)
      if (gloss && mesh.material === posterMaterial) mesh.material = gloss
      const mat = mesh.material as MeshPhysicalMaterial
      applyFundamentalSurface(mat, {
        reflective: (state.params.reflective ?? paramDefault(cubeInstrument, 'reflective')) >= 0.5,
        refractive: (state.params.refractive ?? paramDefault(cubeInstrument, 'refractive')) >= 0.5,
        shaded: (state.params.shaded ?? paramDefault(cubeInstrument, 'shaded')) >= 0.5,
        textured: (state.params.textured ?? paramDefault(cubeInstrument, 'textured')) >= 0.5,
      }, tint, energy)
    }

    const beat = state.beat
    const { a, spread } = shatterAt(state)

    // The core shrinks as it shatters; fragments grow from nothing and fly outward.
    // The per-axis DIM stretch rides the same mesh scale (a mesh property, so
    // splitter copies stretch in place and mover layouts stay unscaled).
    const shatterScale = Math.max(0.001, 1 - 0.85 * a)
    mesh.scale.set(
      shatterScale * (state.params.dimX ?? paramDefault(cubeInstrument, 'dimX')),
      shatterScale * (state.params.dimY ?? paramDefault(cubeInstrument, 'dimY')),
      shatterScale * (state.params.dimZ ?? paramDefault(cubeInstrument, 'dimZ')),
    )
    for (let i = 0; i < CORNERS.length; i++) {
      const frag = fragRefs.current[i]
      if (!frag) continue
      const [dx, dy, dz] = CORNERS[i]
      const dist = a * spread
      frag.position.set(dx * dist, dy * dist, dz * dist)
      frag.scale.setScalar(0.45 * a)
      frag.rotation.set(beat * 0.6 + i, beat * 0.8 + i, 0)
      frag.visible = a > 0.001
    }
  })

  return (
    <group ref={spinRef}>
      {/* No declarative geometry: the frame callback owns it for EVERY solid
          now, rebuilt from the GEOMETRY / TUBE / SIDES params. */}
      <FundamentalMesh meshRef={meshRef} />
      {CORNERS.map((_, i) => (
        <mesh key={i} ref={(el) => { fragRefs.current[i] = el }} visible={false} castShadow receiveShadow>
          <boxGeometry args={[1.6, 1.6, 1.6]} />
          <meshPhysicalMaterial
            color="#f472b6"
            metalness={0.65}
            roughness={0.18}
            clearcoat={0.45}
            clearcoatRoughness={0.1}
            envMapIntensity={1.4}
            emissive="#be185d"
            emissiveIntensity={1.4}
          />
        </mesh>
      ))}
    </group>
  )
}

// ── Instanced path ──────────────────────────────────────────────────────────
// ONE mount per track drawing every VisualCopy occurrence: a splitter's grid of
// solids is one InstancedMesh2 (one draw call) instead of one mounted Cube per
// cell. Kept pixel-faithful to the per-copy path above - shared shatterAt /
// cubeBaseHex / build*Geometry / applyFundamentalSurface - with two documented
// fidelity trades: gloss EMISSIVE follows the track's own color (per-copy
// colorShift can't reach a shared material's emissive), and the unlit gloss
// surface likewise carries the track color per track, not per copy. Diffuse
// color IS per copy on both finishes (instance color texture).

const _placed = new Matrix4()
const _local = new Matrix4()
const _spin = new Matrix4()
const _euler = new Euler()
const _pos = new Vector3()
const _quat = new Quaternion()
const _scl = new Vector3()
const _instColor = new Color()
const _baseScratch = new Color()
const WHITE = new Color('#ffffff')

export function CubeInstanced({ trackId }: { trackId: string }) {
  const rig = useMemo(() => {
    const poster = createInstancedPosterMaterial()
    // Material generic left wide: the finish swaps poster ⟷ gloss at runtime.
    const solid: InstancedMesh2 = new InstancedMesh2(buildFundamentalGeometry('cube'), poster)
    solid.castShadow = true
    solid.receiveShadow = true
    const gloss = new MeshPhysicalMaterial({ ...FUNDAMENTAL_MATERIAL_PROPS })
    // Fragments: the Shatter burst, 8 corners per copy in one instanced draw.
    const frags = new InstancedMesh2(new BoxGeometry(1.6, 1.6, 1.6), new MeshPhysicalMaterial({
      color: '#f472b6',
      metalness: 0.65,
      roughness: 0.18,
      clearcoat: 0.45,
      clearcoatRoughness: 0.1,
      envMapIntensity: 1.4,
      emissive: '#be185d',
      emissiveIntensity: 1.4,
    }))
    frags.castShadow = true
    frags.receiveShadow = true
    frags.visible = false
    return { solid, poster, gloss, frags, built: { id: 'cube' as FundamentalGeometryId, value: 0 } }
  }, [])

  useEffect(() => () => {
    rig.solid.geometry.dispose()
    rig.poster.dispose()
    rig.gloss.dispose()
    rig.frags.geometry.dispose()
    ;(rig.frags.material as MeshPhysicalMaterial).dispose()
    rig.solid.dispose()
    rig.frags.dispose()
  }, [rig])

  useInstancedCopyFrame(trackId, (f) => {
    const { state, copies } = f
    const { solid, poster, gloss, frags } = rig
    const count = Math.max(1, copies.length)
    if (solid.instancesCount !== count) {
      solid.clearInstances()
      solid.addInstances(count, () => {})
      frags.clearInstances()
      frags.addInstances(count * CORNERS.length, () => {})
    }

    // Geometry follows the params, one live geometry at a time (the per-copy
    // path keeps 12 meshes mounted and toggles visible; here a switch swaps).
    const geometry = normalizeFundamentalGeometry(state.stringParams.geometry)
    const tube = state.params.tube ?? paramDefault(cubeInstrument, 'tube')
    const sides = normalizeSides(state.params.sides ?? paramDefault(cubeInstrument, 'sides'))
    const paramValue = TUBED_GEOMETRIES.has(geometry) ? tube : SIDED_GEOMETRIES.has(geometry) ? sides : 0
    if (rig.built.id !== geometry || Math.abs(rig.built.value - paramValue) > 1e-4) {
      // InstancedMesh2 attaches its SHARED `instanceIndex` GL buffer attribute
      // to whatever geometry it holds. Disposing the old geometry with that
      // attribute still on it makes three delete the shared buffer - the new
      // geometry then draws with a dead index buffer, i.e. NOTHING, until a
      // reload (the "some shapes don't show up until refresh" bug). Detach
      // it first, then dispose only what this geometry owns.
      const old = solid.geometry
      old.deleteAttribute('instanceIndex')
      old.dispose()
      solid.geometry = buildFundamentalGeometry(geometry, tube, sides)
      solid.geometry.computeBoundingSphere()
      rig.built = { id: geometry, value: paramValue }
    }

    const energy = state.energy
    const baseHex = cubeBaseHex(state, _baseScratch)
    const matte = (state.params.finish ?? paramDefault(cubeInstrument, 'finish')) < 0.5
    if (matte) {
      if (solid.material !== poster) solid.material = poster
      poster.uniforms.uShade.value = state.params.shading ?? paramDefault(cubeInstrument, 'shading')
      poster.uniforms.uEnergy.value = energy
    } else {
      if (solid.material !== gloss) solid.material = gloss
      const surface = {
        reflective: (state.params.reflective ?? paramDefault(cubeInstrument, 'reflective')) >= 0.5,
        refractive: (state.params.refractive ?? paramDefault(cubeInstrument, 'refractive')) >= 0.5,
        shaded: (state.params.shaded ?? paramDefault(cubeInstrument, 'shaded')) >= 0.5,
        textured: (state.params.textured ?? paramDefault(cubeInstrument, 'textured')) >= 0.5,
      }
      // Shaded gloss: WHITE diffuse × per-instance color = the per-copy tint.
      // Unlit gloss emits the TRACK color (black diffuse, shared emissive).
      applyFundamentalSurface(gloss, surface, surface.shaded ? WHITE : _instColor.set(baseHex), energy)
    }

    const spinSpeed = state.params.spinSpeed ?? paramDefault(cubeInstrument, 'spinSpeed')
    _spin.makeRotationFromEuler(_euler.set(...cubeSpinRotation(state.beat, spinSpeed)))
    const { a, spread } = shatterAt(state)
    const shatterScale = Math.max(0.001, 1 - 0.85 * a)
    const dimX = state.params.dimX ?? paramDefault(cubeInstrument, 'dimX')
    const dimY = state.params.dimY ?? paramDefault(cubeInstrument, 'dimY')
    const dimZ = state.params.dimZ ?? paramDefault(cubeInstrument, 'dimZ')
    const fragsLive = a > 0.001

    let anyFaded = false
    for (let i = 0; i < count; i++) {
      const fade = f.copyFade(i)
      const visible = fade > 0.001
      solid.setVisibilityAt(i, visible)
      if (!visible) {
        if (fragsLive) for (let c = 0; c < CORNERS.length; c++) frags.setVisibilityAt(i * CORNERS.length + c, false)
        continue
      }
      if (fade < 0.999) anyFaded = true
      f.composeCopyMatrix(i, _placed)
      _placed.multiply(_spin)
      // Solid: placement × spin × (shatter shrink × per-axis dims).
      _local.copy(_placed)
      _local.multiply(_scale2.makeScale(shatterScale * dimX, shatterScale * dimY, shatterScale * dimZ))
      solid.setMatrixAt(i, _local)
      solid.setColorAt(i, f.copyColor(i, baseHex, _instColor))
      solid.setOpacityAt(i, Math.min(1, fade))
      if (fragsLive) {
        const dist = a * spread
        for (let c = 0; c < CORNERS.length; c++) {
          const [dx, dy, dz] = CORNERS[c]
          const idx = i * CORNERS.length + c
          _pos.set(dx * dist, dy * dist, dz * dist)
          _quat.setFromEuler(_euler.set(state.beat * 0.6 + c, state.beat * 0.8 + c, 0))
          _scl.setScalar(0.45 * a)
          _local.compose(_pos, _quat, _scl)
          _local.premultiply(_placed)
          frags.setMatrixAt(idx, _local)
          frags.setVisibilityAt(idx, true)
          frags.setOpacityAt(idx, Math.min(1, fade))
        }
      }
    }
    solid.visible = !state.blackedOut
    frags.visible = fragsLive && !state.blackedOut
    // Mirror applyMaterialOpacity's transparency rule per track: any faded copy
    // flips the shared material to the transparent list (poster keeps its
    // premultiplied convention; force-transparent semantics don't apply here).
    const mat = solid.material as MeshPhysicalMaterial | ReturnType<typeof createInstancedPosterMaterial>
    mat.transparent = anyFaded
    ;(frags.material as MeshPhysicalMaterial).transparent = anyFaded
  })

  return (
    <>
      <primitive object={rig.solid} />
      <primitive object={rig.frags} />
    </>
  )
}

const _scale2 = new Matrix4()

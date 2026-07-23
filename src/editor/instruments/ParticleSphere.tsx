import { useEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import { beatInBlock, useInstrumentFrame } from '../core/visual/instrumentFrame'
import { paramDefault, type ObjectInstrumentDef } from './types'

// Ported from SafarSoFar/sphere-particle-wrap (MIT License, Copyright (c) 2025
// Safar Isaev) - https://github.com/SafarSoFar/sphere-particle-wrap. The
// original wraps a sphere's vertices in small glowing boxes that flee the
// mouse cursor and spring back.
//
// Adaptation for the cabin engine: the cursor becomes MIDI - each labelled row
// drops a repulsor at a fixed spot around the shell (or dead center for a
// radial burst), velocity scales the shove, and the flee/return is a
// closed-form envelope of beat-distance to the note instead of the original's
// per-dot lerp state (pause invariant: scrub == playback). The per-vertex
// meshes (~1k draw calls) become one InstancedMesh; lil-gui settings become
// params; the sphere spins with the beat, world-fixed repulsors preserved by
// rotating them into the shell's local frame.

const BASE_RADIUS = 2.2
/** Repulsors sit just outside the shell, like the cursor hovering it. */
const REPULSOR_DISTANCE = BASE_RADIUS * 1.55
const MAX_DETAIL = 40
const MAX_DOTS = (MAX_DETAIL + 1) * (MAX_DETAIL + 1)
/** Beats to reach full shove after the note lands. */
const ATTACK_BEATS = 0.12
const DEFAULT_COLOR = '#f9a66c'

// Row pitch → repulsor placement. `null` = the shell's center: every dot is
// pushed straight along its own radius (the whole shell puffs outward).
const POKES: Record<number, Vector3 | null> = {
  76: null,
  68: new Vector3(0, 0, 1),
  60: new Vector3(0, 1, 0),
  52: new Vector3(0, -1, 0),
  44: new Vector3(-1, 0, 0),
  36: new Vector3(1, 0, 0),
}

export const particleSphereInstrument: ObjectInstrumentDef = {
  id: 'particleSphere',
  name: 'Particle Sphere',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: [
    { key: 'size', label: 'Size', min: 0.2, max: 4, step: 0.05, default: 1.6 },
    { key: 'color', label: 'Color', type: 'color', default: DEFAULT_COLOR },
    { key: 'glow', label: 'Glow', min: 0, max: 8, step: 0.1, default: 2.5 },
    { key: 'detail', label: 'Dots', min: 8, max: MAX_DETAIL, step: 2, default: 24 },
    { key: 'dotSize', label: 'Dot Size', min: 0.01, max: 0.1, step: 0.002, default: 0.028 },
    { key: 'reach', label: 'Poke Reach', min: 0.4, max: 3, step: 0.05, default: 1.2 },
    { key: 'push', label: 'Poke Push', min: -3, max: 3, step: 0.05, default: 1.4 },
    { key: 'releaseBeats', label: 'Release (beats)', min: 0.05, max: 4, step: 0.05, default: 0.6 },
    { key: 'spin', label: 'Spin Speed', min: 0, max: 4, step: 0.05, default: 0 },
    { key: 'x', label: 'X Position', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'y', label: 'Y Position', min: -10, max: 10, step: 0.1, default: 0 },
    { key: 'z', label: 'Z Position', min: -10, max: 10, step: 0.1, default: 0 },
  ],
  midiRows: [
    { pitch: 76, label: 'Burst · center', emphasized: true },
    { pitch: 68, label: 'Part · front' },
    { pitch: 60, label: 'Poke · top' },
    { pitch: 52, label: 'Poke · bottom' },
    { pitch: 44, label: 'Poke · left' },
    { pitch: 36, label: 'Poke · right' },
  ],
  localTransform: ({ params, energy }) => ({
    position: [
      params.x ?? paramDefault(particleSphereInstrument, 'x'),
      params.y ?? paramDefault(particleSphereInstrument, 'y'),
      params.z ?? paramDefault(particleSphereInstrument, 'z'),
    ],
    scale: ((params.size ?? paramDefault(particleSphereInstrument, 'size')) / 1.6) * (1 + energy * 0.18),
  }),
  component: ParticleSphere,
}

/** Unit directions of a sphere's vertices at the given segment detail (seam and
 *  pole duplicates included, exactly like the original - they overlap cleanly). */
function shellDirections(detail: number): Vector3[] {
  const geometry = new SphereGeometry(1, detail, detail)
  const positions = geometry.attributes.position
  const dirs: Vector3[] = []
  for (let i = 0; i < positions.count; i++) {
    dirs.push(new Vector3().fromBufferAttribute(positions, i).normalize())
  }
  geometry.dispose()
  return dirs
}

/** The shove envelope: quick ease-out attack, full while the note holds, smooth
 *  release after - a pure function of beat-distance to the note. */
function pokeEnvelope(age: number, durationBeats: number, releaseBeats: number): number {
  if (age < 0) return 0
  const hold = Math.max(durationBeats, ATTACK_BEATS)
  if (age < ATTACK_BEATS) {
    const t = age / ATTACK_BEATS
    return 1 - (1 - t) * (1 - t)
  }
  if (age < hold) return 1
  if (age < hold + releaseBeats) {
    const t = (age - hold) / releaseBeats
    return (1 - t) * (1 - t)
  }
  return 0
}

const IDENTITY_QUAT = new Quaternion()

export function ParticleSphere({ trackId }: { trackId: string }) {
  const rootRef = useRef<Group>(null)
  const lastDetail = useRef(0)
  const dirsRef = useRef<Vector3[]>([])
  const baseColor = useRef(new Color())

  // Scratch objects reused across dots (no per-frame allocation in the loop).
  const scratch = useRef({
    matrix: new Matrix4(),
    pos: new Vector3(),
    offset: new Vector3(),
    scale: new Vector3(),
    euler: new Euler(),
    invRotation: new Quaternion(),
    repulsor: new Vector3(),
  }).current

  const mesh = useMemo(() => {
    // The elongated dot of the original (0.1 × 0.1 × 1.0), normalized so the
    // per-instance scale is just the dot size.
    const geometry = new BoxGeometry(1, 1, 10)
    const material = new MeshBasicMaterial({ color: DEFAULT_COLOR, toneMapped: false })
    const instanced = new InstancedMesh(geometry, material, MAX_DOTS)
    instanced.instanceMatrix.setUsage(DynamicDrawUsage)
    instanced.frustumCulled = false
    return instanced
  }, [])

  useEffect(() => () => {
    mesh.geometry.dispose()
    ;(mesh.material as MeshBasicMaterial).dispose()
    mesh.dispose()
  }, [mesh])

  useInstrumentFrame(trackId, (state) => {
    const root = rootRef.current
    if (!root) return false

    // Blocks are the instrument's on-screen region: no block at the playhead,
    // no shell (block-gated ambient rule).
    const inBlock = beatInBlock(state)
    root.visible = inBlock
    if (!inBlock) return

    const p = state.params
    const detail = Math.max(8, Math.min(MAX_DETAIL, Math.round(p.detail ?? paramDefault(particleSphereInstrument, 'detail'))))
    if (detail !== lastDetail.current) {
      dirsRef.current = shellDirections(detail)
      lastDetail.current = detail
    }
    const dirs = dirsRef.current

    const glow = p.glow ?? paramDefault(particleSphereInstrument, 'glow')
    const dotSize = p.dotSize ?? paramDefault(particleSphereInstrument, 'dotSize')
    const reach = (p.reach ?? paramDefault(particleSphereInstrument, 'reach')) * BASE_RADIUS
    const push = (p.push ?? paramDefault(particleSphereInstrument, 'push')) * BASE_RADIUS
    const releaseBeats = p.releaseBeats ?? paramDefault(particleSphereInstrument, 'releaseBeats')
    const spin = p.spin ?? paramDefault(particleSphereInstrument, 'spin')

    // Spin like the original's toggleRotation (equal rate on all three axes),
    // derived from the beat so scrubbing reproduces it exactly.
    const angle = state.beat * spin * 0.3
    root.rotation.set(angle, angle, angle)
    // Repulsors stay world-fixed (the original's cursor does not spin with the
    // shell): rotate each into the shell's local frame instead.
    scratch.invRotation.setFromEuler(scratch.euler.set(angle, angle, angle)).invert()

    // Active pokes this beat: a repulsor position (shell-local) and strength
    // per sounding note. Notes are resolved and sorted; anything with zero
    // envelope contributes nothing and is skipped.
    const pokes: { repulsor: Vector3 | null; strength: number }[] = []
    for (const note of state.notes) {
      if (note.beat > state.beat) break
      const placement = POKES[note.pitch]
      if (placement === undefined) continue
      const env = pokeEnvelope(state.beat - note.beat, note.durationBeats, releaseBeats)
      if (env <= 0.001) continue
      const velocity = note.velocity <= 1 ? note.velocity : note.velocity / 127
      const repulsor = placement
        ? scratch.repulsor.copy(placement).multiplyScalar(REPULSOR_DISTANCE).applyQuaternion(scratch.invRotation).clone()
        : null
      pokes.push({ repulsor, strength: env * velocity * push })
    }

    // HDR color: the glow multiplier lifts the dots over the bloom threshold,
    // flaring with the note pulse like the lasers do.
    baseColor.current.set(state.stringParams.color || DEFAULT_COLOR)
    const material = mesh.material as MeshBasicMaterial
    material.color.copy(baseColor.current).multiplyScalar(1 + glow * (0.5 + state.energy))

    const dotScale = dotSize * (1 + state.energy * 0.4)
    scratch.scale.set(dotScale, dotScale, dotScale)

    for (let i = 0; i < dirs.length; i++) {
      scratch.pos.copy(dirs[i]).multiplyScalar(BASE_RADIUS)
      for (const poke of pokes) {
        if (poke.repulsor === null) {
          // Center burst: straight along the dot's own radius, no falloff.
          scratch.offset.copy(dirs[i]).multiplyScalar(poke.strength)
        } else {
          scratch.offset.copy(scratch.pos).sub(poke.repulsor)
          const distance = scratch.offset.length()
          const falloff = Math.max(0, 1 - distance / reach)
          if (falloff <= 0 || distance < 1e-4) continue
          scratch.offset.multiplyScalar((poke.strength * falloff * falloff) / distance)
        }
        scratch.pos.add(scratch.offset)
      }
      scratch.matrix.compose(scratch.pos, IDENTITY_QUAT, scratch.scale)
      mesh.setMatrixAt(i, scratch.matrix)
    }
    mesh.count = dirs.length
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <group ref={rootRef}>
      <primitive object={mesh} />
    </group>
  )
}

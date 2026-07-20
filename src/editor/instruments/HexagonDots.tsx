import { useRef, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Group, Mesh, SphereGeometry, MeshBasicMaterial, Color, Vector3 } from 'three'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import { setAnimatedOpacity } from '../core/visual/animatedOpacity'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW. Each note spawns a ring of six glowing dots out at a distant
// hexagon; they rotate around their orbit and drift toward the camera, fading in and out.
// Fully derived from beat-age each frame (no integration), so it's scrub-accurate.

interface Pooled { mesh: Mesh; mat: MeshBasicMaterial; active: boolean }

const HEX_RADIUS = 4
const HEX_DISTANCE = 25
let sharedSphere: SphereGeometry | null = null
function sphereGeo() { if (!sharedSphere) sharedSphere = new SphereGeometry(1, 16, 16); return sharedSphere }
const _c = new Color()

function hexagonPoint(angle: number, radius: number, distance: number): Vector3 {
  const hexAngle = Math.PI / 3
  const vi = Math.floor((angle / (Math.PI * 2)) * 6)
  const local = (angle % hexAngle) / hexAngle
  const a1 = vi * hexAngle, a2 = (vi + 1) * hexAngle
  const x = Math.cos(a1) * radius + (Math.cos(a2) * radius - Math.cos(a1) * radius) * local
  const y = Math.sin(a1) * radius + (Math.sin(a2) * radius - Math.sin(a1) * radius) * local
  return new Vector3(x, y, -distance)
}

const PARAMS: ParamDef[] = [
  { key: 'dotSpeed', label: 'Dot Speed', min: 1, max: 10, step: 0.5, default: 4 },
  { key: 'dotSize', label: 'Dot Size', min: 0.05, max: 0.5, step: 0.05, default: 0.15 },
]
function HexagonDotsVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const poolRef = useRef<Pooled[]>([])
  const { camera } = useThree()

  useEffect(() => () => {
    const g = groupRef.current
    if (g) for (const p of poolRef.current) { g.remove(p.mesh); p.mat.dispose() }
    poolRef.current = []
  }, [])

  function acquire(group: Group): Pooled {
    for (const p of poolRef.current) if (!p.active) { p.active = true; p.mesh.visible = true; return p }
    const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
    const mesh = new Mesh(sphereGeo(), mat)
    group.add(mesh)
    const entry: Pooled = { mesh, mat, active: true }
    poolRef.current.push(entry)
    return entry
  }

  useInstrumentFrame(trackId, (state) => {
    const group = groupRef.current
    if (!group) return false
    const dotSpeed = state.params.dotSpeed ?? 4
    const dotSize = state.params.dotSize ?? 0.15
    const camZ = camera.position.z
    const threshold = camZ + 2

    for (const p of poolRef.current) { p.active = false; p.mesh.visible = false }

    // Each note owns a hexagon ring; every dot's position is closed-form in the
    // note's beat-age, so pause freezes it and scrubbing (either way) reproduces it.
    for (let ei = 0; ei < state.notes.length; ei++) {
      const n = state.notes[ei]
      const ageSec = (state.beat - n.beat) * state.secPerBeat
      if (ageSec < 0) continue
      const z = -HEX_DISTANCE + dotSpeed * ageSec
      if (z >= threshold) continue

      // Rainbow: the old version random-walked a module-level hue by 15–25° per
      // spawn; keep the same average stride (20°/note) but seed the wobble from
      // the note so a scrub regenerates the identical color.
      const noteSeed = n.beat * 13 + n.pitch * 7
      const hue = ((ei * 20 + (seededRand(noteSeed) - 0.5) * 10) / 360 + 1) % 1
      const vel = n.velocity <= 1 ? n.velocity : n.velocity / 127
      // Fade in over the first 5 units, fade out inside 2 units of the camera.
      const opacity = Math.max(0, Math.min(1, (HEX_DISTANCE + z) / 5, (camZ - z) / 2))

      const spin = 0.5 * ageSec
      for (let i = 0; i < 6; i++) {
        const baseAngle = (i / 6) * Math.PI * 2 + (seededRand(noteSeed + i) - 0.5) * 0.3
        const pos = hexagonPoint(baseAngle, HEX_RADIUS, HEX_DISTANCE)
        const radius = Math.hypot(pos.x, pos.y)
        const angle = baseAngle + spin
        const d = acquire(group)
        d.mesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, z)
        d.mesh.scale.setScalar(dotSize * (0.7 + vel * 0.6))
        d.mat.color.copy(_c.setHSL(hue, 0.9, 0.6).offsetHSL(
          seededRand(noteSeed + i * 3 + 100) * 0.05 - 0.025, 0, seededRand(noteSeed + i * 3 + 200) * 0.1 - 0.05,
        ))
        setAnimatedOpacity(d.mat, opacity)
      }
    }
  })

  return <group ref={groupRef} />
}

export const hexagonDotsInstrument: ObjectInstrumentDef = {
  id: 'hexagonDots',
  name: 'Hexagon Dots',
  kind: 'object',
  userInterfaceRenderer: 'hexagonDots',
  params: PARAMS,
  // Every note spawns one ring regardless of pitch (color cycles per note; velocity sets
  // dot size), so the vocabulary is a single trigger row.
  midiRows: [
    { pitch: 60, label: 'Spawn hexagon ring', emphasized: true },
  ],
  component: HexagonDotsVisual,
}

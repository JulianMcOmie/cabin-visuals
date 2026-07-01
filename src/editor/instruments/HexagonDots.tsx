import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, Mesh, SphereGeometry, MeshBasicMaterial, Color, Vector3 } from 'three'
import { getObjectState } from '../core/engine/VisualEngine'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. Each note spawns a ring of six glowing dots out at a distant
// hexagon; they rotate around their orbit and drift toward the camera, fading in and out.
// Rendered imperatively (Tyler's version re-rendered React every frame).

interface Dot { mesh: Mesh; mat: MeshBasicMaterial; radius: number; angle: number }

const HEX_RADIUS = 4
const HEX_DISTANCE = 25
let colorHue = 0
let sharedSphere: SphereGeometry | null = null
function sphereGeo() { if (!sharedSphere) sharedSphere = new SphereGeometry(1, 16, 16); return sharedSphere }

function hexagonPoint(angle: number, radius: number, distance: number): Vector3 {
  const hexAngle = Math.PI / 3
  const vi = Math.floor((angle / (Math.PI * 2)) * 6)
  const local = (angle % hexAngle) / hexAngle
  const a1 = vi * hexAngle, a2 = (vi + 1) * hexAngle
  const x = Math.cos(a1) * radius + (Math.cos(a2) * radius - Math.cos(a1) * radius) * local
  const y = Math.sin(a1) * radius + (Math.sin(a2) * radius - Math.sin(a1) * radius) * local
  return new Vector3(x, y, -distance)
}
function nextRainbow(): Color {
  const hue = (colorHue % 360) / 360
  colorHue += 15 + Math.random() * 10
  return new Color().setHSL(hue, 0.9, 0.6)
}

const PARAMS: ParamDef[] = [
  { key: 'dotSpeed', label: 'Dot Speed', min: 1, max: 10, step: 0.5, default: 4 },
  { key: 'dotSize', label: 'Dot Size', min: 0.05, max: 0.5, step: 0.05, default: 0.15 },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

function HexagonDotsVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const dotsRef = useRef<Dot[]>([])
  const prevKeys = useRef<Set<string>>(new Set())
  const { camera } = useThree()

  useEffect(() => () => {
    const g = groupRef.current
    if (g) for (const d of dotsRef.current) { g.remove(d.mesh); d.mat.dispose() }
    dotsRef.current = []
  }, [])

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    const state = getObjectState(trackId)
    if (!state) return
    const dotSpeed = state.params.dotSpeed ?? 4
    const dotSize = state.params.dotSize ?? 0.15

    // Spawn a hexagon ring on each new note.
    const keys = new Set(state.activeNotes.map((n) => `${n.pitch}:${n.beat}`))
    for (const n of state.activeNotes) {
      if (prevKeys.current.has(`${n.pitch}:${n.beat}`)) continue
      const base = nextRainbow()
      const vel = n.velocity <= 1 ? n.velocity : n.velocity / 127
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.3
        const pos = hexagonPoint(angle, HEX_RADIUS, HEX_DISTANCE)
        const radius = Math.hypot(pos.x, pos.y)
        const color = base.clone().offsetHSL(Math.random() * 0.05 - 0.025, 0, Math.random() * 0.1 - 0.05)
        const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.8 + vel * 0.2, depthWrite: false })
        const mesh = new Mesh(sphereGeo(), mat)
        mesh.position.copy(pos)
        mesh.scale.setScalar(dotSize * (0.7 + vel * 0.6))
        group.add(mesh)
        dotsRef.current.push({ mesh, mat, radius, angle })
      }
    }
    prevKeys.current = keys

    const camZ = camera.position.z
    const threshold = camZ + 2
    const dead: Dot[] = []
    for (const d of dotsRef.current) {
      d.mesh.position.z += dotSpeed * delta
      d.angle += 0.5 * delta
      d.mesh.position.x = Math.cos(d.angle) * d.radius
      d.mesh.position.y = Math.sin(d.angle) * d.radius
      const distFromCam = camZ - d.mesh.position.z
      if (distFromCam < 2) d.mat.opacity = Math.max(0, distFromCam / 2)
      else if (d.mesh.position.z > -HEX_DISTANCE + 5) d.mat.opacity = Math.min(1, (HEX_DISTANCE + d.mesh.position.z) / 5)
      if (d.mesh.position.z >= threshold) dead.push(d)
    }
    for (const d of dead) { group.remove(d.mesh); d.mat.dispose() }
    if (dead.length) dotsRef.current = dotsRef.current.filter((d) => !dead.includes(d))
  })

  return <group ref={groupRef} />
}

export const hexagonDotsInstrument: ObjectInstrumentDef = {
  id: 'hexagonDots',
  name: 'Hexagon Dots',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: HexagonDotsVisual,
}

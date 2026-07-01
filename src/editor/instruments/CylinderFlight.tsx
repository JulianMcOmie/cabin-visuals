import { useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Mesh, CylinderGeometry, MeshBasicMaterial, Color, AdditiveBlending, DoubleSide } from 'three'
import { getObjectState } from '../core/engine/VisualEngine'
import { useTimeStore } from '../store/TimeStore'
import { useProjectStore } from '../store/ProjectStore'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. Interlocked cylinders fly toward the camera; each note is a
// cylinder whose depth = how long ago (in beats → seconds) it played, so it's fully
// scrub-accurate. Pitch sets the radial segment count. Meshes are pooled.

const cylinderCache = new Map<number, CylinderGeometry>()
function cylinderGeo(radialSegments: number): CylinderGeometry {
  let g = cylinderCache.get(radialSegments)
  if (!g) { g = new CylinderGeometry(1, 1, 1, radialSegments, 1, false); cylinderCache.set(radialSegments, g) }
  return g
}

interface Pooled { mesh: Mesh; mat: MeshBasicMaterial; active: boolean }
const _c = new Color()

const PARAMS: ParamDef[] = [
  { key: 'speed', label: 'Flight Speed', min: 2, max: 40, step: 1, default: 10 },
  { key: 'spread', label: 'Spread', min: 0, max: 10, step: 0.5, default: 1 },
  { key: 'farZ', label: 'Spawn Depth', min: 10, max: 100, step: 5, default: 40 },
  { key: 'baseRadius', label: 'Base Radius', min: 0.1, max: 3, step: 0.1, default: 0.6 },
  { key: 'radiusStep', label: 'Radius Step', min: 0, max: 0.5, step: 0.01, default: 0.1 },
  { key: 'baseHeight', label: 'Base Height', min: 0.2, max: 5, step: 0.1, default: 1 },
  { key: 'heightStep', label: 'Height Step', min: 0, max: 0.5, step: 0.01, default: 0.15 },
  { key: 'rotationSpeed', label: 'Rotation Speed', min: 0, max: 3, step: 0.1, default: 0.4 },
  { key: 'tiltAmount', label: 'Tilt Amount', min: 0, max: 2, step: 0.1, default: 0.8 },
  { key: 'hueStep', label: 'Hue Step', min: 0, max: 0.5, step: 0.01, default: 0.07 },
  { key: 'baseHue', label: 'Base Hue', min: 0, max: 1, step: 0.05, default: 0 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 1, step: 0.05, default: 0.8 },
  { key: 'lightness', label: 'Lightness', min: 0.1, max: 1, step: 0.05, default: 0.7 },
  { key: 'shapePitch', label: 'Shape Base Pitch', min: 24, max: 72, step: 1, default: 48 },
  { key: 'fadeOutZ', label: 'Fade Out Distance', min: 5, max: 30, step: 1, default: 15 },
  { key: 'segments', label: 'Base Segments', min: 3, max: 32, step: 1, default: 16 },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

function CylinderFlightVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const poolRef = useRef<Pooled[]>([])
  const timeRef = useRef(0)

  useEffect(() => () => {
    const g = groupRef.current
    if (g) for (const p of poolRef.current) { g.remove(p.mesh); p.mat.dispose() }
    poolRef.current = []
  }, [])

  function acquire(group: Group): Pooled {
    for (const p of poolRef.current) if (!p.active) { p.active = true; p.mesh.visible = true; return p }
    const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false, side: DoubleSide })
    mat.blending = AdditiveBlending
    mat.fog = false
    const mesh = new Mesh(cylinderGeo(16), mat)
    mesh.rotation.x = Math.PI / 2
    group.add(mesh)
    const entry: Pooled = { mesh, mat, active: true }
    poolRef.current.push(entry)
    return entry
  }

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    const state = getObjectState(trackId)
    if (!state) return
    const notes = state.notes
    if (!notes.length) return
    const p = state.params
    const speed = p.speed ?? 10
    const spread = p.spread ?? 1
    const farZ = p.farZ ?? 40
    const baseRadius = p.baseRadius ?? 0.6
    const radiusStep = p.radiusStep ?? 0.1
    const baseHeight = p.baseHeight ?? 1
    const heightStep = p.heightStep ?? 0.15
    const rotationSpeed = p.rotationSpeed ?? 0.4
    const tiltAmount = p.tiltAmount ?? 0.8
    const hueStep = p.hueStep ?? 0.07
    const baseHue = p.baseHue ?? 0
    const saturation = p.saturation ?? 0.8
    const lightness = p.lightness ?? 0.7
    const shapePitch = p.shapePitch ?? 48
    const fadeOutZ = p.fadeOutZ ?? 15
    const segments = p.segments ?? 16

    const currentBeat = useTimeStore.getState().currentBeat
    const secPerBeat = 60 / useProjectStore.getState().bpm
    timeRef.current += delta
    const time = timeRef.current

    for (const pm of poolRef.current) { pm.active = false; pm.mesh.visible = false }

    let shapeIndex = 0
    for (let ei = 0; ei < notes.length; ei++) {
      const ev = notes[ei]
      if (ev.pitch < shapePitch) continue
      const pitchSegments = Math.min(Math.max(segments + (ev.pitch - shapePitch), 4), 64)
      const radius = baseRadius + ((shapeIndex * radiusStep) % 1.5)
      const height = baseHeight + ((shapeIndex * heightStep) % 2.0)
      const z = (currentBeat - ev.beat) * secPerBeat * speed
      shapeIndex++
      if (z < -farZ || z > fadeOutZ) continue

      const pooled = acquire(group)
      pooled.mesh.geometry = cylinderGeo(pitchSegments)
      const spreadX = spread > 0 ? Math.sin(ei * 7.31 + 0.5) * spread : 0
      const spreadY = spread > 0 ? Math.cos(ei * 13.17 + 0.3) * spread : 0
      pooled.mesh.position.set(spreadX, spreadY, z)
      const progress = 1 - Math.max(0, -z) / farZ
      const scaleFactor = 0.5 + progress * 1.5
      pooled.mesh.scale.set(radius * scaleFactor, height * scaleFactor, radius * scaleFactor)
      const tiltX = Math.sin(ei * 3.47) * tiltAmount
      const tiltY = Math.cos(ei * 5.13) * tiltAmount
      pooled.mesh.rotation.set(
        Math.PI / 2 + tiltX + time * rotationSpeed * 0.3,
        tiltY + time * rotationSpeed,
        ei * 0.5 + time * rotationSpeed * 0.5,
      )
      pooled.mat.color.copy(_c.setHSL((baseHue + shapeIndex * hueStep) % 1, saturation, lightness))
      pooled.mat.opacity = z > 0 ? Math.max(0, 1 - z / fadeOutZ) : 1
    }
  })

  return <group ref={groupRef} />
}

export const cylinderFlightInstrument: ObjectInstrumentDef = {
  id: 'cylinderFlight',
  name: 'Cylinder Flight',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: CylinderFlightVisual,
}

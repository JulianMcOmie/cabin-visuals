import { useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  Group, LineSegments, LineBasicMaterial, EdgesGeometry, IcosahedronGeometry, Color, AdditiveBlending,
  type BufferGeometry,
} from 'three'
import { getObjectState } from '../core/engine/VisualEngine'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. Nested icosahedron wireframes spawn on each note and expand
// outward, fading as they grow. Note-ons are detected from the object's activeNotes.

let sharedEdges: BufferGeometry | null = null
function edgeGeometry(): BufferGeometry {
  if (!sharedEdges) sharedEdges = new EdgesGeometry(new IcosahedronGeometry(1))
  return sharedEdges
}

interface Shell { line: LineSegments; material: LineBasicMaterial; age: number }
const _c = new Color()
let hueCounter = 0

const PARAMS: ParamDef[] = [
  { key: 'startSize', label: 'Start Size', min: 0.05, max: 1, step: 0.05, default: 0.15 },
  { key: 'expansionSpeed', label: 'Expansion Speed', min: 0.5, max: 15, step: 0.5, default: 4 },
  { key: 'maxSize', label: 'Max Size', min: 2, max: 20, step: 0.5, default: 6 },
  { key: 'fadeStart', label: 'Fade Start', min: 0.1, max: 0.9, step: 0.05, default: 0.5 },
  { key: 'hueStep', label: 'Hue Step', min: 0, max: 0.5, step: 0.01, default: 0.08 },
  { key: 'baseHue', label: 'Base Hue', min: 0, max: 1, step: 0.05, default: 0.55 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 1, step: 0.05, default: 0.9 },
  { key: 'lightness', label: 'Lightness', min: 0.1, max: 1, step: 0.05, default: 0.6 },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

function IcosahedronBurstVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const shellsRef = useRef<Shell[]>([])
  const prevKeys = useRef<Set<string>>(new Set())

  useEffect(() => () => {
    const g = groupRef.current
    if (g) for (const s of shellsRef.current) { g.remove(s.line); s.material.dispose() }
    shellsRef.current = []
  }, [])

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    const state = getObjectState(trackId)
    if (!state) return
    const p = state.params
    const startSize = p.startSize ?? 0.15
    const expansionSpeed = p.expansionSpeed ?? 4
    const maxSize = p.maxSize ?? 6
    const fadeStart = p.fadeStart ?? 0.5
    const hueStep = p.hueStep ?? 0.08
    const baseHue = p.baseHue ?? 0.55
    const saturation = p.saturation ?? 0.9
    const lightness = p.lightness ?? 0.6

    // A note-on = a note key that's newly present in activeNotes this frame.
    const keys = new Set(state.activeNotes.map((n) => `${n.beat}:${n.pitch}`))
    let onsets = 0
    for (const k of keys) if (!prevKeys.current.has(k)) onsets++
    prevKeys.current = keys

    for (let i = 0; i < Math.min(onsets, 3); i++) {
      const hue = (baseHue + hueCounter * hueStep) % 1
      hueCounter++
      const material = new LineBasicMaterial({
        color: _c.setHSL(hue, saturation, lightness).getHex(),
        transparent: true, opacity: 1, depthWrite: false,
      })
      material.blending = AdditiveBlending
      const line = new LineSegments(edgeGeometry(), material)
      line.scale.setScalar(startSize)
      group.add(line)
      shellsRef.current.push({ line, material, age: 0 })
    }

    const dead: Shell[] = []
    for (const shell of shellsRef.current) {
      shell.age += delta
      const size = startSize + shell.age * expansionSpeed
      if (size >= maxSize) { dead.push(shell); continue }
      shell.line.scale.setScalar(size)
      const fadeThreshold = maxSize * fadeStart
      shell.material.opacity = size > fadeThreshold ? 1 - (size - fadeThreshold) / (maxSize - fadeThreshold) : 1
    }
    for (const shell of dead) { group.remove(shell.line); shell.material.dispose() }
    if (dead.length) shellsRef.current = shellsRef.current.filter((s) => !dead.includes(s))
  })

  return <group ref={groupRef} />
}

export const icosahedronBurstInstrument: ObjectInstrumentDef = {
  id: 'icosahedronBurst',
  name: 'Icosahedron Burst',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: IcosahedronBurstVisual,
}

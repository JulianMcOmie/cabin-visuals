import { useRef, useEffect, useMemo } from 'react'
import { InstancedMesh, InstancedBufferAttribute, Object3D, Color } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW's CircleGrid (the "circles" shape - a 3D grid of glowing
// dots, NOT full-frame). Layout + toggle-mode math is Tyler's verbatim; only state
// reads are rewired. Tyler's `noteOnCount` (which drives the toggle modes) isn't in
// ObjectState, so we derive it purely as the count of notes whose onset is at or
// before the playhead (scrub == playback). The platonic-solids sub-mode + shape
// switch are dropped - this instrument is a grid of circles only.

const MAX_INSTANCES = 1024 // 32 rows * 32 cols

// --- Layout generators (verbatim from Tyler) - return normalized positions [-1, 1] ---
type LayoutFn = (index: number, total: number, rows: number, cols: number) => { x: number; y: number }

const layouts: LayoutFn[] = [
  // 0 grid
  (index, _total, rows, cols) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    return {
      x: cols > 1 ? (col / (cols - 1)) * 2 - 1 : 0,
      y: rows > 1 ? (row / (rows - 1)) * 2 - 1 : 0,
    }
  },
  // 1 spiral
  (index, total) => {
    const angle = index * 0.5
    const radius = Math.sqrt(index / total)
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  },
  // 2 fibonacci
  (index, total) => {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5))
    const angle = index * goldenAngle
    const radius = Math.sqrt(index / total)
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  },
  // 3 circle
  (index, total) => {
    const rings = Math.ceil(Math.sqrt(total))
    let ringStart = 0
    let currentRing = 0
    for (let r = 0; r < rings; r++) {
      const dotsInRing = r === 0 ? 1 : Math.floor(2 * Math.PI * r)
      if (index < ringStart + dotsInRing) {
        currentRing = r
        break
      }
      ringStart += dotsInRing
    }
    if (currentRing === 0) return { x: 0, y: 0 }
    const indexInRing = index - ringStart
    const dotsInRing = Math.floor(2 * Math.PI * currentRing)
    const angle = (indexInRing / dotsInRing) * Math.PI * 2
    const radius = currentRing / rings
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  },
  // 4 hexagon
  (index, _total, rows, cols) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    const offset = row % 2 === 0 ? 0 : 0.5
    return {
      x: cols > 1 ? ((col + offset) / cols) * 2 - 1 : 0,
      y: rows > 1 ? (row / (rows - 1)) * 2 - 1 : 0,
    }
  },
  // 5 wave
  (index, _total, rows, cols) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    const waveOffset = Math.sin(col * 0.5) * 0.2
    return {
      x: cols > 1 ? (col / (cols - 1)) * 2 - 1 : 0,
      y: rows > 1 ? (row / (rows - 1)) * 2 - 1 + waveOffset : waveOffset,
    }
  },
  // 6 diamond
  (index, total) => {
    const side = Math.ceil(Math.sqrt(total))
    const row = Math.floor(index / side)
    const col = index % side
    const x = (col / (side - 1)) * 2 - 1
    const y = (row / (side - 1)) * 2 - 1
    const cos45 = Math.cos(Math.PI / 4)
    const sin45 = Math.sin(Math.PI / 4)
    return { x: (x * cos45 - y * sin45) * 0.7, y: (x * sin45 + y * cos45) * 0.7 }
  },
  // 7 star
  (index, total) => {
    const points = 5
    const rings = Math.ceil(total / points)
    const ring = Math.floor(index / points)
    const pointIndex = index % points
    const innerRadius = 0.3
    const outerRadius = 1
    const radius = innerRadius + (ring / rings) * (outerRadius - innerRadius)
    const angle = (pointIndex / points) * Math.PI * 2 - Math.PI / 2
    const wobble = ring % 2 === 0 ? 0 : Math.PI / points
    return { x: Math.cos(angle + wobble) * radius, y: Math.sin(angle + wobble) * radius }
  },
  // 8 random
  (index) => {
    const seed = index * 9301 + 49297
    const rng1 = (seed % 233280) / 233280
    const rng2 = ((seed * 7) % 233280) / 233280
    return { x: rng1 * 2 - 1, y: rng2 * 2 - 1 }
  },
]

// --- Toggle modes (verbatim from Tyler) - which dots are visible given noteOnCount ---
type ToggleFn = (index: number, total: number, noteOnCount: number) => boolean

const toggleModes: ToggleFn[] = [
  // 0 none
  () => true,
  // 1 cycle
  (index, total, noteOnCount) => {
    const cycleLength = total * 2
    const pos = noteOnCount % cycleLength
    if (pos < total) return index < pos
    const hiddenCount = pos - total
    return index < total - hiddenCount
  },
  // 2 fill
  (index, total, noteOnCount) => {
    const visibleCount = noteOnCount % (total + 1)
    return index < visibleCount
  },
  // 3 wave
  (index, total, noteOnCount) => {
    const wavePos = (noteOnCount * 2) % total
    const dist = Math.abs(index - wavePos)
    return dist < total * 0.3
  },
  // 4 random
  (index, _total, noteOnCount) => {
    const seed = (index * 9301 + noteOnCount * 49297) % 233280
    return seed / 233280 > 0.5
  },
  // 5 alternate
  (index, _total, noteOnCount) => (index + noteOnCount) % 2 === 0,
  // 6 spiral
  (index, total, noteOnCount) => {
    const visibleCount = noteOnCount % (total + 1)
    return index < visibleCount
  },
]

const PARAMS: ParamDef[] = [
  { key: 'rows', label: 'Rows', min: 1, max: 32, step: 1, default: 4 },
  { key: 'cols', label: 'Columns', min: 1, max: 32, step: 1, default: 4 },
  { key: 'spacing', label: 'Spacing', min: 0.1, max: 4, step: 0.1, default: 1.5 },
  { key: 'dotSize', label: 'Dot Size', min: 0.1, max: 3, step: 0.1, default: 1 },
  {
    key: 'layout',
    label: 'Layout',
    type: 'select',
    options: [
      { value: 0, label: 'Grid' },
      { value: 1, label: 'Spiral' },
      { value: 2, label: 'Fibonacci' },
      { value: 3, label: 'Circle' },
      { value: 4, label: 'Hexagon' },
      { value: 5, label: 'Wave' },
      { value: 6, label: 'Diamond' },
      { value: 7, label: 'Star' },
      { value: 8, label: 'Random' },
    ],
    default: 0,
  },
  {
    key: 'toggleMode',
    label: 'Toggle Mode',
    type: 'select',
    options: [
      { value: 0, label: 'None' },
      { value: 1, label: 'Cycle' },
      { value: 2, label: 'Fill' },
      { value: 3, label: 'Wave' },
      { value: 4, label: 'Random' },
      { value: 5, label: 'Alternate' },
      { value: 6, label: 'Spiral' },
    ],
    default: 1,
  },
  { key: 'baseHue', label: 'Base Hue', min: 0, max: 1, step: 0.05, default: 0.55 },
  { key: 'hueRange', label: 'Hue Range', min: 0, max: 1, step: 0.05, default: 0.2 },
  { key: 'rotationSpeed', label: 'Rotation Speed', min: 0, max: 2, step: 0.1, default: 0 },
]

function CircleGridVisual({ trackId }: { trackId: string }) {
  const meshRef = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const color = useMemo(() => new Color(), [])
  const colors = useMemo(() => new Float32Array(MAX_INSTANCES * 3), [])

  useEffect(() => {
    if (meshRef.current) meshRef.current.instanceColor = new InstancedBufferAttribute(colors, 3)
  }, [colors])

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    if (!mesh) return false
    const p = state.params

    // Derive noteOnCount purely: onsets at or before the playhead (Tyler's engine tracked this itself).
    let noteOnCount = 0
    for (const n of state.notes) if (n.beat <= state.beat) noteOnCount++

    const rows = Math.floor(p.rows ?? 4)
    const cols = Math.floor(p.cols ?? 4)
    const spacing = p.spacing ?? 1.5
    const dotSize = p.dotSize ?? 1
    const layoutFn = layouts[Math.floor(p.layout ?? 0)] ?? layouts[0]
    const toggleFn = toggleModes[Math.floor(p.toggleMode ?? 1)] ?? toggleModes[1]
    const baseHue = p.baseHue ?? 0.55
    const hueRange = p.hueRange ?? 0.2
    const rotationSpeed = p.rotationSpeed ?? 0

    // Time source is the playhead: beat-seconds keep the seconds-tuned frequencies at default bpm.
    const time = state.beat * state.secPerBeat

    const total = Math.min(rows * cols, MAX_INSTANCES)
    const scale = spacing * Math.max(rows, cols) * 0.5

    for (let i = 0; i < total; i++) {
      const isVisible = toggleFn(i, total, noteOnCount)

      if (!isVisible) {
        dummy.position.set(0, 0, 0)
        dummy.scale.setScalar(0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        colors[i * 3] = 0
        colors[i * 3 + 1] = 0
        colors[i * 3 + 2] = 0
        continue
      }

      const pos = layoutFn(i, total, rows, cols)

      const cos = Math.cos(time * rotationSpeed)
      const sin = Math.sin(time * rotationSpeed)
      const x = pos.x * cos - pos.y * sin
      const y = pos.x * sin + pos.y * cos

      dummy.position.set(x * scale, y * scale, 0)
      dummy.scale.setScalar(dotSize)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)

      const distFromCenter = Math.sqrt(pos.x * pos.x + pos.y * pos.y)
      const hue = (baseHue + distFromCenter * hueRange + time * 0.05 + noteOnCount * 0.02) % 1
      color.setHSL(hue, 0.8, 0.5)
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b
    }

    // Collapse any unused instances (rows/cols reduced this frame).
    for (let i = total; i < MAX_INSTANCES; i++) {
      dummy.position.set(0, 0, 0)
      dummy.scale.setScalar(0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_INSTANCES]}>
      <sphereGeometry args={[1, 16, 16]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  )
}

export const circleGridInstrument: ObjectInstrumentDef = {
  id: 'circleGrid',
  name: 'Circle Grid',
  kind: 'object',
  userInterfaceRenderer: 'circleGrid',
  params: PARAMS,
  midiRows: [
    { pitch: 60, label: 'Step dot pattern forward', emphasized: true },
  ],
  component: CircleGridVisual,
}

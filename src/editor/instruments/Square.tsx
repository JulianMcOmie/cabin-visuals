import { useRef, useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import {
  Group, Mesh, LineSegments, LineBasicMaterial, MeshBasicMaterial,
  PlaneGeometry, BufferGeometry, BufferAttribute, Color,
} from 'three'
import { useInstrumentFrame } from '../core/engine/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. A line-outline square on a full-frame background plane,
// driven by MIDI triggers: distinct pitches move it around, spin it, and split it into
// top/bottom halves. Instead of integrating per-frame, each frame replays the track's
// control notes up to the current beat closed-form (velocity segments for move/rotate,
// exponential approach for split), so the visual is a pure function of `state.beat` —
// pausing freezes it and scrubbing lands on exactly what playback shows.

// MIDI pitch assignments
const RETURN_ORIGIN_PITCH = 36 // C2
const MOVE_LEFT_PITCH = 37     // C#2
const MOVE_UP_PITCH = 38       // D2
const MOVE_RIGHT_PITCH = 39    // D#2
const MOVE_DOWN_PITCH = 40     // E2
const STOP_MOVE_PITCH = 41     // F2
const ROTATE_LEFT_PITCH = 42   // F#2
const ROTATE_RIGHT_PITCH = 43  // G2
const STOP_ROTATE_PITCH = 44   // G#2
const SPLIT_PITCH = 45         // A2
const UNSPLIT_PITCH = 46       // A#2

const PARAMS: ParamDef[] = [
  { key: 'squareSize', label: 'Square Size', min: 0.05, max: 1, step: 0.05, default: 0.3 },
  { key: 'moveSpeed', label: 'Move Speed', min: 0.1, max: 10, step: 0.1, default: 2 },
  { key: 'rotateSpeed', label: 'Rotate Speed', min: 0.1, max: 10, step: 0.1, default: 1.5 },
  { key: 'splitSpeed', label: 'Split Speed', min: 0.5, max: 20, step: 0.5, default: 4 },
  { key: 'splitDistance', label: 'Split Distance', min: 0.05, max: 1, step: 0.05, default: 0.4 },
  { key: 'offsetX', label: 'X Offset', min: -2, max: 2, step: 0.05, default: 0 },
  { key: 'offsetY', label: 'Y Offset', min: -2, max: 2, step: 0.05, default: 0 },
  { key: 'bgOpacity', label: 'Background Opacity', min: 0, max: 1, step: 0.05, default: 1 },
  { key: 'bgColor', label: 'Background Color', type: 'color', default: '#8B00FF' },
  { key: 'lineColor', label: 'Line Color', type: 'color', default: '#000000' },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

function SquareVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const { viewport } = useThree()
  const [ready, setReady] = useState(false)

  // Mesh refs
  const topLineRef = useRef<LineSegments | null>(null)
  const bottomLineRef = useRef<LineSegments | null>(null)
  const bgMeshRef = useRef<Mesh | null>(null)
  const topLineMaterialRef = useRef<LineBasicMaterial | null>(null)
  const bottomLineMaterialRef = useRef<LineBasicMaterial | null>(null)
  const bgMaterialRef = useRef<MeshBasicMaterial | null>(null)

  useEffect(() => {
    // Background plane
    const bgGeo = new PlaneGeometry(1, 1)
    const bgMat = new MeshBasicMaterial({
      color: new Color('#8B00FF'),
      transparent: true,
      opacity: 1,
      depthWrite: false,
    })
    const bgMesh = new Mesh(bgGeo, bgMat)
    bgMesh.position.z = -0.01
    bgMeshRef.current = bgMesh
    bgMaterialRef.current = bgMat

    // Square line geometry - split into top half and bottom half
    // Top half: top edge + upper portions of left and right edges
    const topPositions = new Float32Array([
      // Top edge: TL -> TR
      -0.5, 0.5, 0, 0.5, 0.5, 0,
      // Left edge upper: TL -> midpoint
      -0.5, 0.5, 0, -0.5, 0, 0,
      // Right edge upper: TR -> midpoint
      0.5, 0.5, 0, 0.5, 0, 0,
      // Middle edge (visible when split): left mid -> right mid
      -0.5, 0, 0, 0.5, 0, 0,
    ])

    // Bottom half: bottom edge + lower portions of left and right edges
    const bottomPositions = new Float32Array([
      // Bottom edge: BL -> BR
      -0.5, -0.5, 0, 0.5, -0.5, 0,
      // Left edge lower: midpoint -> BL
      -0.5, 0, 0, -0.5, -0.5, 0,
      // Right edge lower: midpoint -> BR
      0.5, 0, 0, 0.5, -0.5, 0,
      // Middle edge (visible when split): left mid -> right mid
      -0.5, 0, 0, 0.5, 0, 0,
    ])

    const topGeo = new BufferGeometry()
    topGeo.setAttribute('position', new BufferAttribute(topPositions, 3))
    const topMat = new LineBasicMaterial({ color: 0x000000, linewidth: 1 })
    const topLine = new LineSegments(topGeo, topMat)
    topLineRef.current = topLine
    topLineMaterialRef.current = topMat

    const bottomGeo = new BufferGeometry()
    bottomGeo.setAttribute('position', new BufferAttribute(bottomPositions, 3))
    const bottomMat = new LineBasicMaterial({ color: 0x000000, linewidth: 1 })
    const bottomLine = new LineSegments(bottomGeo, bottomMat)
    bottomLineRef.current = bottomLine
    bottomLineMaterialRef.current = bottomMat

    setReady(true)

    return () => {
      bgGeo.dispose()
      bgMat.dispose()
      topGeo.dispose()
      topMat.dispose()
      bottomGeo.dispose()
      bottomMat.dispose()
    }
  }, [])

  // Add meshes to group
  useEffect(() => {
    if (!ready || !groupRef.current) return
    const g = groupRef.current
    if (bgMeshRef.current) g.add(bgMeshRef.current)
    if (topLineRef.current) g.add(topLineRef.current)
    if (bottomLineRef.current) g.add(bottomLineRef.current)

    return () => {
      if (bgMeshRef.current) g.remove(bgMeshRef.current)
      if (topLineRef.current) g.remove(topLineRef.current)
      if (bottomLineRef.current) g.remove(bottomLineRef.current)
    }
  }, [ready])

  useInstrumentFrame(trackId, (state) => {
    const p = state.params
    const squareSize = p.squareSize ?? 0.3
    const moveSpeed = p.moveSpeed ?? 2
    const rotateSpeed = p.rotateSpeed ?? 1.5
    const splitSpeed = p.splitSpeed ?? 4
    const splitDistance = p.splitDistance ?? 0.4
    const offsetX = p.offsetX ?? 0
    const offsetY = p.offsetY ?? 0
    const bgOpacity = p.bgOpacity ?? 1
    const bgColor = state.stringParams.bgColor ?? '#8B00FF'
    const lineColor = state.stringParams.lineColor ?? '#000000'

    const vMin = Math.min(viewport.width, viewport.height)
    const scale = vMin * squareSize

    // Replay the control-note history up to the current beat, closed-form.
    // Position/rotation are piecewise-linear (constant-velocity segments between
    // trigger notes); split is the exact solution of the old per-frame exponential
    // lerp, re-anchored at each SPLIT/UNSPLIT. Same-beat ties break by ascending
    // pitch, which reproduces the old trigger-processing order (e.g. STOP beats
    // MOVE, RIGHT beats LEFT).
    const events = state.notes
      .filter((n) => n.pitch >= RETURN_ORIGIN_PITCH && n.pitch <= UNSPLIT_PITCH && n.beat <= state.beat)
      .sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)

    let posX = 0
    let posY = 0
    let velX = 0
    let velY = 0
    let rotation = 0
    let rotVel = 0
    let segBeat = 0 // beat of the last velocity/rotation change
    let splitTarget = 0 // 0 or 1
    let splitAnchor = 0 // split amount at the last target change (0 = together, 1 = fully split)
    let splitBeat = 0 // beat of the last target change

    // Advance position/rotation from segBeat to `beat` at the current velocities.
    const advanceTo = (beat: number) => {
      const dt = (beat - segBeat) * state.secPerBeat
      posX += velX * dt
      posY += velY * dt
      rotation += rotVel * dt
      segBeat = beat
    }
    // Split amount at `beat`: exponential approach from the last anchor.
    const splitAt = (beat: number) =>
      splitTarget + (splitAnchor - splitTarget) * Math.exp(-splitSpeed * (beat - splitBeat) * state.secPerBeat)

    for (const n of events) {
      switch (n.pitch) {
        case RETURN_ORIGIN_PITCH:
          advanceTo(n.beat)
          posX = 0
          posY = 0
          velX = 0
          velY = 0
          break
        case MOVE_LEFT_PITCH:
          advanceTo(n.beat)
          velX = -moveSpeed
          break
        case MOVE_UP_PITCH:
          advanceTo(n.beat)
          velY = moveSpeed
          break
        case MOVE_RIGHT_PITCH:
          advanceTo(n.beat)
          velX = moveSpeed
          break
        case MOVE_DOWN_PITCH:
          advanceTo(n.beat)
          velY = -moveSpeed
          break
        case STOP_MOVE_PITCH:
          advanceTo(n.beat)
          velX = 0
          velY = 0
          break
        case ROTATE_LEFT_PITCH:
          advanceTo(n.beat)
          rotVel = rotateSpeed
          break
        case ROTATE_RIGHT_PITCH:
          advanceTo(n.beat)
          rotVel = -rotateSpeed
          break
        case STOP_ROTATE_PITCH:
          advanceTo(n.beat)
          rotVel = 0
          break
        case SPLIT_PITCH:
          splitAnchor = splitAt(n.beat)
          splitTarget = 1
          splitBeat = n.beat
          break
        case UNSPLIT_PITCH:
          splitAnchor = splitAt(n.beat)
          splitTarget = 0
          splitBeat = n.beat
          break
      }
    }
    advanceTo(state.beat)
    const splitAmount = splitAt(state.beat)

    const splitOffset = splitAmount * splitDistance * vMin * 0.5

    // Update background
    if (bgMeshRef.current && bgMaterialRef.current) {
      bgMaterialRef.current.color.set(bgColor)
      bgMaterialRef.current.opacity = bgOpacity
      bgMeshRef.current.scale.set(viewport.width, viewport.height, 1)
      bgMeshRef.current.position.set(offsetX * vMin, offsetY * vMin, -0.01)
    }

    // Update line colors
    if (topLineMaterialRef.current) {
      topLineMaterialRef.current.color.set(lineColor)
    }
    if (bottomLineMaterialRef.current) {
      bottomLineMaterialRef.current.color.set(lineColor)
    }

    // Position the square halves
    const baseX = posX + offsetX * vMin
    const baseY = posY + offsetY * vMin

    if (topLineRef.current) {
      topLineRef.current.position.set(baseX, baseY + splitOffset, 0)
      topLineRef.current.rotation.z = rotation
      topLineRef.current.scale.set(scale, scale, 1)
    }
    if (bottomLineRef.current) {
      bottomLineRef.current.position.set(baseX, baseY - splitOffset, 0)
      bottomLineRef.current.rotation.z = rotation
      bottomLineRef.current.scale.set(scale, scale, 1)
    }
  })

  if (!ready) return null
  return <group ref={groupRef} />
}

export const squareInstrument: ObjectInstrumentDef = {
  id: 'square',
  name: 'Square',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: SquareVisual,
  fullFrame: true,
}

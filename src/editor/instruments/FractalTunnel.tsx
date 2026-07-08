import { useRef, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Mesh, CanvasTexture, LinearFilter, MeshBasicMaterial } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW. A hypnotic fractal-flower tunnel: a recursive branching
// "flower" is drawn twice (near + far), connected by tunnel lines, projected with a
// simple perspective onto a 2D canvas that's mapped to a full-frame plane. The spiral,
// spread and hue slowly oscillate over musical beats; new notes bump the hue (or spawn
// colour-inversion pulse rings). Drawing math is Tyler's verbatim; only the state reads
// are rewired: engine getTrackState → getObjectState, and all motion derives from
// `state.beat` — hue bumps and pulse rings are computed from `state.notes` each frame
// (note-onset ages, not a spawned list), so scrub == playback.

interface Point3D {
  x: number
  y: number
  z: number
  hue: number
  generation: number
}

interface Branch {
  points: Point3D[]
  generation: number
  hue: number
}

interface BranchParams {
  symmetry: number
  branchCount: number
  generations: number
  spiralAmount: number
  lengthDecay: number
  spreadAngle: number
  hueShift: number
  baseHue: number
}

const CONFIG = {
  backFlowerZ: -250,
  backFlowerScale: 20,
  frontFlowerZ: 500,
  focalLength: 800,
  tunnelLineOpacity: 0.5,
  baseLength: 80,
  oscSpeed: 1,
}

function project(
  x: number, y: number, z: number,
  centerX: number, centerY: number,
  focalLength: number
): { x: number; y: number; scale: number } | null {
  const perspectiveZ = focalLength - z
  if (perspectiveZ <= 0) return null
  const scale = focalLength / perspectiveZ
  return { x: centerX + x * scale, y: centerY + y * scale, scale }
}

function generateBranches(
  baseLength: number,
  zPosition: number,
  scale: number,
  params: BranchParams,
  globalDirectionFlip: number
): Branch[] {
  const branches: Branch[] = []

  const addBranches = (
    x: number, y: number,
    angle: number,
    length: number,
    gen: number,
    hue: number,
    direction: number
  ) => {
    if (gen >= params.generations) return

    const segments = 20
    const points: Point3D[] = []
    let currentX = x
    let currentY = y
    let currentAngle = angle

    points.push({ x: currentX, y: currentY, z: zPosition, hue, generation: gen })

    for (let i = 1; i <= segments; i++) {
      const t = i / segments
      currentAngle = angle + t * params.spiralAmount * direction * globalDirectionFlip * Math.PI
      const segLength = (length * scale) / segments
      currentX += Math.cos(currentAngle) * segLength
      currentY += Math.sin(currentAngle) * segLength
      points.push({ x: currentX, y: currentY, z: zPosition, hue, generation: gen })
    }

    branches.push({ points, generation: gen, hue })

    const childLength = length * params.lengthDecay
    const endAngle = currentAngle

    for (let i = 0; i < params.branchCount; i++) {
      const fanOffset = ((i / (params.branchCount - 1 || 1)) - 0.5) * params.spreadAngle * Math.PI
      const childAngle = endAngle + fanOffset
      const childDirection = (i / (params.branchCount - 1 || 1)) * 2 - 1
      const childHue = (hue + params.hueShift + i * params.hueShift * 0.3) % 1
      addBranches(currentX, currentY, childAngle, childLength, gen + 1, childHue, childDirection)
    }
  }

  for (let i = 0; i < params.symmetry; i++) {
    const angle = (i / params.symmetry) * Math.PI * 2 - Math.PI / 2
    addBranches(0, 0, angle, baseLength, 0, params.baseHue, 1)
  }

  return branches
}

function getEndpoints(branches: Branch[], maxGen: number): Point3D[] {
  const endpoints: Point3D[] = []
  branches.forEach(branch => {
    if (branch.generation === maxGen - 1) {
      endpoints.push(branch.points[branch.points.length - 1])
    }
  })
  return endpoints
}

function renderTunnelLines(
  ctx: CanvasRenderingContext2D,
  frontEndpoints: Point3D[],
  backEndpoints: Point3D[],
  centerX: number, centerY: number,
  focalLength: number, opacity: number, glowIntensity: number
) {
  const count = Math.min(frontEndpoints.length, backEndpoints.length)
  for (let i = 0; i < count; i++) {
    const back = backEndpoints[i]
    const front = frontEndpoints[i]

    ctx.beginPath()
    const segments = 30
    let started = false

    for (let s = 0; s <= segments; s++) {
      const t = s / segments
      const x = back.x + (front.x - back.x) * t
      const y = back.y + (front.y - back.y) * t
      const z = back.z + (front.z - back.z) * t

      const projected = project(x, y, z, centerX, centerY, focalLength)
      if (!projected) continue

      if (!started) {
        ctx.moveTo(projected.x, projected.y)
        started = true
      } else {
        ctx.lineTo(projected.x, projected.y)
      }
    }

    const hue = ((front.hue + back.hue) / 2) * 360
    ctx.strokeStyle = `hsla(${hue}, 80%, 60%, ${opacity})`
    ctx.lineWidth = 1
    ctx.shadowColor = `hsla(${hue}, 80%, 60%, ${glowIntensity * 0.5})`
    ctx.shadowBlur = 8
    ctx.stroke()
  }
}

function renderBranches(
  ctx: CanvasRenderingContext2D,
  branches: Branch[],
  centerX: number, centerY: number,
  focalLength: number, lineWidth: number, glowIntensity: number,
  hueOffset: number = 0
) {
  branches.sort((a, b) => a.generation - b.generation)

  branches.forEach(branch => {
    ctx.beginPath()
    let started = false

    branch.points.forEach(point => {
      const projected = project(point.x, point.y, point.z, centerX, centerY, focalLength)
      if (!projected) return

      if (!started) {
        ctx.moveTo(projected.x, projected.y)
        started = true
      } else {
        ctx.lineTo(projected.x, projected.y)
      }
    })

    const alpha = Math.max(0.2, 1 - branch.generation * 0.15)
    const lightness = 50 + branch.generation * 5
    const saturation = 90 - branch.generation * 5
    const width = lineWidth * Math.pow(0.7, branch.generation)
    const hue = ((branch.hue + hueOffset) % 1) * 360

    ctx.strokeStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowColor = `hsla(${hue}, ${saturation}%, ${lightness}%, ${glowIntensity})`
    ctx.shadowBlur = 10 + branch.generation * 2
    ctx.stroke()
  })
}

function compositePulseRings(
  ctx: CanvasRenderingContext2D,
  invertedCanvas: HTMLCanvasElement,
  centerX: number, centerY: number,
  pulses: { radius: number; bandWidth: number; opacity: number }[]
) {
  if (pulses.length === 0) return

  for (const pulse of pulses) {
    ctx.save()

    ctx.beginPath()
    ctx.arc(centerX, centerY, pulse.radius, 0, Math.PI * 2)
    ctx.arc(centerX, centerY, Math.max(0, pulse.radius - pulse.bandWidth), 0, Math.PI * 2, true)
    ctx.closePath()
    ctx.clip()

    ctx.globalAlpha = pulse.opacity
    ctx.drawImage(invertedCanvas, 0, 0)

    ctx.restore()
  }
}

function renderEndpointDots(
  ctx: CanvasRenderingContext2D,
  branches: Branch[],
  maxGen: number,
  centerX: number, centerY: number,
  focalLength: number, elapsed: number
) {
  const pulse = 0.5 + 0.5 * Math.sin(elapsed * Math.PI * 3)

  branches.filter(b => b.generation === maxGen - 1).forEach(branch => {
    const lastPoint = branch.points[branch.points.length - 1]
    const projected = project(lastPoint.x, lastPoint.y, lastPoint.z, centerX, centerY, focalLength)
    if (!projected) return

    const dotRadius = Math.max(1, (2 + pulse * 1.5) * projected.scale * 0.8)

    ctx.beginPath()
    ctx.arc(projected.x, projected.y, dotRadius, 0, Math.PI * 2)
    ctx.fillStyle = `hsla(${branch.hue * 360}, 100%, 70%, 0.9)`
    ctx.shadowColor = `hsla(${branch.hue * 360}, 100%, 70%, 1)`
    ctx.shadowBlur = 15
    ctx.fill()
  })
}

const PARAMS: ParamDef[] = [
  { key: 'symmetry', label: 'Symmetry', min: 2, max: 12, step: 1, default: 6 },
  { key: 'branchCount', label: 'Branches', min: 1, max: 5, step: 1, default: 3 },
  { key: 'generations', label: 'Generations', min: 1, max: 5, step: 1, default: 3 },
  { key: 'spiralAmount', label: 'Spiral', min: 0, max: 2, step: 0.1, default: 0.9 },
  { key: 'lengthDecay', label: 'Length Decay', min: 0.4, max: 1, step: 0.05, default: 0.8 },
  { key: 'spreadAngle', label: 'Spread Angle', min: 0.5, max: 3, step: 0.1, default: 1.6 },
  { key: 'hueShift', label: 'Hue Shift', min: 0, max: 0.3, step: 0.01, default: 0.09 },
  { key: 'baseHue', label: 'Base Hue', min: 0, max: 1, step: 0.05, default: 0.48 },
  { key: 'lineWidth', label: 'Line Width', min: 1, max: 10, step: 0.5, default: 4 },
  { key: 'glowIntensity', label: 'Glow', min: 0, max: 1, step: 0.1, default: 0.9 },
  { key: 'bgColor', label: 'Background Color', type: 'color', default: '#050508' },
  { key: 'colorPulse', label: 'Color Pulse', type: 'boolean', default: 0 },
  { key: 'pulseSpeed', label: 'Pulse Speed', min: 50, max: 500, step: 10, default: 200 },
  { key: 'pulseBandWidth', label: 'Band Width', min: 10, max: 100, step: 5, default: 40 },
  { key: 'pulseFadeDuration', label: 'Fade Duration', min: 0.5, max: 5, step: 0.1, default: 2.0 },
]
function FractalTunnelVisual({ trackId }: { trackId: string }) {
  const { viewport } = useThree()
  const meshRef = useRef<Mesh>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const offscreenNormalRef = useRef<HTMLCanvasElement | null>(null)
  const offscreenInvertedRef = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)

  // The backing canvases match the visual window's ASPECT (height fixed, width
  // follows), so the tunnel genuinely fills the frame at any window size with no
  // squash — the drawing is projection-based and spreads into whatever canvas it
  // gets. Quantized so live resizes only recreate on meaningful aspect changes.
  const aspect = viewport.height > 0 ? viewport.width / viewport.height : 1
  const texH = 1024
  const texW = Math.max(256, Math.min(2048, Math.round((texH * aspect) / 64) * 64))

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = texW
    canvas.height = texH
    canvasRef.current = canvas

    const offscreenNormal = document.createElement('canvas')
    offscreenNormal.width = texW
    offscreenNormal.height = texH
    offscreenNormalRef.current = offscreenNormal

    const offscreenInverted = document.createElement('canvas')
    offscreenInverted.width = texW
    offscreenInverted.height = texH
    offscreenInvertedRef.current = offscreenInverted

    const texture = new CanvasTexture(canvas)
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    textureRef.current = texture

    return () => {
      texture.dispose()
    }
  }, [texW])

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    if (!canvas || !texture || !mesh) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Time source: the playhead beat (seconds-tuned motion uses beat * secPerBeat).
    const elapsed = state.beat * state.secPerBeat
    const beat = state.beat * CONFIG.oscSpeed

    // Notes whose onset the playhead has passed — the pure replacement for onset
    // detection: hue bumps and pulse rings derive from these each frame.
    const pastNotes = state.notes.filter((n) => n.beat <= state.beat)

    const p = state.params
    const sp = state.stringParams
    const colorPulse = (p.colorPulse ?? 0) >= 0.5
    const pulseSpeed = p.pulseSpeed ?? 200
    const pulseBandWidth = p.pulseBandWidth ?? 40
    const pulseFadeDuration = p.pulseFadeDuration ?? 2.0

    const hueOffset = colorPulse ? 0 : (pastNotes.length * 30) % 360

    // Read settings from params
    const symmetry = p.symmetry ?? 6
    const branchCount = p.branchCount ?? 3
    const generations = p.generations ?? 3
    const spiralAmount = p.spiralAmount ?? 0.9
    const lengthDecay = p.lengthDecay ?? 0.8
    const spreadAngle = p.spreadAngle ?? 1.6
    const hueShift = p.hueShift ?? 0.09
    const baseHue = p.baseHue ?? 0.48
    const lineWidth = p.lineWidth ?? 4
    const glowIntensity = p.glowIntensity ?? 0.9

    const params: BranchParams = {
      symmetry,
      branchCount,
      generations,
      spiralAmount: spiralAmount + Math.sin(beat * Math.PI / 4) * 0.3,
      lengthDecay: lengthDecay + Math.sin(beat * Math.PI / 16 + 2) * 0.15,
      spreadAngle: spreadAngle + Math.sin(beat * Math.PI / 8 + 1) * 0.4,
      hueShift,
      baseHue: (baseHue + beat / 64 + hueOffset / 360) % 1,
    }

    const activePulses: { radius: number; bandWidth: number; opacity: number }[] = []
    if (colorPulse) {
      for (const note of pastNotes) {
        const age = (state.beat - note.beat) * state.secPerBeat
        const radius = age * pulseSpeed
        const opacity = Math.max(0, 1 - age / pulseFadeDuration)

        if (opacity <= 0) continue

        activePulses.push({ radius, bandWidth: pulseBandWidth, opacity })
      }
    }

    const frontBranches = generateBranches(
      CONFIG.baseLength, CONFIG.frontFlowerZ, 1, params, 1
    )
    const backBranches = generateBranches(
      CONFIG.baseLength, CONFIG.backFlowerZ, CONFIG.backFlowerScale, params, 1
    )

    const frontEndpoints = getEndpoints(frontBranches, generations)
    const backEndpoints = getEndpoints(backBranches, generations)

    const centerX = canvas.width / 2
    const centerY = canvas.height / 2

    const offscreenNormal = offscreenNormalRef.current
    const offscreenInverted = offscreenInvertedRef.current
    const normalCtx = offscreenNormal?.getContext('2d')
    const invertedCtx = offscreenInverted?.getContext('2d')

    const hasPulses = activePulses.length > 0

    if (hasPulses && offscreenNormal && offscreenInverted && normalCtx && invertedCtx) {
      normalCtx.clearRect(0, 0, offscreenNormal.width, offscreenNormal.height)
      renderTunnelLines(normalCtx, frontEndpoints, backEndpoints, centerX, centerY,
        CONFIG.focalLength, CONFIG.tunnelLineOpacity, glowIntensity)
      renderBranches(normalCtx, backBranches, centerX, centerY,
        CONFIG.focalLength, lineWidth, glowIntensity, 0)
      renderBranches(normalCtx, frontBranches, centerX, centerY,
        CONFIG.focalLength, lineWidth, glowIntensity, 0)
      renderEndpointDots(normalCtx, frontBranches, generations, centerX, centerY,
        CONFIG.focalLength, elapsed)
      normalCtx.shadowBlur = 0

      invertedCtx.clearRect(0, 0, offscreenInverted.width, offscreenInverted.height)
      renderTunnelLines(invertedCtx, frontEndpoints, backEndpoints, centerX, centerY,
        CONFIG.focalLength, CONFIG.tunnelLineOpacity, glowIntensity)
      renderBranches(invertedCtx, backBranches, centerX, centerY,
        CONFIG.focalLength, lineWidth, glowIntensity, 0.5)
      renderBranches(invertedCtx, frontBranches, centerX, centerY,
        CONFIG.focalLength, lineWidth, glowIntensity, 0.5)
      renderEndpointDots(invertedCtx, frontBranches, generations, centerX, centerY,
        CONFIG.focalLength, elapsed)
      invertedCtx.shadowBlur = 0

      ctx.fillStyle = sp.bgColor ?? '#050508'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(offscreenNormal, 0, 0)

      compositePulseRings(ctx, offscreenInverted, centerX, centerY, activePulses)
    } else {
      ctx.fillStyle = sp.bgColor ?? '#050508'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      renderTunnelLines(ctx, frontEndpoints, backEndpoints, centerX, centerY,
        CONFIG.focalLength, CONFIG.tunnelLineOpacity, glowIntensity)
      renderBranches(ctx, backBranches, centerX, centerY,
        CONFIG.focalLength, lineWidth, glowIntensity)
      renderBranches(ctx, frontBranches, centerX, centerY,
        CONFIG.focalLength, lineWidth, glowIntensity)
      renderEndpointDots(ctx, frontBranches, generations, centerX, centerY,
        CONFIG.focalLength, elapsed)

      ctx.shadowBlur = 0
    }

    texture.needsUpdate = true

    const material = mesh.material as MeshBasicMaterial
    if (material.map !== texture) {
      material.map = texture // (re)bound after an aspect-change recreation too
      material.needsUpdate = true
    }
  })

  // The plane IS the viewport (slight overscan): aspect matches the texture, so
  // the tunnel fills the whole frame undistorted at any window size, and resizes
  // with it. It sits at the full-frame group's origin — the distance `viewport`
  // is measured at.
  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[viewport.width * 1.02, viewport.height * 1.02]} />
      <meshBasicMaterial transparent opacity={1} depthWrite={false} />
    </mesh>
  )
}

export const fractalTunnelInstrument: ObjectInstrumentDef = {
  id: 'fractalTunnel',
  name: 'Fractal Tunnel',
  kind: 'object',
  params: PARAMS,
  component: FractalTunnelVisual,
  fullFrame: true,
}

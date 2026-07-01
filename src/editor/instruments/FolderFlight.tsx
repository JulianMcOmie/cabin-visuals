import { useRef, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, LinearFilter, DoubleSide } from 'three'
import { getObjectState } from '../core/engine/VisualEngine'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. 3D folder icons fly backward into z-depth — each note onset
// spawns a folder that pops in, drifts, tumbles, and fades out at max depth. Meshes are
// pooled. The folder icon is drawn procedurally to a canvas texture (no asset needed).
// Tyler's currentBeat/subdivRate spawn gating + legato glide are replaced with the cabin
// note-onset model (spawn per new note); spawn/flight/recycle math is otherwise preserved.

const PITCH_MIN = 60 // C4
const PITCH_MAX = 71 // B4
const MAX_SPRITES = 512

// ── Canvas rounded-rect helper (no native roundRect dependency) ──
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  rtl: number, rtr: number, rbr: number, rbl: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + rtl, y)
  ctx.lineTo(x + w - rtr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rtr)
  ctx.lineTo(x + w, y + h - rbr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rbr, y + h)
  ctx.lineTo(x + rbl, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rbl)
  ctx.lineTo(x, y + rtl)
  ctx.quadraticCurveTo(x, y, x + rtl, y)
  ctx.closePath()
}

// ── Folder icon texture (pre-rendered once, shared) ──
let _folderTexture: CanvasTexture | null = null
function getFolderTexture(): CanvasTexture {
  if (_folderTexture) return _folderTexture

  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  const sc = size / 32
  ctx.save()
  ctx.scale(sc, sc)

  // Folder tab
  ctx.fillStyle = '#F7D774'
  ctx.strokeStyle = '#D4A840'
  ctx.lineWidth = 0.5
  ctx.beginPath()
  ctx.moveTo(4, 10)
  ctx.lineTo(14, 10)
  ctx.lineTo(16, 7)
  ctx.lineTo(4, 7)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Folder body
  ctx.fillStyle = '#F7D774'
  ctx.strokeStyle = '#D4A840'
  roundedRect(ctx, 4, 10, 24, 16, 1, 1, 1, 1)
  ctx.fill()
  ctx.stroke()

  // Subtle front highlight
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  roundedRect(ctx, 4, 10, 24, 8, 1, 1, 0, 0)
  ctx.fill()

  ctx.restore()

  _folderTexture = new CanvasTexture(canvas)
  _folderTexture.minFilter = LinearFilter
  _folderTexture.magFilter = LinearFilter
  return _folderTexture
}

interface FolderSprite {
  mesh: Mesh
  mat: MeshBasicMaterial
  birthTime: number // performance.now() ms
  vx: number
  vy: number
  tumbleX: number
  tumbleY: number
  targetScale: number
}

const PARAMS: ParamDef[] = [
  { key: 'speed', label: 'Flight Speed', min: 2, max: 60, step: 1, default: 15 },
  { key: 'iconScale', label: 'Icon Scale', min: 0.1, max: 5, step: 0.1, default: 2 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 1 },
  { key: 'maxDepth', label: 'Max Depth', min: 10, max: 200, step: 5, default: 50 },
  { key: 'ySpread', label: 'Y Spread', min: 0, max: 10, step: 0.5, default: 4 },
  { key: 'drift', label: 'Drift', min: 0, max: 3, step: 0.1, default: 0.5 },
  { key: 'tumble', label: 'Tumble', min: 0, max: 5, step: 0.1, default: 1 },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

function FolderFlightVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const spritesRef = useRef<FolderSprite[]>([])
  const prevKeys = useRef<Set<string>>(new Set())
  const geo = useMemo(() => new PlaneGeometry(1, 1), [])

  useEffect(() => () => {
    const g = groupRef.current
    for (const spr of spritesRef.current) {
      if (g) g.remove(spr.mesh)
      spr.mat.dispose()
    }
    spritesRef.current = []
    geo.dispose()
  }, [geo])

  useFrame((_, delta) => {
    const group = groupRef.current
    if (!group) return
    const state = getObjectState(trackId)
    if (!state) return

    const p = state.params
    const speed = p.speed ?? 15
    const iconScale = p.iconScale ?? 2
    const opacity = p.opacity ?? 1
    const maxDepth = p.maxDepth ?? 50
    const ySpread = p.ySpread ?? 4
    const drift = p.drift ?? 0.5
    const tumble = p.tumble ?? 1

    const now = performance.now()

    // ── Spawn a folder on each new note onset ──
    const keys = new Set(state.activeNotes.map((n) => `${n.pitch}:${n.beat}`))
    for (const n of state.activeNotes) {
      if (n.pitch < PITCH_MIN || n.pitch > PITCH_MAX) continue
      const key = `${n.pitch}:${n.beat}`
      if (prevKeys.current.has(key)) continue
      if (spritesRef.current.length >= MAX_SPRITES) break

      // Velocity 0..1 (accept normalized or 0..127)
      const velocity = n.velocity <= 1 ? n.velocity : n.velocity / 127

      // Pitch → spawn Y within the spread band
      const pitchNorm = (n.pitch - PITCH_MIN) / Math.max(1, PITCH_MAX - PITCH_MIN)
      const spawnY = (pitchNorm - 0.5) * ySpread

      const mat = new MeshBasicMaterial({
        map: getFolderTexture(),
        transparent: true,
        opacity,
        side: DoubleSide,
        depthWrite: false,
        toneMapped: false,
      })
      const mesh = new Mesh(geo, mat)
      mesh.position.set(0, spawnY, -5)
      mesh.scale.setScalar(0.01) // springs up
      group.add(mesh)

      // Deterministic pseudo-random per onset (mirrors Tyler's seed math)
      const seed = Math.floor(n.beat * 13) + n.pitch * 7
      const pseudoRand = (m: number) => {
        const x = Math.sin(m * 9301 + 49297) * 233280
        return x - Math.floor(x)
      }

      spritesRef.current.push({
        mesh,
        mat,
        birthTime: now,
        vx: (pseudoRand(seed) - 0.5) * drift,
        vy: (pseudoRand(seed + 1) - 0.5) * drift * 0.6,
        tumbleX: (pseudoRand(seed + 2) - 0.5) * tumble,
        tumbleY: (pseudoRand(seed + 3) - 0.5) * tumble,
        targetScale: iconScale * (0.6 + velocity * 0.6),
      })
    }
    prevKeys.current = keys

    // ── Update existing sprites ──
    const dt = Math.min(delta, 0.05) // cap to avoid jumps
    const toRemove: number[] = []

    for (let i = 0; i < spritesRef.current.length; i++) {
      const spr = spritesRef.current[i]
      const mesh = spr.mesh

      // Fly backward into z-depth
      mesh.position.z -= speed * dt
      // Drift in x/y as they fly away
      mesh.position.x += spr.vx * dt
      mesh.position.y += spr.vy * dt
      // Tumble rotation
      mesh.rotation.x += spr.tumbleX * dt
      mesh.rotation.y += spr.tumbleY * dt

      // Spring scale animation (quick pop-in), age in seconds
      const age = (now - spr.birthTime) / 1000
      const springProgress = Math.min(age * 8, 1)
      const spring = 1 - Math.pow(1 - springProgress, 3) // ease out cubic
      mesh.scale.setScalar(spr.targetScale * spring)

      // Fade out near max depth
      const depth = -mesh.position.z
      const fadeStart = maxDepth * 0.7
      if (depth > fadeStart) {
        spr.mat.opacity = opacity * Math.max(0, 1 - (depth - fadeStart) / (maxDepth - fadeStart))
      } else {
        spr.mat.opacity = opacity
      }

      // Cull past max depth
      if (depth > maxDepth) toRemove.push(i)
    }

    // Remove culled sprites (reverse order to keep indices stable)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i]
      const spr = spritesRef.current[idx]
      group.remove(spr.mesh)
      spr.mat.dispose()
      spritesRef.current.splice(idx, 1)
    }
  })

  return <group ref={groupRef} />
}

export const folderFlightInstrument: ObjectInstrumentDef = {
  id: 'folderFlight',
  name: 'Folder Flight',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: FolderFlightVisual,
}

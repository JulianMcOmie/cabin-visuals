import { useRef, useEffect, useMemo } from 'react'
import { Group, Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, LinearFilter, DoubleSide } from 'three'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW. 3D folder icons fly backward into z-depth - each note in the
// C4 octave is a folder that pops in, drifts, tumbles, and fades out at max depth. Every
// folder's pose is closed-form from its age (beats since onset → seconds), so a static
// playhead is a static frame and scrubbing in either direction is exact. Meshes are
// pooled. The folder icon is drawn procedurally to a canvas texture (no asset needed).

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

interface Pooled { mesh: Mesh; mat: MeshBasicMaterial; active: boolean }

const PARAMS: ParamDef[] = [
  { key: 'speed', label: 'Flight Speed', min: 2, max: 60, step: 1, default: 15 },
  { key: 'iconScale', label: 'Icon Scale', min: 0.1, max: 5, step: 0.1, default: 2 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 1 },
  { key: 'maxDepth', label: 'Max Depth', min: 10, max: 200, step: 5, default: 50 },
  { key: 'ySpread', label: 'Y Spread', min: 0, max: 10, step: 0.5, default: 4 },
  { key: 'drift', label: 'Drift', min: 0, max: 3, step: 0.1, default: 0.5 },
  { key: 'tumble', label: 'Tumble', min: 0, max: 5, step: 0.1, default: 1 },
]
function FolderFlightVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const poolRef = useRef<Pooled[]>([])
  const geo = useMemo(() => new PlaneGeometry(1, 1), [])

  useEffect(() => () => {
    const g = groupRef.current
    for (const p of poolRef.current) {
      if (g) g.remove(p.mesh)
      p.mat.dispose()
    }
    poolRef.current = []
    geo.dispose()
  }, [geo])

  // Per-sprite material because each folder fades independently near max depth
  function acquire(group: Group): Pooled {
    for (const p of poolRef.current) if (!p.active) { p.active = true; p.mesh.visible = true; return p }
    const mat = new MeshBasicMaterial({
      map: getFolderTexture(),
      transparent: true,
      opacity: 1,
      side: DoubleSide,
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new Mesh(geo, mat)
    group.add(mesh)
    const entry: Pooled = { mesh, mat, active: true }
    poolRef.current.push(entry)
    return entry
  }

  useInstrumentFrame(trackId, (state) => {
    const group = groupRef.current
    if (!group) return

    const p = state.params
    const speed = p.speed ?? 15
    const iconScale = p.iconScale ?? 2
    const opacity = p.opacity ?? 1
    const maxDepth = p.maxDepth ?? 50
    const ySpread = p.ySpread ?? 4
    const drift = p.drift ?? 0.5
    const tumble = p.tumble ?? 1

    const currentBeat = state.beat
    const secPerBeat = state.secPerBeat
    const fadeStart = maxDepth * 0.7

    for (const pm of poolRef.current) { pm.active = false; pm.mesh.visible = false }

    let rendered = 0
    for (const n of state.notes) {
      if (n.pitch < PITCH_MIN || n.pitch > PITCH_MAX) continue

      // Age in seconds since onset; folders don't exist before their note plays
      const ageSec = (currentBeat - n.beat) * secPerBeat
      if (ageSec < 0) continue

      // Fly backward into z-depth from the spawn plane; cull past max depth
      const z = -5 - speed * ageSec
      const depth = -z
      if (depth > maxDepth) continue
      if (rendered >= MAX_SPRITES) break

      // Velocity 0..1 (accept normalized or 0..127)
      const velocity = n.velocity <= 1 ? n.velocity : n.velocity / 127

      // Pitch → spawn Y within the spread band
      const pitchNorm = (n.pitch - PITCH_MIN) / Math.max(1, PITCH_MAX - PITCH_MIN)
      const spawnY = (pitchNorm - 0.5) * ySpread

      // Deterministic pseudo-random per onset (mirrors Tyler's seed math)
      const seed = Math.floor(n.beat * 13) + n.pitch * 7
      const vx = (seededRand(seed) - 0.5) * drift
      const vy = (seededRand(seed + 1) - 0.5) * drift * 0.6
      const tumbleX = (seededRand(seed + 2) - 0.5) * tumble
      const tumbleY = (seededRand(seed + 3) - 0.5) * tumble

      const pooled = acquire(group)
      const mesh = pooled.mesh

      // Drift in x/y as they fly away
      mesh.position.set(vx * ageSec, spawnY + vy * ageSec, z)
      // Tumble rotation
      mesh.rotation.set(tumbleX * ageSec, tumbleY * ageSec, 0)

      // Spring scale animation (quick pop-in)
      const targetScale = iconScale * (0.6 + velocity * 0.6)
      const springProgress = Math.min(ageSec * 8, 1)
      const spring = 1 - Math.pow(1 - springProgress, 3) // ease out cubic
      mesh.scale.setScalar(targetScale * spring)

      // Fade out near max depth
      if (depth > fadeStart) {
        pooled.mat.opacity = opacity * Math.max(0, 1 - (depth - fadeStart) / (maxDepth - fadeStart))
      } else {
        pooled.mat.opacity = opacity
      }

      rendered++
    }
  })

  return <group ref={groupRef} />
}

export const folderFlightInstrument: ObjectInstrumentDef = {
  id: 'folderFlight',
  name: 'Folder Flight',
  kind: 'object',
  params: PARAMS,
  midiRows: [
    { pitch: 71, label: 'Launch folder · top' },
    { pitch: 69, label: 'Launch folder · high' },
    { pitch: 67, label: 'Launch folder · above middle' },
    { pitch: 65, label: 'Launch folder · middle' },
    { pitch: 64, label: 'Launch folder · below middle' },
    { pitch: 62, label: 'Launch folder · low' },
    { pitch: 60, label: 'Launch folder · bottom' },
  ],
  component: FolderFlightVisual,
}

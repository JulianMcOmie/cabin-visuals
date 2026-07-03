import { useRef, useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import {
  Group, Mesh, LineSegments, Points,
  PlaneGeometry, MeshBasicMaterial, LineBasicMaterial, PointsMaterial,
  BufferGeometry, BufferAttribute, Color,
} from 'three'
import { useInstrumentFrame } from '../core/engine/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. Generative metronome-ball line drawings: three
// foreground panels + a rotating background "flower", all built from balls that
// pendulum outward, alternating kick/snare turns each beat. The trajectory math
// (computePattern / computePatternBounce) is Tyler's VERBATIM. Full-frame 2D scene,
// sized to the viewport like Square.tsx. Note-ons (a new `${pitch}:${beat}` key)
// nudge the fg/bg angles and swap palettes; the background rotation is BEAT-synced
// (driven by currentBeat, not wall-clock) so it tracks the transport. Tyler's
// Managed* line/dot pools, displacement shader, ink/spiral/snare-bounce sub-effects
// are collapsed away — this keeps the signature look with plain three primitives.

// --- Palettes: [background, foreground/lines, accent/bg-flower] ---
interface Palette { bg: number; fg: number; accent: number }
const PALETTES: Record<string, Palette> = {
  default:  { bg: 0xf5f2eb, fg: 0x1a2744, accent: 0xb5563e },
  sepia:    { bg: 0xe8dcc8, fg: 0x3b2612, accent: 0x8b5e34 },
  midnight: { bg: 0x0d1117, fg: 0xc9d1d9, accent: 0xd4a847 },
  botanical:{ bg: 0xeae6df, fg: 0x2d4a3e, accent: 0xb47a4e },
  plum:     { bg: 0xf0e8f0, fg: 0x3a1f4a, accent: 0xc25a7c },
  crimson:  { bg: 0x0a0a0a, fg: 0xdc143c, accent: 0x8b0000 },
  scarlet:  { bg: 0xdc143c, fg: 0x0a0a0a, accent: 0x8b0000 },
}

// MIDI trigger pitches (subset of Tyler's — the ones that map to what we render)
const PITCH_FG = 48          // nudge foreground angles + rotate
const PITCH_BG = 50          // nudge background angles + rotate flower
const PITCH_INVERT = 56      // swap bg/fg
const PITCH_PAL_SEPIA = 58
const PITCH_PAL_MIDNIGHT = 60
const PITCH_PAL_BOTANICAL = 62
const PITCH_PAL_PLUM = 64
const PITCH_PAL_CRIMSON = 65
const PITCH_PAL_SCARLET = 92
const PAL_PITCHES: [number, string][] = [
  [PITCH_PAL_SEPIA, 'sepia'], [PITCH_PAL_MIDNIGHT, 'midnight'],
  [PITCH_PAL_BOTANICAL, 'botanical'], [PITCH_PAL_PLUM, 'plum'],
  [PITCH_PAL_CRIMSON, 'crimson'], [PITCH_PAL_SCARLET, 'scarlet'],
]

// --- Simulation constants (Tyler's) ---
const SIM_BEATS = 200
const STEPS_PER_BEAT = 30
const BG_BALLS = 32
const BG_SPEED = 3
const BG_SCALE = 1.8
const PATTERN_EXTENT = 500
const MAX_EXTENT = PATTERN_EXTENT * 2
const MAX_POINTS_PER_LINE = SIM_BEATS * STEPS_PER_BEAT + 1
const MAX_BALLS = 80
const BG_ROTATION_STEP = (Math.PI * 2) / 24

function deg2rad(d: number): number {
  return (d * Math.PI) / 180
}

interface Trajectory {
  points: Float32Array
  count: number
}

// --- Pattern computation (Tyler's VERBATIM) ---
function computePattern(
  balls: number,
  kickAngle: number,
  snareAngle: number,
  baseSpeed: number,
): Trajectory[] {
  const result: Trajectory[] = []
  const maxPoints = SIM_BEATS * STEPS_PER_BEAT + 1

  for (let i = 0; i < balls; i++) {
    let angle = (i / balls) * Math.PI * 2
    let x = 0, y = 0
    const pts = new Float32Array(maxPoints * 2)
    pts[0] = 0; pts[1] = 0
    let count = 1
    let alive = true

    for (let beat = 0; beat < SIM_BEATS && alive; beat++) {
      const bim = beat % 4
      let speed: number
      if (bim === 0 || bim === 2) { angle += kickAngle; speed = Math.abs(baseSpeed) }
      else { angle -= snareAngle; speed = -Math.abs(baseSpeed) }
      const dx = Math.cos(angle) * speed
      const dy = Math.sin(angle) * speed

      for (let s = 0; s < STEPS_PER_BEAT && alive; s++) {
        x += dx; y += dy
        if (Math.abs(x) > MAX_EXTENT || Math.abs(y) > MAX_EXTENT) { alive = false }
        else { pts[count * 2] = x; pts[count * 2 + 1] = y; count++ }
      }
    }
    result.push({ points: pts, count })
  }
  return result
}

// --- Line rendering: convert a trajectory strip into segment pairs ---
// A polyline of N points → (N-1) segments → (N-1)*2 vertices for LineSegments.
function buildLineGeometry(maxLines: number): BufferGeometry {
  const g = new BufferGeometry()
  const maxVerts = maxLines * (MAX_POINTS_PER_LINE - 1) * 2
  g.setAttribute('position', new BufferAttribute(new Float32Array(maxVerts * 3), 3))
  g.setDrawRange(0, 0)
  return g
}
function buildDotGeometry(maxDots: number): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(maxDots * 3), 3))
  g.setDrawRange(0, 0)
  return g
}

/** Write trajectories into a LineSegments position buffer (scaled, x-offset). Returns vertex count. */
function fillLines(geo: BufferGeometry, trajs: Trajectory[], balls: number, scale: number, offsetX: number): number {
  const pos = (geo.getAttribute('position') as BufferAttribute).array as Float32Array
  let v = 0
  for (let bi = 0; bi < balls; bi++) {
    const traj = trajs[bi]
    if (!traj || traj.count < 2) continue
    for (let i = 0; i < traj.count - 1; i++) {
      const ax = traj.points[i * 2] * scale + offsetX
      const ay = traj.points[i * 2 + 1] * scale
      const bx = traj.points[(i + 1) * 2] * scale + offsetX
      const by = traj.points[(i + 1) * 2 + 1] * scale
      pos[v * 3] = ax; pos[v * 3 + 1] = ay; pos[v * 3 + 2] = 0; v++
      pos[v * 3] = bx; pos[v * 3 + 1] = by; pos[v * 3 + 2] = 0; v++
    }
  }
  geo.setDrawRange(0, v)
  ;(geo.getAttribute('position') as BufferAttribute).needsUpdate = true
  geo.computeBoundingSphere()
  return v
}

/** Write the final (head) point of each trajectory as a dot. */
function fillDots(geo: BufferGeometry, trajs: Trajectory[], balls: number, scale: number, offsetX: number): number {
  const pos = (geo.getAttribute('position') as BufferAttribute).array as Float32Array
  let d = 0
  for (let bi = 0; bi < balls; bi++) {
    const traj = trajs[bi]
    if (!traj || traj.count < 1) continue
    const lx = traj.points[(traj.count - 1) * 2] * scale + offsetX
    const ly = traj.points[(traj.count - 1) * 2 + 1] * scale
    pos[d * 3] = lx; pos[d * 3 + 1] = ly; pos[d * 3 + 2] = 0; d++
  }
  geo.setDrawRange(0, d)
  ;(geo.getAttribute('position') as BufferAttribute).needsUpdate = true
  geo.computeBoundingSphere()
  return d
}

const PARAMS: ParamDef[] = [
  { key: 'balls', label: 'Balls', min: 1, max: MAX_BALLS, step: 1, default: 24 },
  { key: 'kickStart', label: 'Kick Start (deg)', min: 1, max: 180, step: 1, default: 37 },
  { key: 'snareStart', label: 'Snare Start (deg)', min: 1, max: 180, step: 1, default: 53 },
  { key: 'kickStep', label: 'Kick Step (deg)', min: -10, max: 10, step: 0.1, default: 3 },
  { key: 'snareStep', label: 'Snare Step (deg)', min: -10, max: 10, step: 0.1, default: 2 },
  { key: 'speed', label: 'Speed', min: 0.5, max: 8, step: 0.1, default: 2 },
  { key: 'dotSize', label: 'Dot Size', min: 0.5, max: 8, step: 0.5, default: 2 },
  { key: 'lineOpacity', label: 'Line Opacity', min: 0.02, max: 0.6, step: 0.02, default: 0.2 },
  { key: 'fgMultiplier', label: 'FG Multiplier', min: 0.1, max: 10, step: 0.1, default: 1 },
  { key: 'bgMultiplier', label: 'BG Multiplier', min: 0.1, max: 20, step: 0.1, default: 4 },
  { key: 'bgRotateRate', label: 'BG Rotate/Beat', min: 0, max: 2, step: 0.05, default: 0.5 },
]
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

const _c = new Color()

function MetronomeBallsVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const { viewport } = useThree()
  const [ready, setReady] = useState(false)

  // Meshes / materials
  const paperRef = useRef<Mesh | null>(null)
  const paperMatRef = useRef<MeshBasicMaterial | null>(null)
  const bgLinesRef = useRef<LineSegments | null>(null)
  const bgDotsRef = useRef<Points | null>(null)
  const bgLineMatRef = useRef<LineBasicMaterial | null>(null)
  const bgDotMatRef = useRef<PointsMaterial | null>(null)
  const bgGroupRef = useRef<Group | null>(null)
  const fgLinesRef = useRef<LineSegments | null>(null)
  const fgDotsRef = useRef<Points | null>(null)
  const fgLineMatRef = useRef<LineBasicMaterial | null>(null)
  const fgDotMatRef = useRef<PointsMaterial | null>(null)

  // Accumulated angle / rotation state
  const fgKickAngle = useRef(0)
  const fgSnareAngle = useRef(0)
  const bgKickAngle = useRef(0)
  const bgSnareAngle = useRef(0)
  const bgRotation = useRef(0)
  const inverted = useRef(false)
  const paletteKey = useRef('default')
  const initRef = useRef(false)
  const prevKeys = useRef<Set<string>>(new Set())
  const prevBeatRef = useRef<number | null>(null)

  useEffect(() => {
    const paperGeo = new PlaneGeometry(1, 1)
    const paperMat = new MeshBasicMaterial({ color: new Color(PALETTES.default.bg), depthWrite: false, depthTest: false })
    const paper = new Mesh(paperGeo, paperMat)
    paper.position.z = -0.02
    paperRef.current = paper
    paperMatRef.current = paperMat

    const bgGroup = new Group()
    bgGroupRef.current = bgGroup
    const bgLineGeo = buildLineGeometry(BG_BALLS)
    const bgLineMat = new LineBasicMaterial({ color: new Color(PALETTES.default.accent), transparent: true, opacity: 0.12, depthWrite: false })
    const bgLines = new LineSegments(bgLineGeo, bgLineMat)
    bgLinesRef.current = bgLines
    bgLineMatRef.current = bgLineMat
    const bgDotGeo = buildDotGeometry(BG_BALLS)
    const bgDotMat = new PointsMaterial({ color: new Color(PALETTES.default.accent), size: 4, sizeAttenuation: false, depthWrite: false })
    const bgDots = new Points(bgDotGeo, bgDotMat)
    bgDotsRef.current = bgDots
    bgDotMatRef.current = bgDotMat
    bgGroup.add(bgLines)
    bgGroup.add(bgDots)

    const fgLineGeo = buildLineGeometry(MAX_BALLS)
    const fgLineMat = new LineBasicMaterial({ color: new Color(PALETTES.default.fg), transparent: true, opacity: 0.2, depthWrite: false })
    const fgLines = new LineSegments(fgLineGeo, fgLineMat)
    fgLinesRef.current = fgLines
    fgLineMatRef.current = fgLineMat
    const fgDotGeo = buildDotGeometry(MAX_BALLS)
    const fgDotMat = new PointsMaterial({ color: new Color(PALETTES.default.fg), size: 5, sizeAttenuation: false, depthWrite: false })
    const fgDots = new Points(fgDotGeo, fgDotMat)
    fgDotsRef.current = fgDots
    fgDotMatRef.current = fgDotMat

    setReady(true)
    return () => {
      paperGeo.dispose(); paperMat.dispose()
      bgLineGeo.dispose(); bgLineMat.dispose(); bgDotGeo.dispose(); bgDotMat.dispose()
      fgLineGeo.dispose(); fgLineMat.dispose(); fgDotGeo.dispose(); fgDotMat.dispose()
    }
  }, [])

  useEffect(() => {
    if (!ready || !groupRef.current) return
    const g = groupRef.current
    if (paperRef.current) g.add(paperRef.current)
    if (bgGroupRef.current) g.add(bgGroupRef.current)
    if (fgLinesRef.current) g.add(fgLinesRef.current)
    if (fgDotsRef.current) g.add(fgDotsRef.current)
    return () => {
      if (paperRef.current) g.remove(paperRef.current)
      if (bgGroupRef.current) g.remove(bgGroupRef.current)
      if (fgLinesRef.current) g.remove(fgLinesRef.current)
      if (fgDotsRef.current) g.remove(fgDotsRef.current)
    }
  }, [ready])

  function applyColors() {
    const pal = PALETTES[paletteKey.current] ?? PALETTES.default
    const inv = inverted.current
    const colBg = inv ? pal.fg : pal.bg
    const colFg = inv ? pal.bg : pal.fg
    const colAccent = inv ? pal.bg : pal.accent
    paperMatRef.current?.color.set(colBg)
    bgLineMatRef.current?.color.set(colAccent)
    bgDotMatRef.current?.color.set(colAccent)
    fgLineMatRef.current?.color.set(colFg)
    fgDotMatRef.current?.color.set(colFg)
  }

  function rebuildFg(balls: number, speed: number, fgScale: number, panelWidth: number, dotSize: number) {
    // Three panels: same pattern offset to x = (pi-1)*panelWidth.
    const trajs = computePattern(balls, fgKickAngle.current, fgSnareAngle.current, speed)
    const lineGeo = fgLinesRef.current!.geometry
    const dotGeo = fgDotsRef.current!.geometry
    const linePos = (lineGeo.getAttribute('position') as BufferAttribute).array as Float32Array
    const dotPos = (dotGeo.getAttribute('position') as BufferAttribute).array as Float32Array
    let v = 0, d = 0
    for (let pi = 0; pi < 3; pi++) {
      const ox = (pi - 1) * panelWidth
      for (let bi = 0; bi < balls; bi++) {
        const traj = trajs[bi]
        if (!traj || traj.count < 2) continue
        for (let i = 0; i < traj.count - 1; i++) {
          if ((v + 2) * 3 > linePos.length) break
          linePos[v * 3] = traj.points[i * 2] * fgScale + ox
          linePos[v * 3 + 1] = traj.points[i * 2 + 1] * fgScale
          linePos[v * 3 + 2] = 0; v++
          linePos[v * 3] = traj.points[(i + 1) * 2] * fgScale + ox
          linePos[v * 3 + 1] = traj.points[(i + 1) * 2 + 1] * fgScale
          linePos[v * 3 + 2] = 0; v++
        }
        if ((d + 1) * 3 <= dotPos.length) {
          dotPos[d * 3] = traj.points[(traj.count - 1) * 2] * fgScale + ox
          dotPos[d * 3 + 1] = traj.points[(traj.count - 1) * 2 + 1] * fgScale
          dotPos[d * 3 + 2] = 0; d++
        }
      }
    }
    lineGeo.setDrawRange(0, v)
    ;(lineGeo.getAttribute('position') as BufferAttribute).needsUpdate = true
    lineGeo.computeBoundingSphere()
    dotGeo.setDrawRange(0, d)
    ;(dotGeo.getAttribute('position') as BufferAttribute).needsUpdate = true
    dotGeo.computeBoundingSphere()
    if (fgDotMatRef.current) fgDotMatRef.current.size = dotSize * 2.5
  }

  function rebuildBg(dotSize: number) {
    const trajs = computePattern(BG_BALLS, bgKickAngle.current, bgSnareAngle.current, BG_SPEED)
    // Background scaled to fill roughly the viewport; scale keyed off min dimension.
    const vMin = Math.min(viewport.width, viewport.height)
    const bgScale = (vMin / PATTERN_EXTENT) * BG_SCALE
    fillLines(bgLinesRef.current!.geometry, trajs, BG_BALLS, bgScale, 0)
    fillDots(bgDotsRef.current!.geometry, trajs, BG_BALLS, bgScale, 0)
    if (bgDotMatRef.current) bgDotMatRef.current.size = dotSize * 2
  }

  useInstrumentFrame(trackId, (state) => {
    if (!groupRef.current) return
    const p = state.params

    const balls = Math.floor(p.balls ?? 24)
    const kickStart = p.kickStart ?? 37
    const snareStart = p.snareStart ?? 53
    const kickStep = p.kickStep ?? 3
    const snareStep = p.snareStep ?? 2
    const speed = p.speed ?? 2
    const dotSize = p.dotSize ?? 2
    const lineOpacity = p.lineOpacity ?? 0.2
    const fgMultiplier = p.fgMultiplier ?? 1
    const bgMultiplier = p.bgMultiplier ?? 4
    const bgRotateRate = p.bgRotateRate ?? 0.5

    const vw = viewport.width
    const vh = viewport.height
    const panelWidth = vw / 3
    const fgScale = panelWidth / PATTERN_EXTENT

    // Paper backdrop sized to viewport.
    if (paperRef.current) paperRef.current.scale.set(vw * 1.2, vh * 1.2, 1)

    // Initial build.
    if (!initRef.current) {
      initRef.current = true
      fgKickAngle.current = deg2rad(kickStart)
      fgSnareAngle.current = deg2rad(snareStart)
      bgKickAngle.current = deg2rad(kickStart)
      bgSnareAngle.current = deg2rad(snareStart)
      applyColors()
      rebuildFg(balls, speed, fgScale, panelWidth, dotSize)
      rebuildBg(dotSize)
    }

    if (fgLineMatRef.current) fgLineMatRef.current.opacity = lineOpacity

    let fgDirty = false
    let bgDirty = false
    let colorsDirty = false

    // Onset detection: a note-on = a `${pitch}:${beat}` key newly present this frame.
    const keys = new Set(state.activeNotes.map((n) => `${n.pitch}:${n.beat}`))
    const onsetPitches = new Set<number>()
    for (const n of state.activeNotes) {
      if (!prevKeys.current.has(`${n.pitch}:${n.beat}`)) onsetPitches.add(n.pitch)
    }
    prevKeys.current = keys

    if (onsetPitches.has(PITCH_FG)) {
      fgKickAngle.current += deg2rad(kickStep) * fgMultiplier
      fgSnareAngle.current += deg2rad(snareStep) * fgMultiplier
      fgDirty = true
    }
    if (onsetPitches.has(PITCH_BG)) {
      bgKickAngle.current += deg2rad(kickStep) * bgMultiplier
      bgSnareAngle.current += deg2rad(snareStep) * bgMultiplier
      bgRotation.current += BG_ROTATION_STEP
      bgDirty = true
    }
    if (onsetPitches.has(PITCH_INVERT)) {
      inverted.current = !inverted.current
      colorsDirty = true
    }
    // Palette switches (last winning pitch this frame wins).
    let winningPal: string | null = null
    for (const [pp, key] of PAL_PITCHES) if (onsetPitches.has(pp)) winningPal = key
    if (winningPal !== null) {
      paletteKey.current = paletteKey.current === winningPal ? 'default' : winningPal
      colorsDirty = true
    }

    // Beat-synced background rotation — driven by the transport's currentBeat,
    // NOT wall-clock, so the flower turns in lockstep with playback.
    const currentBeat = state.beat
    if (prevBeatRef.current !== null) {
      const dBeat = currentBeat - prevBeatRef.current
      if (dBeat !== 0) bgRotation.current += dBeat * bgRotateRate
    }
    prevBeatRef.current = currentBeat
    if (bgGroupRef.current) bgGroupRef.current.rotation.z = bgRotation.current

    if (colorsDirty) applyColors()
    if (fgDirty) rebuildFg(balls, speed, fgScale, panelWidth, dotSize)
    if (bgDirty) rebuildBg(dotSize)
  })

  useEffect(() => () => {
    // Geometries/materials are disposed in the build effect's cleanup.
  }, [])

  if (!ready) return null
  return <group ref={groupRef} />
}

export const metronomeBallsInstrument: ObjectInstrumentDef = {
  id: 'metronomeBalls',
  name: 'Metronome Balls',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: MetronomeBallsVisual,
  fullFrame: true,
}

import { useRef, useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import {
  Group, Mesh, LineSegments, Points,
  PlaneGeometry, MeshBasicMaterial, LineBasicMaterial, PointsMaterial,
  BufferGeometry, BufferAttribute, Color,
} from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { setAnimatedOpacity } from '../core/visual/animatedOpacity'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW. Generative metronome-ball line drawings: three
// foreground panels + a rotating background "flower", all built from balls that
// pendulum outward, alternating kick/snare turns each beat. The trajectory math
// (computePattern / computePatternBounce) is Tyler's VERBATIM. Full-frame 2D scene,
// sized to the viewport. All state is derived PURELY from the
// current beat: angles/rotation/palette come from counting/folding the notes with
// beat <= state.beat, so any scrub path lands on the identical picture. Tyler's
// Managed* line/dot pools, displacement shader, ink/spiral/snare-bounce sub-effects
// are collapsed away - this keeps the signature look with plain three primitives.

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

// MIDI trigger pitches (subset of Tyler's - the ones that map to what we render)
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
const PAL_PITCH_MAP = new Map<number, string>(PAL_PITCHES)

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

  // Last-BUILT derived values (caches for the rebuild-on-change optimization -
  // these are never accumulated, only compared against freshly derived values).
  const builtFg = useRef<{ kick: number; snare: number; balls: number; speed: number; fgScale: number; panelWidth: number } | null>(null)
  const builtBg = useRef<{ kick: number; snare: number; vMin: number } | null>(null)
  const builtColors = useRef<{ pal: string; inv: boolean } | null>(null)

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

  function applyColors(palKey: string, inv: boolean) {
    const pal = PALETTES[palKey] ?? PALETTES.default
    const colBg = inv ? pal.fg : pal.bg
    const colFg = inv ? pal.bg : pal.fg
    const colAccent = inv ? pal.bg : pal.accent
    paperMatRef.current?.color.set(colBg)
    bgLineMatRef.current?.color.set(colAccent)
    bgDotMatRef.current?.color.set(colAccent)
    fgLineMatRef.current?.color.set(colFg)
    fgDotMatRef.current?.color.set(colFg)
  }

  function rebuildFg(balls: number, kickAngle: number, snareAngle: number, speed: number, fgScale: number, panelWidth: number) {
    // Three panels: same pattern offset to x = (pi-1)*panelWidth.
    const trajs = computePattern(balls, kickAngle, snareAngle, speed)
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
  }

  function rebuildBg(kickAngle: number, snareAngle: number, vMin: number) {
    const trajs = computePattern(BG_BALLS, kickAngle, snareAngle, BG_SPEED)
    // Background scaled to fill roughly the viewport; scale keyed off min dimension.
    const bgScale = (vMin / PATTERN_EXTENT) * BG_SCALE
    fillLines(bgLinesRef.current!.geometry, trajs, BG_BALLS, bgScale, 0)
    fillDots(bgDotsRef.current!.geometry, trajs, BG_BALLS, bgScale, 0)
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

    if (fgLineMatRef.current) setAnimatedOpacity(fgLineMatRef.current, lineOpacity)
    if (fgDotMatRef.current) fgDotMatRef.current.size = dotSize * 2.5
    if (bgDotMatRef.current) bgDotMatRef.current.size = dotSize * 2

    // --- Pure derivation: count/fold trigger notes with beat <= state.beat. ---
    // state.notes is the full resolved note list, sorted by beat, so the same
    // beat always yields the same counts no matter how we scrubbed here.
    const beat = state.beat
    let countFg = 0
    let countBg = 0
    let countInvert = 0
    const palNotes: { beat: number; pitch: number }[] = []
    for (const n of state.notes) {
      if (n.beat > beat) break
      if (n.pitch === PITCH_FG) countFg++
      else if (n.pitch === PITCH_BG) countBg++
      else if (n.pitch === PITCH_INVERT) countInvert++
      else if (PAL_PITCH_MAP.has(n.pitch)) palNotes.push(n)
    }

    const fgKick = deg2rad(kickStart) + deg2rad(kickStep) * fgMultiplier * countFg
    const fgSnare = deg2rad(snareStart) + deg2rad(snareStep) * fgMultiplier * countFg
    const bgKick = deg2rad(kickStart) + deg2rad(kickStep) * bgMultiplier * countBg
    const bgSnare = deg2rad(snareStart) + deg2rad(snareStep) * bgMultiplier * countBg
    const inverted = countInvert % 2 === 1

    // Palette: fold toggles in beat order (deterministic tie-break by pitch).
    palNotes.sort((a, b) => a.beat - b.beat || a.pitch - b.pitch)
    let palKey = 'default'
    for (const n of palNotes) {
      const key = PAL_PITCH_MAP.get(n.pitch)!
      palKey = palKey === key ? 'default' : key
    }

    // Beat-synced background rotation: one step per BG note so far, plus a
    // continuous term from the absolute beat (pure form of the old dBeat sum).
    if (bgGroupRef.current) {
      bgGroupRef.current.rotation.z = BG_ROTATION_STEP * countBg + bgRotateRate * beat
    }

    // Rebuild geometry / colors only when the derived values actually changed.
    const cf = builtFg.current
    if (!cf || cf.kick !== fgKick || cf.snare !== fgSnare || cf.balls !== balls
        || cf.speed !== speed || cf.fgScale !== fgScale || cf.panelWidth !== panelWidth) {
      rebuildFg(balls, fgKick, fgSnare, speed, fgScale, panelWidth)
      builtFg.current = { kick: fgKick, snare: fgSnare, balls, speed, fgScale, panelWidth }
    }
    const vMin = Math.min(vw, vh)
    const cb = builtBg.current
    if (!cb || cb.kick !== bgKick || cb.snare !== bgSnare || cb.vMin !== vMin) {
      rebuildBg(bgKick, bgSnare, vMin)
      builtBg.current = { kick: bgKick, snare: bgSnare, vMin }
    }
    const cc = builtColors.current
    if (!cc || cc.pal !== palKey || cc.inv !== inverted) {
      applyColors(palKey, inverted)
      builtColors.current = { pal: palKey, inv: inverted }
    }
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
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  midiRows: [
    { pitch: PITCH_FG, label: 'Evolve pattern · foreground', emphasized: true },
    { pitch: PITCH_BG, label: 'Evolve + rotate · background flower' },
    { pitch: PITCH_INVERT, label: 'Invert · swap ink and paper' },
    { pitch: PITCH_PAL_SEPIA, label: 'Palette · Sepia (toggle)', color: '#8b5e34' },
    { pitch: PITCH_PAL_MIDNIGHT, label: 'Palette · Midnight (toggle)', color: '#d4a847' },
    { pitch: PITCH_PAL_BOTANICAL, label: 'Palette · Botanical (toggle)', color: '#2d4a3e' },
    { pitch: PITCH_PAL_PLUM, label: 'Palette · Plum (toggle)', color: '#c25a7c' },
    { pitch: PITCH_PAL_CRIMSON, label: 'Palette · Crimson (toggle)', color: '#dc143c' },
    { pitch: PITCH_PAL_SCARLET, label: 'Palette · Scarlet (toggle)', color: '#8b0000' },
  ],
  component: MetronomeBallsVisual,
  fullFrame: true,
}

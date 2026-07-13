import { useRef, useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, CanvasTexture, LinearFilter, type Material } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { setAnimatedOpacity } from '../core/visual/animatedOpacity'
import type { ResolvedNote } from '../core/visual/types'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW. Eight emoji glyphs laid out in a 2×4 grid across the full
// frame, rearranged by MIDI triggers: switch corners, swap halves, rotate the whole set
// CW/CCW, flip the layout axis, a whole-180 flip, per-row rotations, and a held "3D depth"
// trigger that spawns depth trails zooming toward the camera. Emoji are unicode drawn to a
// canvas + CanvasTexture (no image assets, no IndexedDB). Tyler's seek handling and palette
// are dropped.
//
// Adapter notes: Tyler read note-on edges from `pitchNoteOnCounts` (per-pitch counts) and
// accumulated layout state across frames. Here everything is refolded from state.notes up
// to the playhead every frame: the layout is the fold of all trigger hits at or before the
// current beat, the position easing and depth fade are closed-form exponentials anchored
// at the driving note's beat, and the trail phase is total held time so far - so a paused
// playhead is a static frame and scrub == playback. Tyler's layout / rotation / trail math
// is copied verbatim; only the trigger reads are rewired.

// MIDI pitch assignments - trigger rows below the emoji selector.
const SWITCH_CORNERS_PITCH = 35 // B1
const SWAP_HALVES_PITCH = 34    // A#1
const ROTATE_CW_PITCH = 33      // A1
const ROTATE_CCW_PITCH = 32     // G#1
const FLIP_AXIS_PITCH = 31      // G1
const DEPTH_3D_PITCH = 30       // F#1
const WHOLE_180_PITCH = 29      // F1
const TOP_ROW_CW_PITCH = 28     // E1
const TOP_ROW_CCW_PITCH = 27    // D#1
const BOTTOM_ROW_CW_PITCH = 26  // D1
const BOTTOM_ROW_CCW_PITCH = 25 // C#1

const EMOJI_PITCH_MIN = 36 // C2 - first emoji selector
const EMOJI_PITCH_MAX = 83 // B5

const NUM_TRAIL = 6    // trail copies per emoji for the 3D effect
const TRAIL_MAX_Z = 3  // max Z distance towards camera
const TRAIL_SPEED = 1.5 // how fast trails cycle through Z
const DEPTH_FADE_RATE = 6 // s⁻¹ - matches the old per-frame `1 - exp(-6·dt)` fade lerp

const NUM_EMOJIS = 8

const DEFAULT_EMOJIS =
  '😀 😎 🔥 💀 👻 🎉 🌈 ⭐ 💖 🎵 🚀 🌊 🍕 🎸 👑 💎 🦋 🌺 🎭 🤖 👽 🦄 🐉 🌙 ' +
  '🎪 🧊 🫧 🪩 🎯 🧿 🔮 🪬 🫀 🧠 👁️ 🦑 🐙 🪸 🍄 🌵 🪻 🫠 🥶 🤯 🥳 😈 🤡 🛸'

const CANVAS_SIZE = 512

// Shared canvas cache keyed by (token, size).
const canvasCache = new Map<string, HTMLCanvasElement>()
const CACHE_MAX = 64

function createEmojiCanvas(token: string, size: number): HTMLCanvasElement {
  const key = `${token}|${size}`
  const cached = canvasCache.get(key)
  if (cached) return cached

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const canvas = document.createElement('canvas')
  canvas.width = size * dpr
  canvas.height = size * dpr
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.scale(dpr, dpr)

  let fontSize = size * 0.6
  ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`

  const maxWidth = size * 0.9
  const measured = ctx.measureText(token)
  if (measured.width > maxWidth && measured.width > 0) {
    fontSize *= maxWidth / measured.width
    ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(token, size / 2, size / 2)

  if (canvasCache.size >= CACHE_MAX) {
    const firstKey = canvasCache.keys().next().value
    if (firstKey !== undefined) canvasCache.delete(firstKey)
  }
  canvasCache.set(key, canvas)
  return canvas
}

// Corner offsets from a half's center (dx, dy multipliers). TL=0, TR=1, BL=2, BR=3.
const CORNER_SIGNS: [number, number][] = [
  [-1, 1],  // TL
  [1, 1],   // TR
  [-1, -1], // BL
  [1, -1],  // BR
]

// Logical layout at some beat, rebuilt each frame by replaying trigger notes up to the
// playhead (the beat-pure replacement for the old accumulated refs): which emoji index
// occupies each corner of each half (TL, TR, BL, BR), plus the toggles and row angles.
interface LayoutState {
  leftCorners: number[]
  rightCorners: number[]
  halvesSwapped: boolean
  vertical: boolean
  whole180: boolean  // toggled each hit
  topRowAngle: number // 45° steps, mod 8
  bottomRowAngle: number
}

function initialLayout(): LayoutState {
  return {
    leftCorners: [0, 1, 2, 3],
    rightCorners: [4, 5, 6, 7],
    halvesSwapped: false,
    vertical: false,
    whole180: false,
    topRowAngle: 0,
    bottomRowAngle: 0,
  }
}

function cloneLayout(l: LayoutState): LayoutState {
  return { ...l, leftCorners: [...l.leftCorners], rightCorners: [...l.rightCorners] }
}

const isTriggerPitch = (pitch: number) =>
  pitch >= BOTTOM_ROW_CCW_PITCH && pitch <= SWITCH_CORNERS_PITCH && pitch !== DEPTH_3D_PITCH

// Apply one trigger-row hit to the layout (Tyler's corner/rotation ops, unchanged).
function applyTrigger(l: LayoutState, pitch: number) {
  switch (pitch) {
    // Switch corners: diagonal swap within each half (TL↔BR, TR↔BL).
    case SWITCH_CORNERS_PITCH: {
      const lc = l.leftCorners
      l.leftCorners = [lc[3], lc[2], lc[1], lc[0]]
      const rc = l.rightCorners
      l.rightCorners = [rc[3], rc[2], rc[1], rc[0]]
      break
    }
    // Swap halves: toggle which side each half is on.
    case SWAP_HALVES_PITCH:
      l.halvesSwapped = !l.halvesSwapped
      break
    // Rotate CW: TL→TR→BR→BL→TL.
    case ROTATE_CW_PITCH: {
      const lc = l.leftCorners
      l.leftCorners = [lc[2], lc[0], lc[3], lc[1]]
      const rc = l.rightCorners
      l.rightCorners = [rc[2], rc[0], rc[3], rc[1]]
      break
    }
    // Rotate CCW: TL→BL→BR→TR→TL.
    case ROTATE_CCW_PITCH: {
      const lc = l.leftCorners
      l.leftCorners = [lc[1], lc[3], lc[0], lc[2]]
      const rc = l.rightCorners
      l.rightCorners = [rc[1], rc[3], rc[0], rc[2]]
      break
    }
    // Flip axis: toggle horizontal (left/right) vs vertical (top/bottom) layout.
    case FLIP_AXIS_PITCH:
      l.vertical = !l.vertical
      break
    case WHOLE_180_PITCH:
      l.whole180 = !l.whole180
      break
    case TOP_ROW_CW_PITCH:
      l.topRowAngle = (l.topRowAngle + 1) % 8
      break
    case TOP_ROW_CCW_PITCH:
      l.topRowAngle = (l.topRowAngle + 7) % 8 // +7 = -1 mod 8
      break
    case BOTTOM_ROW_CW_PITCH:
      l.bottomRowAngle = (l.bottomRowAngle + 1) % 8
      break
    case BOTTOM_ROW_CCW_PITCH:
      l.bottomRowAngle = (l.bottomRowAngle + 7) % 8
      break
  }
}

// Compute each emoji's target position for a layout (Tyler's grid math, unchanged).
function computeTargets(
  layout: LayoutState,
  usableW: number,
  usableH: number,
  spread: number,
): { x: Float64Array; y: Float64Array } {
  const cellW = usableW / 4
  const cellH = usableH / 2

  // Half centers (before swap).
  const leftCenterX = -usableW / 4
  const rightCenterX = usableW / 4

  // Corner offsets from half center.
  const dx = cellW / 2
  const dy = cellH / 2

  const targetX = new Float64Array(NUM_EMOJIS)
  const targetY = new Float64Array(NUM_EMOJIS)

  // Half centers and corner offsets depend on axis orientation.
  let halfACX: number, halfACY: number
  let halfBCX: number, halfBCY: number
  let cdx: number, cdy: number

  if (layout.vertical) {
    // Vertical: halves stacked top/bottom.
    halfACX = 0
    halfACY = usableH / 4 * spread
    halfBCX = 0
    halfBCY = -usableH / 4 * spread
    cdx = usableW / 4 * spread
    cdy = usableH / 8 * spread
  } else {
    // Horizontal: halves side by side left/right (default).
    halfACX = leftCenterX * spread
    halfACY = 0
    halfBCX = rightCenterX * spread
    halfBCY = 0
    cdx = dx * spread
    cdy = dy * spread
  }

  // Apply halves swap.
  const lCX = layout.halvesSwapped ? halfBCX : halfACX
  const lCY = layout.halvesSwapped ? halfBCY : halfACY
  const rCX = layout.halvesSwapped ? halfACX : halfBCX
  const rCY = layout.halvesSwapped ? halfACY : halfBCY

  for (let c = 0; c < 4; c++) {
    const lEmojiIdx = layout.leftCorners[c]
    targetX[lEmojiIdx] = lCX + CORNER_SIGNS[c][0] * cdx
    targetY[lEmojiIdx] = lCY + CORNER_SIGNS[c][1] * cdy

    const rEmojiIdx = layout.rightCorners[c]
    targetX[rEmojiIdx] = rCX + CORNER_SIGNS[c][0] * cdx
    targetY[rEmojiIdx] = rCY + CORNER_SIGNS[c][1] * cdy
  }

  // --- Per-row rotations around each row's center ---
  // Top row = emojis at TL/TR corners (indices 0,1) from each half.
  // Bottom row = emojis at BL/BR corners (indices 2,3) from each half.
  const topEmojis = [
    layout.leftCorners[0], layout.leftCorners[1],
    layout.rightCorners[0], layout.rightCorners[1],
  ]
  const bottomEmojis = [
    layout.leftCorners[2], layout.leftCorners[3],
    layout.rightCorners[2], layout.rightCorners[3],
  ]

  const applyRowRotation = (emojiIndices: number[], angleSteps: number) => {
    if (angleSteps === 0) return
    let cx = 0, cy = 0
    for (const idx of emojiIndices) {
      cx += targetX[idx]
      cy += targetY[idx]
    }
    cx /= emojiIndices.length
    cy /= emojiIndices.length

    const angle = -(angleSteps * Math.PI / 4) // each step = 45° CW
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    for (const idx of emojiIndices) {
      const ddx = targetX[idx] - cx
      const ddy = targetY[idx] - cy
      targetX[idx] = cx + ddx * cos - ddy * sin
      targetY[idx] = cy + ddx * sin + ddy * cos
    }
  }

  applyRowRotation(topEmojis, layout.topRowAngle)
  applyRowRotation(bottomEmojis, layout.bottomRowAngle)

  // --- Whole structure 180° rotation around center ---
  if (layout.whole180) {
    for (let i = 0; i < NUM_EMOJIS; i++) {
      targetX[i] = -targetX[i]
      targetY[i] = -targetY[i]
    }
  }

  return { x: targetX, y: targetY }
}

interface TrailEntity {
  mesh: Mesh
  material: MeshBasicMaterial
}

interface EmojiEntity {
  mesh: Mesh
  material: MeshBasicMaterial
  texture: CanvasTexture
  lastToken: string
  trails: TrailEntity[]
}

const PARAMS: ParamDef[] = [
  { key: 'emojis', label: 'Emojis (space-separated)', type: 'string', default: DEFAULT_EMOJIS, multiline: true },
  { key: 'fontSize', label: 'Size', min: 0.05, max: 2, step: 0.05, default: 0.15 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 1 },
  { key: 'moveSpeed', label: 'Move Speed', min: 1, max: 30, step: 1, default: 8 },
  { key: 'padding', label: 'Padding', min: 0, max: 0.4, step: 0.02, default: 0.1 },
  { key: 'spread', label: 'Spread', min: 0, max: 3, step: 0.05, default: 1 },
]
function EmojiDisplayVisual({ trackId }: { trackId: string }) {
  const entitiesRef = useRef<EmojiEntity[]>([])
  const groupRef = useRef<Group>(null)
  const { viewport } = useThree()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const geo = new PlaneGeometry(1, 1)
    const entities: EmojiEntity[] = []

    for (let i = 0; i < NUM_EMOJIS; i++) {
      const tex = new CanvasTexture(createEmojiCanvas('😀', CANVAS_SIZE))
      tex.minFilter = LinearFilter
      tex.magFilter = LinearFilter
      const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 1 })
      const mesh = new Mesh(geo, mat)

      // Trail copies for the 3D depth effect - share the parent's texture.
      const trails: TrailEntity[] = []
      for (let t = 0; t < NUM_TRAIL; t++) {
        const trailMat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 })
        const trailMesh = new Mesh(geo, trailMat)
        trailMesh.visible = false
        trails.push({ mesh: trailMesh, material: trailMat })
      }

      entities.push({ mesh, material: mat, texture: tex, lastToken: '', trails })
    }
    entitiesRef.current = entities
    setReady(true)

    return () => {
      for (const e of entities) {
        e.texture.dispose()
        e.material.dispose()
        for (const tr of e.trails) tr.material.dispose()
      }
      geo.dispose()
    }
  }, [])

  // Add meshes to the group once ready (trails first so they render behind).
  useEffect(() => {
    if (!ready || !groupRef.current) return
    const g = groupRef.current
    for (const e of entitiesRef.current) {
      for (const tr of e.trails) g.add(tr.mesh)
      g.add(e.mesh)
    }
    return () => {
      for (const e of entitiesRef.current) {
        g.remove(e.mesh)
        for (const tr of e.trails) g.remove(tr.mesh)
      }
    }
  }, [ready])

  useInstrumentFrame(trackId, (state) => {
    if (!groupRef.current) return

    const p = state.params
    const emojisStr = state.stringParams.emojis ?? DEFAULT_EMOJIS
    const fontSize = p.fontSize ?? 0.15
    const baseOpacity = p.opacity ?? 1
    const moveSpeed = p.moveSpeed ?? 8
    const padding = p.padding ?? 0.1
    const spread = p.spread ?? 1

    const tokens = emojisStr.split(/\s+/).filter(Boolean)
    const currentBeat = state.beat
    const secPerBeat = state.secPerBeat

    const vMin = Math.min(viewport.width, viewport.height)
    const scale = vMin * 0.5 * fontSize

    // Grid layout computation.
    const usableW = viewport.width * (1 - 2 * padding)
    const usableH = viewport.height * (1 - 2 * padding)

    // --- Replay the trigger history up to the playhead (pure in state.beat/notes) ---
    // The layout is the fold of every trigger hit at or before the current beat; the
    // snapshot taken just before the latest hit is the transition's start layout. The
    // token is set by the highest emoji-selector pitch struck at the latest onset beat.
    let layout = initialLayout()
    let prevLayout = layout
    let lastChangeBeat = -Infinity
    let tokenBeat = -Infinity
    let tokenPitch = -1
    const depthNotes: ResolvedNote[] = []
    let groupBeat = NaN
    let groupPitches: Set<number> | null = null

    for (const n of state.notes) {
      if (n.beat > currentBeat) break // notes are sorted by beat
      const pitch = n.pitch
      if (pitch === DEPTH_3D_PITCH) {
        depthNotes.push(n)
      } else if (pitch >= EMOJI_PITCH_MIN && pitch <= EMOJI_PITCH_MAX) {
        if (n.beat > tokenBeat || (n.beat === tokenBeat && pitch > tokenPitch)) {
          tokenBeat = n.beat
          tokenPitch = pitch
        }
      } else if (isTriggerPitch(pitch)) {
        // One hit per (pitch, beat) - the old per-frame onset set collapsed same-beat
        // duplicates of a pitch into a single trigger.
        if (n.beat !== groupBeat) {
          groupBeat = n.beat
          groupPitches = new Set()
        }
        if (groupPitches!.has(pitch)) continue
        groupPitches!.add(pitch)
        if (n.beat > lastChangeBeat) {
          prevLayout = cloneLayout(layout)
          lastChangeBeat = n.beat
        }
        applyTrigger(layout, pitch)
      }
    }

    const activeToken = tokenPitch >= 0
      ? tokens[(tokenPitch - EMOJI_PITCH_MIN) % tokens.length] ?? '❓'
      : '😀'

    // --- Target positions, easing from the pre-hit layout (closed form) ---
    // The old per-frame lerp `1 - exp(-moveSpeed·dt)` compounds to exactly
    // exp(-moveSpeed·age), so this reproduces playback and holds still on pause.
    const cur = computeTargets(layout, usableW, usableH, spread)
    let blend = 0
    if (lastChangeBeat > -Infinity) {
      const ageSec = (currentBeat - lastChangeBeat) * secPerBeat
      blend = Math.exp(-moveSpeed * ageSec)
    }
    const prev = blend > 0.001 ? computeTargets(prevLayout, usableW, usableH, spread) : null

    // --- 3D depth: closed-form fade + phase from the depth-note hold history ---
    // Merge overlapping holds into spans, then evaluate the old per-frame fade lerp
    // analytically: rise toward 1 across each held span, decay toward 0 across each
    // gap. The trail phase is the total held time so far times TRAIL_SPEED.
    let depthFade = 0
    let depthHeldSec = 0
    let spanStart = -Infinity
    let spanEnd = -Infinity
    const flushSpan = () => {
      if (spanEnd === -Infinity) return
      const heldSec = (Math.min(spanEnd, currentBeat) - spanStart) * secPerBeat
      depthFade = 1 + (depthFade - 1) * Math.exp(-DEPTH_FADE_RATE * heldSec)
      depthHeldSec += heldSec
    }
    for (const n of depthNotes) {
      if (n.beat <= spanEnd) {
        spanEnd = Math.max(spanEnd, n.beat + n.durationBeats)
        continue
      }
      flushSpan()
      if (spanEnd > -Infinity) {
        depthFade *= Math.exp(-DEPTH_FADE_RATE * (n.beat - spanEnd) * secPerBeat)
      }
      spanStart = n.beat
      spanEnd = n.beat + n.durationBeats
    }
    flushSpan()
    if (spanEnd > -Infinity && currentBeat > spanEnd) {
      // Released before the playhead: keep decaying toward 0.
      depthFade *= Math.exp(-DEPTH_FADE_RATE * (currentBeat - spanEnd) * secPerBeat)
    }
    const depthPhase = (depthHeldSec * TRAIL_SPEED) % 1
    const depthVisible = depthFade > 0.01

    // --- Update each emoji ---
    for (let i = 0; i < NUM_EMOJIS; i++) {
      const entity = entitiesRef.current[i]
      if (!entity) continue

      // Update texture (shared with trails via the same CanvasTexture reference).
      if (activeToken !== entity.lastToken) {
        entity.texture.image = createEmojiCanvas(activeToken, CANVAS_SIZE)
        entity.texture.needsUpdate = true
        entity.lastToken = activeToken
        for (const tr of entity.trails) {
          tr.material.map = entity.texture
          tr.material.needsUpdate = true
        }
      }

      const x = prev ? cur.x[i] + (prev.x[i] - cur.x[i]) * blend : cur.x[i]
      const y = prev ? cur.y[i] + (prev.y[i] - cur.y[i]) * blend : cur.y[i]

      setAnimatedOpacity(entity.material, baseOpacity)
      entity.mesh.visible = true
      entity.mesh.scale.set(scale, scale, 1)
      entity.mesh.position.set(x, y, -0.001 * i)

      // --- Trail copies for 3D depth ---
      for (let t = 0; t < NUM_TRAIL; t++) {
        const trail = entity.trails[t]
        if (!depthVisible) {
          trail.mesh.visible = false
          continue
        }
        const copyPhase = (depthPhase + t / NUM_TRAIL) % 1
        const z = copyPhase * TRAIL_MAX_Z
        const trailScale = scale * (1 + copyPhase * 0.8)
        const trailOpacity = baseOpacity * (1 - copyPhase) * depthFade * 0.6

        setAnimatedOpacity(trail.material, trailOpacity)
        trail.mesh.visible = trailOpacity > 0.005
        trail.mesh.scale.set(trailScale, trailScale, 1)
        trail.mesh.position.set(x, y, z)
      }
    }
  })

  if (!ready) return null
  return <group ref={groupRef} />
}

export const emojiDisplayInstrument: ObjectInstrumentDef = {
  id: 'emojiDisplay',
  name: 'Emoji Display',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  midiRows: [
    { pitch: 43, label: 'Show 8th emoji in list' },
    { pitch: 42, label: 'Show 7th emoji in list' },
    { pitch: 41, label: 'Show 6th emoji in list' },
    { pitch: 40, label: 'Show 5th emoji in list' },
    { pitch: 39, label: 'Show 4th emoji in list' },
    { pitch: 38, label: 'Show 3rd emoji in list' },
    { pitch: 37, label: 'Show 2nd emoji in list' },
    { pitch: 36, label: 'Show 1st emoji in list', emphasized: true },
    { pitch: 35, label: 'Swap corners (diagonal)' },
    { pitch: 34, label: 'Swap halves' },
    { pitch: 33, label: 'Rotate corners CW' },
    { pitch: 32, label: 'Rotate corners CCW' },
    { pitch: 31, label: 'Flip layout axis' },
    { pitch: 30, label: '3D depth trails (hold)' },
    { pitch: 29, label: 'Flip whole grid 180°' },
    { pitch: 28, label: 'Spin top row CW' },
    { pitch: 27, label: 'Spin top row CCW' },
    { pitch: 26, label: 'Spin bottom row CW' },
    { pitch: 25, label: 'Spin bottom row CCW' },
  ],
  component: EmojiDisplayVisual,
  fullFrame: true,
}

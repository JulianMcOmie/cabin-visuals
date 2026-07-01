import { useRef, useEffect, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, CanvasTexture, LinearFilter, type Material } from 'three'
import { getObjectState } from '../core/engine/VisualEngine'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. Eight emoji glyphs laid out in a 2×4 grid across the full
// frame, rearranged by MIDI triggers: switch corners, swap halves, rotate the whole set
// CW/CCW, flip the layout axis, a whole-180 flip, per-row rotations, and a held "3D depth"
// trigger that spawns depth trails zooming toward the camera. Emoji are unicode drawn to a
// canvas + CanvasTexture (no image assets, no IndexedDB). Tyler's seek handling and palette
// are dropped; note-onsets come from the object's activeNotes.
//
// Adapter notes: Tyler read note-on edges from `pitchNoteOnCounts` (per-pitch counts) and
// held pitches from an `activeNotes` Set. Here onsets are detected the cabin way — a
// `${pitch}:${beat}` key newly present in state.activeNotes this frame is an onset — and a
// pitch is "held" if any active note has that pitch. Tyler's layout / rotation / trail math
// is copied verbatim; only the trigger reads are rewired.

// MIDI pitch assignments — trigger rows below the emoji selector.
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

const EMOJI_PITCH_MIN = 36 // C2 — first emoji selector
const EMOJI_PITCH_MAX = 83 // B5

const NUM_TRAIL = 6    // trail copies per emoji for the 3D effect
const TRAIL_MAX_Z = 3  // max Z distance towards camera
const TRAIL_SPEED = 1.5 // how fast trails cycle through Z

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

interface TrailEntity {
  mesh: Mesh
  material: MeshBasicMaterial
}

interface EmojiEntity {
  mesh: Mesh
  material: MeshBasicMaterial
  texture: CanvasTexture
  lastToken: string
  currentX: number
  currentY: number
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
const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

function EmojiDisplayVisual({ trackId }: { trackId: string }) {
  const entitiesRef = useRef<EmojiEntity[]>([])
  const groupRef = useRef<Group>(null)
  const { viewport } = useThree()
  const [ready, setReady] = useState(false)
  const lastTimeRef = useRef(-1)

  // Logical state: which emoji index occupies each corner of each half (indices into
  // the 8-emoji array): TL, TR, BL, BR.
  const leftCornersRef = useRef([0, 1, 2, 3])
  const rightCornersRef = useRef([4, 5, 6, 7])
  const halvesSwappedRef = useRef(false)
  const verticalRef = useRef(false)

  // 3D depth effect state.
  const depthPhaseRef = useRef(0) // cycles 0→1 continuously while held
  const depthFadeRef = useRef(0)  // 0 = hidden, 1 = fully visible (smooth transition)

  // Whole structure + per-row rotation state.
  const whole180Ref = useRef(false)  // toggled each hit
  const topRowAngleRef = useRef(0)   // 45° steps, mod 8
  const bottomRowAngleRef = useRef(0)

  // Onset detection: keys of notes seen last frame (the cabin analogue of Tyler's
  // per-pitch note-on counts).
  const prevKeys = useRef<Set<string>>(new Set())

  // Emoji selector: last token chosen by a selector-pitch onset.
  const currentTokenRef = useRef('😀')

  // Snap to target on first frame, lerp after.
  const initializedRef = useRef(false)

  useEffect(() => {
    const geo = new PlaneGeometry(1, 1)
    const entities: EmojiEntity[] = []

    for (let i = 0; i < NUM_EMOJIS; i++) {
      const tex = new CanvasTexture(createEmojiCanvas('😀', CANVAS_SIZE))
      tex.minFilter = LinearFilter
      tex.magFilter = LinearFilter
      const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 1 })
      const mesh = new Mesh(geo, mat)

      // Trail copies for the 3D depth effect — share the parent's texture.
      const trails: TrailEntity[] = []
      for (let t = 0; t < NUM_TRAIL; t++) {
        const trailMat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 })
        const trailMesh = new Mesh(geo, trailMat)
        trailMesh.visible = false
        trails.push({ mesh: trailMesh, material: trailMat })
      }

      entities.push({ mesh, material: mat, texture: tex, lastToken: '', currentX: 0, currentY: 0, trails })
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

  useFrame(() => {
    const state = getObjectState(trackId)
    if (!state || !groupRef.current) return

    const p = state.params
    const emojisStr = state.stringParams.emojis ?? DEFAULT_EMOJIS
    const fontSize = p.fontSize ?? 0.15
    const baseOpacity = p.opacity ?? 1
    const moveSpeed = p.moveSpeed ?? 8
    const padding = p.padding ?? 0.1
    const spread = p.spread ?? 1

    const tokens = emojisStr.split(/\s+/).filter(Boolean)
    const now = performance.now() / 1000
    const dt = lastTimeRef.current < 0 ? 0 : now - lastTimeRef.current
    lastTimeRef.current = now

    const vMin = Math.min(viewport.width, viewport.height)
    const scale = vMin * 0.5 * fontSize

    // Grid layout computation.
    const usableW = viewport.width * (1 - 2 * padding)
    const usableH = viewport.height * (1 - 2 * padding)
    const cellW = usableW / 4
    const cellH = usableH / 2

    // Half centers (before swap).
    const leftCenterX = -usableW / 4
    const rightCenterX = usableW / 4

    // Corner offsets from half center.
    const dx = cellW / 2
    const dy = cellH / 2

    // --- Onset detection: a new `${pitch}:${beat}` key this frame is a note-on ---
    const keys = new Set(state.activeNotes.map((n) => `${n.pitch}:${n.beat}`))
    const onsetPitches = new Set<number>()
    let highestEmojiOnset = -1
    for (const n of state.activeNotes) {
      const k = `${n.pitch}:${n.beat}`
      if (prevKeys.current.has(k)) continue
      onsetPitches.add(n.pitch)
      if (n.pitch >= EMOJI_PITCH_MIN && n.pitch <= EMOJI_PITCH_MAX && n.pitch > highestEmojiOnset) {
        highestEmojiOnset = n.pitch
      }
    }
    prevKeys.current = keys
    const wasTriggered = (pitch: number): boolean => onsetPitches.has(pitch)

    // --- Emoji selection: highest emoji-selector pitch struck this frame sets the token ---
    if (highestEmojiOnset >= 0) {
      const idx = highestEmojiOnset - EMOJI_PITCH_MIN
      currentTokenRef.current = tokens[idx % tokens.length] ?? '❓'
    }

    // --- Trigger row hits ---
    // Switch corners: diagonal swap within each half (TL↔BR, TR↔BL).
    if (wasTriggered(SWITCH_CORNERS_PITCH)) {
      const l = leftCornersRef.current
      leftCornersRef.current = [l[3], l[2], l[1], l[0]]
      const r = rightCornersRef.current
      rightCornersRef.current = [r[3], r[2], r[1], r[0]]
    }

    // Swap halves: toggle which side each half is on.
    if (wasTriggered(SWAP_HALVES_PITCH)) {
      halvesSwappedRef.current = !halvesSwappedRef.current
    }

    // Rotate CW: TL→TR→BR→BL→TL.
    if (wasTriggered(ROTATE_CW_PITCH)) {
      const l = leftCornersRef.current
      leftCornersRef.current = [l[2], l[0], l[3], l[1]]
      const r = rightCornersRef.current
      rightCornersRef.current = [r[2], r[0], r[3], r[1]]
    }

    // Rotate CCW: TL→BL→BR→TR→TL.
    if (wasTriggered(ROTATE_CCW_PITCH)) {
      const l = leftCornersRef.current
      leftCornersRef.current = [l[1], l[3], l[0], l[2]]
      const r = rightCornersRef.current
      rightCornersRef.current = [r[1], r[3], r[0], r[2]]
    }

    // Flip axis: toggle horizontal (left/right) vs vertical (top/bottom) layout.
    if (wasTriggered(FLIP_AXIS_PITCH)) {
      verticalRef.current = !verticalRef.current
    }

    // --- Compute target positions for each emoji ---
    const targetX = new Float64Array(NUM_EMOJIS)
    const targetY = new Float64Array(NUM_EMOJIS)

    const isVertical = verticalRef.current

    // Half centers and corner offsets depend on axis orientation.
    let halfACX: number, halfACY: number
    let halfBCX: number, halfBCY: number
    let cdx: number, cdy: number

    if (isVertical) {
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
    const lCX = halvesSwappedRef.current ? halfBCX : halfACX
    const lCY = halvesSwappedRef.current ? halfBCY : halfACY
    const rCX = halvesSwappedRef.current ? halfACX : halfBCX
    const rCY = halvesSwappedRef.current ? halfACY : halfBCY

    for (let c = 0; c < 4; c++) {
      const lEmojiIdx = leftCornersRef.current[c]
      targetX[lEmojiIdx] = lCX + CORNER_SIGNS[c][0] * cdx
      targetY[lEmojiIdx] = lCY + CORNER_SIGNS[c][1] * cdy

      const rEmojiIdx = rightCornersRef.current[c]
      targetX[rEmojiIdx] = rCX + CORNER_SIGNS[c][0] * cdx
      targetY[rEmojiIdx] = rCY + CORNER_SIGNS[c][1] * cdy
    }

    // --- Rotation triggers ---
    if (wasTriggered(WHOLE_180_PITCH)) {
      whole180Ref.current = !whole180Ref.current
    }
    if (wasTriggered(TOP_ROW_CW_PITCH)) {
      topRowAngleRef.current = (topRowAngleRef.current + 1) % 8
    }
    if (wasTriggered(TOP_ROW_CCW_PITCH)) {
      topRowAngleRef.current = (topRowAngleRef.current + 7) % 8 // +7 = -1 mod 8
    }
    if (wasTriggered(BOTTOM_ROW_CW_PITCH)) {
      bottomRowAngleRef.current = (bottomRowAngleRef.current + 1) % 8
    }
    if (wasTriggered(BOTTOM_ROW_CCW_PITCH)) {
      bottomRowAngleRef.current = (bottomRowAngleRef.current + 7) % 8
    }

    // --- Per-row rotations around each row's center ---
    // Top row = emojis at TL/TR corners (indices 0,1) from each half.
    // Bottom row = emojis at BL/BR corners (indices 2,3) from each half.
    const topEmojis = [
      leftCornersRef.current[0], leftCornersRef.current[1],
      rightCornersRef.current[0], rightCornersRef.current[1],
    ]
    const bottomEmojis = [
      leftCornersRef.current[2], leftCornersRef.current[3],
      rightCornersRef.current[2], rightCornersRef.current[3],
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

    applyRowRotation(topEmojis, topRowAngleRef.current)
    applyRowRotation(bottomEmojis, bottomRowAngleRef.current)

    // --- Whole structure 180° rotation around center ---
    if (whole180Ref.current) {
      for (let i = 0; i < NUM_EMOJIS; i++) {
        targetX[i] = -targetX[i]
        targetY[i] = -targetY[i]
      }
    }

    // --- 3D depth: held = show trails, released = fade out ---
    const depthHeld = state.activeNotes.some((n) => n.pitch === DEPTH_3D_PITCH)
    const fadeLerp = 1 - Math.exp(-6 * dt)
    depthFadeRef.current += ((depthHeld ? 1 : 0) - depthFadeRef.current) * fadeLerp
    if (depthHeld) {
      depthPhaseRef.current = (depthPhaseRef.current + dt * TRAIL_SPEED) % 1
    }
    const depthVisible = depthFadeRef.current > 0.01

    // --- Update each emoji ---
    const activeToken = currentTokenRef.current
    const lerpFactor = dt > 0 ? 1 - Math.exp(-moveSpeed * dt) : 1

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

      if (!initializedRef.current) {
        entity.currentX = targetX[i]
        entity.currentY = targetY[i]
      } else {
        entity.currentX += (targetX[i] - entity.currentX) * lerpFactor
        entity.currentY += (targetY[i] - entity.currentY) * lerpFactor
      }

      entity.material.opacity = baseOpacity
      entity.mesh.visible = true
      entity.mesh.scale.set(scale, scale, 1)
      entity.mesh.position.set(entity.currentX, entity.currentY, -0.001 * i)

      // --- Trail copies for 3D depth ---
      for (let t = 0; t < NUM_TRAIL; t++) {
        const trail = entity.trails[t]
        if (!depthVisible) {
          trail.mesh.visible = false
          continue
        }
        const copyPhase = (depthPhaseRef.current + t / NUM_TRAIL) % 1
        const z = copyPhase * TRAIL_MAX_Z
        const trailScale = scale * (1 + copyPhase * 0.8)
        const trailOpacity = baseOpacity * (1 - copyPhase) * depthFadeRef.current * 0.6

        trail.material.opacity = trailOpacity
        trail.mesh.visible = trailOpacity > 0.005
        trail.mesh.scale.set(trailScale, trailScale, 1)
        trail.mesh.position.set(entity.currentX, entity.currentY, z)
      }
    }

    initializedRef.current = true
  })

  if (!ready) return null
  return <group ref={groupRef} />
}

export const emojiDisplayInstrument: ObjectInstrumentDef = {
  id: 'emojiDisplay',
  name: 'Emoji Display',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: EmojiDisplayVisual,
  fullFrame: true,
}

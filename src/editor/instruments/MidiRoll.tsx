import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial } from 'three'
import { useInstrumentFrame, seededRand, beatInBlock } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import type { ObjectInstrumentDef, ParamDef } from './types'
import type { ResolvedNote } from '../core/visual/types'

// Midi Roll: the track's notes as a scrolling piano roll, modeled on a VIDI
// Studio reference capture - hollow neon bars drifting right-to-left past a
// fixed playhead at center, where a glowing diamond marks each sounding note
// and the played stretch of a bar fills in bright. PURE VISUAL: no chrome, no
// UI, nothing interactive in the frame. (The drifting starfield that used to
// draw behind the notes is its own instrument now - Starfield - so the roll
// is just the notes; pair the two tracks for the old look.)
//
// Pitch AUTO-FIT: the vertical layout is derived from the whole track's pitch
// range - adjacent semitones sit at most `Max Note Spacing` apart (a 3-note
// motif stays pleasantly close, not scattered across the frame) and the
// spacing shrinks automatically when the range is too wide to fit (the
// squish). Computed from ALL notes, future included, so the layout never
// re-flows mid-song.
//
// Play styles render through a REAL bloom pipeline: each style draws sharp
// "emissive" shapes into an offscreen layer, which is downsampled to quarter
// resolution, Gaussian-blurred (ctx.filter) at two scales, and composited
// additively back over the frame - the same multi-scale bloom a game engine
// does. Hand-drawn radial gradients are NOT glow (linear falloff reads as a
// flat disc); blurring a bright core is. Companion rules that keep the look
// high-end rather than cartoon: idle bars render DIM whenever a play style
// is active so the lit note owns the frame (value hierarchy), sounding bars
// are drawn as a lit material (vertical light gradient + rim + specular),
// white appears only where bloom stacking naturally approaches it, and light
// releases as an exponential afterglow instead of switching off.
//
// Pause invariant: every mark is a function of (beat, notes, params) - the
// scroll position, fills, marker fades, bloom, and even the star drift
// derive from state.beat, so scrub == playback.

const PARAMS: ParamDef[] = [
  { key: 'color', label: 'Note Color', type: 'color', default: '#35e0e0' },
  { key: 'window', label: 'Time Window (beats)', min: 2, max: 32, step: 1, default: 8 },
  { key: 'thickness', label: 'Note Thickness', min: 0.006, max: 0.05, step: 0.002, default: 0.016 },
  // The auto-fit ceiling: adjacent semitones never sit farther apart than
  // this fraction of the frame height. Wide ranges squish below it on their own.
  { key: 'maxGap', label: 'Max Note Spacing', min: 0.02, max: 0.15, step: 0.005, default: 0.07 },
  {
    key: 'style', label: 'Note Style', type: 'select', default: 0, options: [
      { value: 0, label: 'Outline' },
      { value: 1, label: 'Filled' },
      { value: 2, label: 'Line' },
    ],
  },
  { key: 'rounded', label: 'Rounded', type: 'boolean', default: 0 },
  // How a bar lights up while its note sounds, each modeled on a specific
  // reference image (2026-08-12). Fill = the classic charge-up. Solid = the
  // minimal purple-roll ref: a flat saturated fill, no white, no glow, over
  // a dimmed roll. Radiant = the white-hot-bars ref: near-white core, big
  // saturated bloom, a soft light shaft, floating dust. Prism = the crystal
  // ref: white core with colored rim, cross-flares with chromatic fringe.
  // The color rule that keeps these out of cartoon territory: white lives
  // ONLY in the core where light would clip; all bloom is pure saturated
  // note color. Values are append-only - tracks store the number.
  {
    key: 'playStyle', label: 'Play Style', type: 'select', default: 0, options: [
      { value: 0, label: 'Fill' },
      { value: 1, label: 'Solid' },
      { value: 2, label: 'Radiant' },
      { value: 3, label: 'Prism' },
    ],
  },
  // Scales every play style's emission and reach.
  { key: 'playPower', label: 'Play Intensity', min: 0.2, max: 2, step: 0.05, default: 1 },
  // Radiant/Prism reproduce black-frame references, so by default they
  // paint their own black backdrop instead of compositing over whatever
  // the scene wears (new projects default to cabin blue). Scene = see-through.
  {
    key: 'backdrop', label: 'Backdrop', type: 'select', default: 1, showIf: 'playStyle', options: [
      { value: 0, label: 'Scene' },
      { value: 1, label: 'Black' },
    ],
  },
  // --- Play-style internals, exposed. Shared knobs show for any styled
  // mode; the rest pin to their style via showIf. Numeric = automatable.
  { key: 'bloomReach', label: 'Glow Reach', min: 0.3, max: 2.5, step: 0.05, default: 1, showIf: 'playStyle' },
  { key: 'idleLit', label: 'Idle Brightness', min: 0, max: 1, step: 0.05, default: 0.55, showIf: 'playStyle' },
  { key: 'release', label: 'Afterglow Release', min: 1, max: 12, step: 0.5, default: 5, showIf: 'playStyle' },
  { key: 'gridAmount', label: 'Measure Grid', min: 0, max: 2, step: 0.1, default: 1, showIf: 'playStyle' },
  // Radiant
  { key: 'radiantScale', label: 'Note Chunkiness', min: 1, max: 3.5, step: 0.05, default: 1.5, showIf: 'playStyle=2' },
  { key: 'coreWhite', label: 'Core Whiteness', min: 0, max: 1, step: 0.05, default: 0.8, showIf: 'playStyle=2' },
  { key: 'pillarWidth', label: 'Pillar Width', min: 0, max: 4, step: 0.1, default: 1.5, showIf: 'playStyle=2' },
  { key: 'pillarBright', label: 'Pillar Brightness', min: 0, max: 1, step: 0.05, default: 0.65, showIf: 'playStyle=2' },
  { key: 'dustAmount', label: 'Dust Amount', min: 0, max: 2.5, step: 0.1, default: 1, showIf: 'playStyle=2' },
  { key: 'dustSize', label: 'Dust Size', min: 0.4, max: 3, step: 0.1, default: 1, showIf: 'playStyle=2' },
  { key: 'roses', label: 'Roses', type: 'boolean', default: 1, showIf: 'playStyle=2' },
  { key: 'roseSize', label: 'Rose Size', min: 0.4, max: 2, step: 0.05, default: 1, showIf: 'playStyle=2' },
  { key: 'roseCount', label: 'Rose Density', min: 0.3, max: 2.5, step: 0.1, default: 1, showIf: 'playStyle=2' },
  // Prism
  { key: 'prismScale', label: 'Note Chunkiness', min: 1, max: 3.5, step: 0.05, default: 2.4, showIf: 'playStyle=3' },
  { key: 'gemWhite', label: 'Gem Whiteness', min: 0, max: 1, step: 0.05, default: 0.6, showIf: 'playStyle=3' },
  { key: 'sparkleDensity', label: 'Sparkle Density', min: 0, max: 2.5, step: 0.1, default: 1, showIf: 'playStyle=3' },
  { key: 'sparkleSize', label: 'Sparkle Size', min: 0.4, max: 2.5, step: 0.05, default: 1, showIf: 'playStyle=3' },
  { key: 'twinkleRate', label: 'Twinkle Speed', min: 1, max: 16, step: 1, default: 8, showIf: 'playStyle=3' },
  { key: 'flareSize', label: 'Flare Size', min: 0, max: 2.5, step: 0.05, default: 1, showIf: 'playStyle=3' },
  { key: 'flareBright', label: 'Flare Brightness', min: 0, max: 2, step: 0.05, default: 1, showIf: 'playStyle=3' },
  { key: 'streakLength', label: 'Streak Length', min: 0, max: 2.5, step: 0.05, default: 1, showIf: 'playStyle=3' },
  {
    key: 'marker', label: 'Marker', type: 'select', default: 1, options: [
      { value: 0, label: 'None' },
      { value: 1, label: 'Diamond' },
      { value: 2, label: 'Dot' },
      { value: 3, label: 'Square' },
    ],
  },
  { key: 'markerSize', label: 'Marker Size', min: 0.5, max: 3, step: 0.1, default: 1.8, showIf: 'marker' },
  { key: 'hitFlash', label: 'Hit Flash', min: 0, max: 1, step: 0.05, default: 0.6 },
  // Off by default: no rings are visible in the reference frames - the knob
  // is here because the reference APP offers ripple styles.
  { key: 'ripple', label: 'Ripple', min: 0, max: 1, step: 0.05, default: 0 },
  { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0.6 },
  { key: 'playhead', label: 'Playhead Line', type: 'boolean', default: 0 },
]

const TEXTURE_HEIGHT = 1024
/** Marker keeps glowing this long (beats) after its note releases. */
const MARKER_FADE_BEATS = 0.4
/** Onset flash / ripple lifetime, beats. */
const FLASH_BEATS = 0.35
const RIPPLE_BEATS = 0.6
/** The bloom mip chain: per octave, the blur radius (applied at half or
 *  quarter resolution - see `res`) and its composite gain. Descending gains
 *  over widening radii approximate a real bloom PSF's exponential falloff;
 *  a flat pair of octaves reads as a pastel slab instead of light. */
const BLOOM_OCTAVES = [
  { res: 2, blur: 1, gain: 0.5 },
  { res: 2, blur: 3, gain: 0.4 },
  { res: 4, blur: 8, gain: 0.55 },
  { res: 4, blur: 20, gain: 0.65 },
  // The ambience octave: blur-spread dilutes content alpha so much that a
  // high gain here still reads as a faint room-filling wash, which is what
  // gives the reference frames their bathed-in-light exposure.
  { res: 4, blur: 40, gain: 0.7 },
] as const

// Color plumbing: parse the hex once per frame, then every draw builds
// rgba() strings with explicit alpha (gradient stops need explicit alpha -
// CSS 'transparent' fades through black).
type Rgb = readonly [number, number, number]
const WHITE: Rgb = [255, 255, 255]

function parseHex(hex: string): Rgb {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  const n = parseInt(full, 16)
  if (Number.isNaN(n)) return [53, 224, 224]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`
}

/** Lerp toward another color - used to warm a core toward white, never to
 *  replace the color outright. */
function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/**
 * Per-frame note lookup. A real Midi Roll project carries ~11k notes and only
 * a few dozen sit inside the time window, so scanning the whole array (twice -
 * bars, then markers) was the roll's dominant JS cost. `order` is the note
 * indices sorted by onset; a binary search yields the candidates for any
 * beat range, and the caller iterates them in ORIGINAL array order (indices
 * re-sorted ascending), because overlapping draws are order-dependent and the
 * frame must stay pixel-identical to the full scan. Keyed on the notes array
 * itself: the engine hands out one stable array per resolve, so this is built
 * once per edit, never per frame. Pitch bounds ride along for the auto-fit.
 */
interface NoteIndex {
  order: number[]
  /** onset of `order[j]` - the sorted key the search runs on. */
  onsets: Float64Array
  /** Longest `max(0.05, durationBeats)` - how far back an onset can sit and still reach the window. */
  maxDur: number
  minPitch: number
  maxPitch: number
}
const NOTE_INDEX = new WeakMap<ResolvedNote[], NoteIndex>()
function noteIndexFor(notes: ResolvedNote[]): NoteIndex {
  let idx = NOTE_INDEX.get(notes)
  if (idx) return idx
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].beat - notes[b].beat)
  const onsets = new Float64Array(order.length)
  let maxDur = 0.05
  let minPitch = Infinity
  let maxPitch = -Infinity
  for (let j = 0; j < order.length; j++) {
    const n = notes[order[j]]
    onsets[j] = n.beat
    const d = Math.max(0.05, n.durationBeats)
    if (d > maxDur) maxDur = d
    if (n.pitch < minPitch) minPitch = n.pitch
    if (n.pitch > maxPitch) maxPitch = n.pitch
  }
  idx = { order, onsets, maxDur, minPitch, maxPitch }
  NOTE_INDEX.set(notes, idx)
  return idx
}
/** Indices of every note whose onset lies in [lo, hi], ascending (= original
 *  order). A superset is fine - callers re-run their exact per-note test. */
function notesOnsetWithin(idx: NoteIndex, lo: number, hi: number, out: number[]): number[] {
  out.length = 0
  const { onsets, order } = idx
  let a = 0
  let b = onsets.length
  while (a < b) {
    const m = (a + b) >> 1
    if (onsets[m] < lo) a = m + 1
    else b = m
  }
  for (let j = a; j < onsets.length && onsets[j] <= hi; j++) out.push(order[j])
  if (out.length > 1) out.sort((x, y) => x - y)
  return out
}
/** Slack on the search bounds: they are derived from the per-note pixel test
 *  by algebra, and float rounding must never drop a note the test would keep. */
const SEARCH_EPS = 1e-6

function MidiRollVisual({ trackId }: { trackId: string }) {
  const { viewport, invalidate } = useThree()
  const meshRef = useRef<Mesh>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)
  // Bloom pipeline surfaces: full-res emissive, half+quarter downsamples,
  // and four blur-octave scratch canvases (two at half res, two at quarter).
  const emissiveRef = useRef<HTMLCanvasElement | null>(null)
  const bloomRef = useRef<{
    half: HTMLCanvasElement
    quarter: HTMLCanvasElement
    octaves: HTMLCanvasElement[]
  } | null>(null)
  // 2D contexts, fetched once with their canvases rather than per frame.
  const ctxsRef = useRef<{
    ctx: CanvasRenderingContext2D
    ectx: CanvasRenderingContext2D
    hctx: CanvasRenderingContext2D
    qctx: CanvasRenderingContext2D
    octx: CanvasRenderingContext2D[]
  } | null>(null)
  // True while the emissive layer holds anything: it is cleared only when it
  // does, and the bloom chain runs only when this frame drew into it - a
  // blank layer blooms to nothing, so skipping is pixel-identical.
  const emissiveDirtyRef = useRef(false)
  // Scratch for the per-frame visible-note index lists (see noteIndexFor).
  const visibleRef = useRef<number[]>([])
  const aspect = viewport.height > 0 ? viewport.width / viewport.height : 1
  const textureWidth = Math.max(256, Math.min(2048, Math.round((TEXTURE_HEIGHT * aspect) / 64) * 64))

  useEffect(() => {
    const canvas = makeCanvas(textureWidth, TEXTURE_HEIGHT)
    canvasRef.current = canvas
    const emissive = makeCanvas(textureWidth, TEXTURE_HEIGHT)
    emissiveRef.current = emissive
    const hw = Math.max(1, Math.round(textureWidth / 2))
    const hh = Math.max(1, Math.round(TEXTURE_HEIGHT / 2))
    const qw = Math.max(1, Math.round(textureWidth / 4))
    const qh = Math.max(1, Math.round(TEXTURE_HEIGHT / 4))
    const bloom = {
      half: makeCanvas(hw, hh),
      quarter: makeCanvas(qw, qh),
      // One scratch canvas per octave, sized to the resolution it blurs at.
      octaves: BLOOM_OCTAVES.map((o) => (o.res === 2 ? makeCanvas(hw, hh) : makeCanvas(qw, qh))),
    }
    bloomRef.current = bloom
    const ctx = canvas.getContext('2d')
    const ectx = emissive.getContext('2d')
    const hctx = bloom.half.getContext('2d')
    const qctx = bloom.quarter.getContext('2d')
    const octx = bloom.octaves.map((c) => c.getContext('2d'))
    ctxsRef.current = ctx && ectx && hctx && qctx && octx.every(Boolean)
      ? { ctx, ectx, hctx, qctx, octx: octx as CanvasRenderingContext2D[] }
      : null
    emissiveDirtyRef.current = false

    const texture = new CanvasTexture(canvas)
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    textureRef.current = texture
    invalidate()

    return () => {
      texture.dispose()
      canvasRef.current = null
      textureRef.current = null
      emissiveRef.current = null
      bloomRef.current = null
      ctxsRef.current = null
    }
  }, [invalidate, textureWidth])

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    const emissive = emissiveRef.current
    const bloom = bloomRef.current
    const ctxs = ctxsRef.current
    if (!canvas || !texture || !mesh || !emissive || !bloom || !ctxs) return false
    const { ctx, ectx, hctx, qctx, octx } = ctxs

    // Blocks are the on-screen region: no block at the playhead, no roll.
    const inBlock = beatInBlock(state)
    mesh.visible = inBlock
    if (!inBlock) return

    const W = canvas.width
    const H = canvas.height
    const p = state.params
    const color = state.stringParams.color || '#35e0e0'
    const rgb = parseHex(color)
    const windowBeats = Math.max(2, p.window ?? 8)
    const thickness = p.thickness ?? 0.016
    const maxGap = p.maxGap ?? 0.07
    const style = Math.round(p.style ?? 0)
    const rounded = (p.rounded ?? 0) >= 0.5
    const playStyle = Math.round(p.playStyle ?? 0)
    const playPower = p.playPower ?? 1
    // Exposed play-style internals (defaults mirror the schema).
    const bloomReach = p.bloomReach ?? 1
    const idleLit = p.idleLit ?? 0.55
    const releaseK = p.release ?? 5
    const gridAmount = p.gridAmount ?? 1
    const coreWhite = p.coreWhite ?? 0.8
    const pillarWidth = p.pillarWidth ?? 1.5
    const pillarBright = p.pillarBright ?? 0.65
    const dustAmount = p.dustAmount ?? 1
    const dustSize = p.dustSize ?? 1
    const rosesOn = (p.roses ?? 1) >= 0.5
    const roseSize = p.roseSize ?? 1
    const roseCount = p.roseCount ?? 1
    const gemWhite = p.gemWhite ?? 0.6
    const sparkleDensity = p.sparkleDensity ?? 1
    const sparkleSize = p.sparkleSize ?? 1
    const twinkleRate = Math.max(1, Math.round(p.twinkleRate ?? 8))
    const flareSize = p.flareSize ?? 1
    const flareBright = p.flareBright ?? 1
    const streakLength = p.streakLength ?? 1
    const marker = Math.round(p.marker ?? 1)
    const markerSize = p.markerSize ?? 1.4
    const hitFlash = p.hitFlash ?? 0.6
    const ripple = p.ripple ?? 0.25
    const glow = p.glow ?? 0.6
    const showPlayhead = (p.playhead ?? 0) >= 0.5

    // Any styled play mode dims the idle roll: a lit note only reads as
    // LIGHT if the rest of the frame leaves it headroom. Fill keeps the
    // classic full-brightness roll. Solid (the minimal ref) needs no bloom;
    // only Radiant and Prism run the pipeline.
    const styled = playStyle !== 0
    const usesBloom = playStyle >= 2
    // Idle Brightness scales the dim underlayer too, so it means the same
    // thing in every styled mode.
    const baseDim = styled ? 0.32 * (idleLit / 0.55) : 1

    const beat = state.beat
    // Styled modes own the frame: an opaque black backdrop (default) makes
    // the look independent of the scene's background color. An opaque
    // full-canvas fill replaces every pixel outright, so it IS the clear -
    // clearing first would just touch the whole surface twice.
    if (styled && Math.round(p.backdrop ?? 1) === 1) {
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, W, H)
    } else {
      ctx.clearRect(0, 0, W, H)
    }
    if (usesBloom && emissiveDirtyRef.current) {
      ectx.clearRect(0, 0, W, H)
      emissiveDirtyRef.current = false
    }
    let emitted = false

    // --- Pitch auto-fit over the WHOLE track ---
    const noteIndex = noteIndexFor(state.notes)
    const { minPitch, maxPitch } = noteIndex
    const hasNotes = minPitch !== Infinity
    const range = hasNotes ? maxPitch - minPitch : 0
    const usableH = H * 0.86
    // Capped spread for narrow material, automatic squish for wide.
    const spacing = Math.min(maxGap * H, usableH / Math.max(3, range))
    const midPitch = (minPitch + maxPitch) / 2
    const yOf = (pitch: number) => H / 2 - (pitch - midPitch) * spacing

    const playheadX = W / 2
    const pxPerBeat = W / windowBeats
    // Radiant/Prism bars render at their reference images' chunkier
    // proportions out of the box - Note Thickness still scales them, and
    // each style's Note Chunkiness knob exposes the multiplier directly.
    const h = Math.max(3, thickness * H)
      * (playStyle === 2 ? (p.radiantScale ?? 1.5) : playStyle === 3 ? (p.prismScale ?? 2.4) : 1)
    const radius = rounded ? h / 2 : 0
    const outlineW = Math.max(1.5, H * 0.0022)

    const barPath = (x: number, y: number, w: number, bh: number) => {
      ctx.beginPath()
      if (radius > 0) ctx.roundRect(x, y, w, bh, Math.min(radius, w / 2))
      else ctx.rect(x, y, w, bh)
    }
    const emitBarPath = (x: number, y: number, w: number, bh: number) => {
      ectx.beginPath()
      if (radius > 0) ectx.roundRect(x, y, w, bh, Math.min(radius, w / 2))
      else ectx.rect(x, y, w, bh)
    }

    // --- Emissive helpers: SHARP shapes drawn into the bloom layer. The
    // blur passes turn them into light - no hand-drawn falloff anywhere.
    const emitCapsule = (x1: number, x2: number, cy: number, halfH: number, col: Rgb, a: number) => {
      if (a <= 0.01 || x2 - x1 < 1) return
      emitted = true
      ectx.fillStyle = rgba(col, a)
      emitBarPath(x1, cy - halfH, x2 - x1, halfH * 2)
      ectx.fill()
    }
    const emitPoint = (x: number, cy: number, r: number, col: Rgb, a: number) => {
      if (a <= 0.01 || r < 0.5) return
      emitted = true
      ectx.fillStyle = rgba(col, a)
      ectx.beginPath()
      ectx.arc(x, cy, r, 0, Math.PI * 2)
      ectx.fill()
    }
    // Horizontal light streak with faded ends (anamorphic-flare material).
    const emitStreak = (x1: number, x2: number, cy: number, halfTh: number, col: Rgb, a: number) => {
      if (a <= 0.01 || x2 - x1 < 2) return
      emitted = true
      const gr = ectx.createLinearGradient(x1, 0, x2, 0)
      gr.addColorStop(0, rgba(col, 0))
      gr.addColorStop(0.15, rgba(col, a * 0.6))
      gr.addColorStop(0.5, rgba(col, a))
      gr.addColorStop(0.85, rgba(col, a * 0.6))
      gr.addColorStop(1, rgba(col, 0))
      ectx.fillStyle = gr
      ectx.fillRect(x1, cy - halfTh, x2 - x1, halfTh * 2)
    }
    // Procedural rose: three rings of overlapping petal discs over a spray
    // of dark leaves - impressionistic, sized to read at bar scale exactly
    // like the reference's blossoms do against the blazing white bars.
    // Dark props against light: roses draw in the MAIN canvas only and
    // never emit, so the bloom washes over them like set dressing.
    const drawRose = (cx: number, cy: number, r: number, seed: number) => {
      // Foliage first and PROMINENT - in the reference the green reads
      // before the red does.
      for (let l = 0; l < 4; l++) {
        const ang = seededRand(seed + l * 1.7) * Math.PI * 2
        const lr = r * (1.3 + 0.6 * seededRand(seed + l * 2.3))
        ctx.save()
        ctx.translate(cx + Math.cos(ang) * r * 0.95, cy + Math.sin(ang) * r * 0.95)
        ctx.rotate(ang)
        ctx.fillStyle = l % 2 === 0 ? '#14421c' : '#1d5a26'
        ctx.beginPath()
        ctx.ellipse(0, 0, lr * 0.75, lr * 0.34, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
      // Deep crimson petals - dark enough to hold under the bloom wash.
      const rings = [
        { n: 6, rad: r * 0.75, size: r * 0.45, col: '#5f0d1a' },
        { n: 5, rad: r * 0.45, size: r * 0.36, col: '#8f1626' },
        { n: 4, rad: r * 0.2, size: r * 0.28, col: '#b81f38' },
      ]
      for (const ring of rings) {
        ctx.fillStyle = ring.col
        for (let p = 0; p < ring.n; p++) {
          const ang = (p / ring.n) * Math.PI * 2 + seededRand(seed + ring.n) * 2
          ctx.beginPath()
          ctx.arc(cx + Math.cos(ang) * ring.rad, cy + Math.sin(ang) * ring.rad, ring.size, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.fillStyle = '#d4506a'
      ctx.beginPath()
      ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2)
      ctx.fill()
    }

    // Light shaft: a hair-thin full-height line in pure note color, fading
    // toward the frame's top and bottom. The wide bloom octaves are what
    // turn it into the rose ref's soft vertical column - the emissive line
    // itself must stay thin so the blur builds real falloff around it.
    const emitShaft = (x: number, width: number, a: number) => {
      if (a <= 0.01 || width < 0.5) return
      emitted = true
      const gr = ectx.createLinearGradient(0, 0, 0, H)
      gr.addColorStop(0, rgba(rgb, 0))
      gr.addColorStop(0.35, rgba(rgb, a))
      gr.addColorStop(0.65, rgba(rgb, a))
      gr.addColorStop(1, rgba(rgb, 0))
      ectx.fillStyle = gr
      ectx.fillRect(x - width / 2, 0, width, H)
    }
    // 4-point star flare: thin cross streaks + core, with a whisper of
    // warm/cool fringe so the bloomed result refracts like the crystal
    // reference instead of reading as a plus sign.
    // Per-frame constant tints (pure mixes of the note color), hoisted out of
    // the per-note loops.
    const flareCol = mixRgb(rgb, WHITE, 0.7)
    const flareWarm = mixRgb(rgb, [255, 96, 96], 0.5)
    const flareCool = mixRgb(rgb, [96, 128, 255], 0.5)
    const emitFlare = (x: number, cy: number, len: number, a: number) => {
      if (a <= 0.01 || len < 2) return
      emitted = true
      const fl = flareCol
      const th = Math.max(1.5, h * 0.14)
      emitStreak(x - len, x + len, cy, th / 2, fl, a)
      emitStreak(x - len, x + len, cy - 1.5, th / 2, flareWarm, a * 0.3)
      emitStreak(x - len, x + len, cy + 1.5, th / 2, flareCool, a * 0.3)
      const vlen = len * 0.55
      const gr = ectx.createLinearGradient(0, cy - vlen, 0, cy + vlen)
      gr.addColorStop(0, rgba(fl, 0))
      gr.addColorStop(0.5, rgba(fl, a))
      gr.addColorStop(1, rgba(fl, 0))
      ectx.fillStyle = gr
      ectx.fillRect(x - th / 2, cy - vlen, th, vlen * 2)
      // Diagonal rays: the crystal ref's glints are X-shaped, not plus-shaped.
      const dlen = len * 0.6
      for (const ang of [Math.PI / 4, -Math.PI / 4]) {
        ectx.save()
        ectx.translate(x, cy)
        ectx.rotate(ang)
        const dg = ectx.createLinearGradient(-dlen, 0, dlen, 0)
        dg.addColorStop(0, rgba(fl, 0))
        dg.addColorStop(0.5, rgba(fl, a * 0.6))
        dg.addColorStop(1, rgba(fl, 0))
        ectx.fillStyle = dg
        ectx.fillRect(-dlen, -th / 2, dlen * 2, th)
        ectx.restore()
      }
      emitPoint(x, cy, h * 0.3, fl, a)
    }

    if (showPlayhead) {
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.16
      ctx.lineWidth = Math.max(1, H * 0.0015)
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, H)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // Faint measure grid behind the notes - both reference frames carry it,
    // and it is part of what makes them read as an instrument, not a void.
    if (playStyle >= 2 && gridAmount > 0.01) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      const first = Math.ceil(beat - windowBeats / 2) - 1
      const last = Math.floor(beat + windowBeats / 2) + 1
      for (let b = first; b <= last; b++) {
        const gx = playheadX + (b - beat) * pxPerBeat
        ctx.globalAlpha = Math.min(0.4, (b % 4 === 0 ? 0.09 : 0.04) * gridAmount)
        ctx.beginPath()
        ctx.moveTo(gx, 0)
        ctx.lineTo(gx, H)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // Foliage draws are DEFERRED to after the bloom composite: the
    // reference's roses sit in front of the light, crisp and saturated -
    // drawn before the composite they wash out to pink under the glow.
    const foliage: Array<() => void> = []

    // --- Notes ---
    if (hasNotes) {
      // Candidates: the exact pixel test below, solved for the onset -
      // xEnd >= -200 and xStart <= W + 200 - widened by the longest note and
      // a float epsilon, so the search can only over-include.
      const reachBeats = (W / 2 + 200) / pxPerBeat
      const visible = notesOnsetWithin(noteIndex,
        beat - reachBeats - noteIndex.maxDur - SEARCH_EPS,
        beat + reachBeats + SEARCH_EPS,
        visibleRef.current)
      const radiantCore = mixRgb(rgb, WHITE, coreWhite)
      const radiantHead = mixRgb(rgb, WHITE, 0.7)
      const radiantPillar = mixRgb(rgb, WHITE, 0.85)
      const dustWhite = mixRgb(rgb, WHITE, 0.85)
      const dustTint = mixRgb(rgb, WHITE, 0.3)
      const gemCol = mixRgb(rgb, WHITE, gemWhite)
      const streakCol = mixRgb(rgb, WHITE, 0.75)
      for (const noteI of visible) {
        const note = state.notes[noteI]
        const xStart = playheadX + (note.beat - beat) * pxPerBeat
        const xEnd = xStart + Math.max(0.05, note.durationBeats) * pxPerBeat
        if (xEnd < -200 || xStart > W + 200) continue

        const yMid = yOf(note.pitch)
        const y = yMid - h / 2
        const w = Math.max(2, xEnd - xStart)
        const sounding = beat >= note.beat && beat < note.beat + note.durationBeats
        const onsetAge = beat - note.beat
        const flash = onsetAge >= 0 && onsetAge < FLASH_BEATS
          ? hitFlash * (1 - onsetAge / FLASH_BEATS)
          : 0

        // Ripple: a ring expanding from the hit point at the playhead.
        if (ripple > 0 && onsetAge >= 0 && onsetAge < RIPPLE_BEATS) {
          const t = onsetAge / RIPPLE_BEATS
          ctx.strokeStyle = color
          // Barely-there by default - the reference's rings are a suggestion,
          // not a target reticle.
          ctx.globalAlpha = ripple * (1 - t) * (1 - t) * 0.7
          ctx.lineWidth = Math.max(1, H * 0.0012)
          ctx.beginPath()
          ctx.arc(playheadX, yMid, (0.15 + t * 0.85) * H * 0.09 * (0.5 + ripple), 0, Math.PI * 2)
          ctx.stroke()
          ctx.globalAlpha = 1
        }

        // The bar itself, dimmed to an underlayer when a play style owns
        // the light. Radiant and Prism draw EVERY bar as lit material
        // themselves (both reference images light the whole roll), so the
        // base bar is skipped outright for them.
        if (playStyle >= 2) {
          // no base bar
        } else if (style === 1) {
          ctx.fillStyle = color
          ctx.globalAlpha = (0.55 + flash * 0.45) * baseDim
          barPath(xStart, y, w, h)
          ctx.fill()
        } else if (style === 2) {
          ctx.fillStyle = color
          ctx.globalAlpha = (0.75 + flash * 0.25) * baseDim
          barPath(xStart, yMid - h * 0.2, w, h * 0.4)
          ctx.fill()
        } else {
          ctx.strokeStyle = color
          ctx.globalAlpha = (0.85 + flash * 0.15) * baseDim
          ctx.lineWidth = outlineW + flash * outlineW * (styled ? 0 : 1)
          barPath(xStart + outlineW / 2, y, Math.max(2, w - outlineW), h)
          ctx.stroke()
        }
        ctx.globalAlpha = 1

        // --- Play styles ------------------------------------------------
        // `gate` is 1 while the note sounds and releases as an exponential
        // afterglow - light decays, it does not switch off. All motion is
        // eased and all randomness seeded, so scrub == playback.
        const releaseAge = onsetAge - note.durationBeats
        const gate = onsetAge < 0 ? 0 : sounding ? 1 : Math.exp(-releaseAge * releaseK)
        const headX = Math.min(playheadX, xEnd)
        const flare = onsetAge >= 0 ? Math.exp(-onsetAge * 6) : 0

        if (playStyle === 0) {
          // Fill: the reference capture's charge-up - the played stretch
          // left of the playhead fills in bright. Classic path, no bloom.
          if (sounding) {
            const fillW = Math.max(0, headX - xStart)
            if (fillW > 1) {
              ctx.fillStyle = color
              ctx.globalAlpha = 0.85
              // A whisper of halo - the reference's charged bar stays a
              // crisp thin bar, it does not balloon.
              if (glow > 0) {
                ctx.shadowColor = color
                ctx.shadowBlur = glow * h * 0.35
              }
              barPath(xStart, y, fillW, h)
              ctx.fill()
              ctx.shadowBlur = 0
              ctx.globalAlpha = 1
            }
          }
        } else if (playStyle === 1 && gate > 0.01) {
          // Solid - the minimal purple-roll reference: the sounding note is
          // a flat, fully saturated fill of the note color over the dimmed
          // roll. No white, no glow, no swelling - the restraint IS the
          // design; all contrast comes from the value hierarchy.
          ctx.fillStyle = rgba(rgb, 0.95 * gate)
          barPath(xStart, y, w, h)
          ctx.fill()
        } else if (playStyle === 2) {
          // Radiant - the white-hot-bars reference: EVERY bar is a lit
          // white core (the whole roll glows in the ref); the sounding one
          // burns hotter, stands a broad light pillar at the playhead, and
          // sheds a cloud of dust sparks. The halo comes from bloom of the
          // thin core in pure saturated color - the emissive shape is never
          // bigger than the bar, or blur can't build falloff.
          const lit = idleLit + (1 - idleLit) * gate
          ctx.fillStyle = rgba(radiantCore, 0.95 * lit)
          barPath(xStart, y, w, h)
          ctx.fill()
          // The reference wraps its blazing bars in vines and roses. Queued
          // for the post-bloom pass so the foliage stays crisp and saturated
          // IN FRONT of the light instead of washing pink beneath it.
          if (rosesOn) foliage.push(() => {
            ctx.strokeStyle = '#1d4a22'
            ctx.lineWidth = Math.max(1.5, h * 0.09)
            ctx.globalAlpha = 0.95
            ctx.beginPath()
            const vineSegs = Math.max(4, Math.round(w / (h * 0.8)))
            for (let s = 0; s <= vineSegs; s++) {
              const vx = xStart + (w * s) / vineSegs
              const vy = yMid + Math.sin(s * 1.3 + note.pitch) * h * 0.55
              if (s === 0) ctx.moveTo(vx, vy)
              else ctx.lineTo(vx, vy)
            }
            ctx.stroke()
            // Leaflets along the vine, so the bar reads as a garland.
            ctx.fillStyle = '#1d5a26'
            for (let s = 1; s < vineSegs; s += 2) {
              const vx = xStart + (w * s) / vineSegs
              const vy = yMid + Math.sin(s * 1.3 + note.pitch) * h * 0.55
              ctx.save()
              ctx.translate(vx, vy)
              ctx.rotate(seededRand(note.beat * 3.1 + s) * Math.PI)
              ctx.beginPath()
              ctx.ellipse(0, 0, h * 0.34, h * 0.15, 0, 0, Math.PI * 2)
              ctx.fill()
              ctx.restore()
            }
            ctx.globalAlpha = 1
            const roses = Math.max(1, Math.min(6, Math.round((w / (h * 2.6)) * roseCount)))
            for (let rr = 0; rr < roses; rr++) {
              const seed = note.beat * 17.3 + note.pitch * 5.1 + rr * 29.7
              drawRose(
                xStart + (0.15 + 0.7 * ((rr + seededRand(seed)) / roses)) * w,
                yMid + (seededRand(seed + 1) - 0.5) * h * 0.6,
                h * (0.55 + 0.25 * seededRand(seed + 2)) * roseSize,
                seed,
              )
            }
          })
          emitCapsule(xStart, xEnd, yMid, h * 0.5, rgb, (0.35 + 0.5 * gate) * playPower)
          if (sounding && pillarWidth > 0.01) {
            emitPoint(headX, yMid, h * 0.4, radiantHead, 0.55 * playPower)
            // The pillar: a broad hot white core in the main canvas plus a
            // saturated shaft in the emissive layer. Sounding only - an
            // afterglow pillar at the note's end reads as a stray line.
            const pw = Math.max(3, h * pillarWidth) * (1 + 0.4 * flare) * playPower
            emitShaft(headX, pw, pillarBright + 0.25 * flare)
            const coreA = Math.min(1, 0.7 * (pillarBright / 0.65))
            const pg = ctx.createLinearGradient(0, 0, 0, H)
            pg.addColorStop(0, rgba(WHITE, 0))
            pg.addColorStop(0.35, rgba(radiantPillar, coreA))
            pg.addColorStop(0.65, rgba(radiantPillar, coreA))
            pg.addColorStop(1, rgba(WHITE, 0))
            ctx.fillStyle = pg
            ctx.fillRect(headX - pw * 0.45, 0, pw * 0.9, H)
          }
          if (gate > 0.01 && dustAmount > 0.01) {
            // Dust cloud: sparks looping around the hit point, some white,
            // some in the note color, sharp in main + glowing in emissive.
            // Soft two-pass circles, NOT rects - square particles are what
            // read as pixel garbage on a big canvas.
            const dustN = Math.round(24 * dustAmount)
            for (let k = 0; k < dustN; k++) {
              const sk = note.beat * 6.13 + note.pitch * 3.7 + k * 9.31
              const rate = 0.25 + 0.5 * seededRand(sk)
              const ph = (((beat * rate + seededRand(sk + 1)) % 1) + 1) % 1
              const ang = seededRand(sk + 2) * Math.PI * 2
              const rad = (0.25 + 0.75 * seededRand(sk + 3)) * h * 9 * ph
              const mx = headX + Math.cos(ang) * rad * 1.4
              const my = yMid + Math.sin(ang) * rad
              const a = (1 - ph) * ph * 4 * 0.7 * gate
              const col = k % 3 === 0 ? dustWhite : dustTint
              const size = (1 + seededRand(sk + 4) * 1.4) * dustSize
              ctx.fillStyle = rgba(col, a * 0.3)
              ctx.beginPath()
              ctx.arc(mx, my, size * 2.1, 0, Math.PI * 2)
              ctx.fill()
              ctx.fillStyle = rgba(col, a)
              ctx.beginPath()
              ctx.arc(mx, my, size, 0, Math.PI * 2)
              ctx.fill()
              ectx.fillStyle = rgba(col, a * 0.8)
              ectx.beginPath()
              ectx.arc(mx, my, size * 1.4, 0, Math.PI * 2)
              ectx.fill()
            }
            if (dustN > 0) emitted = true
          }
        } else if (playStyle === 3) {
          // Prism - the crystal reference: EVERY bar is a blazing gem -
          // near-white body filled with rainbow refraction speckle
          // (re-rolled on a 1/8-beat twinkle), a crisp saturated rim, and
          // an X-shaped star flare. The sounding gem flares wider and adds
          // a long anamorphic streak.
          const lit = idleLit * 0.9 + (1 - idleLit * 0.9) * gate
          ctx.fillStyle = rgba(gemCol, 0.85 * lit)
          barPath(xStart, y, w, h)
          ctx.fill()
          // Refraction speckle, clipped inside the gem. Seeded positions and
          // hues per note; the twinkle re-roll is what makes it GLITTER.
          // Every glint is a soft two-pass circle (halo + core) - square
          // fillRects here read as PIXELATION on a big canvas, not sparkle.
          // A few glints also land in the emissive layer, so the gem's bloom
          // shimmers with rainbow tints like the reference.
          if (sparkleDensity > 0.01) {
            ctx.save()
            barPath(xStart, y, w, h)
            ctx.clip()
            const qTw = Math.floor(beat * twinkleRate)
            const sparkCount = Math.max(3, Math.round(((w * h) / 140) * sparkleDensity))
            for (let k = 0; k < sparkCount; k++) {
              const sk = note.beat * 31.7 + note.pitch * 7.9 + k * 13.37
              const tw = seededRand(qTw * 5.1 + sk)
              if (tw < 0.3) continue
              const hue = Math.floor(seededRand(sk + 2) * 360)
              const rad = (1 + seededRand(sk + 3) * h * 0.11) * sparkleSize
              const px = xStart + seededRand(sk) * w
              const py = y + seededRand(sk + 1) * h
              const a = (0.6 + 0.4 * tw) * lit
              ctx.fillStyle = `hsla(${hue}, 95%, 55%, ${a * 0.3})`
              ctx.beginPath()
              ctx.arc(px, py, rad * 2.2, 0, Math.PI * 2)
              ctx.fill()
              ctx.fillStyle = `hsla(${hue}, 95%, 65%, ${a})`
              ctx.beginPath()
              ctx.arc(px, py, rad, 0, Math.PI * 2)
              ctx.fill()
              if (k % 3 === 0) {
                emitted = true
                ectx.fillStyle = `hsla(${hue}, 95%, 60%, ${0.5 * tw * lit})`
                ectx.beginPath()
                ectx.arc(px, py, rad * 1.5, 0, Math.PI * 2)
                ectx.fill()
              }
            }
            ctx.restore()
          }
          ctx.strokeStyle = rgba(rgb, 0.8 * lit)
          ctx.lineWidth = Math.max(1, outlineW * 0.8)
          barPath(xStart + 0.5, y + 0.5, Math.max(1, w - 1), h - 1)
          ctx.stroke()
          emitCapsule(xStart, xEnd, yMid, h * 0.5, rgb, (0.35 + 0.55 * gate) * playPower)
          // Star flare on every gem, breathing on smoothed seeded noise;
          // centered on the gem when idle, on the playhead when sounding.
          const i0 = Math.floor(beat * 8)
          const fr = beat * 8 - i0
          const n0 = seededRand(i0 * 2.9 + note.pitch + note.beat)
          const n1 = seededRand((i0 + 1) * 2.9 + note.pitch + note.beat)
          const wobble = 0.7 + 0.6 * (n0 + (n1 - n0) * fr)
          const fx = gate > 0.5 ? headX : Math.max(xStart + 2, Math.min(xEnd - 2, (xStart + xEnd) / 2))
          if (flareSize > 0.01) {
            emitFlare(fx, yMid, h * (2.4 + 2.6 * gate + 5 * flare) * wobble * playPower * flareSize,
              Math.min(1, (0.32 + 0.35 * gate + 0.3 * flare) * flareBright))
          }
          if (gate > 0.5 && streakLength > 0.01) {
            // Anamorphic streak through the sounding gem.
            const reach = pxPerBeat * (0.9 + 1.1 * flare) * playPower * streakLength
            emitStreak(fx - reach, fx + reach, yMid, Math.max(1, h * 0.12),
              streakCol, (0.18 + 0.3 * flare) * gate)
          }
        }
      }

      // --- Bloom composite: downsample the emissive layer, blur it at four
      // widening octaves with falling gain, add them all back. The sharp
      // near-white cores were already painted into the main canvas by the
      // styles; the sharp emissive layer itself is deliberately NOT drawn
      // (that overlay is what washed everything pastel). The glow knob
      // scales the summed light.
      // Nothing emitted this frame (no bar in the window) = a blank layer,
      // and blank blooms to nothing: the whole chain is skipped outright.
      if (usesBloom && emitted) {
        emissiveDirtyRef.current = true
        hctx.clearRect(0, 0, bloom.half.width, bloom.half.height)
        hctx.drawImage(emissive, 0, 0, bloom.half.width, bloom.half.height)
        qctx.clearRect(0, 0, bloom.quarter.width, bloom.quarter.height)
        qctx.drawImage(bloom.half, 0, 0, bloom.quarter.width, bloom.quarter.height)
        ctx.save()
        // 'screen', not 'lighter': additive stacking hard-clips each RGB
        // channel at a different radius, tearing a colored halo into
        // white/magenta/blue terraces wherever notes overlap. Screen
        // saturates asymptotically, so hot spots roll toward white and
        // the halo keeps its hue the whole way down.
        ctx.globalCompositeOperation = 'screen'
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        const glowK = 0.35 + 0.65 * glow
        for (let i = 0; i < BLOOM_OCTAVES.length; i++) {
          const oct = BLOOM_OCTAVES[i]
          const target = bloom.octaves[i]
          const tctx = octx[i]
          const src = oct.res === 2 ? bloom.half : bloom.quarter
          tctx.clearRect(0, 0, target.width, target.height)
          tctx.filter = `blur(${Math.max(0.5, oct.blur * bloomReach)}px)`
          tctx.drawImage(src, 0, 0)
          tctx.filter = 'none'
          ctx.globalAlpha = oct.gain * glowK
          ctx.drawImage(target, 0, 0, W, H)
        }
        ctx.restore()
      }

      // Foliage rides on top of the finished light.
      for (const drawFoliage of foliage) drawFoliage()

      // --- Markers: on every sounding note, lingering briefly after release.
      // Play styles own the playhead treatment, so markers draw only for the
      // classic Fill - none of the reference images has one.
      if (marker > 0 && !styled) {
        // Candidates: onset at or before the beat, and not yet faded out -
        // solved for the onset with the longest note as slack, as above.
        const lingering = notesOnsetWithin(noteIndex,
          beat - MARKER_FADE_BEATS - noteIndex.maxDur - SEARCH_EPS,
          beat + SEARCH_EPS,
          visibleRef.current)
        for (const noteI of lingering) {
          const note = state.notes[noteI]
          const age = beat - note.beat
          if (age < 0) continue
          const pastEnd = age - note.durationBeats
          if (pastEnd >= MARKER_FADE_BEATS) continue
          const fade = pastEnd > 0 ? 1 - pastEnd / MARKER_FADE_BEATS : 1
          const yMid = yOf(note.pitch)
          // A subtle overshoot as the note lands - the reference's diamond
          // pops, it does not explode.
          const pop = age < 0.12 ? 1 + 0.22 * (1 - age / 0.12) : 1
          const s = h * markerSize * pop * (0.65 + 0.35 * fade)

          // Two passes, NO shadowBlur: blur melted the diamond's points into
          // a knob (capture comparison). A soft enlarged low-alpha halo
          // underneath, then the crisp full-alpha shape on top.
          const shape = (size: number) => {
            ctx.beginPath()
            if (marker === 1) {
              ctx.moveTo(playheadX, yMid - size)
              ctx.lineTo(playheadX + size, yMid)
              ctx.lineTo(playheadX, yMid + size)
              ctx.lineTo(playheadX - size, yMid)
              ctx.closePath()
            } else if (marker === 2) {
              ctx.arc(playheadX, yMid, size * 0.8, 0, Math.PI * 2)
            } else {
              ctx.rect(playheadX - size * 0.75, yMid - size * 0.75, size * 1.5, size * 1.5)
            }
          }
          ctx.fillStyle = color
          if (glow > 0) {
            ctx.globalAlpha = fade * glow * 0.28
            shape(s * 1.5)
            ctx.fill()
          }
          ctx.globalAlpha = fade
          shape(s)
          ctx.fill()
          ctx.globalAlpha = 1
        }
      }
    }

    texture.needsUpdate = true
    const material = mesh.material as MeshBasicMaterial
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }

    // Dev-only pixel probe (see "renderer bugs: probe first"): exposes the
    // raw layers so a console/Playwright check can tell whether an artifact
    // is in OUR canvases or added downstream by the render pipeline.
    if (process.env.NODE_ENV !== 'production') {
      ;(window as unknown as Record<string, unknown>).__midiRollDebug = { main: canvas, emissive, bloom }
    }
  })

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[viewport.width, viewport.height]} />
      {/* FORCE_TRANSPARENT_KEY: without it applyMaterialOpacity flips this
          full-frame quad opaque at full track opacity, and the texture's
          near-zero-alpha halo pixels render their unpremultiplied-rounding
          rgb at FULL brightness - hard cyan/magenta rings around any glow.
          (Invisible before the play styles existed: those pixels were black
          over a black scene.) */}
      <meshBasicMaterial transparent depthWrite={false} toneMapped={false} userData={{ [FORCE_TRANSPARENT_KEY]: true }} />
    </mesh>
  )
}

export const midiRollInstrument: ObjectInstrumentDef = {
  id: 'midiRoll',
  name: 'Midi Roll',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  // No midiRows: the whole point is the full piano roll - every pitch lands
  // on the auto-fit lane layout.
  component: MidiRollVisual,
  fullFrame: true,
}

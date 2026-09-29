import { createRasterCanvas, type RasterCanvas, type RasterContext } from '../core/visual/rasterCanvas'
import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial } from 'three'
import { useInstrumentFrame, beatInBlock } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import type { ResolvedNote } from '../core/visual/types'
import { CanvasBloom } from './canvasBloom'
import { GLASS_PALETTES, type GlassPalette } from './GlassRoll'
import {
  keyLayout, keyCenterX, keyNoteWidth, fitRange, isBlackKey, whiteIndex,
  motePose, moteEnvelope, streakPose, rand01, type DustParams, type DustPose, type KeyLayout,
} from './glassRollCore'

// The R3F half of Glass Roll (def + params: GlassRoll.tsx; pure geometry and
// plume kinematics: glassRollCore.ts). One full-frame plane wearing a
// CanvasTexture; every frame repaints main + emissive canvases and blooms.
//
// The stained glass is NOT drawn per note per frame: a tall MOSAIC STRIP is
// rendered once per (palette, seed, detail, tint, lead) - a Voronoi
// tessellation cut by long diagonal leads, each facet a weighted palette
// color shaded thicker toward its lead, dotted with pale flower motifs, then
// softened - and every tile is a window onto a seeded slice of it, clipped
// to its rounded slab. A tile's slice offset is seeded on the note, so the
// pattern stays glued to the tile as it falls.

const TEXTURE_HEIGHT = 1024
/** Mosaic strip resolution. 128 wide ≈ 4x a reference tile (30px at 970p),
 *  so facets and leads downsample cleanly at every note width. */
const STRIP_W = 128
const STRIP_H = 2048
/** Dust emission, measured off the reference press: a burst of motes on the
 *  strike, then a steady trickle while the note is held (per second, scaled
 *  by Sparkle Amount). Emission stops after MAX_EMIT_SECONDS of a held note -
 *  a bound on per-frame work, not a look. */
const BURST_MOTES = 55
const HELD_MOTE_RATE = 150
const MAX_EMIT_SECONDS = 12
const SEARCH_EPS = 1e-6
/** Bloom chain: the near octaves carry the strike's blaze, the wide ones
 *  are kept quiet so the night stays black away from the keys (Midi Roll's
 *  room-filling ambience octave washed the whole frame navy here). */
const GLASS_BLOOM = [
  { res: 2, blur: 1, gain: 0.6 },
  { res: 2, blur: 3, gain: 0.8 },
  { res: 4, blur: 8, gain: 0.9 },
  { res: 4, blur: 20, gain: 0.7 },
  { res: 4, blur: 40, gain: 0.3 },
] as const

type Rgb = readonly [number, number, number]

function parseHex(hex: string): Rgb {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  const n = parseInt(full, 16)
  if (Number.isNaN(n)) return [223, 232, 255]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgba([r, g, b]: Rgb, a: number): string {
  return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${Math.max(0, Math.min(1, a))})`
}
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}
/** Rotate a color's hue by `deg` (sRGB HSL - a knob, not a perceptual claim). */
function hueShift(c: Rgb, deg: number): Rgb {
  if (deg === 0) return c
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d < 1e-6) return c
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (((h / 6 + deg / 360) % 1) + 1) % 1
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}

// ── The mosaic strip ────────────────────────────────────────────────────────

const stripCache = new Map<string, RasterCanvas>()

function buildGlassStrip(palette: GlassPalette, seed: number, detail: number, tint: number, leadBright: number, flowers: number): RasterCanvas {
  const W = STRIP_W
  const H = STRIP_H
  // Facet grid: about two sites across a tile at detail 1 - the diagonal
  // cuts below then split most panes into the reference's long triangles.
  const g = W / (1.1 * detail)
  const cols = Math.ceil(W / g) + 2
  const rows = Math.ceil(H / g) + 2
  const sx = new Float32Array(cols * rows)
  const sy = new Float32Array(cols * rows)
  const alive = new Uint8Array(cols * rows)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i
      const s = seed * 131.7 + k * 7.31
      sx[k] = (i - 1 + 0.15 + 0.7 * rand01(s)) * g
      sy[k] = (j - 1 + 0.15 + 0.7 * rand01(s + 0.5)) * g
      // A few sites dropped: the neighbours grow into bigger, longer facets.
      alive[k] = rand01(s + 0.9) < 0.84 ? 1 : 0
    }
  }
  // Long diagonal leads: two families of parallel-ish cuts at opposing
  // slants, spaced ~1.3 tile widths - the reference tiles carry one or two
  // slashes across their whole width that turn facets into triangles.
  const spacing = W * 0.9
  const lineCount = Math.ceil(H / spacing) + 2
  const lines: Array<{ x0: number; y0: number; nx: number; ny: number; fam: number }> = []
  for (let fam = 0; fam < 2; fam++) {
    for (let k = -1; k < lineCount; k++) {
      const s = seed * 17.3 + fam * 91.1 + k * 3.7
      const y0 = (k + 0.5 * fam + 0.3 + 0.4 * rand01(s)) * spacing
      const ang = (fam === 0 ? 1 : -1) * ((35 + 30 * rand01(s + 1)) * Math.PI / 180)
      // Normal of a line at angle `ang` from horizontal.
      lines.push({ x0: W / 2, y0, nx: -Math.sin(ang), ny: Math.cos(ang), fam })
    }
  }
  const lineSide = (x: number, y: number, fam: number): number => {
    // Which side of the family's nearest line (by y) the pixel is on.
    let best = -1
    let bestD = Infinity
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i]
      if (L.fam !== fam) continue
      const d = Math.abs(L.y0 - y)
      if (d < bestD) { bestD = d; best = i }
    }
    const L = lines[best]
    const side = (x - L.x0) * L.nx + (y - L.y0) * L.ny
    return best * 2 + (side >= 0 ? 1 : 0)
  }

  // Rosettes: the reference facets radiate like a rose window - pointed
  // petals around a hub, one rosette per ~tile-width down the strip. They
  // are CELLS of the key map (negative keys), so the lead detection and the
  // per-pane shading below treat a petal exactly like any other pane.
  const rosPitch = (W * 1.4) / detail
  const rosCount = Math.ceil(H / rosPitch) + 2
  const ros: Array<{ cx: number; cy: number; R: number; petals: number; base: number }> = []
  for (let r = 0; r < rosCount; r++) {
    const s0 = seed * 5.3 + r * 3.77
    ros.push({
      cx: W * (0.3 + 0.4 * rand01(s0)),
      cy: (r - 0.5 + 0.6 * rand01(s0 + 0.5)) * rosPitch,
      R: (W * (0.55 + 0.35 * rand01(s0 + 0.7))) / detail,
      petals: 5 + Math.floor(rand01(s0 + 1) * 3),
      base: rand01(s0 + 1.5) * Math.PI * 2,
    })
  }
  const rosScratch = { key: 0, d: 0 }
  const rosetteAt = (x: number, y: number): boolean => {
    const r0 = Math.round(y / rosPitch)
    for (let r = Math.max(0, r0 - 1); r <= Math.min(rosCount - 1, r0 + 1); r++) {
      const o = ros[r]
      const dx = x - o.cx
      const dy = y - o.cy
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d >= o.R) continue
      if (d < o.R * 0.11) { rosScratch.key = -(r * 64 + 63) - 1; rosScratch.d = d / (o.R * 0.11); return true }
      let ang = Math.atan2(dy, dx) - o.base
      ang = ((ang / (Math.PI * 2)) % 1 + 1) % 1
      const u = ang * o.petals
      const pI = Math.floor(u)
      const frac = u - pI - 0.5
      // Pointed petal: the sector narrows toward the tip and toward the hub.
      const t = d / o.R
      // Each petal its own girth, so a rosette is not a stamped daisy.
      const girth = 0.8 + 0.4 * rand01(r * 7.7 + pI * 1.3 + seed)
      const halfW = 0.46 * girth * Math.sqrt(Math.max(0, 1 - t * t)) * Math.min(1, 0.35 + t * 2.2)
      if (Math.abs(frac) < halfW) { rosScratch.key = -(r * 64 + pI) - 1; rosScratch.d = Math.abs(frac) / halfW; return true }
      return false
    }
    return false
  }

  const key = new Int32Array(W * H)
  const dist = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    const cj = Math.floor(y / g) + 1
    for (let x = 0; x < W; x++) {
      const ci = Math.floor(x / g) + 1
      let bestK = -1
      let bestD = Infinity
      for (let dj = -2; dj <= 2; dj++) {
        const jj = cj + dj
        if (jj < 0 || jj >= rows) continue
        for (let di = -2; di <= 2; di++) {
          const ii = ci + di
          if (ii < 0 || ii >= cols) continue
          const k = jj * cols + ii
          if (!alive[k]) continue
          const dx = sx[k] - x
          const dy = sy[k] - y
          const dd = dx * dx + dy * dy
          if (dd < bestD) { bestD = dd; bestK = k }
        }
      }
      if (rosetteAt(x, y)) {
        key[y * W + x] = rosScratch.key
        dist[y * W + x] = rosScratch.d
        continue
      }
      const side0 = lineSide(x, y, 0)
      const side1 = lineSide(x, y, 1)
      key[y * W + x] = bestK * 4096 + side0 * 64 + side1
      dist[y * W + x] = Math.sqrt(bestD) / g
    }
  }

  // Facet colors: hash the cell key to a weighted palette pick.
  const facets = palette.facets.map(([hex, w]) => ({ c: hueShift(parseHex(hex), tint), w }))
  const totalW = facets.reduce((a, f) => a + f.w, 0)
  const pickColor = (k: number): Rgb => {
    let r = rand01(k * 0.618 + seed * 3.1) * totalW
    for (const f of facets) {
      r -= f.w
      if (r <= 0) return f.c
    }
    return facets[facets.length - 1].c
  }
  const colorCache = new Map<number, Rgb>()
  const facetColor = (k: number): Rgb => {
    let c = colorCache.get(k)
    if (!c) {
      const base = pickColor(k)
      // Per-facet brightness wobble so neighbours of one hue still read as
      // separate panes.
      const v = 0.6 + 0.65 * rand01(k * 1.37 + seed)
      // Hazed toward a grey lilac: real glass in a dim room, not a swatch.
      const hazed = mix(base, [150, 150, 190], 0.1)
      c = [Math.min(255, hazed[0] * v), Math.min(255, hazed[1] * v), Math.min(255, hazed[2] * v)]
      colorCache.set(k, c)
    }
    return c
  }

  // Lead mask: pixels near a key change. Soft edge via distance dilation.
  const edge = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const k = key[i]
      if ((x + 1 < W && key[i + 1] !== k) || (y + 1 < H && key[i + W] !== k)) edge[i] = 1
    }
  }
  const LEAD_R = 2.6
  const R = Math.ceil(LEAD_R + 1)
  const leadA = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let best = Infinity
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= H) continue
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= W) continue
          if (edge[yy * W + xx]) {
            const d = Math.sqrt(dx * dx + dy * dy)
            if (d < best) best = d
          }
        }
      }
      // Full lead inside LEAD_R, fading to glass one pixel further out.
      leadA[y * W + x] = (best <= LEAD_R ? 1 : best <= LEAD_R + 1.4 ? 1 - (best - LEAD_R) / 1.4 : 0) * 0.72
    }
  }

  const raw = createRasterCanvas()
  raw.width = W
  raw.height = H
  const rctx = raw.getContext('2d')!
  const img = rctx.createImageData(W, H)
  const px = img.data
  const lead = hueShift(parseHex(palette.lead), tint)
  const leadRgb: Rgb = [lead[0] * leadBright, lead[1] * leadBright, lead[2] * leadBright]
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const c = facetColor(key[i])
      // Glass reads thicker (darker, more saturated) toward the lead and
      // lighter at the pane's heart - a gentle vignette per facet.
      const d = Math.min(1, dist[i])
      // Mottle: two octaves of blocky value noise - hand-poured glass is
      // never flat, and the reference panes read as cloudy.
      const m1 = rand01(Math.floor(x / 8) * 13.1 + Math.floor(y / 8) * 7.7 + seed)
      const m2 = rand01(Math.floor(x / 16) * 3.3 + Math.floor(y / 16) * 5.9 + seed * 2)
      const shade = (0.8 - 0.4 * d) * (0.82 + 0.36 * (0.5 * m1 + 0.5 * m2))
      const la = leadA[i]
      let r = c[0] * shade, gg = c[1] * shade, b = c[2] * shade
      r = r + (leadRgb[0] - r) * la
      gg = gg + (leadRgb[1] - gg) * la
      b = b + (leadRgb[2] - b) * la
      const o = i * 4
      px[o] = Math.max(0, Math.min(255, r))
      px[o + 1] = Math.max(0, Math.min(255, gg))
      px[o + 2] = Math.max(0, Math.min(255, b))
      px[o + 3] = 255
    }
  }
  rctx.putImageData(img, 0, 0)

  // Flower motifs: small pale five-petal clusters scattered inside facets,
  // the reference's "tiny patterns in the glass". Drawn as the pane's own
  // color lifted toward white so they read as texture, not stickers.
  if (flowers > 0) {
    const clusters = Math.round((H / g) * 16 * flowers)
    for (let f = 0; f < clusters; f++) {
      const s = f * 3.3 + seed * 0.7
      const fx = 4 + rand01(s) * (W - 8)
      const fy = 4 + rand01(s + 1) * (H - 8)
      const ki = key[Math.floor(fy) * W + Math.floor(fx)]
      const c = facetColor(ki)
      const pale = mix(c, [255, 255, 255], 0.9)
      // The speckle lives in SOME of the darker panes (a seeded half of
      // them); pale glass and the rest stay clear, as in the reference.
      if (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 165) continue
      if (rand01(ki * 0.37 + seed * 1.1) < 0.45) continue
      const dots = 5 + Math.floor(rand01(s + 2) * 6)
      const reach = (6 + 6 * rand01(s + 3)) * g / 85
      const dot = (1.5 + 1.0 * rand01(s + 4)) * g / 85
      rctx.fillStyle = rgba(pale, 0.95)
      for (let pI = 0; pI < dots; pI++) {
        const a = rand01(s + 5 + pI * 1.7) * 6.283
        const rr = reach * Math.sqrt(rand01(s + 6 + pI * 2.3))
        rctx.beginPath()
        rctx.arc(fx + Math.cos(a) * rr, fy + Math.sin(a) * rr, dot * (0.7 + 0.6 * rand01(s + 9 + pI)), 0, Math.PI * 2)
        rctx.fill()
      }
    }
  }

  // Soften: the reference glass is luminous and slightly out of focus.
  const out = createRasterCanvas()
  out.width = W
  out.height = H
  const octx = out.getContext('2d')!
  octx.filter = 'blur(1px)'
  octx.drawImage(raw, 0, 0)
  octx.filter = 'none'
  return out
}

function glassStrip(paletteIndex: number, seed: number, detail: number, tint: number, leadBright: number, flowers: number): RasterCanvas {
  const palette = GLASS_PALETTES[Math.max(0, Math.min(GLASS_PALETTES.length - 1, paletteIndex))]
  const id = `${paletteIndex}|${seed}|${detail.toFixed(2)}|${Math.round(tint)}|${leadBright.toFixed(2)}|${flowers.toFixed(1)}`
  let strip = stripCache.get(id)
  if (strip) return strip
  strip = buildGlassStrip(palette, seed, detail, tint, leadBright, flowers)
  // A handful of recent looks; a knob sweep should not keep every step.
  if (stripCache.size > 6) stripCache.delete(stripCache.keys().next().value!)
  stripCache.set(id, strip)
  return strip
}

// ── Sprites ─────────────────────────────────────────────────────────────────

const spriteCache = new Map<string, RasterCanvas>()
/** A soft dust mote: hot core, quick falloff, faint wide skirt. */
function dotSprite(col: Rgb): RasterCanvas {
  const id = `dot|${col[0] | 0},${col[1] | 0},${col[2] | 0}`
  let s = spriteCache.get(id)
  if (s) return s
  s = createRasterCanvas()
  s.width = s.height = 32
  const c = s.getContext('2d')!
  const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16)
  gr.addColorStop(0, rgba(col, 1))
  gr.addColorStop(0.16, rgba(col, 0.95))
  gr.addColorStop(0.34, rgba(col, 0.4))
  gr.addColorStop(0.6, rgba(col, 0.12))
  gr.addColorStop(1, rgba(col, 0))
  c.fillStyle = gr
  c.fillRect(0, 0, 32, 32)
  spriteCache.set(id, s)
  return s
}
// ── Note index (Midi Roll's bisection, same contract) ──────────────────────

interface NoteIndex {
  order: number[]
  onsets: Float64Array
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

function roundRectPath(ctx: RasterContext, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  if (rr > 0) ctx.roundRect(x, y, w, h, rr)
  else ctx.rect(x, y, w, h)
}

const WHITE: Rgb = [255, 255, 255]
const KEY_BLUE: Rgb = [96, 140, 255]
const HAZE_BLUE: Rgb = [92, 98, 255]
const PARTICLE_BLUE: Rgb = [154, 181, 255]

export function GlassRollVisual({ trackId }: { trackId: string }) {
  const { viewport, invalidate } = useThree()
  const meshRef = useRef<Mesh>(null)
  const canvasRef = useRef<RasterCanvas | null>(null)
  const ctxRef = useRef<RasterContext | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)
  const bloomRef = useRef<CanvasBloom | null>(null)
  const visibleRef = useRef<number[]>([])
  const litRef = useRef(new Float32Array(128))
  const poseRef = useRef<DustPose>({ x: 0, y: 0, t: 0 })
  // The Night backdrop (gradient + washes) is static per settings: painted
  // once into its own canvas and blitted, not rebuilt from gradients per frame.
  const backdropRef = useRef<{ key: string; canvas: RasterCanvas } | null>(null)
  const aspect = viewport.height > 0 ? viewport.width / viewport.height : 1
  const textureWidth = Math.max(256, Math.min(2048, Math.round((TEXTURE_HEIGHT * aspect) / 64) * 64))

  useEffect(() => {
    const canvas = createRasterCanvas()
    canvas.width = textureWidth
    canvas.height = TEXTURE_HEIGHT
    canvasRef.current = canvas
    ctxRef.current = canvas.getContext('2d')
    bloomRef.current = new CanvasBloom(textureWidth, TEXTURE_HEIGHT, GLASS_BLOOM)
    const texture = new CanvasTexture(canvas)
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    textureRef.current = texture
    invalidate()
    return () => {
      texture.dispose()
      canvasRef.current = null
      ctxRef.current = null
      textureRef.current = null
      bloomRef.current = null
    }
  }, [invalidate, textureWidth])

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    const bloom = bloomRef.current
    if (!canvas || !ctx || !texture || !mesh || !bloom) return false

    const inBlock = beatInBlock(state)
    mesh.visible = inBlock
    if (!inBlock) return

    const W = canvas.width
    const H = canvas.height
    const p = state.params
    const beat = state.beat
    const secPerBeat = state.secPerBeat

    // ── Params ──
    const paletteI = Math.round(p.palette ?? 0)
    const tint = p.tint ?? 0
    const glassDetail = p.glassDetail ?? 1
    const mosaicSeed = Math.round(p.mosaicSeed ?? 7)
    const leadBright = p.leadBright ?? 0.85
    const flowers = p.flowers ?? 1
    const glassBright = p.glassBright ?? 1
    const noteWidthK = p.noteWidth ?? 0.86
    const cornerK = p.cornerRadius ?? 0.22
    const noteGap = (p.noteGap ?? 2) * (H / 1024)
    const borderWidth = (p.borderWidth ?? 1.6) * (H / 1024)
    const speedMode = Math.round(p.speedMode ?? 0)
    const fallSeconds = p.fallSeconds ?? 2.5
    const windowBeats = Math.max(0.5, p.window ?? 5)
    const layoutMode = Math.round(p.layout ?? 0)
    const hitLine = p.hitLine ?? 0.5
    const octaveLines = (p.octaveLines ?? 1) >= 0.5
    const backdrop = Math.round(p.backdrop ?? 0)
    const ambient = p.ambient ?? 1
    const keyboard = Math.round(p.keyboard ?? 2)
    const keyboardHeight = p.keyboardHeight ?? 0.26
    const keyLight = p.keyLight ?? 1
    const hitWhite = p.hitWhite ?? 0.85
    const attack = p.attack ?? 0.04
    const release = Math.max(0.02, p.release ?? 0.35)
    const glow = p.glow ?? 1
    const glowReach = p.glowReach ?? 1
    const particles = p.particles ?? 1
    const particleRise = p.particleRise ?? 1
    const particleLife = p.particleLife ?? 2.2
    const particleSpread = p.particleSpread ?? 1
    const particleCurl = p.particleCurl ?? 1
    const particleSize = p.particleSize ?? 1
    const haze = p.haze ?? 1
    const streaks = p.streaks ?? 1
    const particleRgb = parseHex(state.stringParams.particleColor || '#dfe8ff')

    const hitY = Math.round(hitLine * H)
    const kbH = keyboard === 2 ? keyboardHeight * H : 0
    // Fall clock: seconds by default (the reference), beats on request.
    const pxPerBeat = speedMode === 1 ? hitY / windowBeats : (hitY / fallSeconds) * secPerBeat

    const noteIndex = noteIndexFor(state.notes)
    const hasNotes = noteIndex.minPitch !== Infinity
    let range: [number, number]
    if (layoutMode === 1) range = fitRange(noteIndex.minPitch, noteIndex.maxPitch)
    else if (layoutMode === 2) range = [Math.round(p.lowKey ?? 21), Math.round(p.highKey ?? 108)]
    else range = [21, 108]
    if (range[1] - range[0] < 7) range = [range[0], range[0] + 7]
    const layout: KeyLayout = keyLayout(range[0], range[1], W)
    const whiteW = layout.whiteW

    const strip = glassStrip(paletteI, mosaicSeed, glassDetail, tint, leadBright, flowers)
    bloom.begin()
    const ectx = bloom.ectx
    let emitted = false

    // ── Backdrop ──
    if (backdrop === 2) {
      ctx.clearRect(0, 0, W, H)
    } else if (backdrop === 1) {
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, W, H)
    } else {
      // Night: the reference's near-black navy, faintly lighter toward the
      // rail, with soft cloud washes so the dark is not flat (the reference
      // room is lit unevenly - a pale drift of light up one side).
      const bkey = `${W}|${H}|${hitLine.toFixed(3)}|${ambient.toFixed(2)}`
      let bd = backdropRef.current
      if (!bd || bd.key !== bkey) {
        const c = createRasterCanvas()
        c.width = W
        c.height = H
        const bctx = c.getContext('2d')
        if (!bctx) return false
        const gr = bctx.createLinearGradient(0, 0, 0, H)
        gr.addColorStop(0, '#04060b')
        gr.addColorStop(Math.max(0.01, hitLine - 0.02), '#0a1220')
        gr.addColorStop(Math.min(1, hitLine + 0.02), '#070b14')
        gr.addColorStop(1, '#05070c')
        bctx.fillStyle = gr
        bctx.fillRect(0, 0, W, H)
        if (ambient > 0) {
          const washes = [
            { x: 0.78, y: 0.3, r: 0.42, a: 0.34 },
            { x: 0.62, y: 0.75, r: 0.3, a: 0.2 },
            { x: 0.22, y: 0.55, r: 0.28, a: 0.12 },
          ]
          for (const wsh of washes) {
            const cx = W * wsh.x
            const cy = hitY * wsh.y
            const r = W * wsh.r
            const cg = bctx.createRadialGradient(cx, cy, 0, cx, cy, r)
            cg.addColorStop(0, rgba([34, 62, 104], Math.min(1, wsh.a * ambient)))
            cg.addColorStop(0.6, rgba([34, 62, 104], Math.min(1, wsh.a * 0.35 * ambient)))
            cg.addColorStop(1, rgba([34, 62, 104], 0))
            bctx.fillStyle = cg
            bctx.fillRect(cx - r, cy - r, r * 2, r * 2)
          }
        }
        bd = { key: bkey, canvas: c }
        backdropRef.current = bd
      }
      ctx.drawImage(bd.canvas, 0, 0)
    }

    // ── Octave lines: a hairline at every C's left edge, roll region only.
    if (octaveLines) {
      ctx.strokeStyle = 'rgba(170, 182, 205, 0.16)'
      ctx.lineWidth = Math.max(1, H / 1024)
      for (let pitch = layout.lowKey; pitch <= layout.highKey; pitch++) {
        if (pitch % 12 !== 0) continue
        const x = Math.round((whiteIndex(pitch) - whiteIndex(layout.lowKey)) * whiteW) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, hitY)
        ctx.stroke()
      }
    }

    // ── Notes: which are on screen. A tile is visible from the moment its
    // leading (onset) edge enters at the top until its end passes the rail,
    // and its afterglow + plume linger after that.
    const lit = litRef.current
    lit.fill(0)
    const lifeBeats = (particleLife * 1.3) / secPerBeat
    const releaseBeats = (release * 2) / secPerBeat
    const visible = hasNotes
      ? notesOnsetWithin(noteIndex,
        beat - noteIndex.maxDur - Math.max(lifeBeats, releaseBeats) - SEARCH_EPS,
        beat + hitY / pxPerBeat + SEARCH_EPS,
        visibleRef.current)
      : visibleRef.current

    // Gate per note (attack/release), computed once and reused by every pass.
    const gateOf = (note: ResolvedNote): number => {
      const onsetSec = (beat - note.beat) * secPerBeat
      if (onsetSec < 0) return 0
      const durSec = Math.max(0.02, note.durationBeats) * secPerBeat
      if (onsetSec < durSec) return attack > 0 ? Math.min(1, onsetSec / attack) : 1
      // Release: the reference's pillar drops to ~10% within 0.1 s and the
      // rest lingers as a slow ember (the Afterglow knob is that tail).
      const rel = onsetSec - durSec
      return 0.9 * Math.exp(-rel / 0.05) + 0.1 * Math.exp(-rel / release)
    }
    // A strike lights the keys AROUND it too (the reference floods ~8 keys):
    // per key, the strongest gate within reach, falling off with distance.
    const litX: number[] = []
    const litG: number[] = []
    for (const noteI of visible) {
      const note = state.notes[noteI]
      const g = gateOf(note)
      if (g <= 0.01) continue
      if (g > lit[note.pitch & 127]) lit[note.pitch & 127] = g
      litX.push(keyCenterX(layout, note.pitch))
      litG.push(g)
    }
    const keyLightAt = (x: number): number => {
      let l = 0
      for (let i = 0; i < litX.length; i++) {
        // Reach in FRAME units, not key units: a fitted 17-key layout must
        // not light the whole keyboard from one strike.
        const dx = (x - litX[i]) / (W * 0.05)
        l += litG[i] * Math.exp(-dx * dx)
      }
      return Math.min(1, l)
    }

    // ── Keyboard ──
    if (keyboard === 2) {
      const gap = Math.max(1, whiteW * 0.05)
      ctx.fillStyle = '#0b0b14'
      ctx.fillRect(0, hitY, W, kbH)
      // White keys: the reference's cool blue-grey ivories, lighter at the
      // front lip; a struck key floods toward the key light's blue.
      for (let pitch = layout.lowKey; pitch <= layout.highKey; pitch++) {
        if (isBlackKey(pitch)) continue
        const wi = whiteIndex(pitch) - whiteIndex(layout.lowKey)
        const x = wi * whiteW
        const l = Math.min(1, Math.max(lit[pitch], keyLightAt((wi + 0.5) * whiteW) * 0.85) * keyLight)
        const top = mix([38, 42, 60], [113, 156, 235], l)
        const bottom = mix([60, 66, 90], [150, 190, 255], l)
        const kg = ctx.createLinearGradient(0, hitY, 0, hitY + kbH)
        kg.addColorStop(0, rgba(top, 1))
        kg.addColorStop(1, rgba(bottom, 1))
        ctx.fillStyle = kg
        ctx.fillRect(x + gap / 2, hitY, whiteW - gap, kbH)
      }
      for (let pitch = layout.lowKey; pitch <= layout.highKey; pitch++) {
        if (!isBlackKey(pitch)) continue
        const cx = keyCenterX(layout, pitch)
        const l = Math.min(1, Math.max(lit[pitch], keyLightAt(cx) * 0.6) * keyLight)
        const bw = layout.blackW
        ctx.fillStyle = rgba(mix([12, 11, 20], [42, 75, 208], l * 0.9), 1)
        ctx.fillRect(cx - bw / 2, hitY, bw, kbH * 0.62)
        // Front face of the black key, a shade lighter.
        ctx.fillStyle = rgba(mix([30, 30, 44], [70, 105, 230], l * 0.9), 1)
        ctx.fillRect(cx - bw / 2, hitY + kbH * 0.56, bw, kbH * 0.06)
      }
    }
    // The rail: the ivories' top edge, a pale band the strikes light up.
    if (keyboard >= 1) {
      const railH = Math.max(2, H * 0.004)
      ctx.fillStyle = 'rgba(120, 135, 170, 0.5)'
      ctx.fillRect(0, hitY - railH * 0.5, W, railH)
      ctx.fillStyle = 'rgba(190, 200, 230, 0.35)'
      ctx.fillRect(0, hitY - railH * 0.5, W, Math.max(1, railH * 0.35))
    }

    // ── Key light + plume base: blue spill on the keys and the soft blue
    // column at the foot of each strike. Both before the tiles so the tile
    // bottoms sit on top of them.
    const dotPale = dotSprite(particleRgb)
    const dotWhite = dotSprite(WHITE)
    const dotBlue = dotSprite(PARTICLE_BLUE)
    const dust: DustParams = {
      rise: 100 * (H / 1024) * particleRise,
      spread: 70 * (H / 1024) * particleSpread,
      curl: 22 * (H / 1024) * particleCurl,
      life: particleLife,
    }
    const pose = poseRef.current

    for (const noteI of visible) {
      const note = state.notes[noteI]
      const g = gateOf(note)
      const cx = keyCenterX(layout, note.pitch)
      const kw = keyNoteWidth(layout, note.pitch) * noteWidthK
      if (g > 0.01) {
        // Blue spill down the keys.
        if (keyboard === 2 && keyLight > 0) {
          const r = W * 0.1
          const sg = ctx.createRadialGradient(cx, hitY, 0, cx, hitY, r)
          sg.addColorStop(0, rgba(KEY_BLUE, 0.55 * g * keyLight))
          sg.addColorStop(0.45, rgba(KEY_BLUE, 0.22 * g * keyLight))
          sg.addColorStop(1, rgba(KEY_BLUE, 0))
          ctx.save()
          ctx.beginPath()
          ctx.rect(0, hitY, W, kbH)
          ctx.clip()
          ctx.fillStyle = sg
          ctx.fillRect(cx - r, hitY, r * 2, r)
          ctx.restore()
          ectx.fillStyle = rgba(KEY_BLUE, 0.28 * g * keyLight)
          ectx.beginPath()
          ectx.ellipse(cx, hitY + kbH * 0.12, W * 0.027, kbH * 0.16, 0, 0, Math.PI * 2)
          ectx.fill()
          emitted = true
        }
        // The blue column rising from the rail under the plume.
        if (haze > 0) {
          const colH = H * 0.16
          const colW = kw * 4.2
          // An upright ellipse of light standing on the rail: soft on every
          // side (a gradient rect showed its vertical edges).
          for (const [c, k] of [[ctx, 0.3], [ectx, 0.4]] as const) {
            c.save()
            c.translate(cx, hitY)
            c.scale(colW / 2, colH)
            const cg = c.createRadialGradient(0, 0, 0, 0, 0, 1)
            cg.addColorStop(0, rgba(mix(HAZE_BLUE, WHITE, 0.6), k * g * haze))
            cg.addColorStop(0.3, rgba(HAZE_BLUE, 0.5 * k * g * haze))
            cg.addColorStop(1, rgba(HAZE_BLUE, 0))
            c.fillStyle = cg
            c.beginPath()
            c.ellipse(0, 0, 1, 1, 0, Math.PI, Math.PI * 2)
            c.fill()
            c.restore()
          }
          emitted = true
        }
      }
    }

    // ── Tiles ──
    for (const noteI of visible) {
      const note = state.notes[noteI]
      const dur = Math.max(0.05, note.durationBeats)
      const yLead = hitY - (note.beat - beat) * pxPerBeat
      const yTail = hitY - (note.beat + dur - beat) * pxPerBeat
      if (yTail >= hitY || yLead <= 0) continue
      const cx = keyCenterX(layout, note.pitch)
      const w = Math.max(2, keyNoteWidth(layout, note.pitch) * noteWidthK)
      const x = cx - w / 2
      const top = yTail + noteGap / 2
      const bottom = Math.min(yLead, hitY) - (yLead <= hitY ? noteGap / 2 : 0)
      const fullH = Math.max(2, yLead - yTail - noteGap)
      const h = bottom - top
      if (h <= 1) continue
      const g = gateOf(note)
      const radius = w * cornerK
      // Slice of the strip this tile shows: seeded per note, aspect-true.
      const seed = note.beat * 7.13 + note.pitch * 3.31
      const segH = w * (STRIP_H / STRIP_W)
      ctx.save()
      roundRectPath(ctx, x, top, w, fullH, radius)
      ctx.clip()
      ctx.beginPath()
      ctx.rect(x - 2, top, w + 4, h)
      ctx.clip()
      ctx.globalAlpha = Math.min(1, glassBright)
      let drawn = 0
      let seg = 0
      while (drawn < fullH && seg < 64) {
        const segTop = top + drawn
        const wantH = Math.min(segH, fullH - drawn)
        const srcH = (wantH / w) * STRIP_W
        const off = seg === 0 ? rand01(seed) * (STRIP_H - srcH) : 0
        ctx.drawImage(strip, 0, off, STRIP_W, srcH, x, segTop, w, wantH)
        drawn += wantH
        seg++
      }
      ctx.globalAlpha = 1
      if (glassBright > 1) {
        ctx.fillStyle = rgba(WHITE, (glassBright - 1) * 0.5)
        ctx.fillRect(x, top, w, h)
      }
      // Strike: the tile burns white from the rail upward while it sounds,
      // hottest at its foot, the mosaic still ghosting through.
      if (g > 0.01 && hitWhite > 0) {
        const wg = ctx.createLinearGradient(0, top, 0, bottom)
        wg.addColorStop(0, rgba(WHITE, hitWhite * g * 0.35))
        wg.addColorStop(1, rgba(WHITE, hitWhite * g * 0.8))
        ctx.fillStyle = wg
        ctx.fillRect(x, top, w, h)
      }
      ctx.restore()
      // Lead border.
      if (borderWidth > 0) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(x - 4, top - 4, w + 8, h + 8)
        ctx.clip()
        ctx.strokeStyle = rgba(mix([198, 204, 216], WHITE, 0.3 * g), Math.min(1, 0.9 * leadBright))
        ctx.lineWidth = borderWidth
        roundRectPath(ctx, x + borderWidth / 2, top + borderWidth / 2, w - borderWidth, fullH - borderWidth, radius)
        ctx.stroke()
        ctx.restore()
      }
      // Emission: a faint halo on every tile (the glass glows), a blaze on
      // a struck one with a hot pool at the rail.
      ectx.save()
      ectx.beginPath()
      ectx.rect(x - 2, top, w + 4, h)
      ectx.clip()
      roundRectPath(ectx, x, top, w, fullH, radius)
      ectx.fillStyle = rgba([200, 212, 255], 0.15 + 0.95 * g * hitWhite)
      ectx.fill()
      ectx.restore()
      if (g > 0.01) {
        // The blaze spills past the slab: a second, expanded white pass.
        ectx.save()
        ectx.beginPath()
        ectx.rect(x - w, top - w * 0.5, w * 3, h + w)
        ectx.clip()
        roundRectPath(ectx, x - w * 0.4, top - w * 0.15, w * 1.8, fullH + w * 0.3, radius * 1.5)
        ectx.fillStyle = rgba(WHITE, 0.3 * g * hitWhite)
        ectx.fill()
        ectx.restore()
      }
      emitted = true
      if (g > 0.01) {
        ectx.fillStyle = rgba(WHITE, 0.75 * g * hitWhite)
        ectx.beginPath()
        ectx.ellipse(cx, hitY, Math.max(w * 1.5, W * 0.05), w * 0.28, 0, 0, Math.PI * 2)
        ectx.fill()
      }
    }

    // ── Sparkle dust ──
    // Per note: a burst of motes on the strike plus a trickle while held.
    // Each mote is a closed-form path (kick up, then a slow drift and
    // wobble) born inside the pillar's footprint; while the pillar burns
    // they hide in its white, and on release they are the puff it leaves
    // behind. A few vapor streaks race up ahead of the puff.
    if (particles > 0) {
      const burstN = Math.round(BURST_MOTES * particles)
      const rate = HELD_MOTE_RATE * particles
      for (const noteI of visible) {
        const note = state.notes[noteI]
        const onsetSec = (beat - note.beat) * secPerBeat
        if (onsetSec < 0) continue
        const durSec = Math.max(0.02, note.durationBeats) * secPerBeat
        const emitEnd = Math.min(durSec, MAX_EMIT_SECONDS)
        if (onsetSec > emitEnd + dust.life * 1.3) continue
        const cx = keyCenterX(layout, note.pitch)
        const kw = keyNoteWidth(layout, note.pitch) * noteWidthK
        const noteSeed = note.beat * 11.7 + note.pitch * 5.3
        // The puff's haze: a soft blue blob riding the cloud after release.
        // STRANDS: the reference puff is wispy - dots hang in a few vertical
        // ribbons standing on the rail, each drifting and curling as one,
        // with a soft blue haze column behind it (the "blue flames"). Each
        // mote belongs to one strand (the strand's own motePose is the
        // shared path) and sits at its own height along it.
        const total = burstN + Math.round(rate * emitEnd)
        const strandAge = Math.min(onsetSec, emitEnd + dust.life)
        const strandCount = 2 + Math.floor(rand01(noteSeed + 4.4) * 3)
        for (let st = 0; st < strandCount; st++) {
          const ss = noteSeed + st * 7.7
          const tall = 0.6 + 0.8 * rand01(ss + 1.1)
          const strandX = cx + ((st + 0.5) / strandCount - 0.5) * kw * 2.6 + (rand01(ss + 0.5) - 0.5) * kw * 0.8
          const lifeS = dust.life * (0.8 + 0.4 * rand01(ss + 0.9))
          // The strand is alive while motes still ride it: from its first
          // mote's birth until the last one fades.
          const envS0 = onsetSec < emitEnd ? 1 : Math.max(0, 1 - (onsetSec - emitEnd) / lifeS)
          const envS = envS0 * envS0 * envS0
          if (envS <= 0 || haze <= 0) continue
          motePose(ss, strandAge, { x: strandX, y: hitY }, dust, pose, emitEnd)
          // A soft glow standing on the rail under the strand, following its
          // lean but not its climb - the reference haze lives at the base.
          const colH = Math.max(kw, (hitY - pose.y) * 0.35 + kw * 1.9 * tall)
          const colW = kw * (1.3 + 0.6 * rand01(ss + 1.3))
          // Anchored at the strand root: the glow under a note is STEADY in
          // the reference; only the dust drifts.
          for (const [c, k] of [[ctx, 0.14], [ectx, 0.32]] as const) {
            c.save()
            c.translate(strandX, hitY)
            c.scale(colW / 2, colH)
            const cg = c.createRadialGradient(0, -0.35, 0, 0, -0.35, 0.75)
            cg.addColorStop(0, rgba(HAZE_BLUE, k * envS * haze))
            cg.addColorStop(1, rgba(HAZE_BLUE, 0))
            c.fillStyle = cg
            c.beginPath()
            c.ellipse(0, -0.35, 1, 0.75, 0, 0, Math.PI * 2)
            c.fill()
            c.restore()
          }
          emitted = true
        }
        for (let k = 0; k < total; k++) {
          const birth = k < burstN ? (k / burstN) * 0.08 : (k - burstN) / rate
          const age = onsetSec - birth
          if (age < 0) break
          const strand = k % strandCount
          const ss = noteSeed + strand * 7.7
          const tall = 0.6 + 0.8 * rand01(ss + 1.1)
          const ms = noteSeed + k * 1.618
          const r = rand01(ms + 0.1)
          const r2 = rand01(ms + 0.2)
          const r3 = rand01(ms + 0.3)
          const strandX = cx + ((strand + 0.5) / strandCount - 0.5) * kw * 2.6 + (rand01(ss + 0.5) - 0.5) * kw * 0.8
          motePose(ss, age, { x: strandX, y: hitY }, dust, pose, emitEnd - birth)
          // Own place on the ribbon: in one of three CLUMPS along it (dark
          // gaps between, like the reference), hugging the spine.
          const clump = Math.floor(r2 * 3)
          const clumpY = (0.15 + 0.35 * clump + 0.2 * rand01(ss + 2.2 + clump)) * kw * 2.4 * tall
          const px = pose.x + (r - 0.5) * kw * 0.7
          const py = pose.y - clumpY - (rand01(ms + 0.4) - 0.5) * kw * 0.9 + kw * 0.25
          const t = age / (dust.life * (0.7 + 0.6 * r3))
          const env = moteEnvelope(t)
          if (env <= 0) continue
          const twinkle = 0.85 + 0.15 * Math.sin(age * 2.5 + r3 * 6.283)
          const a = Math.min(1, env * twinkle)
          const sz = (0.7 + 1.2 * r3 * r3) * particleSize * (H / 1024)
          const sprite = r < 0.45 ? dotPale : r < 0.9 ? dotWhite : dotBlue
          ctx.globalAlpha = a
          ctx.drawImage(sprite, px - sz * 2.2, py - sz * 2.2, sz * 4.4, sz * 4.4)
          ectx.globalAlpha = a * 0.9
          ectx.drawImage(sprite, px - sz * 4, py - sz * 4, sz * 8, sz * 8)
          emitted = true
        }
        // Vapor streaks: three on the strike, one every 0.35 s held.
        if (streaks > 0) {
          const STREAK_LIFE = 0.9
          const births = rand01(noteSeed + 9.1) < 0.5 ? [emitEnd] : [emitEnd, emitEnd + 0.12]
          for (let b = 0.25; b < emitEnd - 0.2; b += 0.4) births.push(b)
          ctx.globalAlpha = 1
          ectx.globalAlpha = 1
          for (let j = 0; j < births.length; j++) {
            const age = onsetSec - births[j]
            if (age < 0) continue
            if (age > STREAK_LIFE) continue
            const ss = noteSeed * 1.7 + j * 3.1
            const origin = { x: cx + (rand01(ss + 0.4) - 0.5) * kw * 1.5, y: hitY - kw * (0.4 + rand01(ss + 0.7)) }
            const env = Math.min(1, age / 0.1) * (1 - age / STREAK_LIFE)
            ctx.beginPath()
            ectx.beginPath()
            for (let i = 0; i <= 7; i++) {
              const a2 = age - i * 0.04
              if (a2 < 0) break
              streakPose(ss, a2, origin, 150 * (H / 1024) * particleRise, pose)
              if (i === 0) { ctx.moveTo(pose.x, pose.y); ectx.moveTo(pose.x, pose.y) }
              else { ctx.lineTo(pose.x, pose.y); ectx.lineTo(pose.x, pose.y) }
            }
            ctx.lineCap = 'round'
            ctx.strokeStyle = rgba([140, 150, 255], 0.45 * env * streaks)
            ctx.lineWidth = 3 * (H / 1024)
            ctx.stroke()
            ectx.lineCap = 'round'
            ectx.strokeStyle = rgba([120, 130, 255], 0.8 * env * streaks)
            ectx.lineWidth = 6 * (H / 1024)
            ectx.stroke()
            emitted = true
          }
        }
      }
      ctx.globalAlpha = 1
      ectx.globalAlpha = 1
    }

    if (emitted && glow > 0) bloom.composite(ctx, glowReach, 0.35 + 0.65 * glow)

    texture.needsUpdate = true
    const material = mesh.material as MeshBasicMaterial
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }

    if (process.env.NODE_ENV !== 'production' && 'document' in globalThis) {
      ;(window as unknown as Record<string, unknown>).__glassRollDebug = { main: canvas, emissive: bloom.emissive, strip, layout, visible: visible.length }
    }
  })

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[viewport.width, viewport.height]} />
      {/* FORCE_TRANSPARENT_KEY: without it applyMaterialOpacity flips this
          full-frame quad opaque at full track opacity and the low-alpha
          halo pixels render posterized (see instruments/CLAUDE.md). */}
      <meshBasicMaterial transparent depthWrite={false} toneMapped={false} userData={{ [FORCE_TRANSPARENT_KEY]: true }} />
    </mesh>
  )
}

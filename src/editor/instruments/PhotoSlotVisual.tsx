import { useThree } from '@react-three/fiber'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import { useFullFrameCanvas, commitCanvasFrame } from '../core/visual/fullFrameCanvas'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import { PHOTO_BASE_PITCH } from '../core/photo/photoTime'
import { getPhotoPlayableUrl } from '../core/photo/photoSource'
import type { ResolvedNote } from '../core/visual/types'
import {
  STYLE_COUNTER, STYLE_CAPS, STYLE_ARCS, STYLE_VERTICAL, STYLE_TITLE, STYLE_PLAIN,
  BORDER_NONE, BORDER_CORNER_ARCS, BORDER_WAVY, BORDER_RAYS,
} from './PhotoSlot'

// The Photo Slot visual - the lazy half of ./PhotoSlot (see that file's header
// for what a slot is and how the counter / placeholder model works).

const BASE = PHOTO_BASE_PITCH

// Reference space: the slot geometry is authored against a 422x254 frame (the
// source template's 16:9-ish strip); everything scales from canvas height.
const REF_W = 422
const REF_H = 254

// ---------------------------------------------------------------------------
// Photo bytes -> HTMLImageElement, cached per ref for canvas drawing.

interface ImgEntry { img: HTMLImageElement | null; failed: boolean }
const imageCache = new Map<string, ImgEntry>()
function cachedImage(ref: string): HTMLImageElement | null {
  const entry = imageCache.get(ref)
  if (entry) return entry.img
  const rec: ImgEntry = { img: null, failed: false }
  imageCache.set(ref, rec)
  void getPhotoPlayableUrl(ref)
    .then((url) => {
      const img = new Image()
      // Signed storage URLs are cross-origin; without CORS clearance the 2D
      // canvas is TAINTED by drawImage and the WebGL texture upload throws a
      // SecurityError. Same default THREE's TextureLoader uses (which is why
      // the Photo instrument never hit this). Harmless for object/public URLs.
      img.crossOrigin = 'anonymous'
      img.onload = () => { rec.img = img }
      img.onerror = () => { rec.failed = true }
      img.src = url
    })
    .catch(() => { rec.failed = true })
  return null
}

// ---------------------------------------------------------------------------
// Shared drawing vocabulary (ported from the source-edit analysis).

type Ctx = CanvasRenderingContext2D

export function paperRect(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, bulge: number, seed: number): void {
  const bx = bulge * (0.8 + seededRand(seed) * 0.4)
  const by = bulge * (0.8 + seededRand(seed + 1) * 0.4)
  ctx.beginPath()
  ctx.moveTo(x0 + bulge, y0)
  ctx.quadraticCurveTo((x0 + x1) / 2, y0 - by, x1 - bulge, y0)
  ctx.quadraticCurveTo(x1 + bx, (y0 + y1) / 2, x1 - bulge, y1)
  ctx.quadraticCurveTo((x0 + x1) / 2, y1 + by, x0 + bulge, y1)
  ctx.quadraticCurveTo(x0 - bx, (y0 + y1) / 2, x0 + bulge, y0)
  ctx.closePath()
}

function arcText(ctx: Ctx, text: string, cx: number, cy: number, width: number, sag: number, size: number, color: string): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.font = `${size}px Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const totalW = ctx.measureText(text).width
  const scale = Math.min(1, width / totalW)
  let x = cx - (totalW * scale) / 2
  for (const ch of text.split('')) {
    const w = ctx.measureText(ch).width * scale
    const t = (x + w / 2 - cx) / (width / 2)
    const y = cy - (1 - t * t) * sag
    ctx.save()
    ctx.translate(x + w / 2, y)
    ctx.rotate(Math.atan2(2 * t * sag, width / 2) * 0.6)
    ctx.scale(scale, 1)
    ctx.fillText(ch, 0, 0)
    ctx.restore()
    x += w
  }
  ctx.restore()
}

function squishedLine(ctx: Ctx, text: string, cx: number, cy: number, size: number, color: string): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.font = `${size}px Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.translate(cx, cy)
  ctx.scale(0.96, 1.06)
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

/** Blurred title sprite ("Spider scene"): radial zoom blur, cached per label. */
const titleCache = new Map<string, HTMLCanvasElement>()
function titleSprite(label: string): HTMLCanvasElement {
  const hit = titleCache.get(label)
  if (hit) return hit
  const w = 512, h = 200
  const base = document.createElement('canvas')
  base.width = w; base.height = h
  const bctx = base.getContext('2d')!
  bctx.fillStyle = '#ffffff'
  bctx.font = '64px Arial, sans-serif'
  bctx.textAlign = 'center'
  bctx.textBaseline = 'middle'
  bctx.fillText(label, w / 2, h / 2)
  const out = document.createElement('canvas')
  out.width = w; out.height = h
  const octx = out.getContext('2d')!
  for (let i = 0; i < 14; i++) {
    const s = 1 + i * 0.018
    octx.globalAlpha = 0.16 * (1 - i / 15)
    octx.drawImage(base, w / 2 - (w * s) / 2, h / 2 - (h * s) / 2, w * s, h * s)
  }
  octx.globalAlpha = 0.85
  octx.drawImage(base, 0, 0)
  titleCache.set(label, out)
  return out
}

/** Radial light rays (the Spider-scene backdrop), deterministic. */
let raySprite: HTMLCanvasElement | null = null
function getRaySprite(): HTMLCanvasElement {
  if (raySprite) return raySprite
  const w = 512, h = 308
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  ctx.translate(w / 2, h / 2)
  for (let i = 0; i < 90; i++) {
    const a = seededRand(i * 3.1) * Math.PI * 2
    const len = 150 + seededRand(i * 7.7) * 220
    const wd = 2 + seededRand(i * 11.3) * 10
    ctx.globalAlpha = 0.05 + seededRand(i * 5.9) * 0.1
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(Math.cos(a - 0.02) * len, Math.sin(a - 0.02) * len)
    ctx.lineTo(Math.cos(a + 0.02) * len + wd, Math.sin(a + 0.02) * len)
    ctx.closePath()
    ctx.fill()
  }
  raySprite = c
  return c
}

// ---------------------------------------------------------------------------

interface SlotEventState {
  note: ResolvedNote
  /** Running velocity sum of this block's notes up to and including `note`. */
  counter: number
  /** 0-based position of `note` among this block's notes. */
  ordinal: number
}

/** The slot's active event at `beat`: gate = only while the note sounds,
 *  latch = photo-style until the next note-on (block-bounded either way). */
function activeEvent(notes: ResolvedNote[], beat: number, latch: boolean): SlotEventState | null {
  let best: ResolvedNote | null = null
  for (const n of notes) {
    if (n.beat > beat) continue
    if (beat >= n.blockEndBeat) continue
    if (!latch && beat >= n.beat + n.durationBeats) continue
    if (!best || n.beat > best.beat) best = n
  }
  if (!best) return null
  // Counter increments ride velocities as (delta + 1) - velocity-0 notes don't
  // survive resolution, so a "no tick" event is velocity 1. The ordinal counts
  // this block's events up to the current one (photo fallback when the track
  // carries no counter).
  let counter = 0
  let ordinal = 0
  for (const n of notes) {
    if (n.blockStartBeat !== best.blockStartBeat || n.beat > best.beat) continue
    counter += Math.max(0, n.velocity - 1)
    if (n.beat < best.beat) ordinal++
  }
  return { note: best, counter, ordinal }
}

/** Canvas height tracking the real render height (quantized so resizes don't
 *  mint a canvas per pixel). A fixed low height blurred every photo: the slot
 *  rasterizes to THIS canvas, so unlike a sampled WebGL texture it has to be
 *  at output resolution to stay sharp - in the editor AND in a pinned export. */
function useSlotTexHeight(): number {
  return useThree((s) => Math.max(256, Math.min(1152, Math.round((s.size.height * s.viewport.dpr) / 64) * 64)))
}

export function PhotoSlotVisual({ trackId }: { trackId: string }) {
  const { viewport, meshRef, canvasRef, textureRef, unchanged, invalidate } = useFullFrameCanvas(useSlotTexHeight())

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    if (!canvas || !texture || !mesh) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    const p = state.params
    mesh.renderOrder = 100 + (p.layer ?? 5)
    const latch = (p.hold ?? 0) >= 0.5
    const ev = state.blackedOut ? null : activeEvent(state.notes, state.beat, latch)
    if (!ev) {
      mesh.visible = false
      invalidate()
      return
    }
    mesh.visible = true

    const pads = state.photoPads ?? []
    // Warm the whole bank (Photo does the same): without this, the first cut
    // to a not-yet-loaded pad flashes the placeholder while the bytes arrive.
    for (const pad of pads) void cachedImage(pad.ref)
    // The picture NUMBER drives the picture: 'background pictures "39"' means
    // photo #39 - so the counter picks the pad (mod bank), and every counter
    // tick is a cut to a new photo, exactly like the source template. Tracks
    // without a counter advance one pad per event instead. (Pitch keeps
    // choosing the placeholder color only.)
    const pictureNo = ev.counter > 0 ? ev.counter - 1 : ev.ordinal
    const padIndex = pads.length > 0 ? ((pictureNo % pads.length) + pads.length) % pads.length : -1
    const padRef = padIndex >= 0 ? pads[padIndex].ref : null
    const img = padRef ? cachedImage(padRef) : null
    const imgReady = !!img

    const palette = (state.stringParams.palette ?? '#d8f4f0')
      .split(',').map((s) => s.trim()).filter(Boolean)
    const color = palette.length ? palette[(((ev.note.pitch - BASE) % palette.length) + palette.length) % palette.length] : '#d8f4f0'
    const label = state.stringParams.label ?? ''
    const textColor = state.stringParams.textColor ?? '#141414'
    const style = p.labelStyle ?? STYLE_COUNTER
    const border = p.borderStyle ?? BORDER_NONE

    const w = canvas.width
    const h = canvas.height
    const key = [
      ev.note.beat, ev.note.pitch, ev.counter, w, h, imgReady, color, label, textColor,
      p.x, p.y, p.w, p.h, p.rot, p.wobble, p.labelStyle, p.labelSize, p.labelX, p.labelY,
      p.borderStyle, p.alpha, state.opacity, pads.map((pd) => pd.ref).join('~'),
    ].join('|')
    if (unchanged(key, state.notes)) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // Scale reference-space drawing to the canvas.
    const s = h / REF_H
    ctx.setTransform(s, 0, 0, s, (w - REF_W * s) / 2, 0)

    const opacity = (p.alpha ?? 1) * (state.opacity ?? 1)
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity))

    const cx = (p.x ?? 0.5) * REF_W
    const cy = (p.y ?? 0.5) * REF_H
    const rw = (p.w ?? 1) * REF_W
    const rh = (p.h ?? 1) * REF_H
    const rot = ((p.rot ?? 0) * Math.PI) / 180
    const wob = (p.wobble ?? 0.35) * 6
    const seed = ev.note.pitch * 7.3 + (p.layer ?? 5) * 31

    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rot)

    // The slot body: user photo (cover-cropped) or the palette placeholder.
    // Palette entry 'none' = label-only event (captions floating on whatever
    // is behind - the arched texts of phases D/E live on other slots' fills).
    const bodyless = color === 'none'
    paperRect(ctx, -rw / 2, -rh / 2, rw / 2, rh / 2, wob, seed)
    if (img) {
      ctx.save()
      ctx.clip()
      ctx.imageSmoothingQuality = 'high'
      const ia = img.width / img.height
      const ra = rw / rh
      const dw = ia > ra ? rh * ia : rw
      const dh = ia > ra ? rh : rw / ia
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
      ctx.restore()
    } else if (!bodyless) {
      ctx.fillStyle = color
      ctx.fill()
    }

    // Labels are the PLACEHOLDER's caption ('background pictures "39"'): they
    // exist to say what belongs in the slot, so a filled slot draws none.
    const lx = -rw / 2 + (p.labelX ?? 0.5) * rw
    const ly = -rh / 2 + (p.labelY ?? 0.5) * rh
    const size = (p.labelSize ?? 0.105) * REF_H
    if (img) {
      // photo showing - no label
    } else if (style === STYLE_COUNTER) {
      squishedLine(ctx, `${label} "${ev.counter}"`, lx, ly, size, textColor)
    } else if (style === STYLE_CAPS) {
      ctx.save()
      // Caps captions take their ink from the slot color itself (the source
      // template darkens whatever the placeholder is).
      const capsInk = color.startsWith('#')
        ? `rgb(${[1, 3, 5].map((i) => Math.round(parseInt(color.slice(i, i + 2), 16) * 0.35)).join(',')})`
        : textColor
      ctx.fillStyle = capsInk
      ctx.font = `${size}px Arial, sans-serif`
      ctx.textAlign = 'center'
      const lines = label.split('\n')
      lines.forEach((l, i) => ctx.fillText(l.toUpperCase(), lx, ly + (i - (lines.length - 1) / 2) * size * 1.4))
      ctx.restore()
    } else if (style === STYLE_ARCS) {
      // labelY sets how far in from the slot's edges the two arcs sit, so a
      // lane can keep them hugging a moving band.
      const inset = (p.labelY ?? 0.08) * rh
      arcText(ctx, label, lx, -rh / 2 + Math.max(12, inset), rw * 0.9, 8, size, textColor)
      arcText(ctx, label, lx, rh / 2 - Math.max(12, inset), rw * 0.9, -8, size, textColor)
    } else if (style === STYLE_VERTICAL) {
      ctx.save()
      ctx.translate(lx, ly)
      ctx.rotate(-Math.PI / 2)
      ctx.fillStyle = textColor
      ctx.font = `${size}px Arial, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(label, 0, 0)
      ctx.restore()
    } else if (style === STYLE_TITLE) {
      const sp = titleSprite(label || 'Title')
      const tw = rw * 0.86
      const th = (tw / sp.width) * sp.height
      ctx.drawImage(sp, lx - tw / 2, ly - th / 2, tw, th)
    } else if (style === STYLE_PLAIN) {
      ctx.save()
      ctx.fillStyle = textColor
      ctx.font = `${size}px Arial, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const lines = label.split('\n')
      lines.forEach((l, i) => ctx.fillText(l, lx, ly + (i - (lines.length - 1) / 2) * size * 1.25))
      ctx.restore()
    }

    // Borders inside the (rotated) slot space.
    if (border === BORDER_CORNER_ARCS) {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.moveTo(-rw / 2, -rh / 2); ctx.lineTo(rw / 2, -rh / 2); ctx.lineTo(rw / 2, -rh / 2 + 24)
      ctx.quadraticCurveTo(0, -rh / 2 - 6, -rw / 2, -rh / 2 + 24)
      ctx.closePath(); ctx.fill()
      ctx.beginPath()
      ctx.moveTo(-rw / 2, rh / 2); ctx.lineTo(rw / 2, rh / 2); ctx.lineTo(rw / 2, rh / 2 - 22)
      ctx.quadraticCurveTo(0, rh / 2 + 8, -rw / 2, rh / 2 - 22)
      ctx.closePath(); ctx.fill()
    } else if (border === BORDER_WAVY) {
      for (const yEdge of [-rh / 2, rh / 2]) {
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        const amp = 5 + seededRand(seed + yEdge) * 3
        ctx.moveTo(-rw / 2 - 4, yEdge - 5 + amp)
        ctx.quadraticCurveTo(0, yEdge - 5 - amp, rw / 2 + 4, yEdge - 5 + amp)
        ctx.lineTo(rw / 2 + 4, yEdge + 5 - amp)
        ctx.quadraticCurveTo(0, yEdge + 5 + amp, -rw / 2 - 4, yEdge + 5 - amp)
        ctx.closePath()
        ctx.fill()
      }
    } else if (border === BORDER_RAYS) {
      ctx.save()
      ctx.globalAlpha = ctx.globalAlpha * 0.55
      ctx.drawImage(getRaySprite(), -rw / 2, -rh / 2, rw, rh)
      ctx.restore()
    }

    ctx.restore()
    ctx.globalAlpha = 1
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    commitCanvasFrame(mesh, texture)
    // A photo that is still loading: retry until it lands so a paused frame
    // doesn't hold the placeholder forever.
    if (padRef && !imgReady && !imageCache.get(padRef)?.failed) return false
  })

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[viewport.width * 1.02, viewport.height * 1.02]} />
      <meshBasicMaterial transparent opacity={1} depthWrite={false} depthTest={false} toneMapped={false} userData={{ [FORCE_TRANSPARENT_KEY]: true }} />
    </mesh>
  )
}

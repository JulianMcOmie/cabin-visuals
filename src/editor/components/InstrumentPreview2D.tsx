'use client'

import { useEffect, useRef } from 'react'
import { strobeGate } from '../instruments/Strobe'

/**
 * Purpose-built canvas-2D previews for instruments whose real render needs
 * context the hover popup can't provide - uploads (Video, Photo), live audio
 * (Oscilloscope), the scene camera (Camera), a scene to remap (Color Filters),
 * or scenes to composite (the Directors). Same move as the Slideshow template
 * card (TemplateSlideshowPreview): a small hand-drawn vignette that reads
 * unmistakably as what the instrument does, instead of a blank real render.
 *
 * Every vignette runs off one time input (seconds since mount) and pulses at
 * the same 120bpm the R3F previews use, so hovering down the list feels like
 * one connected demo reel.
 */

type Draw2D = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void

const BEATS_PER_SEC = 2 // 120bpm, matching InstrumentHoverPreview's clock

/** Decaying pulse restarting every `strideBeats` (1 at the onset, falling to 0). */
function pulseAt(beat: number, strideBeats = 1, rate = 4): number {
  const frac = ((beat % strideBeats) + strideBeats) % strideBeats
  return Math.exp(-rate * frac)
}

// ── Shared scenery ───────────────────────────────────────────────────────────

// The little sun-over-hills postcard, in a few palettes - stands in for "your
// footage/photos" wherever a vignette needs recognizable image content.
const LANDSCAPES: Array<{ sky: [string, string]; sun: string; hill: string }> = [
  { sky: ['#fbbf24', '#ec4899'], sun: '#fff7ed', hill: '#7c2d12' },
  { sky: ['#38bdf8', '#0ea5e9'], sun: '#fef9c3', hill: '#0c4a6e' },
  { sky: ['#a78bfa', '#f472b6'], sun: '#fdf4ff', hill: '#4c1d95' },
  { sky: ['#34d399', '#0d9488'], sun: '#ecfdf5', hill: '#064e3b' },
]

function drawLandscape(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  idx: number,
  sunY = 0.34,
) {
  const s = LANDSCAPES[((idx % LANDSCAPES.length) + LANDSCAPES.length) % LANDSCAPES.length]
  const sky = ctx.createLinearGradient(x, y, x, y + h)
  sky.addColorStop(0, s.sky[0])
  sky.addColorStop(1, s.sky[1])
  ctx.fillStyle = sky
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = s.sun
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.arc(x + w * 0.72, y + h * sunY, Math.min(w, h) * 0.13, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = s.hill
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  ctx.lineTo(x + w * 0.32, y + h * 0.52)
  ctx.lineTo(x + w * 0.55, y + h * 0.82)
  ctx.lineTo(x + w * 0.78, y + h * 0.46)
  ctx.lineTo(x + w, y + h * 0.78)
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
  ctx.fill()
}

// ── The vignettes ────────────────────────────────────────────────────────────

/** The Camera vignette's scene: a perspective field of movie-camera emojis
 *  the viewpoint glides through, with "Camera" standing mid-scene as a tilted
 *  3D billboard that pulses on the beat. The glide plus the punch-in above
 *  make the MOVE the subject - this instrument drives the camera, it isn't
 *  a picture. */
function drawCameraScene(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const beat = t * BEATS_PER_SEC
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#151c40')
  bg.addColorStop(1, '#2a164f')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  const horizon = h * 0.36
  const focal = h * 0.85
  const rowDepth = 1 // world units between emoji rows
  // Constant forward glide: rows recycle every rowDepth, with a gentle sway.
  const zOffset = (t * 0.55) % rowDepth
  const sway = Math.sin(t * 0.6) * 0.5
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Far to near, so close cameras draw over distant ones. Rows dissolve as
  // they near the lens instead of swallowing the frame.
  for (let zi = 7; zi >= 1; zi--) {
    const z = zi * rowDepth - zOffset + 0.55
    const size = (h * 0.3) / z
    const y = horizon + (focal * 0.32) / z
    ctx.font = `${size}px sans-serif`
    ctx.globalAlpha = Math.min(1, 2.2 / z) * Math.min(1, Math.max(0, (z - 0.55) / 0.45))
    for (let xi = -3; xi <= 3; xi++) {
      const x = w / 2 + ((xi * 1.5 + sway) * focal * 0.35) / z
      if (x > -size && x < w + size) ctx.fillText('🎥', x, y)
    }
  }
  ctx.globalAlpha = 1

  // "Camera" IN the scene: sheared like a billboard standing on the plane,
  // pulsing with each note.
  const titleSize = h * 0.24 * (1 + 0.1 * pulseAt(beat, 1, 3))
  ctx.save()
  ctx.translate(w / 2, horizon - h * 0.05)
  ctx.transform(1, -0.05, 0, 1, 0, 0)
  ctx.font = `900 ${titleSize}px "Arial Black", Impact, sans-serif`
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = titleSize * 0.16
  ctx.shadowOffsetY = titleSize * 0.07
  ctx.fillText('Camera', 0, 0)
  ctx.restore()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** Camera: the scene punches in and shakes on each note, viewed through
 *  viewfinder chrome (corner brackets + REC). */
const drawCamera: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  const p = pulseAt(beat, 1, 3)
  const scale = 1 + 0.16 * p
  const dx = Math.sin(t * 43) * 2.5 * p
  const dy = Math.cos(t * 57) * 2.5 * p
  ctx.save()
  ctx.translate(w / 2 + dx, h / 2 + dy)
  // Slight overscan under the punch/shake so an edge never shows.
  ctx.scale(scale * 1.06, scale * 1.06)
  ctx.translate(-w / 2, -h / 2)
  drawCameraScene(ctx, w, h, t)
  ctx.restore()

  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 1.5
  const b = 10
  const cx = [8, w - 8]
  const cy = [8, h - 8]
  for (const x of cx) for (const y of cy) {
    ctx.beginPath()
    ctx.moveTo(x + (x < w / 2 ? b : -b), y)
    ctx.lineTo(x, y)
    ctx.lineTo(x, y + (y < h / 2 ? b : -b))
    ctx.stroke()
  }
  if (Math.floor(t * 1.6) % 2 === 0) {
    ctx.fillStyle = '#ef4444'
    ctx.beginPath()
    ctx.arc(w - 34, 15, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = '600 8px monospace'
    ctx.fillText('REC', w - 28, 18)
  }
}

/** Video: the video itself, nothing else - full-frame sunset footage with
 *  mountain ridges rushing past in parallax (the far ridge slower than the
 *  near one, like footage shot from a moving car) and "video" centered over
 *  it. No player chrome: the instrument shows footage, it doesn't add UI. */
const drawVideo: Draw2D = (ctx, w, h, t) => {
  const sky = ctx.createLinearGradient(0, 0, 0, h)
  sky.addColorStop(0, '#fbbf24')
  sky.addColorStop(1, '#ec4899')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#fff7ed'
  ctx.globalAlpha = 0.9
  ctx.beginPath()
  ctx.arc(w * 0.72, h * 0.3, Math.min(w, h) * 0.13, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1

  // A zigzag ridge: two summed triangle waves over world-x, so it never tiles
  // visibly and never ends.
  const ridge = (scroll: number, base: number, amp: number, color: string) => {
    const tri = (u: number, period: number, phase: number) => {
      const f = ((u / period + phase) % 1 + 1) % 1
      return Math.abs(f - 0.5) * 2
    }
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let x = 0; x <= w; x += 4) {
      const u = x + scroll
      ctx.lineTo(x, base - amp * (0.6 * tri(u, w * 0.45, 0) + 0.4 * tri(u, w * 0.23, 0.37)))
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  }
  // Far ridge drifts, near ridge rushes - the parallax IS the "it's playing".
  ridge(t * w * 0.09, h * 0.82, h * 0.34, '#b0486b')
  ridge(t * w * 0.28, h * 1.04, h * 0.5, '#7c2d12')

  // Centered "video", steady - a video just plays, it doesn't beat.
  const capSize = h * 0.2
  ctx.font = `900 ${capSize}px "Arial Black", Impact, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = capSize * 0.25
  ctx.shadowOffsetY = capSize * 0.05
  ctx.fillText('video', w / 2, h / 2)
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** Photo: one still, full stop - a white-bordered print of a landscape with
 *  "photo" centered on it. Nothing animates: a photo doesn't play, and the
 *  stillness against Video's rushing ridges IS the tell. */
const drawPhoto: Draw2D = (ctx, w, h) => {
  ctx.fillStyle = '#0b0b0b'
  ctx.fillRect(0, 0, w, h)
  const m = 8
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(m - 4, m - 4, w - 2 * (m - 4), h - 2 * (m - 4))
  drawLandscape(ctx, m, m, w - 2 * m, h - 2 * m, 2)
  const capSize = h * 0.2
  ctx.font = `900 ${capSize}px "Arial Black", Impact, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = capSize * 0.25
  ctx.shadowOffsetY = capSize * 0.05
  ctx.fillText('photo', w / 2, h / 2)
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** Oscilloscope: a glowing waveform over a faint grid, amplitude pulsing on
 *  the beat like audio would. */
const drawOscilloscope: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  ctx.fillStyle = '#04070a'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = 'rgba(58,255,140,0.08)'
  ctx.lineWidth = 1
  for (let i = 1; i < 8; i++) {
    ctx.beginPath(); ctx.moveTo((w / 8) * i, 0); ctx.lineTo((w / 8) * i, h); ctx.stroke()
  }
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke()
  }
  const amp = h * (0.1 + 0.28 * pulseAt(beat, 1, 3))
  ctx.strokeStyle = '#3aff8c'
  ctx.lineWidth = 1.5
  ctx.shadowColor = '#3aff8c'
  ctx.shadowBlur = 8
  ctx.beginPath()
  for (let x = 0; x <= w; x += 2) {
    const ph = (x / w) * Math.PI * 2
    const y = h / 2 + Math.sin(ph * 3 + t * 6) * amp * (0.6 + 0.4 * Math.sin(ph * 7 - t * 9))
    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  // The name in scope-phosphor green - terminal face, glowing like the trace.
  let size = h * 0.16
  const scopeFont = (s: number) => `700 ${s}px Consolas, "Lucida Console", Menlo, monospace`
  ctx.font = scopeFont(size)
  const measured = ctx.measureText('oscilloscope').width
  const maxW = w * 0.86
  if (measured > maxW) size *= maxW / measured
  ctx.font = scopeFont(size)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#3aff8c'
  ctx.shadowBlur = 10
  ctx.fillText('oscilloscope', w / 2, h * 0.2)
  ctx.shadowBlur = 0
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** Bass Ripple: the name run through its own effect - "bass ripple" rendered
 *  once to a scratch layer, then redrawn in thin rows displaced by a traveling
 *  sine whose amplitude PULSES on the bass hit every couple of beats, so the
 *  words visibly warp like the scene does while its note is held. */
let bassRippleScratch: HTMLCanvasElement | null = null

const drawBassRipple: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#120f22')
  bg.addColorStop(1, '#1c1233')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // The undisturbed words, re-rendered only when the card size changes.
  if (!bassRippleScratch) bassRippleScratch = document.createElement('canvas')
  const scratch = bassRippleScratch
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w
    scratch.height = h
    const s = scratch.getContext('2d')!
    let size = h * 0.24
    const font = (v: number) => `900 ${v}px "Arial Black", Impact, sans-serif`
    s.font = font(size)
    const measured = s.measureText('bass ripple').width
    const maxW = w * 0.86
    if (measured > maxW) size *= maxW / measured
    s.font = font(size)
    s.textAlign = 'center'
    s.textBaseline = 'middle'
    s.fillStyle = '#a78bfa'
    s.fillText('bass ripple', w / 2, h / 2)
  }

  // Bass hit every 2 beats: the ripple swells hard and settles, a small
  // steady shimmer keeping the field alive between hits.
  const amp = w * 0.005 + w * 0.045 * pulseAt(beat, 2, 3)
  const row = Math.max(1, Math.round(h / 60))
  for (let y = 0; y < h; y += row) {
    const off = amp * Math.sin(y * (14 / h) - t * 7)
    ctx.drawImage(scratch, 0, y, w, row, off, y, w, row)
  }
}

/** Color Filters: the name run through its own effect - each held filter is a
 *  DISCRETE look, so the card hard-swaps background and text color together
 *  every beat instead of sweeping, exactly like the instrument's remaps. */
const COLOR_FILTER_LOOKS: Array<{ bg: string; text: string }> = [
  { bg: '#1e1b4b', text: '#22d3ee' },
  { bg: '#052e16', text: '#4ade80' },
  { bg: '#4a044e', text: '#e879f9' },
  { bg: '#451a03', text: '#fbbf24' },
]
const drawColorFilters: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  const look = COLOR_FILTER_LOOKS[Math.floor(beat) % COLOR_FILTER_LOOKS.length]
  ctx.fillStyle = look.bg
  ctx.fillRect(0, 0, w, h)
  let size = h * 0.26
  const font = (s: number) => `900 ${s}px "Arial Black", Impact, sans-serif`
  ctx.font = font(size)
  const maxW = w * 0.86
  const measured = ctx.measureText('color filters').width
  if (measured > maxW) size *= maxW / measured
  ctx.font = font(size)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = look.text
  ctx.fillText('color filters', w / 2, h / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** Strobe: a scrap of stage flipping polarity on the beat grid. It runs the
 *  instrument's OWN gate at its emphasized 1/16 row, so the card flashes at the
 *  rate the instrument actually would (8Hz at the previews' 120bpm) rather than
 *  at a hand-picked blink speed. Inverting means swapping the palette rather
 *  than reading pixels back: same result, no getImageData per frame. */
const STROBE_SHAPES: Array<{ fill: string; flipped: string }> = [
  { fill: '#22d3ee', flipped: '#dd2c11' },
  { fill: '#f472b6', flipped: '#0b8d49' },
  { fill: '#a78bfa', flipped: '#587405' },
]
const drawStrobe: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  const lit = strobeGate(beat, 1 / 4, 0.5) > 0
  ctx.fillStyle = lit ? '#f7f8fa' : '#05070c'
  ctx.fillRect(0, 0, w, h)
  const r = h * 0.17
  const cy = h * 0.46
  const circle = STROBE_SHAPES[0]
  ctx.fillStyle = lit ? circle.flipped : circle.fill
  ctx.beginPath()
  ctx.arc(w * 0.28, cy, r, 0, Math.PI * 2)
  ctx.fill()
  const triangle = STROBE_SHAPES[1]
  ctx.fillStyle = lit ? triangle.flipped : triangle.fill
  ctx.beginPath()
  ctx.moveTo(w * 0.52, cy - r)
  ctx.lineTo(w * 0.62, cy + r)
  ctx.lineTo(w * 0.42, cy + r)
  ctx.closePath()
  ctx.fill()
  const square = STROBE_SHAPES[2]
  ctx.fillStyle = lit ? square.flipped : square.fill
  ctx.fillRect(w * 0.72 - r, cy - r, r * 2, r * 2)
  ctx.fillStyle = lit ? '#0219b8' : '#fde047'
  ctx.fillRect(w * 0.2, h * 0.76, w * 0.6, Math.max(2, h * 0.05))
}

/** Scene Switcher: ONE prominent "switch", restyled every beat - each switch
 *  jumps the font AND the color AND the backdrop, so the whole frame reads as
 *  a different scene holding the same subject. Fonts lean on system stacks
 *  (the same families TextDisplay ships), so every style lands distinct. */
const SWITCH_STYLES: Array<{ font: (size: number) => string; color: string; bg: [string, string] }> = [
  { font: (s) => `900 ${s}px "Arial Black", Impact, sans-serif`, color: '#a78bfa', bg: ['#101426', '#1a1033'] },
  { font: (s) => `italic 900 ${s}px Georgia, "Times New Roman", serif`, color: '#34d399', bg: ['#07191c', '#0c2b22'] },
  { font: (s) => `700 ${s}px "Courier New", monospace`, color: '#f472b6', bg: ['#1f0d1c', '#2b1030'] },
  { font: (s) => `700 ${s}px "Comic Sans MS", "Chalkboard SE", cursive`, color: '#fbbf24', bg: ['#1c1206', '#2b1a08'] },
]
const drawSceneSwitcher: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  const active = Math.floor(beat) % SWITCH_STYLES.length
  const style = SWITCH_STYLES[active]
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, style.bg[0])
  bg.addColorStop(1, style.bg[1])
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  // Fit "switch" to the frame in THIS font (scripts run wider than monos),
  // then punch it slightly on each switch.
  let size = h * 0.34
  ctx.font = style.font(size)
  const measured = ctx.measureText('switch').width
  const maxW = w * 0.8
  if (measured > maxW) size *= maxW / measured
  const pop = 1 + 0.08 * pulseAt(beat, 1, 5)
  ctx.font = style.font(size)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = style.color
  ctx.save()
  ctx.translate(w / 2, h / 2 - h * 0.04)
  ctx.scale(pop, pop)
  ctx.fillText('switch', 0, 0)
  ctx.restore()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** Cut: cut regions POP into and out of existence over a base scene, on
 *  staggered gates so they overlap - one cut alone, two stacked, the other
 *  alone, then the bare scene. Each region is another scene clipped to its
 *  polygon, flashing white at its onset like a note just landed. */
const drawCut: Draw2D = (ctx, w, h, t) => {
  const beat = (t * BEATS_PER_SEC) % 4
  drawWordField(ctx, w, h, t, 'cut', 0)
  const regions: Array<{
    poly: Array<[number, number]>
    line: [number, number, number, number]
    variant: number
    on: number
    off: number
  }> = [
    { poly: [[0, 0], [w * 0.62, 0], [w * 0.38, h], [0, h]], line: [w * 0.62, 0, w * 0.38, h], variant: 1, on: 0, off: 2.5 },
    { poly: [[w * 0.35, 0], [w, 0], [w, h], [w * 0.65, h]], line: [w * 0.35, 0, w * 0.65, h], variant: 2, on: 1, off: 3.5 },
  ]
  for (const r of regions) {
    if (beat < r.on || beat >= r.off) continue
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(r.poly[0][0], r.poly[0][1])
    for (let i = 1; i < r.poly.length; i++) ctx.lineTo(r.poly[i][0], r.poly[i][1])
    ctx.closePath()
    ctx.clip()
    drawWordField(ctx, w, h, t, 'cut', r.variant)
    const flash = 0.55 * Math.exp(-6 * (beat - r.on))
    if (flash > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${flash})`
      ctx.fillRect(0, 0, w, h)
    }
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(r.line[0], r.line[1])
    ctx.lineTo(r.line[2], r.line[3])
    ctx.stroke()
  }
}

/** Radial Cut: concentric cuts POP into and out of existence over the base
 *  scene, staggered so they stack - outer circle alone, both nested, inner
 *  alone, bare scene. Cuts superimpose INSTANTLY at full size, exactly like
 *  the real director; only the onset flash marks the moment they land. */
const drawRadialCut: Draw2D = (ctx, w, h, t) => {
  const beat = (t * BEATS_PER_SEC) % 4
  const m = Math.min(w, h)
  drawWordField(ctx, w, h, t, 'radial', 0)
  const rings = [
    { r: m * 0.42, variant: 1, on: 0, off: 2.5 },
    { r: m * 0.22, variant: 2, on: 1, off: 3.5 },
  ]
  for (const ring of rings) {
    if (beat < ring.on || beat >= ring.off) continue
    ctx.save()
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, ring.r, 0, Math.PI * 2)
    ctx.clip()
    drawWordField(ctx, w, h, t, 'radial', ring.variant)
    const flash = 0.55 * Math.exp(-6 * (beat - ring.on))
    if (flash > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${flash})`
      ctx.fillRect(0, 0, w, h)
    }
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, ring.r, 0, Math.PI * 2)
    ctx.stroke()
  }
}

/** Crop: 6 diagonal slices masking one scene - a field of "crop" text - each
 *  slice gated by its own note. Slices build in with the entry flash, chop
 *  between odd/even groups, then black out so the loop restarts clean. Band
 *  geometry mirrors the real shader: even width PERPENDICULAR to the cut, span
 *  derived from the frame's extent along the cut normal so the end bands cover
 *  the corners. */
const CROP_PREVIEW_ANGLE = -Math.PI / 6
const CROP_PREVIEW_SLICES = 6

// Word-field scenery for the director vignettes: rows of a drifting bold word
// on a deep gradient, one accent row - each palette stands in for one scene, so
// a director composing scenes reads as compositing differently-colored fields.
// Each scene also gets its own FONT (the same system stacks SWITCH_STYLES
// uses), so overlapping cuts read as different scenes even where colors blur.
const WORD_FIELDS: Array<{ font: (size: number) => string; bg: [string, string]; base: string; accent: string }> = [
  { font: (s) => `900 ${s}px "Arial Black", Impact, sans-serif`, bg: ['#151c40', '#2a164f'], base: 'rgba(148,163,184,0.42)', accent: 'rgba(167,139,250,0.78)' },
  { font: (s) => `italic 900 ${s}px Georgia, "Times New Roman", serif`, bg: ['#0a301d', '#12452c'], base: 'rgba(134,197,181,0.40)', accent: 'rgba(52,211,153,0.78)' },
  { font: (s) => `700 ${s}px "Courier New", monospace`, bg: ['#3b1130', '#4e173d'], base: 'rgba(196,149,187,0.40)', accent: 'rgba(244,114,182,0.78)' },
  { font: (s) => `700 ${s}px "Comic Sans MS", "Chalkboard SE", cursive`, bg: ['#3c260a', '#4d300d'], base: 'rgba(214,188,140,0.40)', accent: 'rgba(251,191,36,0.78)' },
]

function drawWordField(
  ctx: CanvasRenderingContext2D,
  w: number, h: number, t: number,
  word: string,
  variant: number,
) {
  const palette = WORD_FIELDS[((variant % WORD_FIELDS.length) + WORD_FIELDS.length) % WORD_FIELDS.length]
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, palette.bg[0])
  bg.addColorStop(1, palette.bg[1])
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  const size = h / 4.2
  ctx.font = palette.font(size)
  ctx.textBaseline = 'middle'
  const step = ctx.measureText(word).width + size * 0.45
  const rows = Math.ceil(h / size) + 1
  for (let row = 0; row < rows; row++) {
    const y = (row + 0.5) * size * 0.92
    const direction = row % 2 === 0 ? 1 : -1
    const drift = ((t * 9 * direction) % step + step) % step
    ctx.fillStyle = row % 3 === 1 ? palette.accent : palette.base
    for (let x = -step * 1.5 + drift + (row % 2) * step * 0.5; x < w + step; x += step) {
      ctx.fillText(word, x, y)
    }
  }
}

/** The real flash shape at preview scale: snap to white, hold, fall away. */
function cropPreviewFlash(beatsSinceOnset: number): number {
  const u = beatsSinceOnset / 0.3
  if (u <= 0 || u >= 1) return 0
  if (u < 0.08) { const a = u / 0.08; return a * a * (3 - 2 * a) }
  if (u < 0.22) return 1
  return Math.exp(-(u - 0.22) / 0.2)
}

const drawCrop: Draw2D = (ctx, w, h, t) => {
  const beat = (t * BEATS_PER_SEC) % 8
  // Everything outside an active slice is masked out.
  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, w, h)
  // 8-beat loop per slice: staggered build, all held, odd/even chop, blackout.
  const intervals = (i: number): Array<[number, number]> =>
    i % 2 === 0 ? [[i * 0.5, 5], [6, 7.5]] : [[i * 0.5, 4], [5, 7.5]]
  const normal = { x: Math.cos(CROP_PREVIEW_ANGLE), y: Math.sin(CROP_PREVIEW_ANGLE) }
  // Half the frame's extent along the cut normal (the shader's halfSpan) - and
  // the half-diagonal, so strips always cover the frame across the cut.
  const halfSpan = 0.5 * (w * Math.abs(normal.x) + h * Math.abs(normal.y))
  const halfDiagonal = 0.5 * Math.hypot(w, h)
  for (let i = 0; i < CROP_PREVIEW_SLICES; i++) {
    const active = intervals(i).find(([on, off]) => beat >= on && beat < off)
    if (!active) continue
    const width = (2 * halfSpan) / CROP_PREVIEW_SLICES
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.rotate(CROP_PREVIEW_ANGLE)
    ctx.beginPath()
    ctx.rect(-halfSpan + i * width, -halfDiagonal, width, halfDiagonal * 2)
    ctx.clip()
    ctx.rotate(-CROP_PREVIEW_ANGLE)
    ctx.translate(-w / 2, -h / 2)
    drawWordField(ctx, w, h, t, 'crop', 0)
    const flash = cropPreviewFlash(beat - active[0])
    if (flash > 0.003) {
      ctx.globalAlpha = flash * 0.9
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.globalAlpha = 1
    }
    ctx.restore()
  }
}

// ── Effect vignettes ─────────────────────────────────────────────────────────
//
// The library's Effects tab previews through the same popup. Each vignette
// shows a stand-in subject with ONLY that effect applied - transforms move a
// glowing chip (the same move as MoverPreview's cube), shader effects distort
// the landscape - all on the shared 120bpm clock. Registered under the plugin
// ids from src/editor/effects, which collide with no instrument or mover id.

const CHIP_BLUE = '#35a7e6'

/** The transforms' stand-in object: a glowing rounded square centered at
 *  (0,0) - callers position it with canvas transforms. */
function drawChip(ctx: CanvasRenderingContext2D, size: number, alpha = 1) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = CHIP_BLUE
  ctx.shadowColor = CHIP_BLUE
  ctx.shadowBlur = 12
  ctx.beginPath()
  ctx.roundRect(-size / 2, -size / 2, size, size, size * 0.18)
  ctx.fill()
  ctx.restore()
}

/** Dashed outline of the chip's untouched footprint - the "without the effect"
 *  ghost every transform vignette contrasts against. */
function drawChipGhost(ctx: CanvasRenderingContext2D, size: number) {
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.roundRect(-size / 2, -size / 2, size, size, size * 0.18)
  ctx.stroke()
  ctx.restore()
}

const drawScaleFx: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  ctx.fillStyle = '#0b0b0b'
  ctx.fillRect(0, 0, w, h)
  const size = Math.min(w, h) * 0.42
  ctx.save()
  ctx.translate(w / 2, h / 2)
  drawChipGhost(ctx, size)
  ctx.scale(1 + 0.4 * pulseAt(beat, 1, 3), 1 + 0.4 * pulseAt(beat, 1, 3))
  drawChip(ctx, size)
  ctx.restore()
}

const drawRotateFx: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  ctx.fillStyle = '#0b0b0b'
  ctx.fillRect(0, 0, w, h)
  const size = Math.min(w, h) * 0.42
  ctx.save()
  ctx.translate(w / 2, h / 2)
  drawChipGhost(ctx, size)
  ctx.rotate(t * 1.4 + 0.5 * pulseAt(beat, 1, 3))
  drawChip(ctx, size)
  // A notch so the spin reads even mid-rotation.
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.beginPath()
  ctx.arc(size * 0.28, -size * 0.28, 2.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

const drawOffsetFx: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  ctx.fillStyle = '#0b0b0b'
  ctx.fillRect(0, 0, w, h)
  const size = Math.min(w, h) * 0.4
  // Every 2 beats the chip slides from home to a side (alternating), so the
  // ghost-at-home / solid-away contrast is on screen most of the time.
  const side = Math.floor(beat / 2) % 2 === 0 ? 1 : -1
  const dist = w * 0.16 * (1 - pulseAt(beat, 2, 5))
  ctx.save()
  ctx.translate(w / 2, h / 2)
  drawChipGhost(ctx, size)
  ctx.translate(side * dist, 0)
  drawChip(ctx, size)
  ctx.restore()
}

// Pixelate re-renders the landscape through a low-res scratch canvas; created
// once - only one popup ever draws at a time.
let pixelateScratch: HTMLCanvasElement | null = null

const drawPixelateFx: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  // Chunky on the beat, refining as it decays - pixelation as a hit.
  const block = 2 + 12 * pulseAt(beat, 2, 2.5)
  if (!pixelateScratch) pixelateScratch = document.createElement('canvas')
  const scratch = pixelateScratch
  const sw = Math.max(2, Math.round(w / block))
  const sh = Math.max(2, Math.round(h / block))
  scratch.width = sw
  scratch.height = sh
  const sctx = scratch.getContext('2d')
  if (!sctx) return
  drawLandscape(sctx, 0, 0, sw, sh, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(scratch, 0, 0, sw, sh, 0, 0, w, h)
  ctx.imageSmoothingEnabled = true
}

const drawKaleidoscopeFx: Draw2D = (ctx, w, h, t) => {
  const wedges = 8
  const step = (Math.PI * 2) / wedges
  const radius = Math.hypot(w, h)
  ctx.fillStyle = '#0b0b0b'
  ctx.fillRect(0, 0, w, h)
  for (let i = 0; i < wedges; i++) {
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.rotate(i * step)
    if (i % 2 === 1) ctx.scale(1, -1) // mirror alternate wedges - the kaleidoscope tell
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, radius, -step / 2, step / 2)
    ctx.closePath()
    ctx.clip()
    ctx.rotate(t * 0.25)
    drawLandscape(ctx, -w * 0.55, -h * 0.55, w * 1.1, h * 1.1, 2)
    ctx.restore()
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.46, 0, Math.PI * 2)
  ctx.stroke()
}

const drawChromaticFx: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  const d = 1.5 + 6 * pulseAt(beat, 1, 3)
  ctx.fillStyle = '#050507'
  ctx.fillRect(0, 0, w, h)
  // Classic RGB split: red and cyan copies fringe out of a white subject.
  const subject = (color: string, dx: number) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(w / 2 + dx, h * 0.44, Math.min(w, h) * 0.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(w * 0.3 + dx, h * 0.74, w * 0.4, 5)
  }
  ctx.globalCompositeOperation = 'lighter'
  subject('#ff2b2b', -d)
  subject('#22e0ff', d)
  subject('#ffffff', 0)
  ctx.globalCompositeOperation = 'source-over'
}

const drawOpacityFx: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  // Transparency checker so "fading" reads as opacity, not brightness.
  ctx.fillStyle = '#101014'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#1a1a20'
  const cell = 10
  for (let y = 0; y < h; y += cell) {
    for (let x = (y / cell) % 2 === 0 ? 0 : cell; x < w; x += cell * 2) {
      ctx.fillRect(x, y, cell, cell)
    }
  }
  ctx.globalAlpha = 0.08 + 0.92 * pulseAt(beat, 2, 2)
  drawLandscape(ctx, w * 0.14, h * 0.14, w * 0.72, h * 0.72, 3)
  ctx.globalAlpha = 1
}

// ── Registry + host component ────────────────────────────────────────────────

const PREVIEWS_2D: Record<string, Draw2D> = {
  cameraControl: drawCamera,
  video: drawVideo,
  photo: drawPhoto,
  oscilloscope: drawOscilloscope,
  bassRipple: drawBassRipple,
  colorFilters: drawColorFilters,
  strobe: drawStrobe,
  sceneSwitcher: drawSceneSwitcher,
  cut: drawCut,
  radialCut: drawRadialCut,
  crop: drawCrop,
  // Effect plugins (the library's Effects tab).
  scale: drawScaleFx,
  rotate: drawRotateFx,
  offset: drawOffsetFx,
  pixelate: drawPixelateFx,
  kaleidoscope: drawKaleidoscopeFx,
  chromaticAberration: drawChromaticFx,
  opacity: drawOpacityFx,
}

export function get2DPreview(id: string): Draw2D | undefined {
  return PREVIEWS_2D[id]
}

/** Fills its (positioned) parent with an animated canvas running `draw`.
 *  Same rAF/dpr/reduced-motion skeleton as TemplateSlideshowPreview. */
export function Preview2D({ draw }: { draw: Draw2D }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !parent || !ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = parent.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width))
    const h = Math.max(1, Math.round(rect.height))
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(ctx, w, h, 1.3)
      return
    }

    let raf = 0
    let start = 0
    const loop = (ts: number) => {
      if (!start) start = ts
      draw(ctx, w, h, (ts - start) / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
}

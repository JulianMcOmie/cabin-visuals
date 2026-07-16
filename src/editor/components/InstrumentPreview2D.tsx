'use client'

import { useEffect, useRef } from 'react'

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

// Abstract mini-scenes for the Directors - deliberately graphic (a ball, bars,
// orbiting dots) rather than footage, so "several scenes" reads at a glance.
function drawAbstractScene(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  variant: number, t: number,
) {
  const beat = t * BEATS_PER_SEC
  const m = Math.min(w, h)
  if (variant % 3 === 0) {
    // Bouncing ball on indigo.
    ctx.fillStyle = '#27255f'
    ctx.fillRect(0, 0, w, h)
    const cy = h * (0.78 - 0.5 * Math.abs(Math.sin((beat * Math.PI) / 2)))
    ctx.fillStyle = '#22d3ee'
    ctx.beginPath()
    ctx.arc(w / 2, cy, m * 0.1, 0, Math.PI * 2)
    ctx.fill()
  } else if (variant % 3 === 1) {
    // EQ bars on deep teal.
    ctx.fillStyle = '#0f3d3a'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#facc15'
    const n = 5
    for (let i = 0; i < n; i++) {
      const bh = h * (0.2 + 0.5 * Math.abs(Math.sin(t * 3 + i * 1.1)))
      const bw = w * 0.1
      const bx = w * 0.14 + i * ((w * 0.72) / (n - 1)) - bw / 2
      ctx.fillRect(bx, h - bh, bw, bh)
    }
  } else {
    // Orbiting dots on plum.
    ctx.fillStyle = '#4a1d4e'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#f472b6'
    for (let i = 0; i < 6; i++) {
      const a = t * 1.5 + (i * Math.PI) / 3
      ctx.beginPath()
      ctx.arc(w / 2 + Math.cos(a) * m * 0.3, h / 2 + Math.sin(a) * m * 0.3, m * 0.05, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// ── The vignettes ────────────────────────────────────────────────────────────

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
  ctx.scale(scale, scale)
  ctx.translate(-w / 2, -h / 2)
  // Oversized so the dolly-in never reveals an edge.
  drawLandscape(ctx, -w * 0.15, -h * 0.15, w * 1.3, h * 1.3, 1)
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

/** Video: full-frame footage (drifting sun) hard-cutting to the next clip
 *  every couple of beats, with a ticking timecode and progress bar. */
const drawVideo: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  const idx = Math.floor(beat / 2)
  drawLandscape(ctx, 0, 0, w, h, idx, 0.3 + 0.08 * Math.sin(t * 0.9 + idx * 2))

  const barY = h - 4
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.fillRect(0, barY, w, 4)
  ctx.fillStyle = '#f472b6'
  ctx.fillRect(0, barY, w * ((beat % 8) / 8), 4)

  const sec = Math.floor(t) % 60
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(5, h - 21, 42, 12)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.font = '8px monospace'
  ctx.fillText(`0:${String(sec).padStart(2, '0')}`, 9, h - 12)
}

/** Photo: a white-bordered print hard-cutting to the next photo, with a
 *  camera-flash blink on each cut. Static inside a photo - that's the tell
 *  against Video. */
const drawPhoto: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  const idx = Math.floor(beat / 2)
  ctx.fillStyle = '#0b0b0e'
  ctx.fillRect(0, 0, w, h)
  const m = 8
  ctx.fillStyle = '#f8fafc'
  ctx.fillRect(m - 4, m - 4, w - 2 * (m - 4), h - 2 * (m - 4))
  drawLandscape(ctx, m, m, w - 2 * m, h - 2 * m, idx)
  const flash = 0.7 * pulseAt(beat, 2, 10)
  if (flash > 0.02) {
    ctx.fillStyle = `rgba(255,255,255,${flash})`
    ctx.fillRect(m, m, w - 2 * m, h - 2 * m)
  }
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
  ctx.shadowBlur = 0
}

/** Color Filters: the SAME scene remapped through a stepping filter, with a
 *  swatch row showing which filter is held. */
const drawColorFilters: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  const step = Math.floor(beat / 2) % 4
  const hues = [0, 120, 220, 300]
  ctx.save()
  ctx.filter = step === 0 ? 'none' : `hue-rotate(${hues[step]}deg) saturate(1.4)`
  drawLandscape(ctx, 0, 0, w, h, 0)
  ctx.restore()
  const flash = 0.25 * pulseAt(beat, 2, 8)
  if (flash > 0.02) {
    ctx.fillStyle = `rgba(255,255,255,${flash})`
    ctx.fillRect(0, 0, w, h)
  }
  // Swatch row: the filter palette, active one ringed.
  const colors = ['#e2e8f0', '#4ade80', '#60a5fa', '#e879f9']
  for (let i = 0; i < colors.length; i++) {
    const x = w / 2 + (i - 1.5) * 14
    ctx.fillStyle = colors[i]
    ctx.beginPath()
    ctx.arc(x, h - 11, 3.5, 0, Math.PI * 2)
    ctx.fill()
    if (i === step) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(x, h - 11, 5.5, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
}

/** Scene Switcher: the whole frame jumps to a different scene per held note. */
const drawSceneSwitcher: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  const active = Math.floor(beat / 2) % 3
  drawAbstractScene(ctx, w, h, active, t)
  // Scene dots (same affordance as the slideshow card's pager).
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i === active ? '#ffffff' : 'rgba(255,255,255,0.3)'
    ctx.beginPath()
    ctx.arc(w / 2 + (i - 1) * 10, h - 9, 2, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Cut: the frame partitioned between two scenes, the cut line moving between
 *  straight and diagonal configurations. */
const drawCut: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  const cfg = Math.floor(beat / 2) % 3
  // Region A polygon + its cut line, per configuration.
  const polys: Array<{ a: Array<[number, number]>; line: [number, number, number, number] }> = [
    { a: [[0, 0], [w * 0.5, 0], [w * 0.5, h], [0, h]], line: [w * 0.5, 0, w * 0.5, h] },
    { a: [[0, 0], [w * 0.68, 0], [w * 0.32, h], [0, h]], line: [w * 0.68, 0, w * 0.32, h] },
    { a: [[0, 0], [w * 0.38, 0], [w * 0.62, h], [0, h]], line: [w * 0.38, 0, w * 0.62, h] },
  ]
  const { a, line } = polys[cfg]
  drawAbstractScene(ctx, w, h, cfg + 1, t)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(a[0][0], a[0][1])
  for (let i = 1; i < a.length; i++) ctx.lineTo(a[i][0], a[i][1])
  ctx.closePath()
  ctx.clip()
  drawAbstractScene(ctx, w, h, cfg, t)
  ctx.restore()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(line[0], line[1])
  ctx.lineTo(line[2], line[3])
  ctx.stroke()
}

/** Radial Cut: concentric rings, each showing a different scene, breathing
 *  gently with the beat. */
const drawRadialCut: Draw2D = (ctx, w, h, t) => {
  const beat = t * BEATS_PER_SEC
  const p = pulseAt(beat, 2, 3)
  const m = Math.min(w, h)
  drawAbstractScene(ctx, w, h, 0, t)
  const rings = [
    { r: m * 0.42 * (1 + 0.05 * p), variant: 1 },
    { r: m * 0.22 * (1 + 0.1 * p), variant: 2 },
  ]
  for (const ring of rings) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, ring.r, 0, Math.PI * 2)
    ctx.clip()
    drawAbstractScene(ctx, w, h, ring.variant, t)
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, ring.r, 0, Math.PI * 2)
    ctx.stroke()
  }
}

// ── Registry + host component ────────────────────────────────────────────────

const PREVIEWS_2D: Record<string, Draw2D> = {
  cameraControl: drawCamera,
  video: drawVideo,
  photo: drawPhoto,
  oscilloscope: drawOscilloscope,
  colorFilters: drawColorFilters,
  sceneSwitcher: drawSceneSwitcher,
  cut: drawCut,
  radialCut: drawRadialCut,
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

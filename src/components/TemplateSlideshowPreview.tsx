'use client'

import { useEffect, useRef } from 'react'

// A purpose-built animated preview for the Slideshow template. Unlike the other
// templates - whose cards play a real render clip - Slideshow renders nothing
// until a user adds their own photos, so a literal capture would be blank. This
// stands in for it: a framed photo advancing through placeholder scenes with a
// slide + crossfade, which reads unmistakably as "a slideshow." Canvas-2D, one
// rAF, respects reduced motion.

const SLIDE_DUR = 1.6
const SLIDE_XFADE = 0.4
const SLIDES: Array<{ sky: [string, string]; sun: string; hill: string; blank?: boolean }> = [
  { sky: ['#fbbf24', '#ec4899'], sun: '#fff7ed', hill: '#7c2d12' },
  { sky: ['#38bdf8', '#0ea5e9'], sun: '#fef9c3', hill: '#0c4a6e' },
  { sky: ['#2b2b33', '#3f3f46'], sun: '#52525b', hill: '#18181b', blank: true },
  { sky: ['#a78bfa', '#f472b6'], sun: '#fdf4ff', hill: '#4c1d95' },
]

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

function drawSlide(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, idx: number) {
  const s = SLIDES[((idx % SLIDES.length) + SLIDES.length) % SLIDES.length]
  ctx.save()
  roundRect(ctx, x, y, w, h, 4)
  ctx.clip()
  const sky = ctx.createLinearGradient(x, y, x, y + h)
  sky.addColorStop(0, s.sky[0])
  sky.addColorStop(1, s.sky[1])
  ctx.fillStyle = sky
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = s.sun
  ctx.globalAlpha = s.blank ? 0.5 : 0.9
  ctx.beginPath()
  ctx.arc(x + w * 0.72, y + h * 0.34, Math.min(w, h) * 0.13, 0, Math.PI * 2)
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
  if (s.blank) {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + w * 0.28, y + h * 0.3, w * 0.44, h * 0.4)
  }
  ctx.restore()
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = '#0b0b0e'
  ctx.fillRect(0, 0, w, h)

  const fw = w * 0.62
  const fh = h * 0.72
  const fx = (w - fw) / 2
  const fy = (h - fh) / 2 - h * 0.04
  const pad = 5

  const cycle = t / SLIDE_DUR
  const idx = Math.floor(cycle)
  const frac = cycle - idx
  const xfadeStart = 1 - SLIDE_XFADE / SLIDE_DUR
  const xfade = frac > xfadeStart ? (frac - xfadeStart) / (SLIDE_XFADE / SLIDE_DUR) : 0

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 10
  ctx.shadowOffsetY = 3
  ctx.fillStyle = '#f8fafc'
  roundRect(ctx, fx, fy, fw, fh, 6)
  ctx.fill()
  ctx.restore()

  const px = fx + pad
  const py = fy + pad
  const pw = fw - pad * 2
  const ph = fh - pad * 2
  ctx.save()
  roundRect(ctx, px, py, pw, ph, 4)
  ctx.clip()
  if (xfade > 0) {
    const e = xfade * xfade * (3 - 2 * xfade)
    drawSlide(ctx, px - pw * e, py, pw, ph, idx)
    drawSlide(ctx, px + pw * (1 - e), py, pw, ph, idx + 1)
  } else {
    drawSlide(ctx, px, py, pw, ph, idx)
  }
  ctx.restore()

  const dotY = fy + fh + h * 0.1
  const n = SLIDES.length
  const active = (((idx + (xfade > 0.5 ? 1 : 0)) % n) + n) % n
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i === active ? '#f472b6' : 'rgba(255,255,255,0.28)'
    ctx.beginPath()
    ctx.arc(w / 2 + (i - (n - 1) / 2) * 10, dotY, 2, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function TemplateSlideshowPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !parent || !ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0
    const resize = () => {
      const rect = parent.getBoundingClientRect()
      w = Math.max(1, Math.round(rect.width))
      h = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(parent)

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(ctx, w, h, 0.4)
      return () => ro.disconnect()
    }

    let raf = 0
    let start = 0
    const loop = (ts: number) => {
      if (!start) start = ts
      draw(ctx, w, h, (ts - start) / 1000)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
}

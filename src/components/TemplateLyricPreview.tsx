'use client'

import { useEffect, useRef } from 'react'

// Animated card for the lyric-video templates. Like TemplateSlideshowPreview,
// a literal capture would miss the point (the template is a STYLE waiting for
// the user's words), so the card shows the essence instead: words popping in
// on the beat, one per step, with a bounce. Canvas-2D, one rAF, respects
// reduced motion. The accent tints per template so the four cards read as
// siblings, not clones.

const WORDS = ['WE', 'LIGHT', 'UP', 'THE', 'NIGHT', 'SKY']
const STEP_SEC = 0.42
const ACCENTS: Record<string, string> = {
  lyricVideo: '#e4e4e7',
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, accent: string) {
  ctx.fillStyle = '#0b0b0e'
  ctx.fillRect(0, 0, w, h)

  const step = Math.floor(t / STEP_SEC)
  const frac = (t / STEP_SEC) - step
  const word = WORDS[step % WORDS.length]

  // Pop-in: overshoot scale that settles fast, then a slow fade toward the
  // next word. Reads as "words land on the beat" at a glance.
  const settle = Math.min(1, frac / 0.25)
  const scale = 1 + 0.35 * (1 - settle) * (1 - settle)
  const alpha = frac < 0.85 ? 1 : 1 - (frac - 0.85) / 0.15

  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.scale(scale, scale)
  ctx.globalAlpha = alpha
  ctx.fillStyle = accent
  ctx.font = `900 ${Math.min(w * 0.16, h * 0.3)}px "Arial Black", Impact, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = accent
  ctx.shadowBlur = 14
  ctx.fillText(word, 0, 0)
  ctx.restore()

  // Beat dots along the bottom, current step lit.
  const active = step % 4
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i === active ? accent : 'rgba(255,255,255,0.22)'
    ctx.beginPath()
    ctx.arc(w / 2 + (i - 1.5) * 12, h - 10, 2, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function TemplateLyricPreview({ templateId }: { templateId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !parent || !ctx) return
    const accent = ACCENTS[templateId] ?? '#e4e4e7'

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
      draw(ctx, w, h, 0.15, accent)
      return () => ro.disconnect()
    }

    let raf = 0
    let start = 0
    const loop = (ts: number) => {
      if (!start) start = ts
      draw(ctx, w, h, (ts - start) / 1000, accent)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [templateId])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
}

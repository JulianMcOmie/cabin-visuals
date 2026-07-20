'use client'

import { useEffect, useRef, useState } from 'react'

// Card for the lyric-video templates: the template's REAL render when a clip
// exists - `<id>.mp4` in the public template-previews bucket, exported from
// the app and uploaded by hand, exactly like the non-lyric template cards -
// with the canvas word-pop below as the fallback until the clip loads (or
// when none has been uploaded yet). The fallback tints per template so the
// cards still read as siblings, not clones. Canvas-2D, one rAF, respects
// reduced motion.

const WORDS = ['WE', 'LIGHT', 'UP', 'THE', 'NIGHT', 'SKY']
const STEP_SEC = 0.42

// Canvas font stacks mirroring TextDisplay's FONT_STACKS indices.
const FONTS = [
  '"Arial Black", Impact, sans-serif',
  'Georgia, "Times New Roman", serif',
  '"Courier New", monospace',
  'Arial, Helvetica, sans-serif',
]

interface CardStyle {
  accent: string
  bg: string
  /** FONT_STACKS index (matches the template's Lyrics `font` param). */
  font: number
  /** Outline color; omitted = no stroke pass. */
  stroke?: string
}

const DEFAULT_STYLE: CardStyle = { accent: '#e4e4e7', bg: '#0b0b0e', font: 0 }

// One entry per lyric template so the cards preview their actual typography
// and palette (the accent also lights the beat dots).
const STYLES: Record<string, CardStyle> = {
  lyricVideo: DEFAULT_STYLE,
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, style: CardStyle) {
  ctx.fillStyle = style.bg
  ctx.fillRect(0, 0, w, h)

  const step = Math.floor(t / STEP_SEC)
  const frac = (t / STEP_SEC) - step
  const word = WORDS[step % WORDS.length]
  const accent = style.accent

  // Pop-in: overshoot scale that settles fast, then a slow fade toward the
  // next word. Reads as "words land on the beat" at a glance.
  const settle = Math.min(1, frac / 0.25)
  const scale = 1 + 0.35 * (1 - settle) * (1 - settle)
  const alpha = frac < 0.85 ? 1 : 1 - (frac - 0.85) / 0.15

  const size = Math.min(w * 0.16, h * 0.3)
  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.scale(scale, scale)
  ctx.globalAlpha = alpha
  ctx.font = `900 ${size}px ${FONTS[style.font] ?? FONTS[0]}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (style.stroke) {
    ctx.lineWidth = Math.max(2, size * 0.14)
    ctx.lineJoin = 'round'
    ctx.strokeStyle = style.stroke
    ctx.strokeText(word, 0, 0)
  }
  ctx.fillStyle = accent
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

const BUCKET_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/template-previews`

export function TemplateLyricPreview({ templateId }: { templateId: string }) {
  // null = clip still loading (canvas shows), true = clip playing (canvas
  // unmounts), false = no clip in the bucket (canvas is the card).
  const [clipReady, setClipReady] = useState<boolean | null>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ? null : false,
  )
  return (
    <>
      {clipReady !== true && <LyricCanvasFallback templateId={templateId} />}
      {clipReady !== false && (
        <video
          src={`${BUCKET_BASE}/${templateId}.mp4`}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          onPlaying={() => setClipReady(true)}
          onError={() => setClipReady(false)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </>
  )
}

function LyricCanvasFallback({ templateId }: { templateId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !parent || !ctx) return
    const style = STYLES[templateId] ?? DEFAULT_STYLE

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
      draw(ctx, w, h, 0.15, style)
      return () => ro.disconnect()
    }

    let raf = 0
    let start = 0
    const loop = (ts: number) => {
      if (!start) start = ts
      draw(ctx, w, h, (ts - start) / 1000, style)
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

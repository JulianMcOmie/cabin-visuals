import { useInstrumentFrame, seededRand, beatInBlock } from '../core/visual/instrumentFrame'
import { useFullFrameCanvas, commitCanvasFrame } from '../core/visual/fullFrameCanvas'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import { ensureFont } from '../core/visual/fonts'
import type { ObjectInstrumentDef, ParamDef } from './types'

// FILM CARD - the Silent Film template's bookend cards
// (docs/lyric-template-silent-film.md), one instrument, two modes:
//
//   Intro Paper - a cold-cream graph-paper "playlist page": faint blurred
//                 list lines behind, the featured name in a hand-drawn ink box
//                 over an olive highlighter smear.
//   Title Outro - the song title in glowing Didone caps + a smaller artist
//                 line, over a seeded waveform of vertical bars that pulses
//                 with the track's note energy. Transparent - the Film Stock
//                 background shows through.
//
// Playfair Display is lazy-loaded (core/visual/fonts.ts); the frame callback
// returns false until it's usable so no frame ever renders the fallback face.
// All wobble/jitter derives from beat-time windows - scrub == playback.

const PARAMS: ParamDef[] = [
  {
    key: 'mode', label: 'Card', type: 'select', default: 0, options: [
      { value: 0, label: 'Intro Paper' },
      { value: 1, label: 'Title Outro' },
    ],
  },
  { key: 'title', label: 'Title', type: 'string', default: 'ARTIST NAME' },
  { key: 'subtitle', label: 'Subtitle', type: 'string', default: 'Song Title' },
  { key: 'listText', label: 'Backdrop Lines', type: 'string', multiline: true, default: 'FOLLOW ME\nFOR MORE\nLYRIC VIDEOS' },
  { key: 'paperColor', label: 'Paper', type: 'color', default: '#b5d9cc' },
  { key: 'inkColor', label: 'Ink', type: 'color', default: '#303820' },
  { key: 'highlightColor', label: 'Highlighter', type: 'color', default: '#b3c06d' },
  { key: 'textColor', label: 'Outro Text', type: 'color', default: '#fdfbfe' },
  { key: 'glow', label: 'Outro Glow', min: 0, max: 1, step: 0.05, default: 0.6, showIf: 'mode' },
  { key: 'waveHeight', label: 'Waveform Height', min: 0, max: 1, step: 0.05, default: 0.5, showIf: 'mode' },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'jitterAmount', label: 'Frame Jitter', min: 0, max: 1, step: 0.05, default: 0.5 },
]

const WAVE_BARS = 72
const FILM_FPS = 24
// Unlike the grain layers this card is mostly TYPE, and type is the one thing
// that does not survive a half-resolution canvas - so it keeps the full height
// and pays for its crispness. It is only on screen for the intro/outro anyway,
// and the frame skip below cuts its repaints to film cadence.
const CANVAS_H = 1024

// Baked per (size, amount, mode) - see FilmStock's vignette cache.
const vignetteCache = new Map<string, HTMLCanvasElement>()

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, outro: boolean) {
  if (amount <= 0) return
  const key = `${w}x${h}|${amount.toFixed(3)}|${outro ? 'o' : 'i'}`
  let baked = vignetteCache.get(key)
  if (!baked) {
    baked = document.createElement('canvas')
    baked.width = w
    baked.height = h
    const bctx = baked.getContext('2d')!
    const grad = bctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, Math.hypot(w / 2, h / 2))
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(1, `rgba(0,0,0,${(amount * (outro ? 0.55 : 0.75)).toFixed(4)})`)
    bctx.fillStyle = grad
    bctx.fillRect(0, 0, w, h)
    if (vignetteCache.size >= 12) {
      const oldest = vignetteCache.keys().next().value
      if (oldest !== undefined) vignetteCache.delete(oldest)
    }
    vignetteCache.set(key, baked)
  }
  ctx.drawImage(baked, 0, 0)
}

function FilmCardVisual({ trackId }: { trackId: string }) {
  const { viewport, meshRef, canvasRef, textureRef, unchanged, invalidate } = useFullFrameCanvas(CANVAS_H)

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    if (!canvas || !texture || !mesh) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    if (!ensureFont('Playfair Display')) return false

    const inBlock = beatInBlock(state)
    mesh.visible = inBlock
    if (!inBlock) { invalidate(); return }

    const p = state.params
    const sp = state.stringParams
    const outro = (p.mode ?? 0) >= 0.5
    const vignette = p.vignette ?? 0.5
    const jitterAmount = p.jitterAmount ?? 0.5
    const w = canvas.width
    const h = canvas.height
    const filmFrame = Math.floor(state.beat * state.secPerBeat * FILM_FPS)
    const elapsed = filmFrame / FILM_FPS

    // Note-pulse energy drives the outro waveform ONLY, and it moves a little
    // every frame - quantized here (and left out of the intro key entirely) so
    // it can't defeat the skip it is part of.
    const energyStep = outro ? Math.round(Math.min(1.6, state.energy ?? 0) * 24) : 0
    if (unchanged(
      `${filmFrame}|${w}|${h}|${p.mode}|${sp.title}|${sp.subtitle}|${sp.listText}|${sp.paperColor}`
      + `|${sp.inkColor}|${sp.highlightColor}|${sp.textColor}|${p.glow}|${p.waveHeight}`
      + `|${vignette}|${jitterAmount}|${energyStep}`,
      state.notes,
    )) return

    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.filter = 'none'
    ctx.clearRect(0, 0, w, h)

    // Projected-frame jitter: everything below draws inside this translate.
    const jFrame = Math.floor(elapsed * 12)
    const jx = (seededRand(jFrame * 41 + 3) - 0.5) * jitterAmount * h * 0.008
    const jy = (seededRand(jFrame * 43 + 5) - 0.5) * jitterAmount * h * 0.008
    ctx.save()
    ctx.translate(jx, jy)

    if (!outro) {
      // ---- Intro: the playlist page ----
      const paper = sp.paperColor ?? '#b5d9cc'
      const ink = sp.inkColor ?? '#303820'
      ctx.fillStyle = paper
      ctx.fillRect(-h * 0.02, -h * 0.02, w + h * 0.04, h + h * 0.04)

      // Graph grid in ink.
      ctx.globalAlpha = 0.14
      ctx.strokeStyle = ink
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0.5; x < w; x += 30) { ctx.moveTo(x, 0); ctx.lineTo(x, h) }
      for (let y = 0.5; y < h; y += 30) { ctx.moveTo(0, y); ctx.lineTo(w, y) }
      ctx.stroke()
      ctx.globalAlpha = 1

      // Blurred backdrop lines - out-of-focus names on the page.
      const lines = (sp.listText ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length > 0) {
        ctx.filter = `blur(${(h * 0.008).toFixed(1)}px)`
        ctx.fillStyle = ink
        ctx.globalAlpha = 0.4
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `700 ${h * 0.085}px "Playfair Display", Georgia, serif`
        // Spread across the page, hopping over the boxed center band.
        const slots = lines.length + 1
        let slot = 0
        for (const line of lines) {
          slot++
          let y = (slot / slots) * h
          if (Math.abs(y - h / 2) < h * 0.14) y += y < h / 2 ? -h * 0.14 : h * 0.14
          ctx.fillText(line.toUpperCase(), w / 2, y)
        }
        ctx.filter = 'none'
        ctx.globalAlpha = 1
      }

      // Highlighter smear behind the box: overlapping soft ellipses.
      const highlight = sp.highlightColor ?? '#b3c06d'
      ctx.fillStyle = highlight
      ctx.globalAlpha = 0.6
      for (let i = 0; i < 4; i++) {
        const ex = w / 2 + (seededRand(i * 17 + 2) - 0.5) * w * 0.18
        const ey = h / 2 + (seededRand(i * 19 + 4) - 0.5) * h * 0.02
        ctx.beginPath()
        ctx.ellipse(ex, ey, w * 0.3, h * 0.075, (seededRand(i * 23) - 0.5) * 0.06, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // Hand-drawn ink box: four slightly-off segments beat one crisp rect.
      ctx.strokeStyle = ink
      ctx.lineWidth = Math.max(2, h * 0.004)
      const bx = w * 0.14
      const by = h * 0.415
      const bw = w * 0.72
      const bh = h * 0.17
      ctx.beginPath()
      const corners: [number, number][] = [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]]
      for (let i = 0; i <= 4; i++) {
        const [cx, cy] = corners[i % 4]
        const ox = (seededRand(i * 31 + 6) - 0.5) * h * 0.012
        const oy = (seededRand(i * 37 + 8) - 0.5) * h * 0.012
        if (i === 0) ctx.moveTo(cx + ox, cy + oy)
        else ctx.lineTo(cx + ox, cy + oy)
      }
      ctx.stroke()

      // The featured name.
      ctx.fillStyle = ink
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const title = (sp.title ?? 'ARTIST NAME').toUpperCase()
      let titleSize = h * 0.09
      ctx.font = `700 ${titleSize}px "Playfair Display", Georgia, serif`
      const maxWidth = bw * 0.9
      const measured = ctx.measureText(title).width
      if (measured > maxWidth && measured > 0) {
        titleSize *= maxWidth / measured
        ctx.font = `700 ${titleSize}px "Playfair Display", Georgia, serif`
      }
      ctx.fillText(title, w / 2, by + bh / 2)

      // Flash-reveal notes: a brief whiteout.
      for (const n of state.notes) {
        if (n.beat > state.beat) continue
        const age = (state.beat - n.beat) * state.secPerBeat
        if (age >= 0.3) continue
        const velN = n.velocity <= 1 ? n.velocity : n.velocity / 127
        ctx.fillStyle = '#ffffff'
        ctx.globalAlpha = (1 - age / 0.3) * velN * 0.7
        ctx.fillRect(-h * 0.02, -h * 0.02, w + h * 0.04, h + h * 0.04)
        ctx.globalAlpha = 1
      }
    } else {
      // ---- Outro: title over a pulsing waveform ----
      const textColor = sp.textColor ?? '#fdfbfe'
      const glow = p.glow ?? 0.6
      const waveHeight = p.waveHeight ?? 0.5

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const title = (sp.title ?? 'SONG TITLE').toUpperCase()
      let titleSize = h * 0.115
      ctx.font = `900 ${titleSize}px "Playfair Display", Georgia, serif`
      const maxWidth = w * 0.82
      const measured = ctx.measureText(title).width
      if (measured > maxWidth && measured > 0) {
        titleSize *= maxWidth / measured
      }
      ctx.fillStyle = textColor
      ctx.shadowColor = textColor
      for (const [blur, alpha] of [[titleSize * 0.5, 0.6], [titleSize * 0.12, 1]] as const) {
        ctx.shadowBlur = blur * (0.3 + glow)
        ctx.globalAlpha = alpha
        ctx.font = `900 ${titleSize}px "Playfair Display", Georgia, serif`
        ctx.fillText(title, w / 2, h * 0.33)
        ctx.font = `400 ${titleSize * 0.38}px "Playfair Display", Georgia, serif`
        ctx.fillText(sp.subtitle ?? 'Song Title', w / 2, h * 0.33 + titleSize * 0.75)
      }
      ctx.shadowBlur = 0
      ctx.globalAlpha = 1

      // Waveform: seeded bar heights (one identity per bar), swelling with the
      // track's note-pulse energy, glowing like the projected title above.
      const midY = h * 0.68
      const span = w * 0.8
      const barW = Math.max(2, (span / WAVE_BARS) * 0.45)
      const pulse = 0.55 + (energyStep / 24) * 0.6
      ctx.fillStyle = textColor
      ctx.shadowColor = textColor
      ctx.shadowBlur = 10 * glow
      for (let i = 0; i < WAVE_BARS; i++) {
        const x = w * 0.1 + (i / (WAVE_BARS - 1)) * span
        const base = 0.12 + seededRand(i * 7 + 1) ** 2 * 0.88
        const bh = Math.max(h * 0.006, base * waveHeight * h * 0.11 * pulse)
        ctx.fillRect(x - barW / 2, midY - bh / 2, barW, bh)
      }
      ctx.shadowBlur = 0
    }

    ctx.restore()

    // Vignette closes both modes (the intro's projector shading especially).
    drawVignette(ctx, w, h, vignette, outro)

    commitCanvasFrame(mesh, texture)
  })

  // FORCE_TRANSPARENT: the outro mode's canvas is mostly zero-alpha; see
  // FilmStock's grain overlay for why the flag is required.
  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[viewport.width * 1.02, viewport.height * 1.02]} />
      <meshBasicMaterial transparent opacity={1} depthWrite={false} userData={{ [FORCE_TRANSPARENT_KEY]: true }} />
    </mesh>
  )
}

export const filmCardInstrument: ObjectInstrumentDef = {
  id: 'filmCard',
  name: 'Film Card',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  midiRows: [
    { pitch: 60, label: 'Flash / pulse', color: '#fdfbfe', emphasized: true },
  ],
  component: FilmCardVisual,
  fullFrame: true,
  defaultOnTop: true,
}

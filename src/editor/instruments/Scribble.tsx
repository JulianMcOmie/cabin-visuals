import { useInstrumentFrame, seededRand, beatInBlock } from '../core/visual/instrumentFrame'
import { useFullFrameCanvas, commitCanvasFrame } from '../core/visual/fullFrameCanvas'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import type { ObjectInstrumentDef, ParamDef } from './types'

// SCRIBBLE - glowing hand-drawn pen strokes for the Silent Film lyric template
// (docs/lyric-template-silent-film.md): the underline swoosh, lasso loop,
// S-flourish and circled-word marks that punctuate big lyric moments. Each
// note draws one stroke on: the path reveals over `drawTime`, holds while the
// note sounds, and fades over `fadeTime` after release. Pitch picks the path
// preset; position and wobble are seeded from the note, so every stroke is a
// pure function of the beat (scrub == playback) while no two look alike.
// Full-frame canvas plane (CrtScanlines' plumbing), transparent, on top.

const PITCH_SWOOSH = 60
const PITCH_LOOP = 62
const PITCH_FLOURISH = 64
const PITCH_CIRCLE = 66

const POINTS = 64 // samples per stroke path
// Strokes reveal at film cadence like the rest of the template, which also
// makes a frame skippable whenever the tick and the params have not moved.
const FILM_FPS = 24
const CANVAS_H = 512
const REFERENCE_H = 1024

const PARAMS: ParamDef[] = [
  { key: 'color', label: 'Ink Color', type: 'color', default: '#87dcfb' },
  { key: 'size', label: 'Stroke Size', min: 0.2, max: 1, step: 0.05, default: 0.55 },
  { key: 'lineWidth', label: 'Line Width', min: 0.2, max: 2, step: 0.1, default: 0.8 },
  { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0.7 },
  { key: 'wobble', label: 'Hand Wobble', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'drawTime', label: 'Draw-on (s)', min: 0.1, max: 1.5, step: 0.05, default: 0.4 },
  { key: 'fadeTime', label: 'Fade (s)', min: 0.1, max: 2, step: 0.05, default: 0.6 },
]

/** One point of a preset path in unit space (roughly [-1,1] both axes). */
function pathPoint(pitch: number, t: number): [number, number] {
  if (pitch === PITCH_LOOP) {
    // An underline that ties one cursive loop in the middle.
    const x = -1 + t * 2
    const loop = Math.max(0, 1 - Math.abs(t - 0.5) * 4) // 1 at center, 0 at t<0.25/t>0.75
    const a = (t - 0.25) * 4 * Math.PI // one full turn across the loop window
    return [x + loop * 0.35 * Math.sin(a), -loop * 0.5 * (1 - Math.cos(a))]
  }
  if (pitch === PITCH_FLOURISH) {
    // A tall S: two stacked half-turns, drawn top to bottom.
    const a = Math.PI * t
    return [Math.sin(a * 2) * 0.55 * (t < 0.5 ? 1 : -1) * -1, 1 - t * 2]
  }
  if (pitch === PITCH_CIRCLE) {
    // 1.15 turns of a wide ellipse - the overshoot overlap sells hand-drawn.
    const a = -Math.PI * 0.6 + t * Math.PI * 2 * 1.15
    return [Math.cos(a), Math.sin(a) * 0.55]
  }
  // Swoosh (default): a shallow smile arc left→right with an end hook.
  const x = -1 + t * 2
  const y = -Math.sin(Math.PI * t) * 0.35 + (t > 0.9 ? (t - 0.9) * 3 : 0)
  return [x, y]
}

function ScribbleVisual({ trackId }: { trackId: string }) {
  const { viewport, meshRef, canvasRef, textureRef, unchanged, invalidate } = useFullFrameCanvas(CANVAS_H)

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    if (!canvas || !texture || !mesh) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    const inBlock = beatInBlock(state)
    mesh.visible = inBlock
    if (!inBlock) { invalidate(); return }

    const p = state.params
    const color = state.stringParams.color || '#87dcfb'
    const size = p.size ?? 0.55
    const lineWidth = p.lineWidth ?? 0.8
    const glow = p.glow ?? 0.7
    const wobble = p.wobble ?? 0.5
    const drawTime = p.drawTime ?? 0.4
    const fadeTime = p.fadeTime ?? 0.6

    const w = canvas.width
    const h = canvas.height
    const px = h / REFERENCE_H
    const filmFrame = Math.floor(state.beat * state.secPerBeat * FILM_FPS)
    const elapsed = filmFrame / FILM_FPS

    // Which strokes are alive right now. Most of a song has none - and an
    // empty canvas re-cleared and re-uploaded every frame is pure waste, so
    // consecutive empty frames collapse onto one key and skip entirely.
    const live = state.notes.filter((n) => {
      const age = elapsed - n.beat * state.secPerBeat
      return age >= 0 && age < Math.max(drawTime, n.durationBeats * state.secPerBeat) + fadeTime
    })
    if (unchanged(
      live.length === 0
        ? 'empty'
        : `${filmFrame}|${w}|${h}|${color}|${size}|${lineWidth}|${glow}|${wobble}|${drawTime}|${fadeTime}`,
      state.notes,
    )) return

    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, w, h)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const n of live) {
      const age = elapsed - n.beat * state.secPerBeat
      const heldSec = n.durationBeats * state.secPerBeat

      const seed = n.beat * 997 + n.pitch * 57
      const velN = n.velocity <= 1 ? n.velocity : n.velocity / 127
      const reveal = Math.min(1, age / drawTime)
      const fadeStart = Math.max(drawTime, heldSec)
      const alpha = age > fadeStart ? Math.max(0, 1 - (age - fadeStart) / fadeTime) : 1
      if (alpha <= 0) continue

      // Seeded placement: strokes land in the middle band of the frame, where
      // the words live. Scale rides velocity a little.
      const cx = (0.3 + seededRand(seed) * 0.4) * w
      const cy = (0.3 + seededRand(seed + 1) * 0.4) * h
      const sx = size * (0.7 + velN * 0.5) * h * 0.35
      const sy = sx * 0.6
      const tilt = (seededRand(seed + 2) - 0.5) * 0.3

      // The stroke: per-segment width variation + seeded wobble on every
      // point = a pen line, not a plotter line. Drawn twice - a wide soft
      // glow pass, then the bright core.
      const pts: [number, number][] = []
      const revealed = Math.max(2, Math.ceil(POINTS * reveal))
      for (let i = 0; i < revealed; i++) {
        const t = i / (POINTS - 1)
        const [ux, uy] = pathPoint(n.pitch, t)
        const wx = (seededRand(seed + 10 + i) - 0.5) * wobble * 0.09
        const wy = (seededRand(seed + 90 + i) - 0.5) * wobble * 0.09
        const rx = (ux + wx) * Math.cos(tilt) - (uy + wy) * Math.sin(tilt)
        const ry = (ux + wx) * Math.sin(tilt) + (uy + wy) * Math.cos(tilt)
        pts.push([cx + rx * sx, cy - ry * sy])
      }

      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = color
        ctx.shadowColor = color
        // Blur radius is in canvas pixels, so it scales with the canvas to
        // keep the same on-screen halo at any resolution.
        ctx.shadowBlur = (pass === 0 ? glow * 26 : glow * 7) * px
        ctx.globalAlpha = alpha * (pass === 0 ? 0.55 : 1)
        const baseW = h * 0.006 * lineWidth * (pass === 0 ? 1.6 : 1)
        for (let i = 1; i < pts.length; i++) {
          const varW = 0.75 + seededRand(seed + 500 + i) * 0.5
          ctx.lineWidth = Math.max(1, baseW * varW)
          ctx.beginPath()
          ctx.moveTo(pts[i - 1][0], pts[i - 1][1])
          ctx.lineTo(pts[i][0], pts[i][1])
          ctx.stroke()
        }
      }
      ctx.shadowBlur = 0
      ctx.globalAlpha = 1
    }

    commitCanvasFrame(mesh, texture)
  })

  // FORCE_TRANSPARENT: mostly zero-alpha canvas; see FilmStock's grain overlay.
  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[viewport.width * 1.02, viewport.height * 1.02]} />
      <meshBasicMaterial transparent opacity={1} depthWrite={false} userData={{ [FORCE_TRANSPARENT_KEY]: true }} />
    </mesh>
  )
}

export const scribbleInstrument: ObjectInstrumentDef = {
  id: 'scribble',
  name: 'Scribble',
  kind: 'object',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  midiRows: [
    { pitch: PITCH_SWOOSH, label: 'Underline swoosh', color: '#87dcfb', emphasized: true },
    { pitch: PITCH_LOOP, label: 'Lasso loop', color: '#87dcfb' },
    { pitch: PITCH_FLOURISH, label: 'S flourish', color: '#c261d0' },
    { pitch: PITCH_CIRCLE, label: 'Circle', color: '#c261d0' },
  ],
  component: ScribbleVisual,
  fullFrame: true,
  defaultOnTop: true,
}

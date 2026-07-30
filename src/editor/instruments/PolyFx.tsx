import { useThree } from '@react-three/fiber'
import { useInstrumentFrame, seededRand } from '../core/visual/instrumentFrame'
import { useFullFrameCanvas, commitCanvasFrame } from '../core/visual/fullFrameCanvas'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import type { ResolvedNote } from '../core/visual/types'
import type { ObjectInstrumentDef, ParamDef } from './types'

// POLY FX - the transition/effect vocabulary of the Crazy Edit template, one
// overlay track with a pitch row per effect. Each note fires one effect for
// its duration; velocity picks the color from the palette param (1-based)
// where a color applies. Everything is a pure function of (beat, notes).

const PITCH_BEAM = 60        // sweeping diagonal beam behind the cards
const PITCH_JACK = 62        // union-jack cross + frame border
const PITCH_FLASH = 64       // white flash (fades over the note)
const PITCH_WHITEOUT = 65    // soft whiteout (holds at velocity/127 alpha)
const PITCH_STREAK = 66      // vertical light streak sweeping right
const PITCH_TAB = 67         // paper tab at the top edge
const PITCH_LINES = 68       // thin crossing diagonal lines

const REF_W = 422
const REF_H = 254

const PARAMS: ParamDef[] = [
  { key: 'layer', label: 'Layer', min: 0, max: 20, step: 1, default: 12 },
  { key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.05, default: 1 },
  { key: 'jackWidth', label: 'Jack Width', min: 0, max: 1, step: 0.01, default: 0.25 },
  { key: 'palette', label: 'Color Palette', type: 'string', default: '#7a1f1f,#17c917,#9adfe0,#8c2020,#ffffff' },
]

type Ctx = CanvasRenderingContext2D

function paletteColor(palette: string[], velocity: number): string {
  if (!palette.length) return '#ffffff'
  const idx = Math.max(1, Math.round(velocity)) - 1
  return palette[idx % palette.length]
}

function drawBeam(ctx: Ctx, t: number, color: string): void {
  const ang = ((115 - 90 * t) * Math.PI) / 180
  ctx.save()
  ctx.translate(REF_W / 2, REF_H / 2)
  ctx.rotate(ang)
  ctx.fillStyle = color
  ctx.fillRect(-320, -12, 640, 24)
  ctx.restore()
}

function drawJack(ctx: Ctx, color: string, width: number): void {
  const half = 20 + width * 110
  const diag = (x0: number, y0: number, x1: number, y1: number) => {
    const a = Math.atan2(y1 - y0, x1 - x0)
    const len = Math.hypot(x1 - x0, y1 - y0)
    ctx.save()
    ctx.translate((x0 + x1) / 2, (y0 + y1) / 2)
    ctx.rotate(a)
    ctx.fillStyle = '#f4f4f4'
    ctx.fillRect(-len / 2, -half - 11, len, half * 2 + 22)
    ctx.fillStyle = color
    ctx.fillRect(-len / 2, -half, len, half * 2)
    ctx.restore()
  }
  diag(-10, -10, REF_W + 10, REF_H + 10)
  diag(REF_W + 10, -10, -10, REF_H + 10)
  ctx.strokeStyle = '#f4f4f4'
  ctx.lineWidth = 18
  ctx.strokeRect(0, 0, REF_W, REF_H)
  ctx.strokeStyle = color
  ctx.lineWidth = 11
  ctx.strokeRect(0, 0, REF_W, REF_H)
}

function PolyFxVisual({ trackId }: { trackId: string }) {
  // Same output-resolution canvas as PhotoSlot - a fixed 288p canvas left the
  // beams/pattern edges soft at editor and export sizes.
  const texHeight = useThree((s) => Math.max(256, Math.min(1152, Math.round((s.size.height * s.viewport.dpr) / 64) * 64)))
  const { viewport, meshRef, canvasRef, textureRef, unchanged, invalidate } = useFullFrameCanvas(texHeight)

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    if (!canvas || !texture || !mesh) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    mesh.renderOrder = 100 + (state.params.layer ?? 12)
    const live: ResolvedNote[] = state.blackedOut
      ? []
      : state.notes.filter((n) => state.beat >= n.beat && state.beat < Math.min(n.beat + n.durationBeats, n.blockEndBeat))
    if (live.length === 0) {
      mesh.visible = false
      invalidate()
      return
    }
    mesh.visible = true

    const w = canvas.width
    const h = canvas.height
    const intensity = state.params.intensity ?? 1
    const palette = (state.stringParams.palette ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    // Effects animate within a note, so the key advances at source cadence.
    const tick = Math.floor(state.beat * 8)
    const key = [tick, w, h, intensity, state.params.jackWidth ?? 0.25, palette.join('~'), live.map((n) => `${n.beat}:${n.pitch}:${n.velocity}`).join(',')].join('|')
    if (unchanged(key, state.notes)) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const s = h / REF_H
    ctx.setTransform(s, 0, 0, s, (w - REF_W * s) / 2, 0)

    for (const n of live) {
      const t = Math.max(0, Math.min(1, (state.beat - n.beat) / Math.max(0.001, n.durationBeats)))
      const color = paletteColor(palette, n.velocity)
      ctx.globalAlpha = intensity
      if (n.pitch === PITCH_BEAM) {
        drawBeam(ctx, t, color)
      } else if (n.pitch === PITCH_JACK) {
        drawJack(ctx, color, state.params.jackWidth ?? 0.25)
      } else if (n.pitch === PITCH_FLASH) {
        ctx.globalAlpha = intensity * (1 - t)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(-2, -2, REF_W + 4, REF_H + 4)
      } else if (n.pitch === PITCH_WHITEOUT) {
        ctx.globalAlpha = intensity * Math.min(1, n.velocity / 127)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(-2, -2, REF_W + 4, REF_H + 4)
      } else if (n.pitch === PITCH_STREAK) {
        const x = (0.1 + 0.8 * t) * REF_W
        const grad = ctx.createLinearGradient(x - 12, 0, x + 12, 0)
        grad.addColorStop(0, 'rgba(255,255,255,0)')
        grad.addColorStop(0.5, 'rgba(255,255,255,0.9)')
        grad.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = grad
        ctx.fillRect(x - 14, 0, 28, REF_H)
      } else if (n.pitch === PITCH_TAB) {
        ctx.fillStyle = '#f2f2f2'
        ctx.fillRect(REF_W / 2 - 28, 0, 56, 15)
        ctx.fillStyle = color
        ctx.fillRect(REF_W / 2 - 22, 3, 44, 10)
      } else if (n.pitch === PITCH_LINES) {
        ctx.strokeStyle = color
        ctx.lineWidth = 7
        const off = seededRand(n.beat * 3.7) * 40
        ctx.beginPath()
        ctx.moveTo(-10, REF_H + 10)
        ctx.lineTo(REF_W * 0.7 + off, -10)
        ctx.moveTo(REF_W * 0.2 + off, REF_H + 10)
        ctx.lineTo(REF_W + 10, -10)
        ctx.stroke()
      }
    }
    ctx.globalAlpha = 1
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    commitCanvasFrame(mesh, texture)
  })

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[viewport.width * 1.02, viewport.height * 1.02]} />
      <meshBasicMaterial transparent opacity={1} depthWrite={false} depthTest={false} toneMapped={false} userData={{ [FORCE_TRANSPARENT_KEY]: true }} />
    </mesh>
  )
}

export const polyFxInstrument: ObjectInstrumentDef = {
  id: 'polyFx',
  name: 'Poly FX',
  kind: 'object',
  identityColor: '#17c917',
  userInterfaceRenderer: 'parameters',
  params: PARAMS,
  midiRows: [
    { pitch: PITCH_LINES, label: 'Diagonal lines' },
    { pitch: PITCH_TAB, label: 'Paper tab' },
    { pitch: PITCH_STREAK, label: 'Light streak' },
    { pitch: PITCH_WHITEOUT, label: 'Whiteout' },
    { pitch: PITCH_FLASH, label: 'White flash', emphasized: true },
    { pitch: PITCH_JACK, label: 'Union jack', color: '#8c2020' },
    { pitch: PITCH_BEAM, label: 'Beam sweep', color: '#17c917', emphasized: true },
  ],
  component: PolyFxVisual,
  fullFrame: true,
  defaultOnTop: true,
}

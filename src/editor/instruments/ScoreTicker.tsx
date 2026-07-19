import { useRef, useEffect } from 'react'
import { Mesh, CanvasTexture, LinearFilter, NearestFilter, MeshBasicMaterial } from 'three'
import { useInstrumentFrame, seededRand, beatInBlock } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

// RETRO ARCADE - a giant glowing score readout in a 4x5 pixel font, drawn to a
// canvas texture on a positioned plane (NOT fullFrame). The score is recomputed
// from scratch every frame from note history: each played note is worth
// round(pitch * velocity * multiplier) points, and its points TICK IN over
// `spinDur` seconds in quantized steps (slot-machine spin-up, with seeded digit
// jitter while spinning) - so the displayed number at any beat is a pure function
// of the notes whose onsets have passed, and scrub == playback. Accent notes
// (velocity >= accentThresh) flash a blinking "1UP" over the readout. Ambient:
// the current score sits there glowing, breathing on the beat.

const FONT: Record<string, string[]> = {
  '0': ['####', '#..#', '#..#', '#..#', '####'],
  '1': ['..#.', '.##.', '..#.', '..#.', '.###'],
  '2': ['####', '...#', '####', '#...', '####'],
  '3': ['####', '...#', '.###', '...#', '####'],
  '4': ['#..#', '#..#', '####', '...#', '...#'],
  '5': ['####', '#...', '####', '...#', '####'],
  '6': ['####', '#...', '####', '#..#', '####'],
  '7': ['####', '...#', '..#.', '.#..', '.#..'],
  '8': ['####', '#..#', '####', '#..#', '####'],
  '9': ['####', '#..#', '####', '...#', '####'],
  S: ['####', '#...', '####', '...#', '####'],
  C: ['####', '#...', '#...', '#...', '####'],
  O: ['####', '#..#', '#..#', '#..#', '####'],
  R: ['###.', '#..#', '###.', '#.#.', '#..#'],
  E: ['####', '#...', '###.', '#...', '####'],
  U: ['#..#', '#..#', '#..#', '#..#', '####'],
  P: ['####', '#..#', '####', '#...', '#...'],
}

const TEX_W = 1024
const TEX_H = 256

const PARAMS: ParamDef[] = [
  { key: 'digits', label: 'Digits', min: 4, max: 8, step: 1, default: 6 },
  { key: 'multiplier', label: 'Points Multiplier', min: 0.1, max: 10, step: 0.1, default: 1 },
  { key: 'spinDur', label: 'Spin-Up Time (s)', min: 0.1, max: 2, step: 0.05, default: 0.6 },
  { key: 'spinTicks', label: 'Spin Ticks', min: 2, max: 24, step: 1, default: 8 },
  { key: 'accentThresh', label: '1UP Velocity ≥', min: 0.5, max: 1, step: 0.05, default: 0.8 },
  { key: 'flashDur', label: '1UP Flash (s)', min: 0.3, max: 3, step: 0.1, default: 1.2 },
  { key: 'width', label: 'Readout Width', min: 2, max: 14, step: 0.5, default: 7 },
  { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.05, default: 0.8 },
  { key: 'jitter', label: 'Spin Jitter', min: 0, max: 2, step: 0.1, default: 1 },
  { key: 'scoreColor', label: 'Score Color', type: 'color', default: '#facc15' },
  { key: 'labelColor', label: 'Label Color', type: 'color', default: '#22d3ee' },
  { key: 'accentColor', label: '1UP Color', type: 'color', default: '#4ade80' },
]
/** Draw a pixel-font string centered at (cx, cy); cell = pixel size in canvas px. */
function drawText(
  ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, cell: number,
  color: string, glowBlur: number, jitterFor?: (charIndex: number) => number,
) {
  const cols = text.length * 5 - 1
  const x0 = cx - (cols * cell) / 2
  const y0 = cy - (5 * cell) / 2
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = glowBlur
  for (let idx = 0; idx < text.length; idx++) {
    const glyph = FONT[text[idx]]
    if (!glyph) continue
    const jy = jitterFor ? jitterFor(idx) : 0
    for (let r = 0; r < 5; r++) {
      const row = glyph[r]
      for (let c = 0; c < 4; c++) {
        if (row[c] !== '#') continue
        ctx.fillRect(x0 + (idx * 5 + c) * cell, y0 + r * cell + jy, cell * 0.9, cell * 0.9)
      }
    }
  }
  ctx.shadowBlur = 0
}

function ScoreTickerVisual({ trackId }: { trackId: string }) {
  const meshRef = useRef<Mesh>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = TEX_W
    canvas.height = TEX_H
    canvasRef.current = canvas

    const texture = new CanvasTexture(canvas)
    texture.minFilter = LinearFilter
    texture.magFilter = NearestFilter // crispy pixels
    textureRef.current = texture

    return () => {
      texture.dispose()
    }
  }, [])

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    if (!canvas || !texture || !mesh) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // No block at this beat = nothing on screen (blocks are the on-region).
    const inBlock = beatInBlock(state)
    mesh.visible = inBlock
    if (!inBlock) return

    const p = state.params
    const sp = state.stringParams
    const digits = Math.round(p.digits ?? 6)
    const multiplier = p.multiplier ?? 1
    const spinDur = p.spinDur ?? 0.6
    const spinTicks = Math.max(2, Math.round(p.spinTicks ?? 8))
    const accentThresh = p.accentThresh ?? 0.8
    const flashDur = p.flashDur ?? 1.2
    const widthP = p.width ?? 7
    const glow = p.glow ?? 0.8
    const jitterAmt = p.jitter ?? 1

    const beat = state.beat
    const secPerBeat = state.secPerBeat
    const elapsed = beat * secPerBeat

    // Score from note history: settled notes contribute fully; fresh notes tick
    // their points in over spinDur in quantized steps. Order-independent sum.
    let display = 0
    let spinning = false
    let accentAge = -1
    for (const n of state.notes) {
      if (n.beat > beat) continue
      const velN = n.velocity <= 1 ? n.velocity : n.velocity / 127
      const pts = Math.max(1, Math.round(n.pitch * velN * multiplier))
      const ageSec = (beat - n.beat) * secPerBeat
      if (ageSec >= spinDur) {
        display += pts
      } else {
        spinning = true
        const prog = Math.floor((ageSec / spinDur) * spinTicks) / spinTicks
        display += Math.round(pts * prog)
      }
      if (velN >= accentThresh && ageSec < flashDur && (accentAge < 0 || ageSec < accentAge)) accentAge = ageSec
    }

    const str = String(display).padStart(digits, '0')
    const cols = Math.max(str.length, 5) * 5 - 1
    const cell = Math.min((TEX_W * 0.92) / cols, (TEX_H * 0.5) / 5)

    ctx.clearRect(0, 0, TEX_W, TEX_H)

    // Ambient breathing glow on the beat, boosted while spinning.
    const pulse = 0.5 + 0.5 * Math.sin(beat * Math.PI)
    const glowBlur = (8 + pulse * 10 + (spinning ? 14 : 0)) * glow

    drawText(ctx, 'SCORE', TEX_W / 2, TEX_H * 0.18, cell * 0.32, sp.labelColor ?? '#22d3ee', glowBlur * 0.5)

    const jitterFrame = Math.floor(elapsed * 24)
    const jitterFor = spinning && jitterAmt > 0
      ? (idx: number) => (seededRand(jitterFrame * 31 + idx * 17) - 0.5) * cell * 0.6 * jitterAmt
      : undefined
    drawText(ctx, str, TEX_W / 2, TEX_H * 0.62, cell, sp.scoreColor ?? '#facc15', glowBlur, jitterFor)

    // Blinking 1UP on accent notes (velocity >= accentThresh).
    if (accentAge >= 0 && Math.floor(accentAge * 7) % 2 === 0) {
      drawText(ctx, '1UP', TEX_W * 0.85, TEX_H * 0.2, cell * 0.4, sp.accentColor ?? '#4ade80', glowBlur)
    }

    texture.needsUpdate = true
    mesh.scale.set(widthP, widthP * (TEX_H / TEX_W), 1)
    const material = mesh.material as MeshBasicMaterial
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }
  })

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial transparent opacity={1} depthWrite={false} fog={false} />
    </mesh>
  )
}

export const scoreTickerInstrument: ObjectInstrumentDef = {
  id: 'scoreTicker',
  name: 'Score Ticker',
  kind: 'object',
  userInterfaceRenderer: 'scoreTicker',
  params: PARAMS,
  // Each note adds round(pitch × velocity × multiplier) points, ticking in
  // slot-machine style. Hard hits (velocity ≥ 1UP threshold) also flash 1UP.
  midiRows: [
    { pitch: 96, label: 'Score +96 · jackpot', emphasized: true },
    { pitch: 84, label: 'Score +84 · big' },
    { pitch: 72, label: 'Score +72' },
    { pitch: 60, label: 'Score +60' },
    { pitch: 48, label: 'Score +48' },
    { pitch: 36, label: 'Score +36 · small' },
  ],
  component: ScoreTickerVisual,
}

import { useRef, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Mesh, CanvasTexture, LinearFilter, MeshBasicMaterial } from 'three'
import { useInstrumentFrame, seededRand, beatInBlock } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

// RETRO ARCADE - a full-frame CRT screen: phosphor glow, horizontal scanlines, a
// slow rolling brightness band, radial vignette and a curved-bezel barrel hint,
// all drawn on a 2D canvas mapped to a viewport plane (FractalTunnel's pattern).
// Ambient: the tube hums along with zero notes. Each note flashes the whole
// screen in its pitch-class color (hue = (pitch % 12) / 12), fading over
// `flashDur`, intensity scaled by velocity. Notes at pitch >= 72 additionally
// fire a channel-change static blip: a burst of seeded white noise cells whose
// pattern re-rolls at 30 "frames" per second of beat-time - deterministic, so a
// paused playhead shows one frozen noise frame and scrub == playback.

const PARAMS: ParamDef[] = [
  { key: 'bgColor', label: 'Tube Color', type: 'color', default: '#04070a' },
  { key: 'glowColor', label: 'Phosphor Glow', type: 'color', default: '#3aff8c' },
  { key: 'glowAmount', label: 'Glow Amount', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'scanSpacing', label: 'Scanline Spacing', min: 2, max: 12, step: 1, default: 4 },
  { key: 'scanStrength', label: 'Scanline Strength', min: 0, max: 1, step: 0.05, default: 0.35 },
  { key: 'flashDur', label: 'Flash Fade (s)', min: 0.1, max: 2, step: 0.05, default: 0.6 },
  { key: 'flashStrength', label: 'Flash Strength', min: 0, max: 1, step: 0.05, default: 0.5 },
  { key: 'blipPitch', label: 'Static Blip Pitch ≥', min: 48, max: 96, step: 1, default: 72 },
  { key: 'blipDur', label: 'Blip Length (s)', min: 0.05, max: 0.5, step: 0.01, default: 0.15 },
  { key: 'staticCell', label: 'Static Cell (px)', min: 8, max: 48, step: 2, default: 22 },
  { key: 'bandPeriod', label: 'Roll Every (s)', min: 2, max: 20, step: 0.5, default: 6 },
  { key: 'bandTravel', label: 'Roll Travel (s)', min: 0.5, max: 6, step: 0.25, default: 2 },
  { key: 'bandStrength', label: 'Roll Brightness', min: 0, max: 0.6, step: 0.02, default: 0.18 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05, default: 0.55 },
  { key: 'curvature', label: 'Barrel Curvature', min: 0, max: 1, step: 0.05, default: 0.6 },
]
/** Rounded-rect path (manual - ctx.roundRect isn't in every lib.dom). */
function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}

function CrtScanlinesVisual({ trackId }: { trackId: string }) {
  const { viewport } = useThree()
  const meshRef = useRef<Mesh>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)

  // Canvas matches the visual window's aspect (FractalTunnel's quantized scheme)
  // so scanlines stay square-pixel-true at any window size.
  const aspect = viewport.height > 0 ? viewport.width / viewport.height : 1
  const texH = 1024
  const texW = Math.max(256, Math.min(2048, Math.round((texH * aspect) / 64) * 64))

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = texW
    canvas.height = texH
    canvasRef.current = canvas

    const texture = new CanvasTexture(canvas)
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    textureRef.current = texture

    return () => {
      texture.dispose()
    }
  }, [texW])

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
    const glowAmount = p.glowAmount ?? 0.5
    const scanSpacing = Math.max(2, Math.round(p.scanSpacing ?? 4))
    const scanStrength = p.scanStrength ?? 0.35
    const flashDur = p.flashDur ?? 0.6
    const flashStrength = p.flashStrength ?? 0.5
    const blipPitch = p.blipPitch ?? 72
    const blipDur = p.blipDur ?? 0.15
    const staticCell = Math.max(8, Math.round(p.staticCell ?? 22))
    const bandPeriod = p.bandPeriod ?? 6
    const bandTravel = p.bandTravel ?? 2
    const bandStrength = p.bandStrength ?? 0.18
    const vignette = p.vignette ?? 0.55
    const curvature = p.curvature ?? 0.6

    const elapsed = state.beat * state.secPerBeat
    const w = canvas.width
    const h = canvas.height
    const cx = w / 2
    const cy = h / 2

    // 1. Tube base.
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = sp.bgColor ?? '#04070a'
    ctx.fillRect(0, 0, w, h)

    // 2. Phosphor glow - a soft center bloom that breathes on the beat.
    const breathe = 0.85 + 0.15 * Math.sin(state.beat * Math.PI)
    ctx.globalCompositeOperation = 'lighter'
    const glow = ctx.createRadialGradient(cx, cy, h * 0.05, cx, cy, h * 0.75)
    const glowHex = sp.glowColor ?? '#3aff8c'
    ctx.globalAlpha = glowAmount * 0.3 * breathe
    glow.addColorStop(0, glowHex)
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)
    ctx.globalAlpha = 1

    // 3. Note flashes: whole-screen pitch-class color, fading over flashDur.
    for (const n of state.notes) {
      if (n.beat > state.beat) continue
      const age = (state.beat - n.beat) * state.secPerBeat
      if (age >= flashDur) continue
      const velN = n.velocity <= 1 ? n.velocity : n.velocity / 127
      const k = 1 - age / flashDur
      const hue = (((n.pitch % 12) + 12) % 12) * 30
      ctx.fillStyle = `hsla(${hue}, 95%, 55%, ${(k * k * velN * flashStrength).toFixed(4)})`
      ctx.fillRect(0, 0, w, h)
    }

    // 4. Channel-change static blip (pitch >= blipPitch). Only the freshest blip
    //    draws (bounded cost); noise re-rolls at 30 beat-time fps, seeded.
    let blip: { age: number; pitch: number } | null = null
    for (const n of state.notes) {
      if (n.beat > state.beat || n.pitch < blipPitch) continue
      const age = (state.beat - n.beat) * state.secPerBeat
      if (age < blipDur && (!blip || age < blip.age)) blip = { age, pitch: n.pitch }
    }
    if (blip) {
      const noiseFrame = Math.floor(elapsed * 30)
      const fade = 1 - blip.age / blipDur
      const nx = Math.ceil(w / staticCell)
      const ny = Math.ceil(h / staticCell)
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const r = seededRand(noiseFrame * 7919 + ix * 641 + iy * 7723 + blip.pitch * 13)
          if (r <= 0.55) continue
          ctx.fillStyle = `rgba(255,255,255,${((r - 0.55) * 2.2 * fade * 0.85).toFixed(4)})`
          ctx.fillRect(ix * staticCell, iy * staticCell, staticCell, staticCell)
        }
      }
    }

    // 5. Occasional rolling band - a bright bar drifting down the tube.
    const tc = ((elapsed % bandPeriod) + bandPeriod) % bandPeriod
    if (tc < bandTravel && bandStrength > 0) {
      const bandH = h * 0.16
      const by = (tc / bandTravel) * (h + bandH * 2) - bandH
      const band = ctx.createLinearGradient(0, by - bandH / 2, 0, by + bandH / 2)
      band.addColorStop(0, 'rgba(255,255,255,0)')
      band.addColorStop(0.5, `rgba(255,255,255,${bandStrength.toFixed(4)})`)
      band.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = band
      ctx.fillRect(0, by - bandH / 2, w, bandH)
    }

    // 6. Scanlines.
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = `rgba(0,0,0,${scanStrength.toFixed(4)})`
    const lineH = Math.max(1, Math.floor(scanSpacing * 0.45))
    for (let y = 0; y < h; y += scanSpacing) ctx.fillRect(0, y, w, lineH)

    // 7. Vignette.
    if (vignette > 0) {
      const vg = ctx.createRadialGradient(cx, cy, h * 0.35, cx, cy, h * 0.85)
      vg.addColorStop(0, 'rgba(0,0,0,0)')
      vg.addColorStop(1, `rgba(0,0,0,${vignette.toFixed(4)})`)
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, w, h)
    }

    // 8. Barrel hint - a black curved bezel eating the corners (evenodd frame).
    if (curvature > 0) {
      ctx.beginPath()
      ctx.rect(0, 0, w, h)
      roundedRectPath(ctx, 0, 0, w, h, curvature * h * 0.22)
      ctx.fillStyle = '#000000'
      ctx.fill('evenodd')
    }

    texture.needsUpdate = true
    const material = mesh.material as MeshBasicMaterial
    if (material.map !== texture) {
      material.map = texture // (re)bound after an aspect-change recreation too
      material.needsUpdate = true
    }
  })

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[viewport.width * 1.02, viewport.height * 1.02]} />
      <meshBasicMaterial transparent opacity={1} depthWrite={false} />
    </mesh>
  )
}

export const crtScanlinesInstrument: ObjectInstrumentDef = {
  id: 'crtScanlines',
  name: 'CRT Scanlines',
  kind: 'object',
  userInterfaceRenderer: 'crtScanlines',
  params: PARAMS,
  // Flash color comes from the pitch class (hue = pitch % 12 · 30°); notes at
  // or above the Static Blip Pitch (default 72) also fire a channel-change
  // static burst. One row per color family, plus flash+static rows on top.
  midiRows: [
    { pitch: 72, label: 'Flash + static · red', color: '#f01c1c', emphasized: true },
    { pitch: 76, label: 'Flash + static · green', color: '#1cf01c' },
    { pitch: 80, label: 'Flash + static · blue', color: '#1c1cf0' },
    { pitch: 60, label: 'Flash · red', color: '#f01c1c' },
    { pitch: 62, label: 'Flash · yellow', color: '#f0f01c' },
    { pitch: 64, label: 'Flash · green', color: '#1cf01c' },
    { pitch: 66, label: 'Flash · cyan', color: '#1cf0f0' },
    { pitch: 68, label: 'Flash · blue', color: '#1c1cf0' },
    { pitch: 70, label: 'Flash · magenta', color: '#f01cf0' },
  ],
  component: CrtScanlinesVisual,
  fullFrame: true,
}

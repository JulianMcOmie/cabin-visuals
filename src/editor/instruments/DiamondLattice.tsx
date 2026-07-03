import { useRef, useEffect, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { CanvasTexture, LinearFilter, Mesh } from 'three'
import { useInstrumentFrame } from '../core/engine/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef, PortDef } from './types'

// Ported from Excellent DAW. A radial kite-quad lattice drawn to a 2D canvas that
// backs a full-frame plane. Kick/Snare MIDI triggers morph the arm-swing direction,
// Hat flips rotation, Spread/Swell/Mirror/Glow toggle, Spawn injects an outward layer,
// and a bank of palette + colour-filter triggers restyle it live. Lattice geometry,
// drawUnit math, and layer/mirror/depth passes are Tyler's verbatim; all animation
// state is a pure function of the playhead beat — toggles are onset-count parity,
// chases are closed-form exponentials anchored at the last onset — so scrub shows
// exactly what playback shows. Tyler's clone-plugin / seekGeneration paths are dropped.

const CANVAS_W = 1920
const CANVAS_H = 1080
const DEG = Math.PI / 180

// MIDI pitch mapping — palette select (C1–G1)
const PAL_MONO = 24
const PAL_NEON = 25
const PAL_BRUTALIST = 26
const PAL_VAPORWAVE = 27
const PAL_MAGMA = 28
const PAL_ACID = 29
const PAL_SUNSET = 30
const PAL_ICE = 31

// MIDI pitch mapping — triggers (C2–D#3)
const KICK = 36
const SNARE = 37
const HAT = 38
const SPREAD = 39
const SWELL = 40
const MIRROR = 41
const SPAWN = 42
const GLOW = 43
const INVERT = 44
const HUE_ROTATE = 45
const SATURATE = 46
const DESATURATE = 47
const WARM = 48
const COOL = 49
const HIGH_CONTRAST = 50
const BLEACH = 51

// Canvas filter strings for creative color effects (toggle on/off)
const COLOR_FILTERS: Record<number, string> = {
  [INVERT]: 'invert(1)',
  [HUE_ROTATE]: 'hue-rotate(180deg)',
  [SATURATE]: 'saturate(3)',
  [DESATURATE]: 'saturate(0.15)',
  [WARM]: 'sepia(0.6) saturate(1.5)',
  [COOL]: 'hue-rotate(190deg) saturate(0.8)',
  [HIGH_CONTRAST]: 'contrast(2) brightness(1.1)',
  [BLEACH]: 'brightness(1.6) contrast(0.7) saturate(0.5)',
}

const FILTER_PITCHES = [INVERT, HUE_ROTATE, SATURATE, DESATURATE, WARM, COOL, HIGH_CONTRAST, BLEACH]

// Map palette pitches to scheme keys
const PALETTE_PITCH_MAP: Record<number, string> = {
  [PAL_MONO]: 'mono',
  [PAL_NEON]: 'neon',
  [PAL_BRUTALIST]: 'brutalist',
  [PAL_VAPORWAVE]: 'vaporwave',
  [PAL_MAGMA]: 'magma',
  [PAL_ACID]: 'acid',
  [PAL_SUNSET]: 'sunset',
  [PAL_ICE]: 'ice',
}

// ── Color palettes ──────────────────────────────────────────────────────────

interface ColorScheme {
  name: string
  bg: string
  colors: (layer: number, nLayers: number) => string
}

function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0')
  return hex + a
}

const ALPHA = 0.55

const COLOR_SCHEMES: Record<string, ColorScheme> = {
  mono: {
    name: 'Mono',
    bg: '#0a0a0a',
    colors: (layer, nLayers) => {
      const l = 40 + (layer / Math.max(1, nLayers - 1)) * 50
      return `hsla(0, 0%, ${l}%, ${ALPHA})`
    },
  },
  neon: {
    name: 'Neon',
    bg: '#0a0a1a',
    colors: (layer, nLayers) => {
      const h = (layer / Math.max(1, nLayers)) * 360
      return `hsla(${h}, 100%, 60%, ${ALPHA})`
    },
  },
  brutalist: {
    name: 'Brutalist',
    bg: '#1a1a1a',
    colors: (layer) => {
      const c = ['#ff0000', '#ffffff', '#000000', '#ffff00', '#0000ff', '#ff00ff', '#00ff00', '#ff8800'][layer % 8]
      return hexWithAlpha(c, ALPHA)
    },
  },
  vaporwave: {
    name: 'Vaporwave',
    bg: '#1a0025',
    colors: (layer) => {
      const c = ['#ff71ce', '#01cdfe', '#05ffa1', '#b967ff', '#fffb96', '#ff6b6b', '#54e5ff', '#ffc800'][layer % 8]
      return hexWithAlpha(c, ALPHA)
    },
  },
  magma: {
    name: 'Magma',
    bg: '#0d0000',
    colors: (layer) => {
      const c = ['#ff0000', '#ff4400', '#ff8800', '#ffcc00', '#ffff44', '#ffffff', '#ff2200', '#cc0000'][layer % 8]
      return hexWithAlpha(c, ALPHA)
    },
  },
  acid: {
    name: 'Acid',
    bg: '#001100',
    colors: (layer) => {
      const c = ['#00ff00', '#88ff00', '#ccff00', '#ffff00', '#00ff88', '#00ffcc', '#44ff44', '#aaff00'][layer % 8]
      return hexWithAlpha(c, ALPHA)
    },
  },
  sunset: {
    name: 'Sunset',
    bg: '#1a0a00',
    colors: (layer) => {
      const c = ['#ff4500', '#ff6347', '#ff7f50', '#ffa07a', '#ffb347', '#ffd700', '#ff69b4', '#da70d6'][layer % 8]
      return hexWithAlpha(c, ALPHA)
    },
  },
  ice: {
    name: 'Ice',
    bg: '#000a14',
    colors: (layer) => {
      const c = ['#e0f7fa', '#b2ebf2', '#80deea', '#4dd0e1', '#26c6da', '#00bcd4', '#00acc1', '#0097a7'][layer % 8]
      return hexWithAlpha(c, ALPHA)
    },
  },
}

const SCHEME_KEYS = Object.keys(COLOR_SCHEMES)

// ── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS = {
  colorScheme: 1, // neon (index into SCHEME_KEYS)
  symmetry: 6,
  numLayers: 3,
  unitSize: 100,
  swingDeg: 40,
  rotSpeed: 20,
  rotStagger: 0,
  layerGap: 50,
  spreadRange: 60,
  swellRange: 80,
  sizeSlope: 0,
  breathAmount: 30,
  breathMult: 1,
  sizeOsc: 0,
  swingOsc: 0,
  wiggle: 0,
  depthCopy: 0,
  depthScale: 1.6,
  depthSpread: 1.5,
  depthOpacity: 0.25,
  glowAmount: 30,
  mirrorX: 0,
  mirrorY: 0,
  mirrorSpacing: 0,
  opacity: 1,
}

// ── Spawn layer type ────────────────────────────────────────────────────────

interface SpawnLayer {
  slot: number // smooth interpolated slot position (0 = center)
  opacity: number
}

// ── Params / ports ────────────────────────────────────────────────────────────

const PARAMS: ParamDef[] = [
  {
    key: 'colorScheme',
    label: 'Color Scheme',
    type: 'select',
    options: SCHEME_KEYS.map((k, i) => ({ value: i, label: COLOR_SCHEMES[k].name })),
    default: DEFAULTS.colorScheme,
  },
  { key: 'symmetry', label: 'Symmetry', min: 1, max: 16, step: 1, default: DEFAULTS.symmetry },
  { key: 'numLayers', label: 'Layers', min: 1, max: 8, step: 1, default: DEFAULTS.numLayers },
  { key: 'unitSize', label: 'Diamond Size (%)', min: 20, max: 300, step: 5, default: DEFAULTS.unitSize },
  { key: 'swingDeg', label: 'Swing Amplitude (°)', min: 10, max: 90, step: 1, default: DEFAULTS.swingDeg },
  { key: 'rotSpeed', label: 'Rotation Speed (°/s)', min: 0, max: 120, step: 1, default: DEFAULTS.rotSpeed },
  { key: 'rotStagger', label: 'Rotation Stagger (°/s)', min: -40, max: 40, step: 1, default: DEFAULTS.rotStagger },
  { key: 'layerGap', label: 'Layer Gap', min: 20, max: 120, step: 1, default: DEFAULTS.layerGap },
  { key: 'spreadRange', label: 'Spread Range', min: 10, max: 100, step: 1, default: DEFAULTS.spreadRange },
  { key: 'swellRange', label: 'Swell Range', min: 10, max: 100, step: 1, default: DEFAULTS.swellRange },
  { key: 'sizeSlope', label: 'Size Slope', min: -100, max: 100, step: 1, default: DEFAULTS.sizeSlope },
  { key: 'breathAmount', label: 'Breath Amount (%)', min: 0, max: 80, step: 1, default: DEFAULTS.breathAmount },
  {
    key: 'breathMult',
    label: 'Breath Rate',
    type: 'select',
    options: [
      { value: 0.25, label: '1/4 beat' },
      { value: 0.5, label: '1/2 beat' },
      { value: 1, label: '1 beat' },
      { value: 2, label: '2 beats' },
      { value: 4, label: '1 bar' },
      { value: 8, label: '2 bars' },
      { value: 16, label: '4 bars' },
    ],
    default: DEFAULTS.breathMult,
  },
  { key: 'sizeOsc', label: 'Size Oscillation (%)', min: 0, max: 50, step: 1, default: DEFAULTS.sizeOsc },
  { key: 'swingOsc', label: 'Swing Oscillation (%)', min: 0, max: 100, step: 1, default: DEFAULTS.swingOsc },
  { key: 'wiggle', label: 'Wiggle', min: 0, max: 10, step: 0.5, default: DEFAULTS.wiggle },
  { key: 'glowAmount', label: 'Glow Amount', min: 0, max: 80, step: 1, default: DEFAULTS.glowAmount },
  { key: 'mirrorX', label: 'Mirror X', type: 'boolean', default: DEFAULTS.mirrorX },
  { key: 'mirrorY', label: 'Mirror Y', type: 'boolean', default: DEFAULTS.mirrorY },
  { key: 'mirrorSpacing', label: 'Mirror Spacing', min: 0, max: 100, step: 1, default: DEFAULTS.mirrorSpacing },
  { key: 'depthCopy', label: 'Depth Copy', type: 'boolean', default: DEFAULTS.depthCopy },
  { key: 'depthScale', label: 'Depth Scale', min: 1.1, max: 3, step: 0.1, default: DEFAULTS.depthScale },
  { key: 'depthSpread', label: 'Depth Spread', min: 1, max: 3, step: 0.1, default: DEFAULTS.depthSpread },
  { key: 'depthOpacity', label: 'Depth Opacity', min: 0.05, max: 0.6, step: 0.05, default: DEFAULTS.depthOpacity },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: DEFAULTS.opacity },
]

const PORTS: PortDef[] = [
  { key: 'energy', label: 'Energy', combine: 'add', default: 0 },
  { key: 'scale', label: 'Scale', combine: 'add', default: 0 },
  { key: 'hue', label: 'Hue', combine: 'add', default: 0 },
]

// ── Visual component ────────────────────────────────────────────────────────

function DiamondLatticeVisual({ trackId }: { trackId: string }) {
  const meshRef = useRef<Mesh>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)
  const { viewport } = useThree()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    canvasRef.current = canvas

    const tex = new CanvasTexture(canvas)
    tex.minFilter = LinearFilter
    tex.magFilter = LinearFilter
    textureRef.current = tex
    setReady(true)

    return () => {
      tex.dispose()
    }
  }, [])

  useInstrumentFrame(trackId, (state) => {
    if (!canvasRef.current || !textureRef.current || !meshRef.current) return

    const ctx = canvasRef.current.getContext('2d')!
    const params = state.params

    // Read settings
    const schemeIdx = Math.round(params.colorScheme ?? DEFAULTS.colorScheme)
    const colorScheme = SCHEME_KEYS[schemeIdx] ?? SCHEME_KEYS[DEFAULTS.colorScheme]
    const symmetry = params.symmetry ?? DEFAULTS.symmetry
    const numLayers = params.numLayers ?? DEFAULTS.numLayers
    const unitSize = params.unitSize ?? DEFAULTS.unitSize
    const swingDeg = params.swingDeg ?? DEFAULTS.swingDeg
    const rotSpeed = params.rotSpeed ?? DEFAULTS.rotSpeed
    const rotStagger = params.rotStagger ?? DEFAULTS.rotStagger
    const layerGap = params.layerGap ?? DEFAULTS.layerGap
    const spreadRange = params.spreadRange ?? DEFAULTS.spreadRange
    const swellRange = params.swellRange ?? DEFAULTS.swellRange
    const sizeSlope = params.sizeSlope ?? DEFAULTS.sizeSlope
    const breathAmount = params.breathAmount ?? DEFAULTS.breathAmount
    const breathMultSetting = params.breathMult ?? DEFAULTS.breathMult
    const sizeOsc = params.sizeOsc ?? DEFAULTS.sizeOsc
    const swingOsc = params.swingOsc ?? DEFAULTS.swingOsc
    const wiggle = params.wiggle ?? DEFAULTS.wiggle
    const depthCopy = (params.depthCopy ?? DEFAULTS.depthCopy) >= 0.5
    const depthScale = params.depthScale ?? DEFAULTS.depthScale
    const depthSpread = params.depthSpread ?? DEFAULTS.depthSpread
    const depthOpacity = params.depthOpacity ?? DEFAULTS.depthOpacity
    const glowAmount = params.glowAmount ?? DEFAULTS.glowAmount
    const mirrorX = (params.mirrorX ?? DEFAULTS.mirrorX) >= 0.5
    const mirrorY = (params.mirrorY ?? DEFAULTS.mirrorY) >= 0.5
    const mirrorSpacing = params.mirrorSpacing ?? DEFAULTS.mirrorSpacing
    const opacity = params.opacity ?? DEFAULTS.opacity

    // Time — the playhead beat is THE time source; seconds-tuned motion converts.
    const timeSec = state.beat * state.secPerBeat
    const timeMs = timeSec * 1000

    // Tally trigger onsets at or before the playhead in one pass over the resolved
    // notes (sorted by beat): per-pitch onset count + latest onset beat, Hat/Spawn
    // onset beat lists, and the last palette pick. Every stateful behavior below is
    // a pure function of these, so a scrub to any beat matches playback there.
    const tallies = new Map<number, { count: number; lastBeat: number }>()
    const hatBeats: number[] = []
    const spawnBeats: number[] = []
    let paletteOverride: string | null = null
    for (const n of state.notes) {
      if (n.beat > state.beat) break
      // Palette switches
      if (PALETTE_PITCH_MAP[n.pitch]) {
        paletteOverride = PALETTE_PITCH_MAP[n.pitch]
        continue
      }
      const t = tallies.get(n.pitch)
      if (t) {
        t.count += 1
        t.lastBeat = n.beat
      } else {
        tallies.set(n.pitch, { count: 1, lastBeat: n.beat })
      }
      if (n.pitch === HAT) hatBeats.push(n.beat)
      else if (n.pitch === SPAWN) spawnBeats.push(n.beat)
    }
    const tally = (pitch: number) => tallies.get(pitch) ?? { count: 0, lastBeat: 0 }
    const toggledOn = (pitch: number) => tally(pitch).count % 2 === 1

    const activeSchemeKey = paletteOverride ?? colorScheme
    const scheme = COLOR_SCHEMES[activeSchemeKey] ?? COLOR_SCHEMES.neon

    // ── Derive animation state (pure functions of the playhead) ─────────

    // Closed-form exponential chase: the value that was `from` at `startSec` and
    // has eased toward `to` at `rate`/s ever since — the pure replacement for the
    // old per-frame `value += (target - value) * (1 - exp(-rate * dt))` easing.
    const chaseFrom = (from: number, to: number, startSec: number, rate: number) =>
      to + (from - to) * Math.exp(-rate * Math.max(0, timeSec - startSec))

    // Swing oscillation
    const effectiveSwingOsc = 1 + (swingOsc / 100) * Math.sin(timeMs / 700)
    const effectiveSwing = swingDeg * effectiveSwingOsc

    // Kick/snare angle — the swing direction is the parity of onsets so far; the
    // angle eases toward ±swing from the last onset, taking the previous chase as
    // settled (rapid retriggers and swing oscillation make this an approximation).
    const armAngle = (pitch: number) => {
      const { count, lastBeat } = tally(pitch)
      const dir = count % 2 === 0 ? 1 : -1
      if (count === 0) return chaseFrom(0, effectiveSwing, 0, 5) // ease in from rest at beat 0
      return chaseFrom(-dir * effectiveSwing, dir * effectiveSwing, lastBeat * state.secPerBeat, 5)
    }
    const kickAngle = armAngle(KICK)
    const snareAngle = armAngle(SNARE)

    // Accumulated rotation — the spin direction flips on each Hat onset, so the
    // accumulator is the signed sum of segment durations between flips.
    let rotAccum = 0
    {
      let rotDir = 1
      let prevSec = 0
      for (const hb of hatBeats) {
        const s = hb * state.secPerBeat
        rotAccum += rotDir * (s - prevSec)
        prevSec = s
        rotDir = -rotDir
      }
      rotAccum += rotDir * (timeSec - prevSec)
    }

    // Gap chase
    const spread = tally(SPREAD)
    const spreadOn = spread.count % 2 === 1
    const gapTarget = spreadOn ? layerGap + spreadRange : layerGap - spreadRange
    const currentGap = spread.count === 0
      ? chaseFrom(layerGap, gapTarget, 0, 2)
      : chaseFrom(spreadOn ? layerGap - spreadRange : layerGap + spreadRange, gapTarget, spread.lastBeat * state.secPerBeat, 2)

    // Size slope chase
    const swell = tally(SWELL)
    const swellOn = swell.count % 2 === 1
    const slopeTarget = swellOn ? sizeSlope + swellRange : sizeSlope - swellRange
    const currentSlope = swell.count === 0
      ? chaseFrom(0, slopeTarget, 0, 2)
      : chaseFrom(swellOn ? sizeSlope - swellRange : sizeSlope + swellRange, slopeTarget, swell.lastBeat * state.secPerBeat, 2)

    // Spawn layers — the layer born at Spawn onset i is pushed one slot outward by
    // each later onset, so its slot target between onsets j and j+1 is j - i. The
    // slot chase (rate 1.5) is rebuilt exactly, segment by segment, in closed form;
    // the opacity chase (rate 1.2) tracks a target that moves with the slot, so
    // it's approximated as easing from 1 toward the current target since the spawn.
    // Only the newest 64 layers are considered — older ones have long faded out.
    const spawnLayers: SpawnLayer[] = []
    const spawnSecs = spawnBeats.map((b) => b * state.secPerBeat)
    for (let i = Math.max(0, spawnSecs.length - 64); i < spawnSecs.length; i++) {
      let slot = 0
      for (let j = i; j < spawnSecs.length; j++) {
        const segEnd = j + 1 < spawnSecs.length ? Math.min(spawnSecs[j + 1], timeSec) : timeSec
        const slotTarget = j - i
        slot = slotTarget + (slot - slotTarget) * Math.exp(-1.5 * (segEnd - spawnSecs[j]))
      }
      const targetOpacity = Math.max(0, 1 - slot / numLayers)
      const layerOpacity = targetOpacity + (1 - targetOpacity) * Math.exp(-1.2 * (timeSec - spawnSecs[i]))
      // Skip faded-out layers (matches the old cull threshold)
      if (layerOpacity > 0.01) spawnLayers.push({ slot, opacity: layerOpacity })
    }

    // Glow chase
    const glowOn = toggledOn(GLOW)
    const currentGlow = tally(GLOW).count === 0
      ? 0
      : chaseFrom(glowOn ? 0 : 1, glowOn ? 1 : 0, tally(GLOW).lastBeat * state.secPerBeat, 3)

    // ── Dimension-relative sizing ───────────────────────────────────────

    const dim = Math.min(CANVAS_W, CANVAS_H)
    const baseRadius = dim * 0.12
    const unitScale = unitSize / 100
    const baseCentral = dim * 0.1 * unitScale
    const baseArm = dim * 0.07 * unitScale
    const basePerp = dim * 0.07 * unitScale

    // Size oscillation
    const sizeOscMult = 1 + (sizeOsc / 100) * Math.sin(timeMs / 600)

    // Breath oscillation (radius), synced to BPM: one full cycle = breathMultSetting
    // beats, phase-locked to the playhead
    const breathOsc = 1 + (breathAmount / 100) * Math.sin((state.beat / breathMultSetting) * Math.PI * 2)

    // ── Draw ────────────────────────────────────────────────────────────

    ctx.fillStyle = scheme.bg
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

    ctx.globalAlpha = opacity

    const cx = CANVAS_W / 2
    const cy = CANVAS_H / 2

    const altRot = toggledOn(MIRROR)
    const halfStep = (Math.PI * 2) / symmetry / 2
    const slopeFrac = currentSlope / 100
    const kickAng = kickAngle * DEG
    const snareAng = snareAngle * DEG
    const glowIntensity = currentGlow * glowAmount

    // Draw function for a single kite-quad unit
    const drawUnit = (
      unitCx: number,
      unitCy: number,
      angle: number, // angle from center
      central: number,
      arm: number,
      perp: number,
      fillColor: string,
      unitOpacity: number,
    ) => {
      // Central segment A→B along the radial direction (angle)
      const cosA = Math.cos(angle)
      const sinA = Math.sin(angle)

      const ax = unitCx - cosA * central * 0.5
      const ay = unitCy - sinA * central * 0.5
      const bx = unitCx + cosA * central * 0.5
      const by = unitCy + sinA * central * 0.5

      // Kick arm (C): extends backward from A, rotated by kickAng
      const kickDir = angle + Math.PI + kickAng
      const cxP = ax + Math.cos(kickDir) * arm
      const cyP = ay + Math.sin(kickDir) * arm

      // Snare arm (D): extends forward from B, rotated by snareAng
      const snareDir = angle + snareAng
      const dxP = bx + Math.cos(snareDir) * arm
      const dyP = by + Math.sin(snareDir) * arm

      // Perpendicular vertices (E, F) through midpoint of A-B
      const perpDir = angle + Math.PI / 2
      const ex = unitCx + Math.cos(perpDir) * perp
      const ey = unitCy + Math.sin(perpDir) * perp
      const fx = unitCx - Math.cos(perpDir) * perp
      const fy = unitCy - Math.sin(perpDir) * perp

      // Glow effect via canvas shadow
      if (glowIntensity > 0.5) {
        ctx.shadowColor = fillColor
        ctx.shadowBlur = glowIntensity
      }

      // Build path (reused for base fill + gradient overlay)
      const buildPath = () => {
        ctx.beginPath()
        ctx.moveTo(cxP, cyP)
        ctx.lineTo(ex, ey)
        ctx.lineTo(dxP, dyP)
        ctx.lineTo(fx, fy)
        ctx.closePath()
      }

      // Base fill (with glow shadow if active)
      ctx.globalAlpha = opacity * unitOpacity
      ctx.fillStyle = fillColor
      buildPath()
      ctx.fill()

      // Reset shadow before gradient overlay so it doesn't double-glow
      if (glowIntensity > 0.5) {
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
      }

      // Subtle top-to-bottom gradient overlay: lighter at top, darker at bottom
      const extent = Math.max(central, arm, perp) * 1.2
      const grad = ctx.createLinearGradient(unitCx, unitCy - extent, unitCx, unitCy + extent)
      grad.addColorStop(0, 'rgba(255,255,255,0.3)')
      grad.addColorStop(0.5, 'rgba(0,0,0,0)')
      grad.addColorStop(1, 'rgba(0,0,0,0.2)')
      ctx.fillStyle = grad
      buildPath()
      ctx.fill()
    }

    // Build sorted layer list: base layers + spawn layers
    interface RenderLayer {
      slot: number // position index (determines radius)
      layerIdx: number // color index
      layerOpacity: number
      isSpawn: boolean
    }

    const renderLayers: RenderLayer[] = []

    // Base layers
    for (let L = 0; L < numLayers; L++) {
      renderLayers.push({
        slot: L,
        layerIdx: L,
        layerOpacity: 1,
        isSpawn: false,
      })
    }

    // Spawn layers
    for (const sl of spawnLayers) {
      renderLayers.push({
        slot: sl.slot,
        layerIdx: 0,
        layerOpacity: sl.opacity,
        isSpawn: true,
      })
    }

    // Sort by slot (back to front, outermost first)
    renderLayers.sort((a, b) => b.slot - a.slot)

    // Render a full lattice at a given canvas center, overall scale, opacity, and optional axis flips
    const renderLattice = (
      latticeCx: number,
      latticeCy: number,
      latticeScale: number,
      latticeOpacity: number,
      sizeMult: number,
      radiusMult: number,
      flipX = 1,
      flipY = 1,
    ) => {
      for (const rl of renderLayers) {
        const slot = rl.slot
        const lt = numLayers > 1 ? slot / (numLayers - 1) : 0.5

        const sizeScale = Math.pow(2, slopeFrac * (2 * lt - 1)) * sizeOscMult * sizeMult * latticeScale

        const layerCentral = baseCentral * sizeScale
        const layerArm = baseArm * sizeScale
        const layerPerp = basePerp * sizeScale

        const layerRadius = (baseRadius + slot * Math.max(10, currentGap)) * breathOsc * radiusMult * latticeScale

        const layerDir = altRot ? Math.cos(slot * Math.PI) : 1
        const layerRot = rotAccum * (rotSpeed + slot * rotStagger) * layerDir * DEG + slot * halfStep

        const angleStep = (Math.PI * 2) / symmetry
        const fillColor = scheme.colors(rl.isSpawn ? Math.floor(slot) % numLayers : rl.layerIdx, numLayers)

        for (let i = 0; i < symmetry; i++) {
          const angle = angleStep * i + layerRot

          // Wiggle: per-unit sine offsets to position and size
          let posOffset = 0
          let wiggleSizeMult = 1
          if (wiggle > 0) {
            // Each unit gets a unique phase based on layer slot + index
            const unitPhase = slot * 3.7 + i * 2.3
            posOffset = Math.sin(timeMs / 500 + unitPhase) * wiggle * dim * 0.008
            wiggleSizeMult = 1 + Math.sin(timeMs / 600 + unitPhase * 1.4) * wiggle * 0.04
          }

          // Flip positions around lattice center for mirror duplicates
          const ux = latticeCx + Math.cos(angle) * (layerRadius + posOffset) * flipX
          const uy = latticeCy + Math.sin(angle) * (layerRadius + posOffset) * flipY
          // Flip the unit angle to match
          const flippedAngle = Math.atan2(Math.sin(angle) * flipY, Math.cos(angle) * flipX)

          drawUnit(
            ux,
            uy,
            flippedAngle,
            layerCentral * wiggleSizeMult,
            layerArm * wiggleSizeMult,
            layerPerp * wiggleSizeMult,
            fillColor,
            rl.layerOpacity * latticeOpacity,
          )
        }
      }
    }

    // Build mirror flip variants: [{flipX, flipY, offsetX, offsetY}]
    // mirrorSpacing pushes mirrored copies apart from center (in pixels, relative to dim)
    const mirrorVariants: { flipX: number; flipY: number; ox: number; oy: number }[] = []
    const spacingPx = mirrorSpacing * (dim / 100)

    if (mirrorX && mirrorY) {
      // 4 copies: original, X-flipped, Y-flipped, both-flipped
      mirrorVariants.push({ flipX: 1, flipY: 1, ox: -spacingPx, oy: -spacingPx })
      mirrorVariants.push({ flipX: -1, flipY: 1, ox: spacingPx, oy: -spacingPx })
      mirrorVariants.push({ flipX: 1, flipY: -1, ox: -spacingPx, oy: spacingPx })
      mirrorVariants.push({ flipX: -1, flipY: -1, ox: spacingPx, oy: spacingPx })
    } else if (mirrorX) {
      // 2 copies: original + X-flipped
      mirrorVariants.push({ flipX: 1, flipY: 1, ox: -spacingPx, oy: 0 })
      mirrorVariants.push({ flipX: -1, flipY: 1, ox: spacingPx, oy: 0 })
    } else if (mirrorY) {
      // 2 copies: original + Y-flipped
      mirrorVariants.push({ flipX: 1, flipY: 1, ox: 0, oy: -spacingPx })
      mirrorVariants.push({ flipX: 1, flipY: -1, ox: 0, oy: spacingPx })
    } else {
      // No mirror — single copy
      mirrorVariants.push({ flipX: 1, flipY: 1, ox: 0, oy: 0 })
    }

    // Render the lattice at center × mirror variants (Tyler's clone-plugin fan-out is dropped)
    for (const mv of mirrorVariants) {
      const mcx = cx + mv.ox
      const mcy = cy + mv.oy
      if (depthCopy) {
        renderLattice(mcx, mcy, 1, depthOpacity, depthScale, depthSpread, mv.flipX, mv.flipY)
      }
      renderLattice(mcx, mcy, 1, 1, 1, 1, mv.flipX, mv.flipY)
    }

    ctx.globalAlpha = 1

    // Apply active color filters (onset-count parity per pitch) by redrawing
    // the canvas onto itself, all composed into a single filter string
    const filterStr = FILTER_PITCHES.filter(toggledOn)
      .map((pitch) => COLOR_FILTERS[pitch])
      .join(' ')
    if (filterStr) {
      ctx.save()
      ctx.filter = filterStr
      ctx.drawImage(canvasRef.current, 0, 0)
      ctx.filter = 'none'
      ctx.restore()
    }

    // Update texture
    textureRef.current.needsUpdate = true

    // Scale mesh to fill viewport
    const aspect = CANVAS_W / CANVAS_H
    const vpAspect = viewport.width / viewport.height
    if (vpAspect > aspect) {
      meshRef.current.scale.set(viewport.width, viewport.width / aspect, 1)
    } else {
      meshRef.current.scale.set(viewport.height * aspect, viewport.height, 1)
    }
  })

  if (!ready) return null

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={textureRef.current} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

export const diamondLatticeInstrument: ObjectInstrumentDef = {
  id: 'diamondLattice',
  name: 'Diamond Lattice',
  kind: 'object',
  params: PARAMS,
  ports: PORTS,
  component: DiamondLatticeVisual,
  fullFrame: true,
}

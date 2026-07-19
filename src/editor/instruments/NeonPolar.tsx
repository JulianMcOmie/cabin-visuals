import { useRef, useEffect } from 'react'
import { extend, useThree } from '@react-three/fiber'
import { Group, Vector2, Color } from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { setAnimatedOpacity } from '../core/visual/animatedOpacity'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW's NeonPolar. A 3D neon polar harmonograph: 6 oscillator
// layers of drifting polar curves drawn as fat neon lines. Notes in the jitter range
// (48-59) perturb the curves and shift their base frequency (velocity-scaled). The
// polar-curve math (layerRadius / updateLayerCurve) is Tyler's verbatim. Tyler's
// palette-toggle notes (60-63) are replaced by a `color` param + `hue` port.

extend({ Line2, LineGeometry, LineMaterial })

// --- Configuration ---
const POINT_COUNT = 2048
const DEFAULT_CYCLES = 8
const DEFAULT_MIN_RADIUS = 0
const DEFAULT_MAX_RADIUS = 5
const LINE_WIDTH = 1.5

// --- MIDI pitch mappings ---
// Jitter + freq shift: 48-59 (12 notes)
const PITCH_JITTER_MIN = 48
const PITCH_JITTER_MAX = 59

// --- Oscillator layer definitions ---
interface OscillatorDef {
  freqBase: number
  freqDrift: number
  freqRate: number
  ampBase: number
  ampDrift: number
  ampRate: number
  phaseRate: number
  phaseModDepth: number
  phaseModRate: number
  lightnessOffset: number // added to base lightness for per-layer depth
}

const OSCILLATORS: OscillatorDef[] = [
  {
    freqBase: 3.0, freqDrift: 0.6, freqRate: 0.09,
    ampBase: 0.55, ampDrift: 0.15, ampRate: 0.13,
    phaseRate: 0.05, phaseModDepth: 0.4, phaseModRate: 0.07,
    lightnessOffset: 0.02,
  },
  {
    freqBase: 5.0, freqDrift: 0.9, freqRate: 0.07,
    ampBase: 0.42, ampDrift: 0.12, ampRate: 0.19,
    phaseRate: -0.08, phaseModDepth: 0.5, phaseModRate: 0.11,
    lightnessOffset: 0.05,
  },
  {
    freqBase: 8.0, freqDrift: 1.4, freqRate: 0.11,
    ampBase: 0.32, ampDrift: 0.10, ampRate: 0.23,
    phaseRate: 0.12, phaseModDepth: 0.6, phaseModRate: 0.09,
    lightnessOffset: 0.08,
  },
  {
    freqBase: 13.0, freqDrift: 1.8, freqRate: 0.05,
    ampBase: 0.22, ampDrift: 0.08, ampRate: 0.31,
    phaseRate: -0.15, phaseModDepth: 0.8, phaseModRate: 0.13,
    lightnessOffset: 0.10,
  },
  {
    freqBase: 6.5, freqDrift: 2.2, freqRate: 0.06,
    ampBase: 0.35, ampDrift: 0.10, ampRate: 0.17,
    phaseRate: 0.03, phaseModDepth: 0.5, phaseModRate: 0.08,
    lightnessOffset: 0.04,
  },
  {
    freqBase: 2.0, freqDrift: 0.4, freqRate: 0.13,
    ampBase: 0.30, ampDrift: 0.10, ampRate: 0.11,
    phaseRate: 0.04, phaseModDepth: 0.3, phaseModRate: 0.05,
    lightnessOffset: -0.02,
  },
]

const LAYER_COUNT = OSCILLATORS.length

// Frequency multiplier per jitter note (0-11)
const FREQ_MULTIPLIERS = [
  0.60, 0.70, 0.80, 0.90, 1.00, 1.10,
  1.25, 1.40, 1.60, 1.80, 2.00, 2.30,
]

// --- Types ---
interface CurveObjects {
  line: Line2
  geometry: LineGeometry
  material: LineMaterial
}

interface JitterNote {
  pitchIdx: number
  velScale: number
}

// ---------------------------------------------------------------------------
// Radius computation (Tyler verbatim)
// ---------------------------------------------------------------------------

function layerRadius(
  theta: number,
  t: number,
  phi: number,
  osc: OscillatorDef,
  speed: number,
  freqMult: number,
  minR: number,
  maxR: number,
): number {
  const st = t * speed

  const baseR =
    1.0 +
    0.12 * Math.sin(st * 0.19 + phi) +
    0.08 * Math.sin(st * 0.31 + phi * 0.5)

  const freq =
    (osc.freqBase * freqMult) +
    osc.freqDrift * Math.sin(st * osc.freqRate + phi * 0.3)

  const amp = osc.ampBase + osc.ampDrift * Math.sin(st * osc.ampRate + phi * 1.3)

  const phase =
    st * osc.phaseRate +
    osc.phaseModDepth * Math.sin(st * osc.phaseModRate + phi * 0.7)

  const raw = baseR + minR + amp * Math.cos(freq * theta + phase)

  return Math.min(maxR, raw)
}

// ---------------------------------------------------------------------------
// Line helpers
// ---------------------------------------------------------------------------

function makeLine(
  group: Group,
  resolution: Vector2,
  lineWidth: number,
): CurveObjects {
  const positions = new Array((POINT_COUNT + 1) * 3).fill(0)
  for (let i = 0; i <= POINT_COUNT; i++) {
    const a = (i / POINT_COUNT) * Math.PI * 2
    positions[i * 3] = Math.cos(a)
    positions[i * 3 + 1] = Math.sin(a)
  }

  const geometry = new LineGeometry()
  geometry.setPositions(positions)

  const material = new LineMaterial({
    color: 0xffffff,
    linewidth: lineWidth,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    resolution,
    worldUnits: false,
  })

  const line = new Line2(geometry, material)
  line.computeLineDistances()
  group.add(line)

  return { line, geometry, material }
}

function updateLayerCurve(
  geometry: LineGeometry,
  line: Line2,
  t: number,
  phi: number,
  osc: OscillatorDef,
  speed: number,
  cycles: number,
  freqMult: number,
  jitterNotes: JitterNote[],
  minR: number,
  maxR: number,
): void {
  const positions: number[] = []
  const totalAngle = cycles * Math.PI * 2

  for (let i = 0; i <= POINT_COUNT; i++) {
    const theta = (i / POINT_COUNT) * totalAngle
    let r = layerRadius(theta, t, phi, osc, speed, freqMult, minR, maxR)

    // Jitter from held MIDI notes
    for (let j = 0; j < jitterNotes.length; j++) {
      const { pitchIdx, velScale } = jitterNotes[j]
      const normPitch = pitchIdx / 11
      const amp = 0.02 + normPitch * 0.06
      const freq = 30 + pitchIdx * 7
      const pPhase = theta * (1 + pitchIdx * 0.5)
      const sharpness = 0.2 + normPitch * 0.6
      const raw = Math.sin(t * freq + pPhase)
      const shaped = Math.sign(raw) * Math.pow(Math.abs(raw), 1 - sharpness)
      r += shaped * amp * velScale
    }

    positions.push(r * Math.cos(theta), r * Math.sin(theta), 0)
  }

  geometry.setPositions(positions)
  line.computeLineDistances()
}

// ---------------------------------------------------------------------------
// Params + ports
// ---------------------------------------------------------------------------

const PARAMS: ParamDef[] = [
  { key: 'speed', label: 'Speed', min: 0.1, max: 3, step: 0.1, default: 1 },
  { key: 'complexity', label: 'Complexity', min: 0.2, max: 2, step: 0.1, default: 1 },
  { key: 'lineWidth', label: 'Line Width', min: 0.5, max: 5, step: 0.5, default: LINE_WIDTH },
  { key: 'cycles', label: 'Cycles', min: 1, max: 20, step: 1, default: DEFAULT_CYCLES },
  { key: 'minRadius', label: 'Min Radius', min: -3, max: 3, step: 0.1, default: DEFAULT_MIN_RADIUS },
  { key: 'maxRadius', label: 'Max Radius', min: 1, max: 10, step: 0.1, default: DEFAULT_MAX_RADIUS },
  { key: 'color', label: 'Color', type: 'color', default: '#d4a843' },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, default: 0.75 },
]
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function NeonPolarVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const layerLinesRef = useRef<CurveObjects[]>([])
  const { size } = useThree()
  const resolutionRef = useRef(new Vector2(size.width, size.height))
  const baseColor = useRef(new Color())
  const layerColor = useRef(new Color())
  const hsl = useRef({ h: 0, s: 0, l: 0 })

  useEffect(() => {
    resolutionRef.current.set(size.width, size.height)
    for (const c of layerLinesRef.current)
      c.material.resolution.set(size.width, size.height)
  }, [size.width, size.height])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return

    const lines: CurveObjects[] = []
    for (let i = 0; i < LAYER_COUNT; i++) {
      lines.push(makeLine(group, resolutionRef.current, LINE_WIDTH))
    }
    layerLinesRef.current = lines

    return () => {
      for (const c of layerLinesRef.current) {
        group.remove(c.line)
        c.geometry.dispose()
        c.material.dispose()
      }
      layerLinesRef.current = []
    }
  }, [])

  useInstrumentFrame(trackId, (state) => {
    const group = groupRef.current
    if (!group) return

    const p = state.params
    const speed = p.speed ?? 1
    const complexity = p.complexity ?? 1
    const lineWidth = p.lineWidth ?? LINE_WIDTH
    const cycles = p.cycles ?? DEFAULT_CYCLES
    const minRadius = p.minRadius ?? DEFAULT_MIN_RADIUS
    const maxRadius = p.maxRadius ?? DEFAULT_MAX_RADIUS
    const opacity = clamp(p.opacity ?? 0.75, 0, 1)

    // Energy (the note-pulse) nudges lightness/opacity; the old hue/scale ports are retired.
    const hueShift = 0
    const energy = state.energy
    const scalePort = 0

    // Beat-time in seconds - the drift/jitter frequencies were tuned in seconds.
    const t = state.beat * state.secPerBeat

    // --- MIDI: jitter notes + freq shift (velocity-scaled) ---
    const jitterNotes: JitterNote[] = []
    let freqMult = 1.0
    let heldCount = 0
    let multAccum = 0

    for (const n of state.activeNotes) {
      if (n.pitch >= PITCH_JITTER_MIN && n.pitch <= PITCH_JITTER_MAX) {
        const pitchIdx = n.pitch - PITCH_JITTER_MIN
        const v = n.velocity <= 1 ? n.velocity : n.velocity / 127
        jitterNotes.push({ pitchIdx, velScale: v })
        multAccum += FREQ_MULTIPLIERS[pitchIdx]
        heldCount++
      }
    }
    if (heldCount > 0) {
      freqMult = multAccum / heldCount
    }

    // --- Resolve base colour from the color param, offset by the hue port ---
    baseColor.current.set(state.stringParams.color ?? '#d4a843')
    baseColor.current.getHSL(hsl.current)
    const baseH = (hsl.current.h + hueShift + 1) % 1
    const baseS = hsl.current.s
    const baseL = hsl.current.l

    // Group scale reacts to the scale port.
    group.scale.setScalar(1 + scalePort)

    // --- Update each oscillator layer ---
    for (let i = 0; i < layerLinesRef.current.length; i++) {
      const curve = layerLinesRef.current[i]
      const osc = OSCILLATORS[i]

      const effectiveOsc =
        i >= 2
          ? { ...osc, ampBase: osc.ampBase * complexity, ampDrift: osc.ampDrift * complexity }
          : osc

      updateLayerCurve(
        curve.geometry, curve.line, t, 0, effectiveOsc, speed, cycles,
        freqMult, jitterNotes, minRadius, maxRadius,
      )

      // Color from base + per-layer lightness offset (energy brightens).
      const layerL = clamp(baseL + osc.lightnessOffset + energy * 0.15, 0.1, 0.95)
      layerColor.current.setHSL(baseH, baseS, layerL)
      curve.material.color.copy(layerColor.current)
      setAnimatedOpacity(curve.material, clamp(opacity + energy * 0.2, 0, 1))
      curve.material.linewidth = lineWidth
    }
  })

  return <group ref={groupRef} />
}

export const neonPolarInstrument: ObjectInstrumentDef = {
  id: 'neonPolar',
  name: 'Neon Polar',
  kind: 'object',
  userInterfaceRenderer: 'neonPolar',
  params: PARAMS,
  // Held notes in 48-59 jitter the curves and shift their frequency: higher
  // rows shake harder/sharper and multiply the curve frequency (more petals),
  // lower rows soften and slow it. Quantized to 6 labelled steps.
  midiRows: [
    { pitch: 59, label: 'Jitter · frantic, curves sped up (hold)', emphasized: true },
    { pitch: 57, label: 'Jitter · intense (hold)' },
    { pitch: 55, label: 'Jitter · strong (hold)' },
    { pitch: 53, label: 'Jitter · medium (hold)' },
    { pitch: 50, label: 'Jitter · gentle (hold)' },
    { pitch: 48, label: 'Jitter · subtle, curves slowed (hold)' },
  ],
  component: NeonPolarVisual,
}

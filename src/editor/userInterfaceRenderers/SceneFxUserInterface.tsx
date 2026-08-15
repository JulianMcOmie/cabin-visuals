'use client'

// The seven Scene FX device consoles (effects/scene/*). They are one family and
// share a chassis on purpose - a rack of them should read as one instrument
// with seven voices, not seven unrelated dialogs - so everything common lives in
// `SceneFxShell` and each device below is only its own controls.
//
// The shape was chosen from an interactive mock (preview=scene, amount=knob,
// accent=perDevice, kinds=glyphs, size=compact). Four of those are real
// decisions:
//
// - **AMOUNT is the large lead knob of every device**, in the same slot every
//   time. It is the master the whole device hangs off (0 skips the pass
//   outright) and it is the automation target - the thing you put a kick under -
//   so it gets the guide's primary-param treatment and a fixed home, and the
//   eye finds it in the same place whichever device it lands on.
// - **Each device wears its own accent** (`VisualEffect.accent`, declared on the
//   plugin so the console and the rack LED cannot drift), because in a rack you
//   are picking one device out of a column, not admiring a set.
// - **A device's KIND param is chosen by looking**: the segments draw the blur
//   shapes, the film textures and the fold patterns rather than naming them,
//   with the active one captioned underneath (the guide's rule for values that
//   have shapes). Grade's temperature/tint is a 2D PAD for the same reason -
//   the two axes are one gesture, and two bipolar knobs hide that.
// - **The preview is compact (96px)**, because devices stack: it has to still be
//   there when you are looking at the third one down.

import { useRef } from 'react'
import { gradeScenePlugin } from '../effects/scene/grade'
import { lensScenePlugin } from '../effects/scene/lens'
import { blurScenePlugin } from '../effects/scene/blur'
import { grainScenePlugin } from '../effects/scene/grain'
import { crushScenePlugin } from '../effects/scene/crush'
import { glitchScenePlugin } from '../effects/scene/glitch'
import { mirrorScenePlugin } from '../effects/scene/mirror'
import { SCENE_FX_RATE_DETENTS, formatSceneFxRate } from '../effects/scene/rate'
import type { VisualEffect } from '../effects/types'
import {
  Console,
  ControlRow,
  GutterRow,
  Knob,
  More,
  ParameterList,
  Segmented,
  bindPanel,
  type NumBinding,
  type SegmentOption,
} from './console'
import { SceneFxPreview } from './sceneFxPreview'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// --- glyphs -----------------------------------------------------------------
// Drawn in currentColor so a segment's lit state carries them, and kept to the
// one idea each mode actually is. 22x14 viewBox: wide enough for a directional
// smear, short enough to sit in a 24px segment.

const glyphBox = 'h-[14px] w-[22px]'

function BlurSoftGlyph() {
  return (
    <svg viewBox="0 0 22 14" className={glyphBox} aria-hidden="true">
      <circle cx="11" cy="7" r="5.5" fill="currentColor" opacity="0.16" />
      <circle cx="11" cy="7" r="3.5" fill="currentColor" opacity="0.34" />
      <circle cx="11" cy="7" r="1.8" fill="currentColor" opacity="0.9" />
    </svg>
  )
}

function BlurDirectionalGlyph() {
  return (
    <svg viewBox="0 0 22 14" className={glyphBox} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={3 + i * 4.4} y="4.5" width="3.4" height="5" rx="0.6" fill="currentColor" opacity={0.85 - i * 0.22} />
      ))}
    </svg>
  )
}

function BlurZoomGlyph() {
  return (
    <svg viewBox="0 0 22 14" className={glyphBox} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2
        return (
          <line
            key={i}
            x1={11 + Math.cos(a) * 2.4}
            y1={7 + Math.sin(a) * 2.4}
            x2={11 + Math.cos(a) * 6.4}
            y2={7 + Math.sin(a) * 6.4}
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            opacity="0.75"
          />
        )
      })}
      <circle cx="11" cy="7" r="1.5" fill="currentColor" />
    </svg>
  )
}

function GrainFilmGlyph() {
  // A fixed scatter, not a random one: a glyph that reshuffles per render reads
  // as a rendering bug rather than as grain.
  const dots = [
    [3, 3], [7, 5], [5, 9], [10, 2], [12, 8], [9, 11], [15, 4], [18, 9],
    [16, 11], [13, 5], [6, 12], [19, 5], [2, 7], [11, 8], [17, 2],
  ]
  return (
    <svg viewBox="0 0 22 14" className={glyphBox} aria-hidden="true">
      {dots.map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="1.3" height="1.3" fill="currentColor" opacity={0.4 + ((i * 37) % 6) / 10} />
      ))}
    </svg>
  )
}

function GrainScanlinesGlyph() {
  return (
    <svg viewBox="0 0 22 14" className={glyphBox} aria-hidden="true">
      {[2, 5, 8, 11].map((y) => (
        <rect key={y} x="2" y={y} width="18" height="1.4" rx="0.6" fill="currentColor" opacity="0.7" />
      ))}
    </svg>
  )
}

function GrainHalftoneGlyph() {
  return (
    <svg viewBox="0 0 22 14" className={glyphBox} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((col) =>
        [0, 1, 2].map((row) => (
          <circle
            key={`${col}-${row}`}
            cx={3 + col * 4}
            cy={3.5 + row * 3.6}
            r={0.7 + (col / 4) * 1.5}
            fill="currentColor"
            opacity="0.8"
          />
        )),
      )}
    </svg>
  )
}

function MirrorGlyph() {
  return (
    <svg viewBox="0 0 22 14" className={glyphBox} aria-hidden="true">
      <path d="M10 2 L4 12 L10 12 Z" fill="currentColor" opacity="0.85" />
      <path d="M12 2 L18 12 L12 12 Z" fill="currentColor" opacity="0.4" />
    </svg>
  )
}

function QuadGlyph() {
  return (
    <svg viewBox="0 0 22 14" className={glyphBox} aria-hidden="true">
      <path d="M10 1 L5 6 L10 6 Z" fill="currentColor" opacity="0.85" />
      <path d="M12 1 L17 6 L12 6 Z" fill="currentColor" opacity="0.5" />
      <path d="M10 13 L5 8 L10 8 Z" fill="currentColor" opacity="0.5" />
      <path d="M12 13 L17 8 L12 8 Z" fill="currentColor" opacity="0.3" />
    </svg>
  )
}

function KaleidoGlyph() {
  return (
    <svg viewBox="0 0 22 14" className={glyphBox} aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2
        const b = ((i + 0.5) / 6) * Math.PI * 2
        return (
          <path
            key={i}
            d={`M11 7 L${11 + Math.cos(a) * 6} ${7 + Math.sin(a) * 6} L${11 + Math.cos(b) * 6} ${7 + Math.sin(b) * 6} Z`}
            fill="currentColor"
            opacity={i % 2 === 0 ? 0.8 : 0.32}
          />
        )
      })}
    </svg>
  )
}

function TileGlyph() {
  return (
    <svg viewBox="0 0 22 14" className={glyphBox} aria-hidden="true">
      {[0, 1, 2].map((col) =>
        [0, 1].map((row) => (
          <rect
            key={`${col}-${row}`}
            x={2.5 + col * 6.2}
            y={2 + row * 5.4}
            width="5"
            height="4.4"
            rx="0.7"
            fill="currentColor"
            opacity={(col + row) % 2 === 0 ? 0.8 : 0.4}
          />
        )),
      )}
    </svg>
  )
}

const BLUR_MODES: SegmentOption[] = [
  { value: 0, label: 'Soft', glyph: <BlurSoftGlyph /> },
  { value: 1, label: 'Directional', glyph: <BlurDirectionalGlyph /> },
  { value: 2, label: 'Zoom', glyph: <BlurZoomGlyph /> },
]

const GRAIN_MODES: SegmentOption[] = [
  { value: 0, label: 'Film grain', glyph: <GrainFilmGlyph /> },
  { value: 1, label: 'Scanlines', glyph: <GrainScanlinesGlyph /> },
  { value: 2, label: 'Halftone', glyph: <GrainHalftoneGlyph /> },
]

const MIRROR_MODES: SegmentOption[] = [
  { value: 0, label: 'Mirror', glyph: <MirrorGlyph /> },
  { value: 1, label: 'Quad', glyph: <QuadGlyph /> },
  { value: 2, label: 'Kaleidoscope', glyph: <KaleidoGlyph /> },
  { value: 3, label: 'Tile', glyph: <TileGlyph /> },
]

// --- shared chassis ---------------------------------------------------------

/** The device's live numeric settings, for the preview's uniforms. */
function settingsOf(parameters: readonly UserInterfaceParameter[]): Record<string, number> {
  const settings: Record<string, number> = {}
  for (const parameter of parameters) {
    if (typeof parameter.value === 'number') settings[parameter.definition.key] = parameter.value
  }
  return settings
}

/**
 * A glyph strip plus the active option's NAME underneath. The glyphs make the
 * choice by looking; the caption is what stops a picture-only control from
 * being a guessing game the first time you meet it (the guide's rule).
 */
function GlyphChoice({ b, options, testId }: {
  b: ReturnType<ReturnType<typeof bindPanel>['select']>
  options: readonly SegmentOption[]
  testId?: string
}) {
  if (!b) return null
  const active = options.find((option) => option.value === Math.round(b.value))
  return (
    <div className="px-3 pt-2.5">
      <Segmented b={b} options={options} testId={testId} />
      <div className="pt-1 text-center text-[8px] font-semibold uppercase tracking-[0.18em] text-white/35">
        {active?.label ?? ''}
      </div>
    </div>
  )
}

/**
 * Grade's temperature/tint pad: the two axes of white balance as ONE gesture,
 * over a field showing what each corner does. Fixed size and genuinely square
 * in CSS, not just in a viewBox - a stretched colour field lies about where the
 * neutral point is (the CameraOrbit lesson).
 */
function TemperatureTintPad({ temperature, tint }: { temperature: NumBinding | null; tint: NumBinding | null }) {
  const padRef = useRef<HTMLDivElement>(null)
  if (!temperature || !tint) return null

  const toFraction = (b: NumBinding) => (b.value - b.def.min) / (b.def.max - b.def.min)
  const commit = (event: { clientX: number; clientY: number }) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    temperature.set(temperature.def.min + x * (temperature.def.max - temperature.def.min))
    tint.set(tint.def.min + (1 - y) * (tint.def.max - tint.def.min))
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={padRef}
        role="application"
        aria-label="Temperature and tint"
        tabIndex={0}
        className="relative h-[62px] w-[62px] cursor-crosshair touch-none overflow-hidden rounded-[5px] border border-white/[0.08]"
        style={{
          background:
            'linear-gradient(to top, rgba(233,72,204,0.5), rgba(60,220,140,0.5)), linear-gradient(to right, #2f6fd0, #e8a13c)',
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          event.preventDefault()
          commit(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) commit(event)
        }}
        onDoubleClick={() => {
          temperature.set(temperature.def.default)
          tint.set(tint.def.default)
        }}
        onKeyDown={(event) => {
          const stepX = (temperature.def.max - temperature.def.min) * 0.03
          const stepY = (tint.def.max - tint.def.min) * 0.03
          if (event.key === 'ArrowLeft') temperature.set(temperature.value - stepX)
          else if (event.key === 'ArrowRight') temperature.set(temperature.value + stepX)
          else if (event.key === 'ArrowUp') tint.set(tint.value + stepY)
          else if (event.key === 'ArrowDown') tint.set(tint.value - stepY)
          else return
          event.preventDefault()
        }}
      >
        <span
          className="pointer-events-none absolute h-[9px] w-[9px] rounded-full border-[1.5px] border-white"
          style={{
            left: `${toFraction(temperature) * 100}%`,
            top: `${(1 - toFraction(tint)) * 100}%`,
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 5px rgba(0,0,0,0.9)',
          }}
        />
      </div>
      <span className="text-[7px] font-semibold uppercase tracking-[0.16em] text-white/40">Temp · Tint</span>
    </div>
  )
}

function SceneFxShell({ plugin, parameters, rest, children }: {
  plugin: VisualEffect
  parameters: readonly UserInterfaceParameter[]
  rest: UserInterfaceParameter[]
  children: React.ReactNode
}) {
  return (
    <Console accent={plugin.accent ?? 'var(--accent)'} testId={`scene-fx-${plugin.id}`}>
      <SceneFxPreview plugin={plugin} settings={settingsOf(parameters)} testId={`scene-fx-preview-${plugin.id}`} />
      {children}
      <More parameters={rest} />
    </Console>
  )
}

// --- the seven devices ------------------------------------------------------

const GradePanel: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const amount = b.num('amount')
  const exposure = b.num('exposure')
  const contrast = b.num('contrast')
  const saturation = b.num('saturation')
  const temperature = b.num('temperature')
  const tint = b.num('tint')
  const hueShift = b.num('hueShift')
  const rest = b.rest()
  if (b.missing) return <ParameterList parameters={parameters} />
  return (
    <SceneFxShell plugin={gradeScenePlugin} parameters={parameters} rest={rest}>
      <ControlRow spill>
        <Knob b={amount} label="AMOUNT" large />
        <Knob b={exposure} label="EXPOSURE" bipolar />
        <Knob b={contrast} label="CONTRAST" bipolar />
      </ControlRow>
      <GutterRow label="COLOR">
        <TemperatureTintPad temperature={temperature} tint={tint} />
        <Knob b={saturation} label="SAT" bipolar />
        <Knob b={hueShift} label="HUE" bipolar />
      </GutterRow>
    </SceneFxShell>
  )
}

const LensPanel: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const amount = b.num('amount')
  const distortion = b.num('distortion')
  const chromatic = b.num('chromatic')
  const vignette = b.num('vignette')
  const softness = b.num('softness')
  const rest = b.rest()
  if (b.missing) return <ParameterList parameters={parameters} />
  return (
    <SceneFxShell plugin={lensScenePlugin} parameters={parameters} rest={rest}>
      <ControlRow spill>
        <Knob b={amount} label="AMOUNT" large />
        <Knob b={distortion} label="WARP" bipolar />
        <Knob b={chromatic} label="FRINGE" />
      </ControlRow>
      <GutterRow label="EDGE">
        <Knob b={vignette} label="VIGNETTE" />
        <Knob b={softness} label="SOFTNESS" />
      </GutterRow>
    </SceneFxShell>
  )
}

const BlurPanel: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const mode = b.select('mode')
  const amount = b.num('amount')
  // The effect branch does NOT filter showIf-gated params (that is the
  // instrument branch), so the panel gates the ANGLE knob itself - and binds it
  // optionally in case the branches are ever unified.
  const angle = b.num('angle', { optional: true })
  const rest = b.rest()
  if (b.missing) return <ParameterList parameters={parameters} />
  const directional = Math.round(mode?.value ?? 0) === 1
  return (
    <SceneFxShell plugin={blurScenePlugin} parameters={parameters} rest={rest}>
      <GlyphChoice b={mode} options={BLUR_MODES} testId="scene-blur-modes" />
      <ControlRow>
        <Knob b={amount} label="AMOUNT" large />
        {directional && <Knob b={angle} label="ANGLE" suffix="°" />}
      </ControlRow>
    </SceneFxShell>
  )
}

const GrainPanel: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const mode = b.select('mode')
  const amount = b.num('amount')
  const size = b.num('size')
  const rate = b.num('rate')
  const rest = b.rest()
  if (b.missing) return <ParameterList parameters={parameters} />
  return (
    <SceneFxShell plugin={grainScenePlugin} parameters={parameters} rest={rest}>
      <GlyphChoice b={mode} options={GRAIN_MODES} testId="scene-grain-modes" />
      <ControlRow>
        <Knob b={amount} label="AMOUNT" large />
        <Knob b={size} label="SIZE" />
        <Knob b={rate} label="RATE" detents={SCENE_FX_RATE_DETENTS} format={formatSceneFxRate} />
      </ControlRow>
    </SceneFxShell>
  )
}

const CrushPanel: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const amount = b.num('amount')
  const pixelate = b.num('pixelate')
  const posterize = b.num('posterize')
  const threshold = b.num('threshold')
  const rest = b.rest()
  if (b.missing) return <ParameterList parameters={parameters} />
  return (
    <SceneFxShell plugin={crushScenePlugin} parameters={parameters} rest={rest}>
      <ControlRow spill>
        <Knob b={amount} label="AMOUNT" large />
        <Knob b={pixelate} label="PIXELATE" />
      </ControlRow>
      <GutterRow label="COLOR">
        <Knob b={posterize} label="POSTERIZE" />
        <Knob b={threshold} label="THRESHOLD" />
      </GutterRow>
    </SceneFxShell>
  )
}

const GlitchPanel: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const amount = b.num('amount')
  const rate = b.num('rate')
  const slices = b.num('slices')
  const shift = b.num('shift')
  const split = b.num('split')
  const blocks = b.num('blocks')
  const rest = b.rest()
  if (b.missing) return <ParameterList parameters={parameters} />
  return (
    <SceneFxShell plugin={glitchScenePlugin} parameters={parameters} rest={rest}>
      <ControlRow spill>
        <Knob b={amount} label="AMOUNT" large />
        <Knob b={rate} label="RATE" detents={SCENE_FX_RATE_DETENTS} format={formatSceneFxRate} />
        <Knob b={slices} label="SLICES" />
      </ControlRow>
      <GutterRow label="DAMAGE">
        <Knob b={shift} label="SHIFT" />
        <Knob b={split} label="SPLIT" />
        <Knob b={blocks} label="BLOCKS" />
      </GutterRow>
    </SceneFxShell>
  )
}

const MirrorPanel: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const mode = b.select('mode')
  const amount = b.num('amount')
  const segments = b.num('segments', { optional: true })
  const angle = b.num('angle')
  const rest = b.rest()
  if (b.missing) return <ParameterList parameters={parameters} />
  const kaleidoscope = Math.round(mode?.value ?? 0) === 2
  return (
    <SceneFxShell plugin={mirrorScenePlugin} parameters={parameters} rest={rest}>
      <GlyphChoice b={mode} options={MIRROR_MODES} testId="scene-mirror-modes" />
      <ControlRow>
        <Knob b={amount} label="AMOUNT" large />
        {kaleidoscope && <Knob b={segments} label="SEGMENTS" />}
        <Knob b={angle} label="ANGLE" suffix="°" />
      </ControlRow>
    </SceneFxShell>
  )
}

/** Keyed by plugin id, spread into EFFECT_USER_INTERFACES. */
export const SCENE_FX_USER_INTERFACES: Record<string, UserInterfaceRendererDefinition> = {
  [gradeScenePlugin.id]: GradePanel,
  [lensScenePlugin.id]: LensPanel,
  [blurScenePlugin.id]: BlurPanel,
  [grainScenePlugin.id]: GrainPanel,
  [crushScenePlugin.id]: CrushPanel,
  [glitchScenePlugin.id]: GlitchPanel,
  [mirrorScenePlugin.id]: MirrorPanel,
}

'use client'

// Bespoke settings for Overlap Shape, following docs/instrument-panel-design-guide.md:
// a live preview of two copies gliding across each other - drawn with SVG's
// evenodd fill rule, which IS the instrument's parity rule, so the picture
// can't lie about the semantics - over the panel's two decisions as segmented
// controls (SHAPE, OVERLAP treatment), a knob row (SIZE / PULSE) and the color
// pills. In cut-out mode the overlap region shows the checkerboard behind the
// stage: the universal "this is transparency" signal. The preview animates on
// rAF - panel chrome, exempt from the pause invariant (the guide's
// DOM-transform pattern).

import { useRef } from 'react'
import {
  DEFAULT_OVERLAP_SHAPE_BASE_COLOR,
  DEFAULT_OVERLAP_SHAPE_OVERLAP_COLOR,
  OVERLAP_MODE,
} from '../instruments/OverlapShape'
import { OVERLAP_SHAPE_OPTIONS, overlapShapeIndex, overlapShapePoints } from '../instruments/overlapShapeCore'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { ColorWheelPill, hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
import { usePreviewLoop } from './console'
import { LaserKnob } from './laserKnob'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function stringValue(bound: UserInterfaceParameter | undefined, fallback: string): string {
  return typeof bound?.value === 'string' ? bound.value : fallback
}

// ── Live preview ────────────────────────────────────────────────────────────

const STAGE_W = 240
const STAGE_H = 104
const STAGE_R = 30

/** One shape outline as an SVG subpath (viewBox space, y flipped to y-down). */
function shapeSubpath(shape: number, cx: number, cy: number, r: number): string {
  const points = overlapShapePoints(shape)
  return points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(cx + x * r).toFixed(2)} ${(cy - y * r).toFixed(2)}`)
    .join(' ') + ' Z'
}

/**
 * Two copies of the shape crossing on a slow rAF glide. The union underlay
 * (overlap color) only renders in COLOR mode; the evenodd path on top always
 * paints exactly the odd-covered region in the base color - the same parity
 * the stencil recipe renders in-scene.
 */
function OverlapPreview({ shape, mode, baseColor, overlapColor }: {
  shape: number
  mode: number
  baseColor: string
  overlapColor: string
}) {
  const underRef = useRef<SVGPathElement>(null)
  const xorRef = useRef<SVGPathElement>(null)
  // The rAF loop reads the latest shape through this ref, so switching the
  // segmented control retunes the running glide without restarting it.
  const live = useRef({ shape })
  live.current = { shape }

  const hostRef = usePreviewLoop((t) => {
    const spread = (STAGE_R * 0.72) * Math.sin(t * 0.9)
    const lift = STAGE_R * 0.16 * Math.sin(t * 0.53)
    const a = shapeSubpath(live.current.shape, STAGE_W / 2 - spread, STAGE_H / 2 - lift, STAGE_R)
    const b = shapeSubpath(live.current.shape, STAGE_W / 2 + spread, STAGE_H / 2 + lift, STAGE_R)
    const d = `${a} ${b}`
    underRef.current?.setAttribute('d', d)
    xorRef.current?.setAttribute('d', d)
  })

  return (
    <div
      ref={hostRef}
      data-testid="overlap-shape-preview"
      className="relative h-[112px] overflow-hidden rounded-t-[9px] border-b border-white/[0.06] bg-[#05070c]"
    >
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          {/* The transparency checker the cut-out reads against. */}
          <pattern id="overlap-shape-checker" width="10" height="10" patternUnits="userSpaceOnUse">
            <rect width="10" height="10" fill="#0b0e16" />
            <rect width="5" height="5" fill="#151a26" />
            <rect x="5" y="5" width="5" height="5" fill="#151a26" />
          </pattern>
        </defs>
        <rect width={STAGE_W} height={STAGE_H} fill="url(#overlap-shape-checker)" />
        {mode === OVERLAP_MODE.color && (
          <path ref={underRef} fill={overlapColor} fillRule="nonzero" d="" />
        )}
        <path ref={xorRef} fill={baseColor} fillRule="evenodd" d="" />
      </svg>
    </div>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────

/** The guide's segmented control: one lit segment on a recessed track. */
function Segmented({ options, value, accent, ariaLabel, onChange }: {
  options: { value: number; label: string; title?: string }[]
  value: number
  accent: string
  ariaLabel: string
  onChange: (value: number) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex gap-[2px] rounded-[7px] border border-white/[0.07] bg-black/30 p-[2px]"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`h-[22px] flex-1 cursor-pointer rounded-[5px] px-1.5 text-[9px] font-semibold tracking-[0.08em] transition-colors ${
              active ? '' : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
            }`}
            style={active
              ? { background: withAlpha(accent, 0.22), color: towardWhite(accent, 0.6) }
              : undefined}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** The guide's console knob bound to one param. */
function ParamKnob({ parameter: bound, label, accent }: {
  parameter: UserInterfaceParameter
  label: string
  accent: string
}) {
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  return (
    <LaserKnob
      value={bound.value}
      min={definition.min}
      max={definition.max}
      step={definition.step}
      defaultValue={definition.default}
      curve={definition.curve ?? 1}
      label={label}
      ariaLabel={definition.label}
      accent={accent}
      onChange={bound.setValue}
    />
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

export const OverlapShapeUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const shape = parameter(parameters, 'shape')
  const size = parameter(parameters, 'size')
  const pulse = parameter(parameters, 'pulse')
  const baseColor = parameter(parameters, 'baseColor')
  const overlapMode = parameter(parameters, 'overlapMode')
  // showIf-gated on Color mode, so absent while Cut out - its absence must not
  // trip the fallback (this dir's guide).
  const overlapColor = parameter(parameters, 'overlapColor')

  if (!shape || !size || !pulse || !baseColor || !overlapMode) {
    return <ParameterList parameters={parameters} />
  }

  const accent = stringValue(baseColor, DEFAULT_OVERLAP_SHAPE_BASE_COLOR)
  const accentHsv = hexToHsv(accent)
  // Hue-true dark shade for the section wash, never an alpha tint (the guide).
  const shade = hsvToHex(accentHsv.h, Math.min(accentHsv.s, 0.5), 0.075)
  const spill = `radial-gradient(58% 30px at 50% 0, ${withAlpha(accent, 0.14)}, transparent)`

  const shapeN = overlapShapeIndex(numericValue(shape, 0))
  const modeN = numericValue(overlapMode, OVERLAP_MODE.cutOut)
  const overlapHex = stringValue(overlapColor, DEFAULT_OVERLAP_SHAPE_OVERLAP_COLOR)

  return (
    <section
      data-testid="overlap-shape-user-interface"
      className="-m-3 rounded-[9px]"
      style={{ background: shade }}
    >
      <OverlapPreview shape={shapeN} mode={modeN} baseColor={accent} overlapColor={overlapHex} />
      {/* The instrument's first decision: which flat shape it is. */}
      <div className="px-3 pb-1 pt-2.5" style={{ background: spill }}>
        <Segmented
          ariaLabel="Shape"
          options={OVERLAP_SHAPE_OPTIONS.map(({ value, label, short }) => ({ value, label: short, title: label }))}
          value={shapeN}
          accent={accent}
          onChange={(v) => shape.setValue(v)}
        />
      </div>
      {/* The console: size and note response, the fill pill on the right. */}
      <div className="flex items-end gap-4 px-4 pb-2 pt-1.5">
        <ParamKnob parameter={size} label="SIZE" accent={accent} />
        <ParamKnob parameter={pulse} label="PULSE" accent={accent} />
        <div className="ml-auto">
          <ColorWheelPill
            value={accent}
            onChange={(hex) => baseColor.setValue(hex)}
            label="COLOR"
            ariaLabel="Shape color"
            halo={`0 0 10px ${withAlpha(accent, 0.35)}`}
            align="right"
            pillTestId="overlap-shape-color-pill"
            wheelTestId="overlap-shape-color-wheel"
          />
        </div>
      </div>
      {/* What crossing copies do where they cover the same plane. */}
      <div className="flex items-end gap-4 px-4 pb-4 pt-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <Segmented
            ariaLabel="Overlap treatment"
            options={[
              { value: OVERLAP_MODE.cutOut, label: 'CUT OUT', title: 'Overlap punches through to whatever is behind' },
              { value: OVERLAP_MODE.color, label: 'COLOR', title: 'Overlap flips to a second color' },
            ]}
            value={modeN}
            accent={accent}
            onChange={(v) => overlapMode.setValue(v)}
          />
          <span className="mt-[3px] text-[8px] font-semibold tracking-[0.12em] text-white/40">OVERLAP</span>
        </div>
        {/* Present only in Color mode (showIf gates the param away in Cut
            out), so the second pill appears exactly when it matters. */}
        {overlapColor && (
          <ColorWheelPill
            value={overlapHex}
            onChange={(hex) => overlapColor.setValue(hex)}
            label="OVERLAP"
            ariaLabel="Overlap color"
            halo={`0 0 10px ${withAlpha(overlapHex, 0.35)}`}
            align="right"
            pillTestId="overlap-shape-overlap-pill"
            wheelTestId="overlap-shape-overlap-wheel"
          />
        )}
      </div>
    </section>
  )
}

'use client'

// Bespoke settings for Overlap Solid - the Overlap Shape panel's sibling, per
// docs/instrument-panel-design-guide.md: a live preview of two copies gliding
// through each other (their front-view projections drawn with the evenodd
// parity rule, torus holes included), over segmented SOLID and OVERLAP
// controls, a knob row (SIZE / PULSE / SHADE) and the color pills. A radial
// highlight on each projection is the one 3D tell the flat stage allows.

import { useEffect, useRef } from 'react'
import {
  DEFAULT_OVERLAP_SOLID_BASE_COLOR,
  DEFAULT_OVERLAP_SOLID_OVERLAP_COLOR,
  OVERLAP_SOLID_MODE,
} from '../instruments/OverlapSolid'
import {
  OVERLAP_SOLID_OPTIONS,
  OVERLAP_SOLID_TORUS_RADIUS,
  OVERLAP_SOLID_TORUS_TUBE,
  overlapSolidIndex,
} from '../instruments/overlapSolidCore'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { ColorWheelPill, hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
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

function circleSubpath(cx: number, cy: number, r: number): string {
  return `M${(cx - r).toFixed(2)} ${cy.toFixed(2)} a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0 a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0 Z`
}

/** A solid's front-view projection as SVG subpaths. The torus contributes its
 *  hole as a second subpath - evenodd then carves it, exactly like the volume
 *  test does in-scene. */
function solidProjection(solid: number, cx: number, cy: number, r: number): string {
  switch (overlapSolidIndex(solid)) {
    case 1: // cube
      return `M${(cx - r).toFixed(2)} ${(cy - r).toFixed(2)} h${(2 * r).toFixed(2)} v${(2 * r).toFixed(2)} h${(-2 * r).toFixed(2)} Z`
    case 2: { // cylinder (front view: a slightly narrow slab)
      const w = r * 0.82
      return `M${(cx - w).toFixed(2)} ${(cy - r).toFixed(2)} h${(2 * w).toFixed(2)} v${(2 * r).toFixed(2)} h${(-2 * w).toFixed(2)} Z`
    }
    case 3: // cone
      return `M${cx.toFixed(2)} ${(cy - r).toFixed(2)} L${(cx + r).toFixed(2)} ${(cy + r).toFixed(2)} H${(cx - r).toFixed(2)} Z`
    case 4: { // torus: outer disc + hole
      const outer = r * (OVERLAP_SOLID_TORUS_RADIUS + OVERLAP_SOLID_TORUS_TUBE)
      const inner = r * (OVERLAP_SOLID_TORUS_RADIUS - OVERLAP_SOLID_TORUS_TUBE)
      return `${circleSubpath(cx, cy, outer)} ${circleSubpath(cx, cy, inner)}`
    }
    default: // sphere
      return circleSubpath(cx, cy, r)
  }
}

function OverlapSolidPreview({ solid, mode, baseColor, overlapColor }: {
  solid: number
  mode: number
  baseColor: string
  overlapColor: string
}) {
  const underARef = useRef<SVGPathElement>(null)
  const underBRef = useRef<SVGPathElement>(null)
  const xorRef = useRef<SVGPathElement>(null)
  const live = useRef({ solid })
  live.current = { solid }

  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = (now - start) / 1000
      const spread = (STAGE_R * 0.72) * Math.sin(t * 0.9)
      const lift = STAGE_R * 0.16 * Math.sin(t * 0.53)
      const a = solidProjection(live.current.solid, STAGE_W / 2 - spread, STAGE_H / 2 - lift, STAGE_R)
      const b = solidProjection(live.current.solid, STAGE_W / 2 + spread, STAGE_H / 2 + lift, STAGE_R)
      // Underlay per copy (evenodd each) so the torus's own hole stays a hole;
      // the top path carries both outlines for the parity fill.
      underARef.current?.setAttribute('d', a)
      underBRef.current?.setAttribute('d', b)
      xorRef.current?.setAttribute('d', `${a} ${b}`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      data-testid="overlap-solid-preview"
      className="relative h-[112px] overflow-hidden rounded-t-[9px] border-b border-white/[0.06] bg-[#05070c]"
    >
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <pattern id="overlap-solid-checker" width="10" height="10" patternUnits="userSpaceOnUse">
            <rect width="10" height="10" fill="#0b0e16" />
            <rect width="5" height="5" fill="#151a26" />
            <rect x="5" y="5" width="5" height="5" fill="#151a26" />
          </pattern>
          {/* The 3D tell: a soft top-left highlight over whatever survives. */}
          <radialGradient id="overlap-solid-sheen" cx="0.38" cy="0.3" r="0.9">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
            <stop offset="0.55" stopColor="#ffffff" stopOpacity="0.05" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.22" />
          </radialGradient>
        </defs>
        <rect width={STAGE_W} height={STAGE_H} fill="url(#overlap-solid-checker)" />
        {mode === OVERLAP_SOLID_MODE.color && (
          <>
            <path ref={underARef} fill={overlapColor} fillRule="evenodd" d="" />
            <path ref={underBRef} fill={overlapColor} fillRule="evenodd" d="" />
          </>
        )}
        <path ref={xorRef} fill={baseColor} fillRule="evenodd" d="" />
        <rect width={STAGE_W} height={STAGE_H} fill="url(#overlap-solid-sheen)" style={{ mixBlendMode: 'soft-light' }} />
      </svg>
    </div>
  )
}

// ── Controls (the guide's segmented control + console knob) ────────────────

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

export const OverlapSolidUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const solid = parameter(parameters, 'solid')
  const size = parameter(parameters, 'size')
  const pulse = parameter(parameters, 'pulse')
  const shading = parameter(parameters, 'shading')
  const baseColor = parameter(parameters, 'baseColor')
  const overlapMode = parameter(parameters, 'overlapMode')
  // showIf-gated on Color mode; absence must not trip the fallback.
  const overlapColor = parameter(parameters, 'overlapColor')

  if (!solid || !size || !pulse || !shading || !baseColor || !overlapMode) {
    return <ParameterList parameters={parameters} />
  }

  const accent = stringValue(baseColor, DEFAULT_OVERLAP_SOLID_BASE_COLOR)
  const accentHsv = hexToHsv(accent)
  const shade = hsvToHex(accentHsv.h, Math.min(accentHsv.s, 0.5), 0.075)
  const spill = `radial-gradient(58% 30px at 50% 0, ${withAlpha(accent, 0.14)}, transparent)`

  const solidN = overlapSolidIndex(numericValue(solid, 0))
  const modeN = numericValue(overlapMode, OVERLAP_SOLID_MODE.cutOut)
  const overlapHex = stringValue(overlapColor, DEFAULT_OVERLAP_SOLID_OVERLAP_COLOR)

  return (
    <section
      data-testid="overlap-solid-user-interface"
      className="-m-3 rounded-[9px]"
      style={{ background: shade }}
    >
      <OverlapSolidPreview solid={solidN} mode={modeN} baseColor={accent} overlapColor={overlapHex} />
      <div className="px-3 pb-1 pt-2.5" style={{ background: spill }}>
        <Segmented
          ariaLabel="Solid"
          options={OVERLAP_SOLID_OPTIONS.map(({ value, label, short }) => ({ value, label: short, title: label }))}
          value={solidN}
          accent={accent}
          onChange={(v) => solid.setValue(v)}
        />
      </div>
      <div className="flex items-end gap-4 px-4 pb-2 pt-1.5">
        <ParamKnob parameter={size} label="SIZE" accent={accent} />
        <ParamKnob parameter={pulse} label="PULSE" accent={accent} />
        <ParamKnob parameter={shading} label="SHADE" accent={accent} />
        <div className="ml-auto">
          <ColorWheelPill
            value={accent}
            onChange={(hex) => baseColor.setValue(hex)}
            label="COLOR"
            ariaLabel="Solid color"
            halo={`0 0 10px ${withAlpha(accent, 0.35)}`}
            align="right"
            pillTestId="overlap-solid-color-pill"
            wheelTestId="overlap-solid-color-wheel"
          />
        </div>
      </div>
      <div className="flex items-end gap-4 px-4 pb-4 pt-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <Segmented
            ariaLabel="Overlap treatment"
            options={[
              { value: OVERLAP_SOLID_MODE.cutOut, label: 'CUT OUT', title: 'The shared volume punches a see-through window' },
              { value: OVERLAP_SOLID_MODE.color, label: 'COLOR', title: 'The shared volume flips to a second color' },
            ]}
            value={modeN}
            accent={accent}
            onChange={(v) => overlapMode.setValue(v)}
          />
          <span className="mt-[3px] text-[8px] font-semibold tracking-[0.12em] text-white/40">OVERLAP</span>
        </div>
        {overlapColor && (
          <ColorWheelPill
            value={overlapHex}
            onChange={(hex) => overlapColor.setValue(hex)}
            label="OVERLAP"
            ariaLabel="Overlap color"
            halo={`0 0 10px ${withAlpha(overlapHex, 0.35)}`}
            align="right"
            pillTestId="overlap-solid-overlap-pill"
            wheelTestId="overlap-solid-overlap-wheel"
          />
        )}
      </div>
    </section>
  )
}

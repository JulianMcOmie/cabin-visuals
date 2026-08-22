'use client'

// Bespoke settings for Overlap Shape, following docs/instrument-panel-design-guide.md:
// a live preview over the panel's decisions as segmented controls (SHAPE,
// OVERLAP treatment), a knob row (SIZE / PULSE) and the color pills. In cut-out
// mode the overlap region shows the checkerboard behind the stage: the
// universal "this is transparency" signal. The preview animates on rAF - panel
// chrome, exempt from the pause invariant (the guide's DOM-transform pattern).
//
// THE PREVIEW IS TWO PREVIEWS, because the instrument is two rules. At ORDERS 1
// it is the shipped one: two copies gliding across each other, drawn with SVG's
// evenodd fill rule, which IS the parity rule, so the picture can't lie about
// the semantics. Past 1 the rule counts instead, and a two-shape picture
// couldn't show a third color at all - so it becomes a ROSETTE of orders + 1
// copies breathing in and out of each other, where every depth the ramp names
// is on screen at once. Depth regions are painted as nested clipPaths (SVG has
// intersection only through clipping) in ASCENDING depth, so the deeper region
// simply paints over the shallower one it sits inside - the same "deepest wins"
// the stencil fills get from running deepest-first.

import { useId, useMemo, useRef } from 'react'
import {
  DEFAULT_OVERLAP_SHAPE_BASE_COLOR,
  DEFAULT_OVERLAP_SHAPE_DEEP_COLORS,
  DEFAULT_OVERLAP_SHAPE_OVERLAP_COLOR,
  OVERLAP_MODE,
} from '../instruments/OverlapShape'
import {
  OVERLAP_SHAPE_OPTIONS,
  overlapShapeCounted,
  overlapShapeFillParam,
  overlapShapeIndex,
  overlapShapeOrders,
  overlapShapePoints,
} from '../instruments/overlapShapeCore'
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

/** Every non-empty subset of `n` shapes, shallowest first: the paint order for
 *  the counted preview. Painting depth d before d+1 means a deeper region
 *  simply covers the shallower one containing it, which is how overlapping
 *  clip groups add up to "each region wears its own depth's color". */
function coverageGroups(n: number): { mask: number; depth: number; members: number[] }[] {
  const groups: { mask: number; depth: number; members: number[] }[] = []
  for (let mask = 1; mask < 1 << n; mask++) {
    const members: number[] = []
    for (let i = 0; i < n; i++) if (mask & (1 << i)) members.push(i)
    groups.push({ mask, depth: members.length, members })
  }
  return groups.sort((a, b) => a.depth - b.depth)
}

/**
 * The counted rule's preview: `colors.length` copies arranged as a rosette that
 * breathes in and out of itself, so the whole ramp - a lone shape, two crossing,
 * three, up to the deepest color - is visible at once and moving. Each region is
 * an intersection, which SVG can only say by NESTING clipPaths, one per shape in
 * the subset; the innermost path is the one that paints.
 */
function CountedPreview({ shape, colors }: { shape: number; colors: string[] }) {
  const uid = useId().replace(/:/g, '')
  const count = colors.length
  const groups = useMemo(() => coverageGroups(count), [count])
  const clipRefs = useRef<(SVGPathElement | null)[]>([])
  const fillRefs = useRef(new Map<number, { el: SVGPathElement; shape: number }>())
  const live = useRef({ shape })
  live.current = { shape }

  const hostRef = usePreviewLoop((t) => {
    // Radius small enough that `count` copies plus their spread still clear the
    // stage; the breath crosses the point where every copy holds the center, so
    // the deepest region opens and closes rather than sitting there.
    const r = STAGE_R * 0.72
    const spread = r * (0.62 + 0.42 * Math.sin(t * 0.55))
    const spin = t * 0.22
    const paths = Array.from({ length: count }, (_, i) => {
      const a = spin + (i * 2 * Math.PI) / count
      return shapeSubpath(
        live.current.shape,
        STAGE_W / 2 + Math.cos(a) * spread,
        STAGE_H / 2 + Math.sin(a) * spread * 0.62,
        r,
      )
    })
    clipRefs.current.forEach((el, i) => el?.setAttribute('d', paths[i] ?? ''))
    for (const { el, shape: index } of fillRefs.current.values()) {
      el.setAttribute('d', paths[index] ?? '')
    }
  })

  return (
    <div
      ref={hostRef}
      data-testid="overlap-shape-preview"
      className="relative h-[112px] overflow-clip rounded-t-[9px] border-b border-white/[0.06] bg-[#05070c]"
    >
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          {Array.from({ length: count }, (_, i) => (
            <clipPath key={i} id={`${uid}-c${i}`}>
              <path ref={(el) => { clipRefs.current[i] = el }} d="" />
            </clipPath>
          ))}
        </defs>
        <rect width={STAGE_W} height={STAGE_H} fill="#05070c" />
        {groups.map(({ mask, depth, members }) => {
          const last = members[members.length - 1]
          // Depth past the last color HOLDS it - the panel's picture and the
          // stencil's deepest fill make the same promise.
          let node = (
            <path
              key="fill"
              ref={(el) => {
                if (el) fillRefs.current.set(mask, { el, shape: last })
                else fillRefs.current.delete(mask)
              }}
              d=""
              fill={colors[Math.min(depth, colors.length) - 1]}
            />
          )
          for (const member of members.slice(0, -1)) {
            node = <g key={member} clipPath={`url(#${uid}-c${member})`}>{node}</g>
          }
          return <g key={mask}>{node}</g>
        })}
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
  // showIf-gated on Color mode, so absent while Cut out - their absence must
  // not trip the fallback (this dir's guide). The per-depth colors past the
  // first can only gate on the same mode, so the ORDERS knob is what reveals
  // them here.
  const overlapColor = parameter(parameters, 'overlapColor')
  const overlapOrders = parameter(parameters, 'overlapOrders')
  const deepColors = [3, 4, 5].map((depth) => parameter(parameters, overlapShapeFillParam(depth)))

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
  const ordersN = overlapShapeOrders(numericValue(overlapOrders, 1))
  const counted = overlapShapeCounted(modeN >= OVERLAP_MODE.color, ordersN)
  // The pills the count actually reaches, deepest last: depth 1 is the shape's
  // own COLOR pill above, so this ramp starts at the first overlap color.
  const depthPills = counted
    ? [overlapColor, ...deepColors].slice(0, ordersN).filter((p) => p != null)
    : []
  // The rosette needs the whole ramp INCLUDING the base, indexed by depth.
  const rampHexes = [
    accent,
    overlapHex,
    ...deepColors.map((p, i) => stringValue(p, DEFAULT_OVERLAP_SHAPE_DEEP_COLORS[i])),
  ].slice(0, ordersN + 1)

  return (
    <section
      data-testid="overlap-shape-user-interface"
      className="-m-3 rounded-[9px]"
      style={{ background: shade }}
    >
      {counted
        ? <CountedPreview shape={shapeN} colors={rampHexes} />
        : <OverlapPreview shape={shapeN} mode={modeN} baseColor={accent} overlapColor={overlapHex} />}
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
      <div className={`flex items-end gap-4 px-4 pt-1 ${counted ? 'pb-2' : 'pb-4'}`}>
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
        {/* How many colors deep the count goes. Present only in Color mode,
            where it is also what turns the counted rule on at all. */}
        {overlapOrders && (
          <ParamKnob parameter={overlapOrders} label="ORDERS" accent={accent} />
        )}
        {/* One overlap color stays INLINE, the way it always has - the common
            case keeps its short panel. A ramp gets a row of its own below. */}
        {overlapColor && !counted && (
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
      {/* The ramp: one pill per coverage depth the count colors, labelled by
          how many shapes have to cross to reach it. The deepest wears a "+"
          because everything past it holds that color. */}
      {depthPills.length > 0 && (
        <div
          data-testid="overlap-shape-depth-ramp"
          className="flex flex-wrap items-end justify-center gap-3 px-4 pb-4"
        >
          {depthPills.map((pill, i) => {
            const hex = stringValue(
              pill,
              i === 0 ? DEFAULT_OVERLAP_SHAPE_OVERLAP_COLOR : DEFAULT_OVERLAP_SHAPE_DEEP_COLORS[i - 1],
            )
            const depth = i + 2
            const deepest = i === depthPills.length - 1
            return (
              <ColorWheelPill
                key={pill!.definition.key}
                value={hex}
                onChange={(next) => pill!.setValue(next)}
                label={`${depth}×${deepest ? '+' : ''}`}
                ariaLabel={deepest
                  ? `Color for ${depth} or more shapes crossing`
                  : `Color for ${depth} shapes crossing`}
                halo={`0 0 10px ${withAlpha(hex, 0.35)}`}
                align={i === 0 ? 'left' : 'right'}
                pillTestId={`overlap-shape-depth-${depth}-pill`}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

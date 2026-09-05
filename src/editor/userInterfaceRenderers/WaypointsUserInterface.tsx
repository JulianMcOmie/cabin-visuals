'use client'

// Waypoints' bespoke panel: a live 2D field editor above the controls. The pad
// shows the laid-out positions exactly as the mover computes them (same
// waypointPositions call the engine makes), numbered in travel order with the
// path drawn between them, centered on the object's home (the crosshair). In
// Custom layout the dots are draggable and write the posNX/posNY params; the
// preset layouts render read-only with Spread as their one size handle.

import { useRef, useState, type PointerEvent } from 'react'
import { isNumberParam } from '../instruments/types'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import {
  MAX_WAYPOINTS,
  WAYPOINT_CURVE_LABELS,
  WAYPOINT_CURVE_SPRING,
  WAYPOINT_LAYOUT_CUSTOM,
  waypointPositions,
  waypointsMover,
  type WaypointsSettings,
} from '../core/visualCopies/waypoints'
import { WAYPOINTS_COLOR } from '../core/visualCopies/identityColors'
import { LaserKnob } from './laserKnob'
import { withAlpha } from './colorWheel'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const ACCENT = WAYPOINTS_COLOR

const CURVE_HINTS: Record<number, string> = {
  0: 'EXPO OUT · HITS ON THE NOTE, LONG SETTLE',
  1: 'SHEET CURVE · BIG-SURFACE TRAVEL',
  2: 'BACK OUT · POPS PAST, SETTLES',
  3: 'CRITICAL SPRING · CARRIES VELOCITY, NO OVERSHOOT',
  4: 'UNDERDAMPED SPRING · OVERSHOOTS AND RINGS',
}

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((p) => p.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return bound && typeof bound.value === 'number' ? bound.value : fallback
}

function Segmented({ bound, labels, name }: {
  bound: UserInterfaceParameter
  labels: readonly string[]
  name: string
}) {
  const selected = typeof bound.value === 'number' ? Math.round(bound.value) : 0
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className="flex gap-[2px] rounded-[7px] border border-white/[0.07] bg-black/30 p-[2px]"
    >
      {labels.map((label, value) => {
        const active = value === selected
        return (
          <button
            key={label}
            role="radio"
            aria-checked={active}
            onClick={() => bound.setValue(value)}
            className={`h-6 min-w-0 flex-1 cursor-pointer truncate rounded-[5px] px-1 text-[9px] font-semibold tracking-[0.1em] ${
              active ? '' : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
            }`}
            style={active ? { background: withAlpha(ACCENT, 0.22), color: '#e9f5cf' } : undefined}
          >
            {label.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}

function ParamKnob({ parameter: bound, label, large = false }: {
  parameter: UserInterfaceParameter
  label: string
  large?: boolean
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
      accent={ACCENT}
      large={large}
      onChange={bound.setValue}
    />
  )
}

/** The field pad: SVG so world→view is one transform. World +y is up; the pad
 *  flips it. Extent auto-fits the field (frozen while dragging so the scale
 *  doesn't squirm under the pointer). */
function FieldPad({
  settings,
  customBounds,
  editable,
}: {
  settings: WaypointsSettings
  /** posNX/posNY bounds when the Custom layout has them visible. */
  customBounds: Map<string, UserInterfaceParameter>
  editable: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const dragExtentRef = useRef<number | null>(null)

  const points = waypointPositions(settings)
  const liveExtent = Math.max(1.5, ...points.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)))) * 1.25
  const extent = dragIndex != null && dragExtentRef.current != null ? dragExtentRef.current : liveExtent

  const toView = ([x, y]: [number, number]): [number, number] => [x / extent, -y / extent]

  const moveTo = (index: number, e: PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const vx = ((e.clientX - rect.left) / rect.width) * 2.3 - 1.15
    const vy = ((e.clientY - rect.top) / rect.height) * 2.3 - 1.15
    const clampWorld = (v: number) => Math.max(-20, Math.min(20, Math.round(v * extent * 10) / 10))
    customBounds.get(`pos${index + 1}X`)?.setValue(clampWorld(vx))
    customBounds.get(`pos${index + 1}Y`)?.setValue(clampWorld(-vy))
  }

  return (
    <div className="relative overflow-hidden rounded-[10px] border border-white/[0.08]" style={{ background: '#0a0c11' }}>
      <svg
        ref={svgRef}
        viewBox="-1.15 -1.15 2.3 2.3"
        className="block aspect-square w-full select-none"
      >
        {/* Home crosshair: the object's placement, the field's center. */}
        <line x1="-1.15" y1="0" x2="1.15" y2="0" stroke="rgba(255,255,255,0.06)" strokeWidth="0.008" />
        <line x1="0" y1="-1.15" x2="0" y2="1.15" stroke="rgba(255,255,255,0.06)" strokeWidth="0.008" />

        {/* The travel order, drawn as the path between positions. */}
        <polyline
          points={points.map((p) => toView(p).join(',')).join(' ')}
          fill="none"
          stroke={withAlpha(ACCENT, 0.28)}
          strokeWidth="0.014"
          strokeLinejoin="round"
          strokeDasharray="0.035 0.03"
        />

        {points.map((p, i) => {
          const [vx, vy] = toView(p)
          const dragging = dragIndex === i
          return (
            <g
              key={i}
              transform={`translate(${vx} ${vy})`}
              className={editable ? 'cursor-grab' : undefined}
              style={dragging ? { cursor: 'grabbing' } : undefined}
              onPointerDown={editable ? (e) => {
                e.preventDefault()
                ;(e.currentTarget as unknown as Element).setPointerCapture(e.pointerId)
                dragExtentRef.current = extent
                setDragIndex(i)
              } : undefined}
              onPointerMove={editable ? (e) => { if (dragIndex === i) moveTo(i, e) } : undefined}
              onPointerUp={editable ? () => { setDragIndex(null); dragExtentRef.current = null } : undefined}
            >
              <circle
                r={i === 0 ? 0.085 : 0.075}
                fill={i === 0 ? withAlpha(ACCENT, 0.3) : 'rgba(10,12,17,0.9)'}
                stroke={dragging ? '#ffffff' : i === 0 ? ACCENT : withAlpha(ACCENT, 0.65)}
                strokeWidth="0.012"
              />
              <text
                y="0.028"
                textAnchor="middle"
                fontSize="0.08"
                fontFamily="var(--font-plex-mono), monospace"
                fill={i === 0 ? '#f0f7dd' : withAlpha(ACCENT, 0.9)}
              >
                {i + 1}
              </text>
            </g>
          )
        })}
      </svg>
      <span className="pointer-events-none absolute bottom-1.5 left-2 font-mono text-[8px] uppercase tracking-[0.12em] text-white/25">
        {editable ? 'Drag positions' : 'Custom layout to drag'}
      </span>
    </div>
  )
}

export const WaypointsUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const layout = parameter(parameters, 'layout')
  const positions = parameter(parameters, 'positions')
  const spread = parameter(parameters, 'spread')
  const curve = parameter(parameters, 'curve')
  const travel = parameter(parameters, 'travelBeats')
  const bounce = parameter(parameters, 'bounce')

  // The guide's fallback rule: a missing key means the plain list.
  if (!layout || !positions || !spread || !curve || !travel) return <ParameterList parameters={parameters} />

  // The pad runs the definition's own layout math - panel values over defaults.
  const settings = {
    ...(mergeDefinitionSettings(waypointsMover, undefined) as unknown as WaypointsSettings),
    ...Object.fromEntries(parameters
      .filter((p) => typeof p.value === 'number')
      .map((p) => [p.definition.key, p.value as number])),
  } as WaypointsSettings

  const custom = Math.round(numericValue(layout)) === WAYPOINT_LAYOUT_CUSTOM
  const customBounds = new Map<string, UserInterfaceParameter>()
  for (let i = 1; i <= MAX_WAYPOINTS; i++) {
    const x = parameter(parameters, `pos${i}X`)
    const y = parameter(parameters, `pos${i}Y`)
    if (x) customBounds.set(`pos${i}X`, x)
    if (y) customBounds.set(`pos${i}Y`, y)
  }

  const curveValue = Math.round(numericValue(curve))
  const spring = curveValue === WAYPOINT_CURVE_SPRING

  return (
    <section data-testid="waypoints-user-interface" className="flex flex-col gap-2.5">
      <FieldPad settings={settings} customBounds={customBounds} editable={custom && customBounds.size > 0} />

      <Segmented bound={layout} labels={['Line', 'Grid', 'Ring', 'Custom']} name="Layout" />
      <Segmented bound={curve} labels={WAYPOINT_CURVE_LABELS} name="Curve" />
      <p className="m-0 text-center font-mono text-[8px] uppercase tracking-[0.14em] text-white/30">
        {CURVE_HINTS[curveValue] ?? ''}
      </p>

      <div className="flex items-start justify-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.025] px-2 py-2">
        <ParamKnob parameter={positions} label="POINTS" large />
        {!custom && <ParamKnob parameter={spread} label="SPREAD" />}
        <ParamKnob parameter={travel} label="TRAVEL" />
        {spring && bounce && <ParamKnob parameter={bounce} label="BOUNCE" />}
      </div>
    </section>
  )
}

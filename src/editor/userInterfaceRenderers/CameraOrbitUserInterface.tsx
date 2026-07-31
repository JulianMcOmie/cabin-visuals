'use client'

import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isNumberParam } from '../instruments/types'
import { ParamControl } from './ParameterControl'
import { LaserKnob } from './laserKnob'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for Camera Orbit, built around the two angles: a top-down
// ORBIT plan (drag the rig around the ring to set the angle, in or out to set
// the distance) and a side HEIGHT arc (drag up the arc to lift the rig).
//
// Both views draw the aim as a dashed line back to the center, because that is
// the instrument's whole promise - move the rig anywhere on either diagram and
// the line still lands on the subject. Making the invariant visible is the point
// of the panel; a stack of numeric fields would hide it.
//
// Purely presentational: every value flows through the passed parameters.

const ACCENT = '#818cf8'
const DEG = Math.PI / 180

const clampValue = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function findParam(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numberOf(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

/** A parameter narrowed to the numeric shape both pads need. */
interface NumericBound {
  value: number
  min: number
  max: number
  step: number
  default: number
  label: string
  setValue: (value: number) => void
}

function numeric(bound: UserInterfaceParameter | undefined): NumericBound | null {
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  const { min, max, step, default: fallback, label } = bound.definition
  return { value: bound.value, min, max, step, default: fallback, label, setValue: bound.setValue }
}

function commit(bound: NumericBound, raw: number) {
  const snapped = bound.min + Math.round((raw - bound.min) / bound.step) * bound.step
  bound.setValue(clampValue(Number(snapped.toFixed(6)), bound.min, bound.max))
}

/** Shared chrome for the two drag pads. */
function Pad({ label, hint, readout, ariaLabel, aria, onPoint, onArrow, onReset, children }: {
  label: string
  hint: string
  readout: string
  ariaLabel: string
  aria: { min: number; max: number; now: number }
  onPoint: (nx: number, ny: number) => void
  onArrow: (direction: 1 | -1, axis: 'horizontal' | 'vertical') => void
  onReset: () => void
  children: ReactNode
}) {
  const padRef = useRef<HTMLDivElement>(null)

  const point = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return
    onPoint(((event.clientX - rect.left) / rect.width) * 100, ((event.clientY - rect.top) / rect.height) * 100)
  }

  return (
    <div className="mx-auto min-w-0 w-full max-w-[176px] flex-1">
      <div className="mb-1.5 flex items-baseline justify-between gap-1">
        <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">{label}</span>
        <span className="truncate text-[8px] text-[var(--text-muted)]">{hint}</span>
      </div>
      {/* Kept square: the pads draw circles, and a stretched box would turn the
          orbit ring into an ellipse the rig slides around at the wrong speed. */}
      <div
        ref={padRef}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={aria.min}
        aria-valuemax={aria.max}
        aria-valuenow={aria.now}
        aria-valuetext={readout}
        title={`${ariaLabel} · drag · double-click to reset · arrow keys nudge`}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          point(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) point(event)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onDoubleClick={onReset}
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
          event.preventDefault()
          const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
          const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1
          onArrow(direction, horizontal ? 'horizontal' : 'vertical')
        }}
        className="relative mx-auto aspect-square w-full max-w-[176px] cursor-crosshair touch-none select-none overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-app)] outline-none transition-colors hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)]"
      >
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-0 h-full w-full">
          {children}
        </svg>
        <span className="pointer-events-none absolute bottom-0.5 left-1.5 font-mono text-[8px] text-[var(--text-muted)]">{readout}</span>
      </div>
    </div>
  )
}

/** Where the rig sits on a pad, drawn as a body with a lens nub pointed at the
 *  center, plus the dashed aim line it can never lose. */
function Rig({ x, y, aimX, aimY }: { x: number; y: number; aimX: number; aimY: number }) {
  const heading = (Math.atan2(aimY - y, aimX - x) * 180) / Math.PI
  return (
    <>
      <line
        x1={x} y1={y} x2={aimX} y2={aimY}
        stroke={ACCENT} strokeOpacity={0.55} strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke"
      />
      <g transform={`translate(${x} ${y}) rotate(${heading.toFixed(1)})`}>
        <rect x={-4} y={-3.4} width={7} height={6.8} rx={1.4} fill="var(--text-2)" stroke={ACCENT} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <rect x={3} y={-1.8} width={2.6} height={3.6} fill={ACCENT} />
      </g>
    </>
  )
}

/** The subject: the point being orbited and looked at. */
function Subject({ x, y }: { x: number; y: number }) {
  return (
    <>
      <circle cx={x} cy={y} r={2.2} fill="var(--text-muted)" />
      <circle cx={x} cy={y} r={5.5} fill="none" stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
    </>
  )
}

/**
 * Pad radius for a distance, so the ring visibly grows as the rig backs off.
 *
 * Curved, not linear: the range runs to 60 but almost every useful shot lives
 * under 15, and a linear map crushes all of those into the first quarter-inch of
 * travel - the ring barely clears the subject and dragging it is a nudge war.
 */
const MIN_RADIUS = 12
const MAX_RADIUS = 42
const RADIUS_CURVE = 2.5
function radiusFor(distance: NumericBound) {
  const span = distance.max - distance.min
  const norm = span === 0 ? 0 : clampValue((distance.value - distance.min) / span, 0, 1)
  return MIN_RADIUS + Math.pow(norm, 1 / RADIUS_CURVE) * (MAX_RADIUS - MIN_RADIUS)
}
function distanceForRadius(distance: NumericBound, radius: number) {
  const norm = clampValue((radius - MIN_RADIUS) / (MAX_RADIUS - MIN_RADIUS), 0, 1)
  return distance.min + Math.pow(norm, RADIUS_CURVE) * (distance.max - distance.min)
}

/** Top-down plan: the ring the rig travels, with the rig on it. Up the pad is
 *  -Z (deep stage), matching the Camera panel's stage pad. */
function OrbitPad({ azimuth, distance }: { azimuth: NumericBound; distance: NumericBound }) {
  const radius = radiusFor(distance)
  const angle = azimuth.value * DEG
  // World +Z is toward the viewer, which is DOWN the pad - so azimuth 0 parks
  // the rig at the bottom, exactly where the scene's stock camera stands.
  const x = 50 + Math.sin(angle) * radius
  const y = 50 + Math.cos(angle) * radius

  return (
    <Pad
      label="ORBIT"
      hint="top view · drag around"
      readout={`${azimuth.value.toFixed(0)}°   ${distance.value.toFixed(1)} away`}
      ariaLabel="Orbit angle and distance"
      aria={{ min: azimuth.min, max: azimuth.max, now: azimuth.value }}
      onPoint={(nx, ny) => {
        const dx = nx - 50
        const dy = ny - 50
        const length = Math.hypot(dx, dy)
        // Dead zone at the middle: an angle derived from a two-pixel radius is
        // noise, and dropping the pointer on the subject shouldn't spin the rig.
        if (length > 3) commit(azimuth, (Math.atan2(dx, dy) * 180) / Math.PI)
        commit(distance, distanceForRadius(distance, length))
      }}
      onArrow={(direction, axis) => {
        if (axis === 'horizontal') commit(azimuth, azimuth.value + direction * azimuth.step)
        else commit(distance, distance.value - direction * distance.step)
      }}
      onReset={() => { azimuth.setValue(azimuth.default); distance.setValue(distance.default) }}
    >
      <circle cx={50} cy={50} r={radius} fill="none" stroke="var(--border-subtle)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <Subject x={50} y={50} />
      <Rig x={x} y={y} aimX={50} aimY={50} />
    </Pad>
  )
}

/** Side elevation: the arc the rig climbs, from below the subject to above it. */
function HeightPad({ elevation, distance }: { elevation: NumericBound; distance: NumericBound }) {
  const radius = radiusFor(distance)
  const angle = elevation.value * DEG
  const x = 50 + Math.cos(angle) * radius
  const y = 50 - Math.sin(angle) * radius
  const top = { x: 50 + Math.cos(elevation.max * DEG) * radius, y: 50 - Math.sin(elevation.max * DEG) * radius }
  const bottom = { x: 50 + Math.cos(elevation.min * DEG) * radius, y: 50 - Math.sin(elevation.min * DEG) * radius }
  // Sweep flag 0: the arc must bulge RIGHT, through the level shot at 0°, which
  // is the half of the circle the rig actually travels.
  const arcPath = `M ${bottom.x.toFixed(2)} ${bottom.y.toFixed(2)} A ${radius} ${radius} 0 0 0 ${top.x.toFixed(2)} ${top.y.toFixed(2)}`

  return (
    <Pad
      label="HEIGHT"
      hint="side view · drag up the arc"
      readout={`${elevation.value.toFixed(0)}° ${elevation.value > 1 ? 'above' : elevation.value < -1 ? 'below' : 'level'}`}
      ariaLabel="Orbit height angle"
      aria={{ min: elevation.min, max: elevation.max, now: elevation.value }}
      onPoint={(nx, ny) => {
        const dx = nx - 50
        const dy = 50 - ny
        if (Math.hypot(dx, dy) <= 3) return
        commit(elevation, clampValue((Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI, elevation.min, elevation.max))
      }}
      onArrow={(direction, axis) => {
        if (axis === 'vertical') commit(elevation, elevation.value + direction * elevation.step)
      }}
      onReset={() => elevation.setValue(elevation.default)}
    >
      {/* The ground the subject stands on, for a sense of up. */}
      <line x1={6} y1={50} x2={94} y2={50} stroke="var(--border-subtle)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path
        d={arcPath}
        fill="none" stroke="var(--border-subtle)" strokeWidth={1} vectorEffect="non-scaling-stroke"
      />
      <Subject x={50} y={50} />
      <Rig x={x} y={y} aimX={50} aimY={50} />
    </Pad>
  )
}

/** One coordinate of the center, dragged vertically - the Camera panel's cell. */
function AxisCell({ bound, axis }: { bound: UserInterfaceParameter | undefined; axis: string }) {
  const dragRef = useRef<{ y: number; value: number } | null>(null)
  const value = numeric(bound)
  if (!value) return null
  const range = value.max - value.min

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={value.label}
      aria-valuemin={value.min}
      aria-valuemax={value.max}
      aria-valuenow={value.value}
      title={`${value.label} · drag vertically · double-click to reset`}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { y: event.clientY, value: value.value }
      }}
      onPointerMove={(event) => {
        if (!dragRef.current) return
        commit(value, dragRef.current.value + ((dragRef.current.y - event.clientY) / 160) * range)
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => value.setValue(value.default)}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
        event.preventDefault()
        const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
        commit(value, value.value + direction * value.step)
      }}
      className="flex min-w-0 cursor-ns-resize touch-none select-none flex-col items-center gap-0.5 rounded border border-[var(--border)] bg-[var(--bg-app)] py-1.5 outline-none transition-colors hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)]"
    >
      <span className="text-[8px] font-semibold tracking-[0.1em] text-[var(--text-muted)]">{axis}</span>
      <span className="font-mono text-[11px] tabular-nums text-[var(--text-2)]">{value.value.toFixed(1)}</span>
    </div>
  )
}

function BoundKnob({ bound, label, suffix, large }: {
  bound: UserInterfaceParameter | undefined
  label: string
  suffix?: string
  large?: boolean
}) {
  const value = numeric(bound)
  if (!value) return null
  return (
    <LaserKnob
      value={value.value}
      min={value.min}
      max={value.max}
      step={value.step}
      defaultValue={value.default}
      label={label}
      ariaLabel={value.label}
      accent={ACCENT}
      suffix={suffix}
      large={large}
      onChange={value.setValue}
    />
  )
}

function Segmented({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound || bound.definition.type !== 'select') return null
  return (
    <div className="flex rounded border border-[var(--border)] p-0.5">
      {bound.definition.options.map((option) => {
        const active = Math.round(numberOf(bound)) === option.value
        return (
          <button
            key={option.value}
            onClick={() => bound.setValue(option.value)}
            aria-pressed={active}
            className={`flex-1 cursor-pointer rounded-[2px] py-1 text-[10px] transition-colors ${active
              ? 'bg-[var(--bg-elevated)] text-[var(--text)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

const PLACED = new Set([
  'centerX', 'centerY', 'centerZ', 'distance', 'azimuth', 'elevation',
  'fov', 'swingSpeed', 'tiltSpeed', 'returnBeats', 'returnEase',
])

export const CameraOrbitUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const azimuth = numeric(findParam(parameters, 'azimuth'))
  const elevation = numeric(findParam(parameters, 'elevation'))
  const distance = numeric(findParam(parameters, 'distance'))
  const fov = numberOf(findParam(parameters, 'fov'), 55)
  const leftovers = parameters.filter((bound) => !PLACED.has(bound.definition.key))

  return (
    <section data-testid="camera-orbit-user-interface" className="mb-3">
      {azimuth && elevation && distance && (
        <div className="mb-3 flex gap-2">
          <OrbitPad azimuth={azimuth} distance={distance} />
          <HeightPad elevation={elevation} distance={distance} />
        </div>
      )}

      {/* --- What it circles, and what it therefore points at --- */}
      <div className="mb-3">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">CENTER</span>
          <span className="text-[8px] text-[var(--text-muted)]">orbited · and always aimed at</span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <AxisCell bound={findParam(parameters, 'centerX')} axis="X" />
          <AxisCell bound={findParam(parameters, 'centerY')} axis="Y" />
          <AxisCell bound={findParam(parameters, 'centerZ')} axis="Z" />
        </div>
      </div>

      {/* --- How far a held note travels, and how it comes back --- */}
      <div className="mb-3 border-t border-[var(--border-subtle)] pt-3">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">MOTION</span>
          <span className="text-[8px] text-[var(--text-muted)]">hold a row to travel · chord to combine</span>
        </div>
        <div className="flex items-start justify-around gap-1">
          <BoundKnob bound={findParam(parameters, 'swingSpeed')} label="SWING" large />
          <BoundKnob bound={findParam(parameters, 'tiltSpeed')} label="TILT" />
          <BoundKnob bound={findParam(parameters, 'returnBeats')} label="RETURN" suffix="b" />
        </div>
        <div className="mt-2">
          <span className="mb-1 block text-[9px] tracking-[0.06em] text-[var(--text-muted)] select-none">RETURN EASE</span>
          <Segmented bound={findParam(parameters, 'returnEase')} />
        </div>
      </div>

      {/* --- Lens, with the same focal-feel readout the Camera panel uses --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">LENS</span>
          <span className="font-mono text-[9px] text-[var(--text-muted)]">
            {fov <= 30 ? 'tele' : fov <= 70 ? 'normal' : 'wide'}
          </span>
        </div>
        <div className="flex justify-start">
          <BoundKnob bound={findParam(parameters, 'fov')} label="FOV" />
        </div>
      </div>

      {/* Anything the layout does not know about still gets a control. */}
      {leftovers.length > 0 && (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
          {leftovers.map((bound) => {
            const isNumber = typeof bound.value === 'number'
            return (
              <ParamControl
                key={bound.definition.key}
                param={bound.definition}
                numValue={isNumber ? (bound.value as number) : undefined}
                strValue={isNumber ? undefined : (bound.value as string)}
                onNum={bound.setValue}
                onStr={bound.setValue}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

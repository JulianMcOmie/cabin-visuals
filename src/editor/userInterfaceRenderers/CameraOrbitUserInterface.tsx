'use client'

import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isNumberParam } from '../instruments/types'
import { DEFAULT_ORBIT_AXIS, ORBIT_AXES } from '../instruments/cameraOrbitCore'
import { ParamControl } from './ParameterControl'
import { LaserKnob } from './laserKnob'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for Camera Orbit, built around the ring the rig walks: an
// axis picker (which axis it circles, and so which plane its travel stays
// parallel to), then the two views a camera department would draw - the RING
// looking straight down that axis, and the PROFILE from the side.
//
// Both views draw the aim as a dashed line back to the center, because that is
// the instrument's whole promise: move the rig anywhere on either diagram and
// the line still lands on the subject. The profile draws a second dashed line
// straight across at the rig's standoff, because "circles parallel to the plane"
// is a claim about that line, and a picture states it where a number cannot.
// Making the invariants visible is the point of the panel; a stack of numeric
// fields would hide both of them.
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
        className="relative mx-auto aspect-square w-full max-w-[176px] cursor-crosshair touch-none select-none overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-app)] outline-none hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)]"
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
 * Pad offset for a world distance. Signed, and 0 maps to 0 so the rig sits
 * exactly on the axis at radius 0 and exactly on the plane at standoff 0 -
 * which are the two poses the diagrams have to state clearly.
 *
 * Curved, not linear: the ranges run to 60 but almost every useful shot lives
 * under 15, and a linear map crushes all of those into the first quarter-inch of
 * travel - the ring barely clears the subject and dragging it is a nudge war.
 */
const PAD_REACH = 42
const PAD_SCALE = 60
const PAD_CURVE = 2.5
function padOffset(worldValue: number) {
  const norm = clampValue(Math.abs(worldValue) / PAD_SCALE, 0, 1)
  return Math.sign(worldValue) * Math.pow(norm, 1 / PAD_CURVE) * PAD_REACH
}
function worldOffset(padValue: number) {
  const norm = clampValue(Math.abs(padValue) / PAD_REACH, 0, 1)
  return Math.sign(padValue) * Math.pow(norm, PAD_CURVE) * PAD_SCALE
}

/** Looking straight down the orbit axis: the ring the rig walks, with the rig on
 *  it. Drag around for the angle, in and out for the radius. */
function OrbitPad({ azimuth, radius }: { azimuth: NumericBound; radius: NumericBound }) {
  const ring = padOffset(radius.value)
  const angle = azimuth.value * DEG
  const x = 50 + Math.sin(angle) * ring
  const y = 50 + Math.cos(angle) * ring

  return (
    <Pad
      label="RING"
      hint="down the axis · drag around"
      readout={`${azimuth.value.toFixed(0)}°   r ${radius.value.toFixed(1)}`}
      ariaLabel="Orbit angle and radius"
      aria={{ min: azimuth.min, max: azimuth.max, now: azimuth.value }}
      onPoint={(nx, ny) => {
        const dx = nx - 50
        const dy = ny - 50
        const length = Math.hypot(dx, dy)
        // Dead zone at the middle: an angle derived from a two-pixel radius is
        // noise, and dropping the pointer on the subject shouldn't spin the rig.
        if (length > 3) commit(azimuth, (Math.atan2(dx, dy) * 180) / Math.PI)
        commit(radius, worldOffset(length))
      }}
      onArrow={(direction, axis) => {
        if (axis === 'horizontal') commit(azimuth, azimuth.value + direction * azimuth.step)
        else commit(radius, radius.value - direction * radius.step)
      }}
      onReset={() => { azimuth.setValue(azimuth.default); radius.setValue(radius.default) }}
    >
      <circle cx={50} cy={50} r={Math.max(0.5, ring)} fill="none" stroke="var(--border-subtle)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <Subject x={50} y={50} />
      <Rig x={x} y={y} aimX={50} aimY={50} />
    </Pad>
  )
}

/**
 * The side profile, and the pad that makes the shot legible: the plane the
 * subject sits in runs across, the orbit axis runs up, and the rig is placed by
 * radius (across) and standoff (up). The dashed line through the rig is the
 * standoff it HOLDS - the whole lap happens along that line, which is the
 * property "circles parallel to the plane" actually means.
 */
function ProfilePad({ standoff, radius }: { standoff: NumericBound; radius: NumericBound }) {
  const x = 50 + padOffset(radius.value)
  const y = 50 - padOffset(standoff.value)

  return (
    <Pad
      label="PROFILE"
      hint="side view · drag to place"
      readout={`${standoff.value.toFixed(1)} off plane`}
      ariaLabel="Standoff from the plane, and orbit radius"
      aria={{ min: standoff.min, max: standoff.max, now: standoff.value }}
      onPoint={(nx, ny) => {
        commit(radius, worldOffset(nx - 50))
        commit(standoff, worldOffset(50 - ny))
      }}
      onArrow={(direction, axis) => {
        if (axis === 'vertical') commit(standoff, standoff.value + direction * standoff.step)
        else commit(radius, radius.value + direction * radius.step)
      }}
      onReset={() => { standoff.setValue(standoff.default); radius.setValue(radius.default) }}
    >
      {/* The subject's plane, edge-on. */}
      <line x1={4} y1={50} x2={96} y2={50} stroke="var(--border-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {/* The orbit axis, standing off it. */}
      <line x1={50} y1={4} x2={50} y2={96} stroke="var(--border-subtle)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
      {/* The standoff the lap holds. */}
      <line
        x1={4} y1={y} x2={96} y2={y}
        stroke={ACCENT} strokeOpacity={0.3} strokeWidth={1} strokeDasharray="1 3" vectorEffect="non-scaling-stroke"
      />
      <Subject x={50} y={50} />
      <Rig x={x} y={y} aimX={50} aimY={50} />
    </Pad>
  )
}

/** The segmented axis picker: which axis the rig circles, and so which plane its
 *  travel stays parallel to. The whole character of the shot is this control. */
function AxisPicker({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound || bound.definition.type !== 'select') return null
  const active = Math.round(numberOf(bound, DEFAULT_ORBIT_AXIS))
  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">ORBIT AXIS</span>
        <span className="truncate text-[8px] text-[var(--text-muted)]">{ORBIT_AXES[active]?.plane}</span>
      </div>
      <div className="flex rounded border border-[var(--border)] p-0.5">
        {bound.definition.options.map((option) => (
          <button
            key={option.value}
            onClick={() => bound.setValue(option.value)}
            aria-pressed={active === option.value}
            title={ORBIT_AXES[option.value]?.hint}
            className={`flex-1 cursor-pointer rounded-[2px] py-1 text-[10px] ${active === option.value
              ? 'bg-[var(--bg-elevated)] text-[var(--text)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
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
      className="flex min-w-0 cursor-ns-resize touch-none select-none flex-col items-center gap-0.5 rounded border border-[var(--border)] bg-[var(--bg-app)] py-1.5 outline-none hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)]"
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
            className={`flex-1 cursor-pointer rounded-[2px] py-1 text-[10px] ${active
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
  'centerX', 'centerY', 'centerZ', 'orbitAxis', 'standoff', 'radius', 'azimuth',
  'fov', 'swingSpeed', 'tiltSpeed', 'returnBeats', 'returnEase',
])

export const CameraOrbitUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const azimuth = numeric(findParam(parameters, 'azimuth'))
  const standoff = numeric(findParam(parameters, 'standoff'))
  const radius = numeric(findParam(parameters, 'radius'))
  const fov = numberOf(findParam(parameters, 'fov'), 55)
  const leftovers = parameters.filter((bound) => !PLACED.has(bound.definition.key))
  const distance = standoff && radius ? Math.hypot(standoff.value, radius.value) : 0

  return (
    <section data-testid="camera-orbit-user-interface" className="mb-3">
      <AxisPicker bound={findParam(parameters, 'orbitAxis')} />

      {azimuth && standoff && radius && (
        <>
          <div className="mb-1.5 flex gap-2">
            <OrbitPad azimuth={azimuth} radius={radius} />
            <ProfilePad standoff={standoff} radius={radius} />
          </div>
          <div className="mb-3 text-right font-mono text-[8px] text-[var(--text-muted)]">
            {distance.toFixed(1)} from center
          </div>
        </>
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

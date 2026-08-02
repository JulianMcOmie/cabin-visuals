'use client'

// Bespoke settings for the Symmetric Motion mover. The layout IS the pitch: two
// segmented mode switches (which symmetry the motion respects, which time shape
// every row shares) over a diagram that restates the current mode as arrows,
// a small knob row, and the mover's tiny MIDI grammar spelled out per mode.
// Params the current mode doesn't read are simply absent, not disabled - the
// mover path hands every param over regardless of `showIf`, so the gating
// lives here. Presentation only: every control routes through the passed
// parameter bindings.

import { RotateCcw } from 'lucide-react'
import {
  SYMMETRIC_MOTION_MIRROR_ROWS,
  SYMMETRIC_MOTION_RADIAL_ROWS,
} from '../core/visualCopies/symmetricMotion'
import { SYMMETRIC_MOTION_COLOR } from '../core/visualCopies/identityColors'
import { isNumberParam, type NumberParamDef, type SelectParamDef } from '../instruments/types'
import { LaserKnob } from './laserKnob'
import { ParamControl } from './ParameterControl'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// The accent comes FROM THE DEFINITION - the same hue this mover's timeline
// blocks and piano-roll notes wear.
const ACCENT = SYMMETRIC_MOTION_COLOR

interface NumBinding { def: NumberParamDef; value: number; set: (v: number) => void }
interface SelectBinding { def: SelectParamDef; value: number; set: (v: number) => void }

function bind(parameters: readonly UserInterfaceParameter[]) {
  const pool = new Map(parameters.map((p) => [p.definition.key, p]))
  return {
    num(key: string): NumBinding | null {
      const b = pool.get(key)
      if (!b || !isNumberParam(b.definition) || typeof b.value !== 'number') return null
      pool.delete(key)
      return { def: b.definition, value: b.value, set: b.setValue }
    },
    select(key: string): SelectBinding | null {
      const b = pool.get(key)
      if (!b || b.definition.type !== 'select' || typeof b.value !== 'number') return null
      pool.delete(key)
      return { def: b.definition, value: b.value, set: b.setValue }
    },
    rest(): UserInterfaceParameter[] { return [...pool.values()] },
  }
}

/** One segmented mode switch: the full option row of a select param. */
function Segmented({ b, caption }: { b: SelectBinding; caption?: string }) {
  return (
    <div>
      <span className="mb-1 block text-[8px] font-semibold tracking-[0.12em] text-[var(--text-3)] select-none">
        {(caption ?? b.def.label).toUpperCase()}
      </span>
      <div
        role="radiogroup"
        aria-label={b.def.label}
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${b.def.options.length}, minmax(0, 1fr))` }}
      >
        {b.def.options.map((option) => {
          const active = option.value === b.value
          return (
            <button
              key={option.value}
              role="radio"
              aria-checked={active}
              title={`${b.def.label}: ${option.label}`}
              onClick={() => b.set(option.value)}
              className={`rounded-md border py-1.5 text-[9px] font-semibold tracking-[0.06em] transition-colors ${active
                ? 'border-transparent text-black'
                : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-3)]'}`}
              style={active ? { background: ACCENT } : undefined}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const VB_W = 240
const VB_H = 84
const DCX = VB_W / 2
const DCY = VB_H / 2

/** An arrowed segment from (x1,y1) toward (x2,y2). */
function Arrow({ x1, y1, x2, y2, dim }: { x1: number; y1: number; x2: number; y2: number; dim?: boolean }) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = (spread: number) =>
    `${x2 - 5 * Math.cos(angle - spread)} ${y2 - 5 * Math.sin(angle - spread)}`
  return (
    <g stroke={ACCENT} opacity={dim ? 0.35 : 0.9} strokeWidth="1.3" fill="none" strokeLinecap="round">
      <path d={`M${x1} ${y1} L${x2} ${y2}`} />
      <path d={`M${head(0.5)} L${x2} ${y2} L${head(-0.5)}`} />
    </g>
  )
}

/** The current mode restated as arrows: outward spokes and a turn hint for
 *  Radial, equal-and-opposite pairs across a dashed axis for Mirror. Static on
 *  purpose - the subject is the DIRECTION grammar, and notes drive the motion. */
function ModeDiagram({ mirror, planeLabel }: { mirror: boolean; planeLabel: string | null }) {
  const dots: { x: number; y: number }[] = mirror
    ? [-52, -26, 26, 52].map((x) => ({ x: DCX + x, y: DCY }))
    : [45, 135, 225, 315].map((deg) => ({
      x: DCX + 26 * Math.sin((deg * Math.PI) / 180),
      y: DCY - 26 * Math.cos((deg * Math.PI) / 180),
    }))
  return (
    <div
      className="relative w-full border-y border-[var(--border)] bg-[var(--bg-canvas)]"
      style={{ aspectRatio: `${VB_W} / ${VB_H}` }}
    >
      <svg aria-hidden="true" viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-full w-full">
        {mirror ? (
          <line x1={DCX} y1={8} x2={DCX} y2={VB_H - 8} className="stroke-[var(--border-strong)]" strokeWidth="1" strokeDasharray="4 3" />
        ) : (
          <>
            <circle cx={DCX} cy={DCY} r={26} className="fill-none stroke-[var(--border-subtle)]" strokeWidth="1" />
            {/* the turn rows, hinted as one arc around the ring */}
            <g stroke={ACCENT} opacity="0.35" strokeWidth="1.3" fill="none" strokeLinecap="round">
              <path d={`M${DCX - 38} ${DCY - 10} A 39 39 0 0 1 ${DCX - 10} ${DCY - 38}`} />
              <path d={`M${DCX - 10} ${DCY - 38} L${DCX - 15.5} ${DCY - 38.5} M${DCX - 10} ${DCY - 38} L${DCX - 9.5} ${DCY - 33}`} />
            </g>
          </>
        )}
        <path d={`M${DCX - 3.5} ${DCY}H${DCX + 3.5}M${DCX} ${DCY - 3.5}V${DCY + 3.5}`} className="stroke-[var(--border-strong)]" strokeWidth="1" fill="none" />
        {dots.map((dot, i) => {
          // Each copy's arrow points along ITS OWN outward/apart direction.
          const dx = dot.x - DCX
          const dy = dot.y - DCY
          const reach = Math.hypot(dx, dy)
          return (
            <g key={i}>
              <circle cx={dot.x} cy={dot.y} r="3.2" fill={ACCENT} opacity={0.85} />
              <Arrow
                x1={dot.x + (dx / reach) * 7}
                y1={dot.y + (dy / reach) * 7}
                x2={dot.x + (dx / reach) * 20}
                y2={dot.y + (dy / reach) * 20}
              />
            </g>
          )
        })}
      </svg>
      <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[8px] text-[var(--text-muted)]">
        {mirror ? 'PER AXIS' : planeLabel}
      </span>
      <span className="pointer-events-none absolute bottom-1 left-1.5 font-mono text-[8px] text-[var(--text-3)]">
        {mirror ? 'APART / TOGETHER · SIDE PICKS THE SIGN' : 'OUT / IN / TURN · ABOUT THE CENTER'}
      </span>
    </div>
  )
}

/** The mover's whole MIDI grammar for the current mode - few enough rows to
 *  spell out in full, which is the point of the design. */
function NoteMap({ mirror }: { mirror: boolean }) {
  const rows = mirror ? SYMMETRIC_MOTION_MIRROR_ROWS : SYMMETRIC_MOTION_RADIAL_ROWS
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-app)] p-1.5">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[8px] font-semibold tracking-[0.12em] text-[var(--text-3)] select-none">NOTE MAP</span>
        <span className="text-[7px] text-[var(--text-muted)] select-none">one note moves every copy</span>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-[3px]">
        {rows.map((row) => (
          <div key={row.pitch} className="flex items-center gap-1.5">
            <span className="w-6 flex-shrink-0 rounded-[3px] border border-[var(--border)] py-[2px] text-center font-mono text-[8px] leading-none tabular-nums text-[var(--text-muted)]">
              {row.pitch}
            </span>
            <span className="truncate text-[9px] text-[var(--text-3)]">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Knob({ b, label, large, suffix, format }: {
  b: NumBinding
  label: string
  large?: boolean
  suffix?: string
  format?: (value: number) => string
}) {
  return (
    <LaserKnob
      value={b.value}
      min={b.def.min}
      max={b.def.max}
      step={b.def.step}
      defaultValue={b.def.default}
      curve={b.def.curve ?? 1}
      label={label}
      ariaLabel={b.def.label}
      accent={ACCENT}
      large={large}
      suffix={suffix}
      format={format}
      onChange={b.set}
    />
  )
}

function SymmetricMotionGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="10" cy="10" r="2" className="fill-current" stroke="none" />
      <path d="M10 6.5 V3 M10 13.5 V17 M6.5 10 H3 M13.5 10 H17" />
      <path d="M8.2 4 L10 2.2 L11.8 4 M8.2 16 L10 17.8 L11.8 16 M4 8.2 L2.2 10 L4 11.8 M16 8.2 L17.8 10 L16 11.8" />
    </svg>
  )
}

export const SymmetricMotionMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pool = bind(parameters)
  const symmetry = pool.select('symmetry')
  const motion = pool.select('motion')
  const plane = pool.select('plane')
  const distance = pool.num('distance')
  const angle = pool.num('angle')
  const beats = pool.num('beats')
  const easing = pool.select('easing')

  if (!symmetry || !motion || !distance || !beats) return <ParameterList parameters={parameters} />

  const mirror = symmetry.value === 1
  const burst = motion.value === 0
  const planeLabel = plane?.def.options.find((o) => o.value === plane.value)?.label.toUpperCase() ?? null
  const resetAll = () => {
    for (const bound of parameters) bound.setValue(bound.definition.default)
  }

  return (
    <section
      data-testid="symmetric-motion-user-interface"
      className="-mx-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-[0_14px_34px_rgba(0,0,0,.35)]"
    >
      <header className="flex h-9 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]" style={{ color: ACCENT }}>
            <SymmetricMotionGlyph />
          </div>
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text)]">Symmetric Motion</span>
        </div>
        <button
          aria-label="Reset all Symmetric Motion parameters"
          title="Reset all"
          onClick={resetAll}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-2)]"
        >
          <RotateCcw size={11} />
        </button>
      </header>

      <ModeDiagram mirror={mirror} planeLabel={planeLabel} />

      <div className="space-y-2 p-2">
        <Segmented b={symmetry} />
        <Segmented b={motion} />
        {!mirror && plane && <Segmented b={plane} caption="About" />}

        <div className="flex items-end justify-around pt-1">
          <Knob b={distance} label="DIST" large />
          {!mirror && angle && <Knob b={angle} label="TURN" suffix="°" format={(v) => `${Math.round(v)}`} />}
          <Knob b={beats} label="BEATS" suffix="b" />
        </div>

        {burst && easing && (
          <ParamControl
            param={easing.def}
            numValue={easing.value}
            strValue={undefined}
            onNum={(v) => easing.set(v)}
          />
        )}

        <NoteMap mirror={mirror} />
      </div>
    </section>
  )
}

'use client'

// Bespoke settings for the Contour mover. Top to bottom: a SHAPE rail of icon
// segments (one surface family today - the cone - the rail is the seam more
// slot into), a side-profile window showing the landform the formation is
// sculpted into, and the guide's laser knobs for SLOPE / CENTER X / CENTER Y.
//
// The profile window plots contourHeight() itself - the mover's real surface
// function - along a fixed world slice through the center's Y, with "toward
// the camera" as up. Depth goes through a saturating map (v / (|v| + knee),
// the ImpactPulse rule) so every slope is legible and extremes never clip.
//
// Presentation only: every control routes through the passed parameter
// bindings, never the stores.

import { useMemo, type ComponentType } from 'react'
import { RotateCcw } from 'lucide-react'
import { contourHeight, type ContourSettings } from '../core/visualCopies/contour'
import { CONTOUR_COLOR } from '../core/visualCopies/identityColors'
import { isNumberParam, type NumberParamDef, type SelectParamDef } from '../instruments/types'
import { LaserKnob } from './laserKnob'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

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

/** A cone seen from the side: the glyph for the one shipped surface family.
 *  (lucide's Cone reads as a party hat at 14px; this one keeps the open base
 *  ellipse that says "surface of revolution".) */
function ConeGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3 L4 14.5" />
      <path d="M10 3 L16 14.5" />
      <ellipse cx="10" cy="14.5" rx="6" ry="2.5" />
    </svg>
  )
}

/** Icon per `shape` select value, indexed like CONTOUR_SHAPES. A family
 *  without an icon falls back to its label, so a new surface is never an
 *  invisible button. */
const SHAPE_ICONS: Record<number, ComponentType<{ size?: number }>> = {
  0: ConeGlyph,
}

/** World half-width of the profile window's slice, and the saturation knee:
 *  a depth equal to the knee fills half the window's headroom. */
const PROFILE_HALF_SPAN = 8
const PROFILE_KNEE = 4

function ProfileWindow({ slope, centerX, centerY, shape }: ContourSettings) {
  const WIDTH = 200
  const HEIGHT = 56
  const mid = HEIGHT / 2
  const headroom = HEIGHT / 2 - 6

  const path = useMemo(() => {
    const settings: ContourSettings = { shape, slope, centerX, centerY }
    const points: string[] = []
    for (let px = 0; px <= WIDTH; px += 2) {
      const worldX = ((px / WIDTH) * 2 - 1) * PROFILE_HALF_SPAN
      // Slice the surface through y = centerY: the profile of the cone's axis.
      const depth = contourHeight(settings, worldX, centerY)
      const saturated = depth / (Math.abs(depth) + PROFILE_KNEE)
      points.push(`${px},${(mid - saturated * headroom).toFixed(2)}`)
    }
    return `M${points.join(' L')}`
  }, [shape, slope, centerX, centerY, mid, headroom])

  // The apex marker, clamped into frame when CENTER X leaves the slice.
  const apexPx = Math.max(3, Math.min(WIDTH - 3, ((centerX / PROFILE_HALF_SPAN) + 1) / 2 * WIDTH))

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-deep,rgba(0,0,0,.35))] px-1.5 py-1">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block h-14 w-full" aria-hidden="true">
        {/* The flat scene: where an untouched formation sits. */}
        <line x1="0" y1={mid} x2={WIDTH} y2={mid} stroke="currentColor" strokeOpacity="0.18" strokeDasharray="3 4" />
        {/* The apex's x position. */}
        <line x1={apexPx} y1={4} x2={apexPx} y2={HEIGHT - 4} stroke="currentColor" strokeOpacity="0.12" />
        {/* Three stacked strokes of the same path: the guide's emission idiom
            (a blur filter would smear anisotropically in a stretched viewBox). */}
        <path d={path} fill="none" stroke={CONTOUR_COLOR} strokeOpacity="0.16" strokeWidth="5" strokeLinecap="round" />
        <path d={path} fill="none" stroke={CONTOUR_COLOR} strokeOpacity="0.45" strokeWidth="2.5" strokeLinecap="round" />
        <path d={path} fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="1" strokeLinecap="round" />
      </svg>
      <div className="flex justify-between px-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        <span>Away</span>
        <span>Toward camera ↑</span>
      </div>
    </div>
  )
}

export const ContourMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pool = bind(parameters)
  const shape = pool.select('shape')
  const slope = pool.num('slope')
  const centerX = pool.num('centerX')
  const centerY = pool.num('centerY')

  if (!shape || !slope || !centerX || !centerY) {
    return <ParameterList parameters={parameters} />
  }
  const rest = pool.rest()
  const accent = CONTOUR_COLOR

  const resetAll = () => {
    for (const bound of parameters) bound.setValue(bound.definition.default)
  }

  return (
    <section
      data-testid="contour-user-interface"
      className="-mx-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-[0_14px_34px_rgba(0,0,0,.35)]"
    >
      <header className="flex h-9 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]" style={{ color: accent }}>
            <ConeGlyph size={13} />
          </div>
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text)]">Contour</span>
        </div>
        <button
          aria-label="Reset all Contour parameters"
          title="Reset all"
          onClick={resetAll}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-2)]"
        >
          <RotateCcw size={11} />
        </button>
      </header>

      <div className="space-y-2 p-2">
        {/* SHAPE: which surface the formation is sculpted into. Icon segments,
            one per family - the rail stays a rail at one option so the next
            family is an append, not a redesign. */}
        <div className="flex overflow-hidden rounded-md border border-[var(--border)]">
          {shape.def.options.map((option) => {
            const active = option.value === shape.value
            const Icon = SHAPE_ICONS[option.value]
            return (
              <button
                key={option.value}
                aria-pressed={active}
                aria-label={`${option.label} surface`}
                title={option.label}
                onClick={() => shape.set(option.value)}
                className={`flex flex-1 items-center justify-center py-1.5 ${active
                  ? 'bg-[var(--bg-elevated)] text-[var(--text)]'
                  : 'bg-transparent text-[var(--text-muted)] hover:text-[var(--text-2)]'}`}
                style={active ? { color: accent } : undefined}
              >
                {Icon
                  ? <Icon size={14} />
                  : <span className="text-[9px] font-semibold uppercase tracking-[0.1em]">{option.label}</span>}
              </button>
            )
          })}
        </div>

        <ProfileWindow
          shape={shape.value}
          slope={slope.value}
          centerX={centerX.value}
          centerY={centerY.value}
        />

        <div className="flex items-end justify-center gap-2">
          <LaserKnob
            value={slope.value} min={slope.def.min} max={slope.def.max} step={slope.def.step}
            defaultValue={slope.def.default} curve={slope.def.curve} label="SLOPE"
            ariaLabel="Depth per unit radius" accent={accent} large bipolar
            onChange={slope.set}
          />
          <LaserKnob
            value={centerX.value} min={centerX.def.min} max={centerX.def.max} step={centerX.def.step}
            defaultValue={centerX.def.default} curve={centerX.def.curve} label="CENTER X"
            ariaLabel="Surface center X" accent={accent} bipolar
            format={(v) => v.toFixed(1)} onChange={centerX.set}
          />
          <LaserKnob
            value={centerY.value} min={centerY.def.min} max={centerY.def.max} step={centerY.def.step}
            defaultValue={centerY.def.default} curve={centerY.def.curve} label="CENTER Y"
            ariaLabel="Surface center Y" accent={accent} bipolar
            format={(v) => v.toFixed(1)} onChange={centerY.set}
          />
        </div>

        {rest.length > 0 && (
          <div className="border-t border-[var(--border-subtle)] pt-2">
            <ParameterList parameters={rest} />
          </div>
        )}
      </div>
    </section>
  )
}

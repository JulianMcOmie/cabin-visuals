'use client'

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { COLOR_FILTER_ROWS } from '../instruments/ColorFilters'
import { isNumberParam } from '../instruments/types'
import { ParamControl } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for Color Filters. The instrument has one knob (Amount) but
// nine MIDI-triggered looks - so the panel leads with a big amount bar, then a
// swatch legend of every filter row: what each held note will do to the frame,
// with its pitch. Purely presentational; the legend mirrors COLOR_FILTER_ROWS.

function findParam(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

/** A gradient chip that *is* the filter: each background sketches the mode's
 *  effect on a light-to-dark ramp. Presentation only. */
const MODE_SWATCHES: Record<number, string> = {
  1: 'linear-gradient(90deg, #ffffff, #000000)',                                        // Invert
  2: 'linear-gradient(90deg, #000000, #d8d8d8 55%, #1a1a1a)',                           // Solarize
  3: 'linear-gradient(90deg, #3fae5a 0 33%, #3b82d6 33% 66%, #d64545 66%)',             // RGB → GBR
  4: 'linear-gradient(90deg, #3b82d6 0 33%, #d64545 33% 66%, #3fae5a 66%)',             // RGB → BRG
  5: 'linear-gradient(90deg, #000000, #7a1d1d, #d64545, #e8a33c, #f5e05a, #ffffff)',    // Heat map
  6: 'linear-gradient(90deg, #d648a8, #35a7e6)',                                        // Neon duotone
  7: 'linear-gradient(90deg, #101010 0 25%, #4d4d4d 25% 50%, #9a9a9a 50% 75%, #e8e8e8 75%)', // Posterize
  8: 'linear-gradient(90deg, #d64545, #e8a33c, #3fae5a, #3b82d6, #8d6bd6)',             // Luma rainbow
  9: 'linear-gradient(90deg, #3b82d6, #8d6bd6, #d64545, #e8a33c, #3fae5a, #3b82d6)',    // Hue cycle
}

/** The one knob, writ large: a full-width drag bar with a percent readout. */
function AmountBar({ bound }: { bound: UserInterfaceParameter | undefined }) {
  const trackRef = useRef<HTMLDivElement>(null)
  if (!bound) return null
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  const value = bound.value
  const pct = ((value - definition.min) / (definition.max - definition.min)) * 100

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = definition.min + t * (definition.max - definition.min)
    const snapped = Math.max(definition.min, Math.min(definition.max, Math.round(raw / definition.step) * definition.step))
    bound.setValue(snapped)
  }

  const onPointerDown = (event: ReactPointerEvent) => {
    event.preventDefault()
    setFromClientX(event.clientX)
    const controller = new AbortController()
    window.addEventListener('pointermove', (ev) => setFromClientX(ev.clientX), { signal: controller.signal })
    window.addEventListener('pointerup', () => controller.abort(), { signal: controller.signal })
  }

  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">
          {definition.label.toUpperCase()}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--text-2)]">{Math.round(pct)}%</span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-label={definition.label}
        aria-valuemin={definition.min}
        aria-valuemax={definition.max}
        aria-valuenow={value}
        onPointerDown={onPointerDown}
        className="relative h-[14px] cursor-pointer select-none overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-app)]"
      >
        <div
          className="absolute left-0 top-0 h-full"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent-muted), var(--accent))' }}
        />
        <div
          className="absolute top-0 h-full w-[2px] bg-[var(--text)]"
          style={{ left: `calc(${pct}% - 1px)` }}
        />
      </div>
    </div>
  )
}

export const ColorFiltersUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const placed = new Set(['amount'])
  const leftovers = parameters.filter((bound) => !placed.has(bound.definition.key))

  return (
    <section data-testid="color-filters-user-interface" className="mb-3">
      <AmountBar bound={findParam(parameters, 'amount')} />

      {/* --- The looks: one row per MIDI-triggered filter --- */}
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">FILTERS</span>
        <span className="text-[8px] text-[var(--text-muted)]">held note = active</span>
      </div>
      <div className="overflow-hidden rounded border border-[var(--border)]">
        {COLOR_FILTER_ROWS.map((row, index) => (
          <div
            key={row.pitch}
            className={`flex items-center gap-2 bg-[var(--bg-panel)] px-2 py-[5px] ${index > 0 ? 'border-t border-[var(--border-subtle)]' : ''}`}
          >
            <span
              className="h-3.5 w-7 flex-shrink-0 rounded-[2px] border border-[var(--border-strong)]"
              style={{ background: MODE_SWATCHES[row.mode] ?? 'var(--bg-elevated)' }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-2)]">{row.label}</span>
            <span className="font-mono text-[9px] text-[var(--text-muted)]">{row.pitch}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[9px] leading-relaxed text-[var(--text-muted)]">
        Hold a filter&rsquo;s note to apply it; the latest note wins. Note velocity scales the amount.
      </p>

      {/* Anything the layout does not know about still gets a control. */}
      {leftovers.length > 0 && (
        <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
          {leftovers.map((bound) => {
            const numeric = typeof bound.value === 'number'
            return (
              <ParamControl
                key={bound.definition.key}
                param={bound.definition}
                numValue={numeric ? (bound.value as number) : undefined}
                strValue={numeric ? undefined : (bound.value as string)}
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

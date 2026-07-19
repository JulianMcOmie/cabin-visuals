'use client'

import { isNumberParam } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for the Oscilloscope: a live trace preview up top - the
// motif IS the control surface's identity - reflecting the chosen color, line
// width, and background, with the three controls underneath. The preview wave
// is a fixed enveloped sine (the real one follows the audio); only its styling
// is live. Purely presentational.

function findParam(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

// The static preview trace: an enveloped sine, precomputed once.
const TRACE_POINTS = Array.from({ length: 81 }, (_, i) => {
  const t = i / 80
  const x = t * 200
  const y = 30 - Math.sin(t * Math.PI * 2 * 2.5) * Math.sin(t * Math.PI) * 22
  return `${x.toFixed(1)},${y.toFixed(1)}`
}).join(' ')

// Checkerboard = "this pixel is transparent", the universal alpha signal.
const CHECKERBOARD =
  'repeating-conic-gradient(#26262c 0% 25%, #131316 0% 50%) 0 0 / 12px 12px'

export const OscilloscopeUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const color = findParam(parameters, 'color')
  const lineWidth = findParam(parameters, 'lineWidth')
  const background = findParam(parameters, 'transparentBackground')

  const strokeColor = typeof color?.value === 'string' ? color.value : '#ffffff'
  const widthValue = typeof lineWidth?.value === 'number' ? lineWidth.value : 4
  const transparent = typeof background?.value === 'number' ? background.value >= 0.5 : true
  // Map the 1-24 render width onto a 1-7 preview stroke.
  const previewStroke = 1 + ((Math.max(1, widthValue) - 1) * 6) / 23

  const placed = new Set(['color', 'lineWidth', 'transparentBackground'])
  const leftovers = parameters.filter((bound) => !placed.has(bound.definition.key))

  return (
    <section data-testid="oscilloscope-user-interface" className="mb-3">
      {/* --- The trace --- */}
      <div
        className="relative mb-3 overflow-hidden rounded border border-[var(--border)]"
        style={{ background: transparent ? CHECKERBOARD : '#000000' }}
      >
        <svg viewBox="0 0 200 60" className="block h-[60px] w-full" aria-hidden="true" preserveAspectRatio="none">
          {/* Center graticule line, like a scope at rest. */}
          <line x1="0" y1="30" x2="200" y2="30" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="3 4" />
          <polyline
            points={TRACE_POINTS}
            fill="none"
            stroke={strokeColor}
            strokeWidth={previewStroke}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[8px] tracking-[0.08em] text-[var(--text-muted)]">
          SCOPE
        </span>
      </div>

      {/* --- Trace color: swatch + hex readout --- */}
      {color && typeof color.value === 'string' && (
        <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5">
          <span className="truncate text-[11px] text-[var(--text-3)]" title={color.definition.label}>Trace</span>
          <div className="flex items-center justify-end gap-2">
            <span className="font-mono text-[10px] text-[var(--text-muted)]">{color.value}</span>
            <label
              className="relative h-5 w-8 cursor-pointer overflow-hidden rounded border border-[var(--border-strong)]"
              style={{ background: color.value }}
            >
              <input
                type="color"
                aria-label={color.definition.label}
                value={color.value}
                onChange={(event) => color.setValue(event.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
          </div>
        </div>
      )}

      {/* --- Line width --- */}
      {lineWidth && isNumberParam(lineWidth.definition) && typeof lineWidth.value === 'number' && (
        <ParamSlider
          label={lineWidth.definition.label}
          value={lineWidth.value}
          min={lineWidth.definition.min}
          max={lineWidth.definition.max}
          step={lineWidth.definition.step}
          onChange={lineWidth.setValue}
        />
      )}

      {/* --- Background: what sits behind the trace --- */}
      {background && typeof background.value === 'number' && (
        <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5">
          <span className="truncate text-[11px] text-[var(--text-3)]" title={background.definition.label}>Background</span>
          <div className="flex rounded border border-[var(--border)] p-0.5">
            {([
              { on: true, label: 'See-through', swatch: CHECKERBOARD },
              { on: false, label: 'Black', swatch: '#000000' },
            ] as const).map((option) => {
              const active = transparent === option.on
              return (
                <button
                  key={option.label}
                  onClick={() => background.setValue(option.on ? 1 : 0)}
                  aria-pressed={active}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-[2px] py-1 text-[10px] transition-colors cursor-pointer ${active
                    ? 'bg-[var(--bg-elevated)] text-[var(--text)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
                >
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-[2px] border border-[var(--border-strong)]"
                    style={{ background: option.swatch }}
                  />
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Anything the layout does not know about still gets a control. */}
      {leftovers.length > 0 && (
        <div className="border-t border-[var(--border-subtle)] pt-3">
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

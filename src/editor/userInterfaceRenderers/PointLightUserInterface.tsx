'use client'

import { isNumberParam } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for the Point Light: a lamp panel. The header is a glow
// tile - click it to change the light's color; its halo tracks intensity and
// its bulb dot tracks bulb size - followed by the lamp sliders and the fixture
// placement. Purely presentational; the tile derives from the passed params.

function findParam(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numberOf(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function BoundSlider({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound) return null
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  return (
    <ParamSlider
      label={definition.label}
      value={bound.value}
      min={definition.min}
      max={definition.max}
      step={definition.step}
      onChange={bound.setValue}
    />
  )
}

export const PointLightUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const color = findParam(parameters, 'color')
  const intensity = findParam(parameters, 'intensity')
  const bulbSize = findParam(parameters, 'bulbSize')

  const lightColor = typeof color?.value === 'string' ? color.value : '#ffd28a'
  // Normalize against the schema ranges so the tile reads sensibly end to end.
  const intensityT = Math.max(0, Math.min(1, numberOf(intensity, 12) / 80))
  const bulbT = Math.max(0, Math.min(1, numberOf(bulbSize, 0.12) / 0.6))
  const glowSpread = 18 + intensityT * 55 // % radius of the halo
  const glowOpacity = 0.2 + intensityT * 0.8
  const bulbPx = bulbT > 0 ? 5 + bulbT * 26 : 0

  const placed = new Set([
    'color', 'intensity', 'distance', 'decay', 'bulbSize',
    'baseXPosition', 'baseYPosition', 'baseZPosition',
  ])
  const leftovers = parameters.filter((bound) => !placed.has(bound.definition.key))

  return (
    <section data-testid="point-light-user-interface" className="mb-3">
      {/* --- The glow tile: the light itself, and its color picker --- */}
      <label
        className="relative mb-1 block h-[76px] cursor-pointer overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-canvas)]"
        title="Click to change the light color"
      >
        <span
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(circle at 50% 52%, ${lightColor}, transparent ${glowSpread.toFixed(0)}%)`,
            opacity: glowOpacity,
          }}
        />
        {bulbPx > 0 && (
          <span
            className="pointer-events-none absolute left-1/2 top-[52%] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              width: `${bulbPx.toFixed(0)}px`,
              height: `${bulbPx.toFixed(0)}px`,
              background: lightColor,
              boxShadow: `0 0 ${(6 + intensityT * 18).toFixed(0)}px ${lightColor}`,
            }}
          />
        )}
        <span className="pointer-events-none absolute left-1.5 top-1 text-[8px] font-semibold tracking-[0.1em] text-[var(--text-muted)]">
          LIGHT
        </span>
        <span className="pointer-events-none absolute bottom-1 right-1.5 font-mono text-[8px] text-[var(--text-muted)]">
          {lightColor}
        </span>
        {color && typeof color.value === 'string' && (
          <input
            type="color"
            aria-label={color.definition.label}
            value={color.value}
            onChange={(event) => color.setValue(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        )}
      </label>
      <p className="mb-3 text-[8px] text-[var(--text-muted)]">Notes make it flare - higher rows pulse harder.</p>

      {/* --- The lamp --- */}
      <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">LAMP</span>
      <BoundSlider bound={intensity} />
      <BoundSlider bound={findParam(parameters, 'distance')} />
      <BoundSlider bound={findParam(parameters, 'decay')} />
      <BoundSlider bound={bulbSize} />

      {/* --- Where the fixture hangs --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">PLACEMENT</span>
        <BoundSlider bound={findParam(parameters, 'baseXPosition')} />
        <BoundSlider bound={findParam(parameters, 'baseYPosition')} />
        <BoundSlider bound={findParam(parameters, 'baseZPosition')} />
      </div>

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

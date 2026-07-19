'use client'

import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { isNumberParam } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for the Point Light: a lamp panel. The header is a glow
// tile - click it to change the light's color; its halo tracks intensity and
// its bulb dot tracks bulb size - followed by the lamp sliders and the fixture
// placement: an X/Y pad you drag the glow dot around, with a slim Z fader
// beside it for depth. Purely presentational; everything derives from the
// passed params.

function findParam(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numberOf(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

const clampValue = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function snapTo(raw: number, min: number, max: number, step: number) {
  return clampValue(min + Math.round((raw - min) / step) * step, min, max)
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

/** The fixture pad: front view, drag the glow dot to set X (across) and Y (up). */
function PlacementPad({ x, y, lightColor, glowT }: {
  x: UserInterfaceParameter
  y: UserInterfaceParameter
  lightColor: string
  glowT: number
}) {
  const padRef = useRef<HTMLDivElement>(null)
  const xDefinition = x.definition
  const yDefinition = y.definition
  if (!isNumberParam(xDefinition) || !isNumberParam(yDefinition)) return null
  if (typeof x.value !== 'number' || typeof y.value !== 'number') return null

  const xPercent = ((x.value - xDefinition.min) / (xDefinition.max - xDefinition.min)) * 100
  const yPercent = 100 - ((y.value - yDefinition.min) / (yDefinition.max - yDefinition.min)) * 100
  // Crosshair through world zero, wherever the schema ranges put it.
  const zeroX = ((0 - xDefinition.min) / (xDefinition.max - xDefinition.min)) * 100
  const zeroY = 100 - ((0 - yDefinition.min) / (yDefinition.max - yDefinition.min)) * 100

  const setFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    const nx = clampValue((event.clientX - rect.left) / rect.width, 0, 1)
    const ny = clampValue((event.clientY - rect.top) / rect.height, 0, 1)
    x.setValue(snapTo(xDefinition.min + nx * (xDefinition.max - xDefinition.min), xDefinition.min, xDefinition.max, xDefinition.step))
    y.setValue(snapTo(yDefinition.max - ny * (yDefinition.max - yDefinition.min), yDefinition.min, yDefinition.max, yDefinition.step))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const direction = event.key === 'ArrowRight' ? 1 : -1
      x.setValue(snapTo((x.value as number) + direction * xDefinition.step, xDefinition.min, xDefinition.max, xDefinition.step))
    } else {
      const direction = event.key === 'ArrowUp' ? 1 : -1
      y.setValue(snapTo((y.value as number) + direction * yDefinition.step, yDefinition.min, yDefinition.max, yDefinition.step))
    }
  }

  return (
    <div
      ref={padRef}
      data-testid="point-light-placement-pad"
      role="slider"
      tabIndex={0}
      aria-label="Light X and Y position"
      aria-valuemin={xDefinition.min}
      aria-valuemax={xDefinition.max}
      aria-valuenow={x.value}
      aria-valuetext={`X ${x.value.toFixed(1)}, Y ${y.value.toFixed(1)}`}
      title="Drag to place · double-click to reset · arrow keys nudge"
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onDoubleClick={() => { x.setValue(xDefinition.default); y.setValue(yDefinition.default) }}
      onKeyDown={onKeyDown}
      className="relative h-[92px] cursor-crosshair touch-none select-none overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-canvas)] outline-none transition-colors hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)]"
    >
      {zeroX >= 0 && zeroX <= 100 && <span className="pointer-events-none absolute top-0 h-full w-px bg-[var(--border-subtle)]" style={{ left: `${zeroX}%` }} />}
      {zeroY >= 0 && zeroY <= 100 && <span className="pointer-events-none absolute left-0 h-px w-full bg-[var(--border-subtle)]" style={{ top: `${zeroY}%` }} />}
      {/* The light itself, glowing where it hangs. */}
      <span
        className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          left: `${xPercent}%`,
          top: `${yPercent}%`,
          background: lightColor,
          boxShadow: `0 0 ${(5 + glowT * 14).toFixed(0)}px ${(1 + glowT * 4).toFixed(0)}px ${lightColor}`,
        }}
      />
      <span className="pointer-events-none absolute bottom-0.5 left-1.5 font-mono text-[8px] text-[var(--text-muted)]">X {x.value.toFixed(1)}</span>
      <span className="pointer-events-none absolute right-1.5 top-0.5 font-mono text-[8px] text-[var(--text-muted)]">Y {y.value.toFixed(1)}</span>
    </div>
  )
}

/** The depth axis as a slim vertical fader beside the pad: up = nearer +Z. */
function ZFader({ bound }: { bound: UserInterfaceParameter }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  const value = bound.value
  const percent = ((value - definition.min) / (definition.max - definition.min)) * 100

  const setFromClientY = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const t = clampValue(1 - (clientY - rect.top) / rect.height, 0, 1)
    bound.setValue(snapTo(definition.min + t * (definition.max - definition.min), definition.min, definition.max, definition.step))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    bound.setValue(snapTo(value + direction * definition.step, definition.min, definition.max, definition.step))
  }

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={definition.label}
        aria-orientation="vertical"
        aria-valuemin={definition.min}
        aria-valuemax={definition.max}
        aria-valuenow={value}
        title={`${definition.label} · drag vertically · double-click to reset`}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          setFromClientY(event.clientY)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromClientY(event.clientY)
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onDoubleClick={() => bound.setValue(definition.default)}
        onKeyDown={onKeyDown}
        className="relative h-[92px] w-full cursor-ns-resize touch-none select-none overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-app)] outline-none transition-colors hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)]"
      >
        <span
          className="pointer-events-none absolute bottom-0 left-0 w-full bg-[var(--accent-muted)] opacity-30"
          style={{ height: `${percent}%` }}
        />
        <span
          className="pointer-events-none absolute left-1/2 h-[9px] w-[9px] -translate-x-1/2 translate-y-1/2 rounded-[2px] border border-[var(--border-strong)] bg-[var(--text-2)]"
          style={{ bottom: `${percent}%` }}
        />
      </div>
      <span className="font-mono text-[8px] tabular-nums text-[var(--text-muted)]">Z {value.toFixed(1)}</span>
    </div>
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

  const positionX = findParam(parameters, 'baseXPosition')
  const positionY = findParam(parameters, 'baseYPosition')
  const positionZ = findParam(parameters, 'baseZPosition')
  const padReady = [positionX, positionY, positionZ].every(
    (bound) => bound && isNumberParam(bound.definition) && typeof bound.value === 'number',
  )

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

      {/* --- Where the fixture hangs: drag the dot (X/Y), ride the fader (Z) --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">PLACEMENT</span>
        {padReady ? (
          <div className="mb-[13px] grid grid-cols-[1fr_26px] gap-1.5">
            <PlacementPad x={positionX!} y={positionY!} lightColor={lightColor} glowT={intensityT} />
            <ZFader bound={positionZ!} />
          </div>
        ) : (
          <>
            <BoundSlider bound={positionX} />
            <BoundSlider bound={positionY} />
            <BoundSlider bound={positionZ} />
          </>
        )}
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

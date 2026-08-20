'use client'

// Bespoke settings for Flash Wall, following docs/instrument-panel-design-guide.md:
// a live wall preview whose cells flash in sequence through the instrument's REAL
// envelope (flashEnvelopeAt from flashWallCore - the engine's own sampler, so the
// picture cannot drift from playback), over the panel's biggest decisions as
// segmented controls (LAYOUT, placement) with a zone stepper, then the console:
// an ADSR knob row with the color pill on the far right, and a surface row
// (IDLE / GAP / TEXTURE) with the color-mode segments. Every control takes its
// accent from the color param; zone colors come from the same zoneColorHex the
// wall renders with. The preview animates on the shared preview loop - panel
// chrome, exempt from the pause invariant (per the design guide's DOM-transform
// pattern).

import { useRef } from 'react'
import {
  DEFAULT_FLASH_WALL_COLOR,
  DEFAULT_FLASH_WALL_COLOR2,
  FLASH_WALL_COLOR_MODE,
  FLASH_WALL_FALLBACK_RGB,
  flashEnvelopeAt,
  flashWallGrid,
  zoneColorHex,
  type FlashWallEnvelope,
} from '../instruments/flashWallCore'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { ColorWheelPill, hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
import { usePreviewLoop } from './console'
import { LaserKnob } from './laserKnob'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'
import { clamp } from '../utils/math'
import { hexToRgb } from '../utils/colors'

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function stringValue(bound: UserInterfaceParameter | undefined, fallback: string): string {
  return typeof bound?.value === 'string' ? bound.value : fallback
}

function hexToRgbObject(hex: string): { r: number; g: number; b: number } {
  const [r, g, b] = hexToRgb(hex, FLASH_WALL_FALLBACK_RGB)
  return { r, g, b }
}

// ── Live preview ────────────────────────────────────────────────────────────

/** Demo performance: one flash per zone, fired round-robin. */
const PREVIEW_STEP_SEC = 0.55
const PREVIEW_HELD_SEC = 0.12

/** Fine grain for the preview surface - an inline turbulence SVG, no asset. */
const GRAIN_URI =
  'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22/></filter><rect width=%22120%22 height=%22120%22 filter=%22url(%23n)%22 opacity=%220.55%22/></svg>")'

/**
 * The wall in miniature: a DOM cell grid (no WebGL context to budget), animated
 * by writing styles off one rAF loop. Cells past the zone count (grid filler)
 * idle statically, exactly like the shader's filler cells.
 */
function WallPreview({ zones, layout, env, idle, gap, texture, cellColors }: {
  zones: number
  layout: number
  env: FlashWallEnvelope
  idle: number
  gap: number
  texture: number
  cellColors: string[]
}) {
  const cellRefs = useRef<(HTMLDivElement | null)[]>([])
  // The rAF loop reads the LATEST values through this ref, so knob turns
  // retune the running animation without restarting it.
  const live = useRef({ zones, env, idle, colors: cellColors.map(hexToRgbObject) })
  live.current = { zones, env, idle, colors: cellColors.map(hexToRgbObject) }

  const hostRef = usePreviewLoop((tSec) => {
    const { zones, env, idle, colors } = live.current
    const total = Math.max(1, zones) * PREVIEW_STEP_SEC
    const cycleT = tSec % total
    for (let i = 0; i < zones; i++) {
      const el = cellRefs.current[i]
      const c = colors[i]
      if (!el || !c) continue
      let t = cycleT - i * PREVIEW_STEP_SEC
      if (t < 0) t += total
      const level = flashEnvelopeAt(env, t, PREVIEW_HELD_SEC)
      el.style.backgroundColor = `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.min(1, idle * 0.7 + level).toFixed(3)})`
      el.style.boxShadow = `0 0 ${Math.round(22 * level)}px rgba(${c.r}, ${c.g}, ${c.b}, ${(0.5 * level).toFixed(3)})`
    }
  })

  const { cols, rows } = flashWallGrid(zones, layout)
  return (
    <div
      ref={hostRef}
      data-testid="flash-wall-preview"
      className="relative h-[112px] overflow-hidden rounded-t-[9px] border-b border-white/[0.06] bg-[#05070c]"
    >
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          gap: `${(1 + gap * 26).toFixed(1)}px`,
          padding: '10px',
        }}
      >
        {Array.from({ length: cols * rows }, (_, i) => {
          const c = hexToRgbObject(cellColors[i] ?? DEFAULT_FLASH_WALL_COLOR)
          return (
            <div
              key={`${cols}x${rows}-${i}`}
              ref={(el) => { cellRefs.current[i] = el }}
              className="relative rounded-[3px]"
              style={{ backgroundColor: `rgba(${c.r}, ${c.g}, ${c.b}, ${(idle * 0.7).toFixed(3)})` }}
            >
              {/* The cell's vignette - the shader's center-weighted shade. */}
              <div
                className="pointer-events-none absolute inset-0 rounded-[3px]"
                style={{
                  background: 'radial-gradient(85% 85% at 50% 45%, transparent 45%, rgba(0,0,0,0.55) 100%)',
                  opacity: texture,
                }}
              />
            </div>
          )
        })}
      </div>
      {/* Fine grain over the whole surface, scaled by TEXTURE. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: GRAIN_URI, opacity: texture * 0.22, mixBlendMode: 'overlay' }}
      />
    </div>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────

/** The guide's segmented control: one lit segment on a recessed track, the
 *  active segment wearing the accent as light. */
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
            className={`h-[22px] flex-1 cursor-pointer rounded-[5px] px-2 text-[9px] font-semibold tracking-[0.1em] transition-colors ${
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

/** −/+ around the zone count: an exact small integer is a hunt on any knob. */
function ZoneStepper({ bound, accent }: { bound: UserInterfaceParameter; accent: string }) {
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  const n = Math.round(bound.value)
  const button = (direction: -1 | 1, glyph: string) => (
    <button
      aria-label={direction === 1 ? 'More zones' : 'Fewer zones'}
      onClick={() => bound.setValue(clamp(n + direction, definition.min, definition.max))}
      disabled={direction === -1 ? n <= definition.min : n >= definition.max}
      className="h-[22px] w-6 cursor-pointer rounded-[5px] font-mono text-[11px] leading-none text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white/80 disabled:cursor-default disabled:opacity-30"
    >
      {glyph}
    </button>
  )
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-[2px] rounded-[7px] border border-white/[0.07] bg-black/30 p-[2px]">
        {button(-1, '−')}
        <span className="w-6 text-center font-mono text-[11px] tabular-nums" style={{ color: towardWhite(accent, 0.5) }}>
          {n}
        </span>
        {button(1, '+')}
      </div>
      <span className="mt-[3px] text-[8px] font-semibold tracking-[0.12em] text-white/40">ZONES</span>
    </div>
  )
}

/** The guide's console knob bound to one param (LaserSphere's helper). */
function ParamKnob({ parameter: bound, label, accent, large = false }: {
  parameter: UserInterfaceParameter
  label: string
  accent: string
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
      accent={accent}
      large={large}
      onChange={bound.setValue}
    />
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

export const FlashWallUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const zones = parameter(parameters, 'zones')
  const layout = parameter(parameters, 'layout')
  const attack = parameter(parameters, 'attack')
  const decay = parameter(parameters, 'decay')
  const sustain = parameter(parameters, 'sustain')
  const release = parameter(parameters, 'release')
  const idle = parameter(parameters, 'idle')
  const gap = parameter(parameters, 'gap')
  const texture = parameter(parameters, 'texture')
  const color = parameter(parameters, 'color')
  // showIf-gated on Gradient mode, so absent while Solid - like panelWidth,
  // its absence must not trip the fallback.
  const color2 = parameter(parameters, 'color2')
  const colorMode = parameter(parameters, 'colorMode')
  const fitToScreen = parameter(parameters, 'fitToScreen')
  const panelWidth = parameter(parameters, 'panelWidth')
  const panelHeight = parameter(parameters, 'panelHeight')

  // panelWidth/panelHeight are showIf-gated: TrackEditor only hands over
  // params whose gate is satisfied, so they are absent in FILL mode by design
  // and must not trip the fallback.
  if (!zones || !layout || !attack || !decay || !sustain || !release || !idle || !gap ||
      !texture || !color || !colorMode || !fitToScreen) {
    return <ParameterList parameters={parameters} />
  }

  const accent = stringValue(color, DEFAULT_FLASH_WALL_COLOR)
  const accentHsv = hexToHsv(accent)
  // Hue-true dark shade for the section wash, never an alpha tint (the guide).
  const shade = hsvToHex(accentHsv.h, Math.min(accentHsv.s, 0.5), 0.075)
  const spill = `radial-gradient(58% 30px at 50% 0, ${withAlpha(accent, 0.14)}, transparent)`

  const zonesN = clamp(Math.round(numericValue(zones, 6)), 1, 12)
  const layoutN = numericValue(layout, 0)
  const modeN = numericValue(colorMode, FLASH_WALL_COLOR_MODE.solid)
  const accent2 = stringValue(color2, DEFAULT_FLASH_WALL_COLOR2)
  const idleN = numericValue(idle, 0.08)
  const gapN = numericValue(gap, 0.06)
  const textureN = numericValue(texture, 0.5)
  const inScene = numericValue(fitToScreen, 1) < 0.5
  const envelope: FlashWallEnvelope = {
    attackSec: numericValue(attack, 0.01),
    decaySec: Math.max(0.001, numericValue(decay, 0.18)),
    sustain: numericValue(sustain, 0.55),
    releaseSec: numericValue(release, 0.4),
  }

  // The same zone colors the shader will wear (filler cells clamp to the last
  // zone, matching the instrument's grid-filler rule).
  const { cols, rows } = flashWallGrid(zonesN, layoutN)
  const cellColors = Array.from({ length: cols * rows }, (_, i) =>
    zoneColorHex(accent, accent2, modeN, Math.min(i, zonesN - 1), zonesN),
  )

  const pillHalo = `0 0 10px ${withAlpha(accent, 0.35)}`

  return (
    <section
      data-testid="flash-wall-user-interface"
      className="-m-3 rounded-[9px]"
      style={{ background: shade }}
    >
      <WallPreview
        zones={zonesN}
        layout={layoutN}
        env={envelope}
        idle={idleN}
        gap={gapN}
        texture={textureN}
        cellColors={cellColors}
      />
      {/* The wall's biggest decisions: how the screen divides, and where it sits. */}
      <div className="flex items-center gap-2.5 px-3 pb-1 pt-2.5" style={{ background: spill }}>
        <div className="min-w-0 flex-1">
          <Segmented
            ariaLabel="Zone layout"
            options={[
              { value: 0, label: 'COLS', title: 'Vertical slices across the screen' },
              { value: 1, label: 'ROWS', title: 'Horizontal bands down the screen' },
              { value: 2, label: 'GRID', title: 'A near-square grid of cells' },
            ]}
            value={layoutN}
            accent={accent}
            onChange={(v) => layout.setValue(v)}
          />
        </div>
        <ZoneStepper bound={zones} accent={accent} />
        <Segmented
          ariaLabel="Placement"
          options={[
            { value: 1, label: 'FILL', title: 'Fill the screen' },
            { value: 0, label: 'SCENE', title: 'A rectangle in the scene' },
          ]}
          value={inScene ? 0 : 1}
          accent={accent}
          onChange={(v) => fitToScreen.setValue(v)}
        />
      </div>
      {/* The envelope console: the flash's shape in time, pill on the right. */}
      <div className="flex items-end gap-4 px-4 pb-2 pt-1.5">
        <ParamKnob parameter={attack} label="ATK" accent={accent} />
        <ParamKnob parameter={decay} label="DEC" accent={accent} />
        <ParamKnob parameter={sustain} label="SUS" accent={accent} />
        <ParamKnob parameter={release} label="REL" accent={accent} />
        <div className="ml-auto flex items-end gap-3">
          <ColorWheelPill
            value={accent}
            onChange={(hex) => color.setValue(hex)}
            label="COLOR"
            ariaLabel="Wall color"
            halo={pillHalo}
            align="right"
            pillTestId="flash-wall-color-pill"
            wheelTestId="flash-wall-color-wheel"
          />
          {/* Present only in Gradient mode (showIf gates the param away in
              Solid), so the second pill appears exactly when it matters. */}
          {color2 && (
            <ColorWheelPill
              value={accent2}
              onChange={(hex) => color2.setValue(hex)}
              label="COLOR 2"
              ariaLabel="Gradient end color"
              halo={`0 0 10px ${withAlpha(accent2, 0.35)}`}
              align="right"
              pillTestId="flash-wall-color2-pill"
              wheelTestId="flash-wall-color2-wheel"
            />
          )}
        </div>
      </div>
      {/* The surface: what the wall is made of, and how zones take color. */}
      <div className="flex items-end gap-4 px-4 pb-4 pt-1">
        <ParamKnob parameter={idle} label="IDLE" accent={accent} />
        <ParamKnob parameter={gap} label="GAP" accent={accent} />
        <ParamKnob parameter={texture} label="TEXTURE" accent={accent} />
        {inScene && panelWidth && <ParamKnob parameter={panelWidth} label="W" accent={accent} />}
        {inScene && panelHeight && <ParamKnob parameter={panelHeight} label="H" accent={accent} />}
        <div className="ml-auto flex flex-col items-center pb-3">
          <Segmented
            ariaLabel="Zone color mode"
            options={[
              { value: 0, label: 'SOLID', title: 'Every zone wears the one color' },
              { value: 1, label: 'GRADIENT', title: 'Zones blend from COLOR to COLOR 2 across the wall' },
            ]}
            value={modeN}
            accent={accent}
            onChange={(v) => colorMode.setValue(v)}
          />
          <span className="mt-[3px] text-[8px] font-semibold tracking-[0.12em] text-white/40">ZONE COLOR</span>
        </div>
      </div>
    </section>
  )
}

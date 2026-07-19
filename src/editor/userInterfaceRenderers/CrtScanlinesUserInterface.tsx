'use client'

import { useRef } from 'react'
import { isNumberParam } from '../instruments/types'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import { ParamControl } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// CRT Scanlines settings: a live "tube" swatch up top (glow, scanlines, vignette
// and barrel curvature all react to their params in real time) over sections of
// scanline-striped sliders - the fill itself carries the CRT stripe motif.

function find(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((p) => p.definition.key === key)
}

function num(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function str(bound: UserInterfaceParameter | undefined, fallback: string): string {
  return typeof bound?.value === 'string' ? bound.value : fallback
}

/** Slider whose fill is horizontally striped like a raster - the CRT accent. */
function ScanSlider({ bound, label, decimals = 2 }: { bound?: UserInterfaceParameter; label?: string; decimals?: number }) {
  const trackRef = useRef<HTMLDivElement>(null)
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  const d = bound.definition
  const value = bound.value
  const pct = ((value - d.min) / (d.max - d.min)) * 100

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = d.min + t * (d.max - d.min)
    bound.setValue(Math.max(d.min, Math.min(d.max, Math.round(raw / d.step) * d.step)))
  }

  return (
    <div className="mb-[11px] grid grid-cols-[96px_1fr_42px] items-center gap-2.5">
      <span className="truncate text-[11px] text-[var(--text-3)]" title={label ?? d.label}>{label ?? d.label}</span>
      <div
        ref={trackRef}
        role="slider"
        aria-label={label ?? d.label}
        aria-valuemin={d.min}
        aria-valuemax={d.max}
        aria-valuenow={value}
        onPointerDown={(e) => {
          e.preventDefault()
          lockCursor('grabbing')
          setFromClientX(e.clientX)
          const controller = new AbortController()
          window.addEventListener('pointermove', (ev) => setFromClientX(ev.clientX), { signal: controller.signal })
          window.addEventListener('pointerup', () => { controller.abort(); unlockCursor() }, { signal: controller.signal })
        }}
        className="relative h-[9px] cursor-pointer select-none border border-[var(--border)] bg-[var(--bg-canvas)]"
      >
        {/* raster-striped fill: 1px lit line, 1px gap, repeating */}
        <div
          className="absolute left-0 top-0 h-full"
          style={{
            width: `${pct}%`,
            background: 'repeating-linear-gradient(180deg, var(--accent-muted) 0 1px, transparent 1px 3px)',
          }}
        />
        <div
          className="absolute top-1/2 h-[13px] w-[3px] -translate-y-1/2 bg-[var(--text-2)]"
          style={{ left: `calc(${pct}% - 1px)` }}
        />
      </div>
      <span className="text-right font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{value.toFixed(decimals)}</span>
    </div>
  )
}

/** Section label with a tiny stack of scanlines as its bullet. */
function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-1.5 mt-3 flex items-center gap-1.5 first:mt-0">
      <span aria-hidden="true" className="flex flex-col gap-[2px]">
        <span className="h-px w-3 bg-[var(--accent-muted)]" />
        <span className="h-px w-3 bg-[var(--accent-muted)] opacity-60" />
        <span className="h-px w-3 bg-[var(--accent-muted)] opacity-30" />
      </span>
      <span className="text-[9px] font-semibold tracking-[0.1em] text-[var(--text-muted)] select-none">{children}</span>
    </div>
  )
}

function ColorChip({ bound, label }: { bound?: UserInterfaceParameter; label: string }) {
  if (!bound || typeof bound.value !== 'string') return null
  return (
    <label className="flex cursor-pointer items-center gap-1.5" title={`${label}: ${bound.value}`}>
      <span className="relative h-[18px] w-[18px] overflow-hidden rounded-[2px] border border-[var(--border-strong)]" style={{ background: bound.value }}>
        <input
          type="color"
          aria-label={label}
          value={bound.value}
          onChange={(e) => bound.setValue(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      <span className="text-[9px] tracking-[0.06em] text-[var(--text-3)] select-none">{label}</span>
    </label>
  )
}

function Leftovers({ parameters, placed }: { parameters: readonly UserInterfaceParameter[]; placed: readonly string[] }) {
  const placedSet = new Set(placed)
  const rest = parameters.filter((p) => !placedSet.has(p.definition.key))
  if (rest.length === 0) return null
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      {rest.map((p) => {
        const numeric = typeof p.value === 'number'
        return (
          <ParamControl
            key={p.definition.key}
            param={p.definition}
            numValue={numeric ? (p.value as number) : undefined}
            strValue={numeric ? undefined : (p.value as string)}
            onNum={p.setValue}
            onStr={p.setValue}
          />
        )
      })}
    </div>
  )
}

export const CrtScanlinesUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const bgColor = find(parameters, 'bgColor')
  const glowColor = find(parameters, 'glowColor')
  const glowAmount = find(parameters, 'glowAmount')
  const scanSpacing = find(parameters, 'scanSpacing')
  const scanStrength = find(parameters, 'scanStrength')
  const flashDur = find(parameters, 'flashDur')
  const flashStrength = find(parameters, 'flashStrength')
  const blipPitch = find(parameters, 'blipPitch')
  const blipDur = find(parameters, 'blipDur')
  const staticCell = find(parameters, 'staticCell')
  const bandPeriod = find(parameters, 'bandPeriod')
  const bandTravel = find(parameters, 'bandTravel')
  const bandStrength = find(parameters, 'bandStrength')
  const vignette = find(parameters, 'vignette')
  const curvature = find(parameters, 'curvature')
  const placed = [
    'bgColor', 'glowColor', 'glowAmount', 'scanSpacing', 'scanStrength', 'flashDur', 'flashStrength',
    'blipPitch', 'blipDur', 'staticCell', 'bandPeriod', 'bandTravel', 'bandStrength', 'vignette', 'curvature',
  ]

  const tube = str(bgColor, '#04070a')
  const glowHex = str(glowColor, '#3aff8c')
  const glowK = num(glowAmount, 0.5)
  const spacing = Math.max(2, Math.round(num(scanSpacing, 4)))
  const lineH = Math.max(1, Math.floor(spacing * 0.45))
  const strength = num(scanStrength, 0.35)
  const vig = num(vignette, 0.55)
  const curve = num(curvature, 0.6)

  return (
    <section data-testid="crtscanlines-user-interface">
      {/* Live tube swatch: bg, glow, scanlines, vignette + curvature all real */}
      <div className="mb-1.5 rounded-[3px] border border-[var(--border)] bg-[var(--bg-canvas-deep)] p-1.5">
        <div
          className="relative h-[64px] overflow-hidden"
          style={{
            background: tube,
            borderRadius: `${Math.round(curve * 16)}px`,
            boxShadow: `inset 0 0 ${Math.round(14 + vig * 34)}px rgba(0,0,0,${(0.35 + vig * 0.6).toFixed(2)})`,
          }}
        >
          <div
            className="absolute inset-0"
            style={{ background: `radial-gradient(ellipse at 50% 50%, ${glowHex} 0%, transparent 72%)`, opacity: glowK * 0.55 }}
          />
          <div
            className="absolute inset-0"
            style={{ background: `repeating-linear-gradient(180deg, rgba(0,0,0,${strength.toFixed(2)}) 0 ${lineH}px, transparent ${lineH}px ${spacing}px)` }}
          />
          <span className="absolute bottom-1 right-1.5 font-mono text-[7px] tracking-[0.14em] text-white/25 select-none">CH·03</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between px-0.5">
          <ColorChip bound={bgColor} label="TUBE" />
          <ColorChip bound={glowColor} label="PHOSPHOR" />
        </div>
      </div>

      <SectionLabel>TUBE</SectionLabel>
      <ScanSlider bound={glowAmount} label="Glow" />
      <ScanSlider bound={vignette} label="Vignette" />
      <ScanSlider bound={curvature} label="Curvature" />

      <SectionLabel>SCANLINES</SectionLabel>
      <ScanSlider bound={scanSpacing} label="Spacing" decimals={0} />
      <ScanSlider bound={scanStrength} label="Strength" />

      <SectionLabel>NOTE FLASH</SectionLabel>
      <ScanSlider bound={flashDur} label="Fade (s)" />
      <ScanSlider bound={flashStrength} label="Strength" />

      <SectionLabel>STATIC BLIP</SectionLabel>
      <ScanSlider bound={blipPitch} label="Pitch ≥" decimals={0} />
      <ScanSlider bound={blipDur} label="Length (s)" />
      <ScanSlider bound={staticCell} label="Cell (px)" decimals={0} />

      <SectionLabel>ROLLING BAND</SectionLabel>
      <ScanSlider bound={bandPeriod} label="Every (s)" decimals={1} />
      <ScanSlider bound={bandTravel} label="Travel (s)" />
      <ScanSlider bound={bandStrength} label="Brightness" />

      <Leftovers parameters={parameters} placed={placed} />
    </section>
  )
}

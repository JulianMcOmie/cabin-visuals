'use client'

// Bespoke settings for Dot Field, migrated to docs/instrument-panel-design-guide.md
// on the console kit (./console): the old card groups, in-panel title and theme-var
// styling are gone. A live sunflower window up top (dot count + size mirror the
// params), the three baked color schemes as gradient chips (each chip IS its
// palette), then the knobs in gutter-labelled rows - the field itself, the two
// note-reaction systems (disruptor blades, center ripples) - with the rolling
// effect roster as a cell strip. Presentation only - every control routes through
// the passed parameter bindings.

import type { ReactNode } from 'react'
import {
  bindPanel,
  Console,
  ControlRow,
  GutterRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  towardWhite,
  useConsoleAccent,
  withAlpha,
  type NumBinding,
  type SelectBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

/** The instrument's declared identity (DotField.tsx `identityColor`) - the same
 *  green its track wears in the timeline and on the tab rail. */
const ACCENT = '#3ddc97'

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** Sunflower-distribution window mirroring particle count + dot size - the
 *  field's real layout law (the instrument places dots on the same spiral). */
function SunflowerWindow({ count, dotSize }: { count: number; dotSize: number }) {
  const n = Math.round(24 + Math.min(1, count / 2000) * 140)
  const r = 0.55 + (Math.min(24, dotSize) / 24) * 1.4
  const dots: ReactNode[] = []
  for (let i = 0; i < n; i++) {
    const radius = 44 * Math.sqrt(i / n)
    const theta = i * GOLDEN_ANGLE
    // The rim dots dim toward the room, so the field reads as lit from center.
    const dim = 0.25 + 0.75 * (1 - (radius / 44) * 0.7)
    dots.push(
      <circle
        key={i}
        cx={Math.cos(theta) * radius}
        cy={Math.sin(theta) * radius}
        r={r}
        fill={withAlpha(ACCENT, Math.min(1, dim))}
      />,
    )
  }
  return (
    <PreviewWindow height={104} testId="dot-field-window">
      <svg aria-hidden="true" viewBox="-70 -50 140 100" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
        {dots}
      </svg>
    </PreviewWindow>
  )
}

// Representative gradients for the three baked schemes, in option order.
const SCHEME_GRADIENTS = [
  'radial-gradient(circle at 42% 42%, #ff2d78, #e01313 48%, #ffb020)',
  'radial-gradient(circle at 42% 42%, #123f8f, #0e9a8f 52%, #e0b13a)',
  'radial-gradient(circle at 42% 42%, #2c1e7a, #b12ce0 46%, #23e0c8)',
]

/** Scheme chips: each chip IS its palette (the guide's segments-with-shapes
 *  rule) - a gradient face with the name beneath, the active one ringed in
 *  the accent. */
function SchemeChips({ b }: { b: SelectBinding }) {
  const accent = useConsoleAccent()
  const selected = Math.round(b.value)
  return (
    <div className="grid grid-cols-3 gap-1.5 px-3 pt-2">
      {b.def.options.map((option) => {
        const active = option.value === selected
        return (
          <button
            key={option.value}
            aria-pressed={active}
            aria-label={`${b.def.label}: ${option.label}`}
            onClick={() => b.set(option.value)}
            className={`overflow-hidden rounded border cursor-pointer ${
              active ? '' : 'border-white/[0.07] hover:border-white/20'
            }`}
            style={active ? { borderColor: withAlpha(accent, 0.7) } : undefined}
          >
            <span
              className={`block h-7 w-full ${active ? '' : 'opacity-60'}`}
              style={{ background: SCHEME_GRADIENTS[option.value] ?? SCHEME_GRADIENTS[0] }}
            />
            <span
              className="block truncate px-1 py-0.5 text-[7px] font-semibold tracking-[0.05em] uppercase"
              style={{ color: active ? towardWhite(accent, 0.6) : 'rgba(255,255,255,0.4)' }}
            >
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Integer cell strip: click cell k for value k; click the active cell for 0.
 *  A smooth control would make the exact roster count a hunt - the cells are
 *  the value. */
function CellStrip({ b }: { b: NumBinding | null }) {
  const accent = useConsoleAccent()
  if (!b) return null
  const { def, value, set } = b
  const cells = Math.round(def.max - def.min)
  const current = Math.round(value)
  return (
    <div className="flex min-w-0 flex-col items-center">
      <div
        className="flex h-[12px] w-[104px] gap-[2px]"
        role="group"
        aria-label={def.label}
        title="Click a cell · click the last lit cell to zero"
      >
        {Array.from({ length: cells }, (_, index) => {
          const cellValue = Math.round(def.min) + index + 1
          const lit = cellValue <= current
          return (
            <button
              key={cellValue}
              aria-label={`${def.label} ${cellValue}`}
              aria-pressed={lit}
              onClick={() => set(cellValue === current ? Math.round(def.min) : cellValue)}
              className={`h-full flex-1 rounded-[1px] cursor-pointer ${lit ? '' : 'bg-white/[0.08] hover:bg-white/[0.16]'}`}
              style={lit ? { background: withAlpha(accent, 0.75) } : undefined}
            />
          )
        })}
      </div>
      <span className="mt-1 text-[8px] font-semibold tracking-[0.12em] text-white/40">FX ROSTER</span>
      <span className="font-mono text-[9px] tabular-nums text-white/70">{current}</span>
    </div>
  )
}

export const DotFieldUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const colorMode = b.select('colorMode')
  const particleCount = b.num('particleCount')
  const dotSize = b.num('dotSize')
  const opacity = b.num('opacity')
  const speed = b.num('speed')
  const intensity = b.num('intensity')
  const activeEffects = b.num('activeEffects')
  const bladeCount = b.num('bladeCount')
  const disruptorStrength = b.num('disruptorStrength')
  const disruptorSpeed = b.num('disruptorSpeed')
  const disruptorLifetime = b.num('disruptorLifetime')
  const rippleSpeed = b.num('rippleSpeed')
  const rippleStrength = b.num('rippleStrength')

  if (!colorMode || !particleCount || !dotSize) return <ParameterList parameters={parameters} />

  return (
    <Console accent={ACCENT} testId="dot-field-user-interface">
      <SunflowerWindow count={particleCount.value} dotSize={dotSize.value} />
      <div className="flex flex-col gap-2 pb-3">
        <SchemeChips b={colorMode} />
        <ControlRow spill className="gap-4 px-4 pb-1 pt-2">
          <Knob b={particleCount} label="COUNT" large />
          <Knob b={dotSize} label="SIZE" />
          <Knob b={opacity} label="ALPHA" />
          <Knob b={speed} label="SPEED" />
          <Knob b={intensity} label="HEAT" />
          <div className="ml-auto">
            <CellStrip b={activeEffects} />
          </div>
        </ControlRow>
        {/* The two note-reaction systems, each on its own gutter row: blades
            fire every 4th note, ripples every 2nd - the gutter says which. */}
        <GutterRow label="BLADES · 4th">
          <Knob b={bladeCount} label="COUNT" />
          <Knob b={disruptorStrength} label="FORCE" />
          <Knob b={disruptorSpeed} label="SPEED" />
          <Knob b={disruptorLifetime} label="LIFE" />
        </GutterRow>
        <GutterRow label="RIPPLES · 2nd">
          <Knob b={rippleSpeed} label="SPEED" />
          <Knob b={rippleStrength} label="FORCE" />
          <span className="flex-1" aria-hidden="true" />
          <span className="flex-1" aria-hidden="true" />
        </GutterRow>
        <More parameters={b.rest()} label="MORE" className="px-3" />
      </div>
    </Console>
  )
}

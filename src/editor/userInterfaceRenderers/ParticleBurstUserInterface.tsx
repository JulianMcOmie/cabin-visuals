'use client'

// Bespoke settings for Particle Burst, migrated to
// docs/instrument-panel-design-guide.md on the console kit (./console). Reads
// top-to-bottom the way you'd design a firework: pick the burst shape (each
// chip IS its geometry), pick the decay curve (each segment IS its falloff),
// then the knobs in gutter-labelled rows - the explosion, its decay, and the
// geometry-specific extras (dimmed when the selected shape ignores them).
// Presentation only - every control routes through the passed parameter
// bindings.

import {
  bindPanel,
  Console,
  GutterRow,
  Knob,
  More,
  ParameterList,
  towardWhite,
  useConsoleAccent,
  withAlpha,
  type NumBinding,
  type SelectBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

/** The instrument's declared identity (ParticleBurst.tsx `identityColor`). */
const ACCENT = '#e62b00'

/** One mini glyph per burst geometry, in the option order of the `burstType` select. */
function TypeGlyph({ index }: { index: number }) {
  const common = { className: 'fill-none stroke-current', strokeWidth: 1.2, strokeLinecap: 'round' as const }
  switch (index) {
    case 0: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><circle cx="8" cy="8" r="5.5" /><circle cx="6" cy="7" r="0.7" className="fill-current stroke-none" /><circle cx="10" cy="6.2" r="0.7" className="fill-current stroke-none" /><circle cx="8.4" cy="10" r="0.7" className="fill-current stroke-none" /></svg>
    case 1: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><path d="M3 8 L13 3.5 M3 8 L13 12.5" /><ellipse cx="13" cy="8" rx="1.5" ry="4.5" /></svg>
    case 2: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><path d="M2.5 8 L13.5 5.6 M2.5 8 L13.5 10.4 M5.5 8h5" /></svg>
    case 3: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><path d="M8 8 C9.5 8 9.5 6 8 6 C5.8 6 5.8 9.5 8 9.5 C11 9.5 11 4.5 8 4.5 C4 4.5 4 11.5 8 11.5 C12.5 11.5 12.5 3.5 8 3.5" /></svg>
    case 4: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><path d="M8 8 Q10.5 4.5 8 2.5 Q5.5 4.5 8 8 Q11.5 5.5 13.5 8 Q11.5 10.5 8 8 Q10.5 11.5 8 13.5 Q5.5 11.5 8 8 Q4.5 10.5 2.5 8 Q4.5 5.5 8 8" /></svg>
    case 5: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><circle cx="8" cy="8" r="4.6" strokeWidth="2.2" /></svg>
    default: return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" {...common}><path d="M3.5 2.5 C8 5.5 8 10.5 12.5 13.5 M12.5 2.5 C8 5.5 8 10.5 3.5 13.5 M5.6 5h4.8 M5.6 11h4.8" /></svg>
  }
}

/** Representative stroke of each ease curve (option order of `burstCurve`). */
const CURVE_PATHS = [
  'M2 22 C5 7 10 3 22 2',   // logarithmic
  'M2 22 C3 5 8 2 22 2',    // exponential
  'M2 22 C9 12 14 5 22 2',  // power
  'M2 22 A20 20 0 0 1 22 2',// circular
  'M2 22 Q12 4 22 2',       // sine
]

/** The burst-shape chips: each chip IS its geometry, in the same accent-lit
 *  chip vocabulary as the Mover's easing strip and Cube's geometry strip. */
function TypeSelector({ b }: { b: SelectBinding }) {
  const accent = useConsoleAccent()
  const selected = Math.round(b.value)
  return (
    <div className="grid grid-cols-4 gap-1 px-3 pt-2">
      {b.def.options.map((option) => {
        const active = option.value === selected
        return (
          <button
            key={option.value}
            aria-pressed={active}
            aria-label={`${b.def.label}: ${option.label}`}
            onClick={() => b.set(option.value)}
            className={`flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-md border px-1 py-1.5 transition-colors ${
              active ? '' : 'border-white/[0.07] bg-white/[0.025] text-white/30 hover:bg-white/[0.06] hover:text-white/65'
            }`}
            style={active ? { borderColor: withAlpha(accent, 0.4), background: withAlpha(accent, 0.15), color: towardWhite(accent, 0.45) } : undefined}
          >
            <TypeGlyph index={option.value} />
            <span className="max-w-full truncate text-[7px] font-semibold tracking-[0.05em] uppercase">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** The decay-curve strip: each segment IS its falloff. */
function CurveSelector({ b }: { b: SelectBinding }) {
  const accent = useConsoleAccent()
  const selected = Math.round(b.value)
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex overflow-hidden rounded-md border border-white/10">
        {b.def.options.map((option) => {
          const active = option.value === selected
          return (
            <button
              key={option.value}
              title={option.label}
              aria-pressed={active}
              aria-label={`${b.def.label}: ${option.label}`}
              onClick={() => b.set(option.value)}
              className={`px-1 pb-0.5 pt-1 transition-colors cursor-pointer ${active ? '' : 'bg-black/25 hover:bg-white/5'}`}
              style={active ? { background: accent } : undefined}
            >
              <svg aria-hidden="true" width="16" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" stroke={active ? '#000' : 'rgba(255,255,255,0.45)'}>
                <path d={CURVE_PATHS[option.value] ?? CURVE_PATHS[0]} />
              </svg>
            </button>
          )
        })}
      </div>
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">CURVE</span>
      <span className="font-mono text-[9px] text-white/70">
        {b.def.options.find((option) => option.value === selected)?.label.toUpperCase() ?? ''}
      </span>
    </div>
  )
}

/** Wraps a shape-specific knob, dimming it when the selected burst type ignores it. */
function ShapeKnob({ b, label, relevantTypes, selected }: {
  b: NumBinding | null
  label: string
  relevantTypes: number[] | null
  selected: number
}) {
  if (!b) return null
  const relevant = relevantTypes === null || relevantTypes.includes(selected)
  return (
    <div
      className={relevant ? undefined : 'pointer-events-auto opacity-40'}
      title={relevant ? undefined : `${b.def.label} only affects some burst types`}
    >
      <Knob b={b} label={label} />
    </div>
  )
}

export const ParticleBurstUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const burstType = b.select('burstType')
  const count = b.num('count')
  const pointSize = b.num('pointSize')
  const burstRadius = b.num('burstRadius')
  const burstPower = b.num('burstPower')
  const burstCurve = b.select('burstCurve')
  const burstLifetime = b.num('burstLifetime')
  const fadePower = b.num('fadePower')
  const dissolveSpread = b.num('dissolveSpread')
  const coneAngle = b.num('coneAngle')
  const spiralTwists = b.num('spiralTwists')
  const polarPetals = b.num('polarPetals')
  const cylinderRadius = b.num('cylinderRadius')

  if (!burstType || !count || !burstPower) return <ParameterList parameters={parameters} />

  const selectedType = Math.round(burstType.value)

  return (
    <Console accent={ACCENT} testId="particle-burst-user-interface">
      <TypeSelector b={burstType} />
      <div className="flex flex-col gap-2 pb-3 pt-2">
        <GutterRow label="EXPLOSION">
          <Knob b={count} label="COUNT" large />
          <Knob b={pointSize} label="SIZE" />
          <Knob b={burstRadius} label="RADIUS" />
          <Knob b={burstPower} label="POWER" />
        </GutterRow>
        <GutterRow label="DECAY">
          {burstCurve && <CurveSelector b={burstCurve} />}
          <Knob b={burstLifetime} label="LIFE" />
          <Knob b={fadePower} label="FADE" />
          <Knob b={dissolveSpread} label="SPREAD" />
        </GutterRow>
        <GutterRow label="TUNING">
          <ShapeKnob b={coneAngle} label="CONE" relevantTypes={[1, 2]} selected={selectedType} />
          <ShapeKnob b={spiralTwists} label="TWISTS" relevantTypes={[3, 6]} selected={selectedType} />
          <ShapeKnob b={polarPetals} label="PETALS" relevantTypes={[4]} selected={selectedType} />
          <ShapeKnob b={cylinderRadius} label="BARREL" relevantTypes={null} selected={selectedType} />
        </GutterRow>
        <More parameters={b.rest()} label="MORE" className="px-3" />
      </div>
    </Console>
  )
}

'use client'

// Bespoke settings for the Stars warp starfield: a live starfield strip up top
// (density, dot size, tint, background, and ground all read straight from the
// bound params), then SKY / MOTION / GROUND sections. Presentation only - every
// control writes through the passed setValue, and any param key this layout
// does not explicitly place falls through to a generic list at the bottom.

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isNumberParam } from '../instruments/types'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import { ParamControl, ParamSlider, ParamToggle } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const bind = (parameters: readonly UserInterfaceParameter[], key: string) =>
  parameters.find((p) => p.definition.key === key)

const num = (p: UserInterfaceParameter | undefined, fallback: number) =>
  typeof p?.value === 'number' ? p.value : fallback

const str = (p: UserInterfaceParameter | undefined, fallback: string) =>
  typeof p?.value === 'string' ? p.value : fallback

// Deterministic pseudo-random so the preview layout is stable across renders.
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function StarGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-current opacity-70">
      <path d="M5 0 L6 4 L10 5 L6 6 L5 10 L4 6 L0 5 L4 4 Z" />
    </svg>
  )
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex select-none items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">
          <StarGlyph />
          {title}
        </span>
        {aside}
      </div>
      {children}
    </div>
  )
}

/** Tint slider whose track is the actual hue wheel - the one place a rainbow belongs. */
function TintSlider({ bound }: { bound: UserInterfaceParameter }) {
  const trackRef = useRef<HTMLDivElement>(null)
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
    bound.setValue(Math.max(definition.min, Math.min(definition.max, Math.round(raw / definition.step) * definition.step)))
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    lockCursor('grabbing')
    setFromClientX(e.clientX)
    const controller = new AbortController()
    window.addEventListener('pointermove', (ev) => setFromClientX(ev.clientX), { signal: controller.signal })
    window.addEventListener('pointerup', () => { controller.abort(); unlockCursor() }, { signal: controller.signal })
  }

  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr_44px] items-center gap-2.5">
      <span className="truncate text-[11px] text-[var(--text-3)]" title={definition.label}>{definition.label}</span>
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        className="relative h-[5px] cursor-pointer select-none rounded-[2px]"
        style={{ background: 'linear-gradient(to right, hsl(0,55%,55%), hsl(60,55%,55%), hsl(120,55%,45%), hsl(180,55%,50%), hsl(240,55%,60%), hsl(300,55%,55%), hsl(360,55%,55%))' }}
      >
        <div
          className="absolute top-1/2 h-[11px] w-[9px] -translate-y-1/2 border border-[var(--border-strong)]"
          style={{ left: `calc(${pct}% - 4px)`, background: `hsl(${value}, 60%, 60%)` }}
        />
      </div>
      <span className="text-right font-mono text-[10px] tabular-nums text-[var(--text-muted)]">{Math.round(value)}°</span>
    </div>
  )
}

function StarfieldPreview({
  starCount, dotSize, tint, bg, groundOn, groundColor, bgBound,
}: {
  starCount: number
  dotSize: number
  tint: number
  bg: string
  groundOn: boolean
  groundColor: string
  bgBound: UserInterfaceParameter | undefined
}) {
  const n = Math.round(10 + (Math.min(starCount, 3000) / 3000) * 52)
  const dots: ReactNode[] = []
  for (let i = 0; i < n; i++) {
    const depth = hash(i + 2000) // 0 near, 1 far
    const size = Math.max(1, (1.7 - depth) * (0.7 + dotSize * 0.55))
    const far = depth > 0.4
    dots.push(
      <span
        key={i}
        className="absolute rounded-full"
        style={{
          left: `${hash(i) * 100}%`,
          top: `${hash(i + 1000) * 92}%`,
          width: size,
          height: size,
          background: far ? `hsl(${tint}, 45%, 78%)` : '#ffffff',
          opacity: 1 - depth * 0.55,
        }}
      />,
    )
  }

  return (
    <div
      className="relative mb-4 h-[72px] overflow-hidden rounded border border-[var(--border)]"
      style={{ background: bg }}
      title="Live sky preview - density, dot size, tint, background, ground"
    >
      {dots}
      {groundOn && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[26px]"
          style={{
            backgroundImage: `linear-gradient(${groundColor}66 1px, transparent 1px), linear-gradient(90deg, ${groundColor}66 1px, transparent 1px)`,
            backgroundSize: '14px 9px',
            maskImage: 'linear-gradient(to bottom, transparent, black 70%)',
          }}
        />
      )}
      {bgBound && typeof bgBound.value === 'string' && (
        <label
          className="absolute bottom-1 right-1 flex cursor-pointer items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-panel)] px-1 py-0.5"
          title="Background color"
        >
          <span className="h-2.5 w-2.5 rounded-[2px] border border-[var(--border-strong)]" style={{ background: bgBound.value }} />
          <span className="text-[8px] font-semibold tracking-[0.06em] text-[var(--text-muted)]">BG</span>
          <input
            type="color"
            aria-label="Background color"
            value={bgBound.value}
            onChange={(e) => bgBound.setValue(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      )}
    </div>
  )
}

function NumberRow({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound) return null
  const d = bound.definition
  if (!isNumberParam(d) || typeof bound.value !== 'number') return null
  return <ParamSlider label={d.label} value={bound.value} min={d.min} max={d.max} step={d.step} onChange={bound.setValue} />
}

function ExtraParams({ parameters, placed }: { parameters: readonly UserInterfaceParameter[]; placed: ReadonlySet<string> }) {
  const rest = parameters.filter((p) => !placed.has(p.definition.key))
  if (rest.length === 0) return null
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      {rest.map((p) => (
        <ParamControl
          key={p.definition.key}
          param={p.definition}
          numValue={typeof p.value === 'number' ? p.value : undefined}
          strValue={typeof p.value === 'string' ? p.value : undefined}
          onNum={p.setValue}
          onStr={p.setValue}
        />
      ))}
    </div>
  )
}

const PLACED = new Set([
  'starCount', 'dotSize', 'speed', 'spread', 'depth', 'drift', 'tint', 'bgColor', 'ground', 'groundY', 'groundColor',
])

export const StarsUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const starCount = bind(parameters, 'starCount')
  const dotSize = bind(parameters, 'dotSize')
  const speed = bind(parameters, 'speed')
  const spread = bind(parameters, 'spread')
  const depth = bind(parameters, 'depth')
  const drift = bind(parameters, 'drift')
  const tint = bind(parameters, 'tint')
  const bgColor = bind(parameters, 'bgColor')
  const ground = bind(parameters, 'ground')
  const groundY = bind(parameters, 'groundY') // gated behind ground - absent while off
  const groundColor = bind(parameters, 'groundColor')

  const groundOn = num(ground, 0) >= 0.5

  return (
    <div data-testid="stars-user-interface">
      <StarfieldPreview
        starCount={num(starCount, 1500)}
        dotSize={num(dotSize, 2)}
        tint={num(tint, 220)}
        bg={str(bgColor, '#0a0a0f')}
        groundOn={groundOn}
        groundColor={str(groundColor, '#4a3a8a')}
        bgBound={bgColor}
      />

      <Section title="SKY">
        <NumberRow bound={starCount} />
        <NumberRow bound={dotSize} />
        <NumberRow bound={spread} />
        <NumberRow bound={depth} />
        {tint && <TintSlider bound={tint} />}
      </Section>

      <Section title="MOTION">
        <NumberRow bound={speed} />
        <NumberRow bound={drift} />
      </Section>

      {ground && (
        <Section
          title="GROUND"
          aside={<ParamToggle on={groundOn} onChange={(v) => ground.setValue(v ? 1 : 0)} label="Ground Plane" />}
        >
          {groundOn && (
            <>
              <NumberRow bound={groundY} />
              {groundColor && typeof groundColor.value === 'string' && (
                <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5">
                  <span className="truncate text-[11px] text-[var(--text-3)]">Ground Color</span>
                  <div className="flex justify-end">
                    <input
                      type="color"
                      aria-label="Ground color"
                      value={groundColor.value}
                      onChange={(e) => groundColor.setValue(e.target.value)}
                      className="h-5 w-8 flex-shrink-0 cursor-pointer rounded border border-[var(--border)] bg-transparent transition-transform active:scale-95"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </Section>
      )}

      <ExtraParams parameters={parameters} placed={PLACED} />
    </div>
  )
}

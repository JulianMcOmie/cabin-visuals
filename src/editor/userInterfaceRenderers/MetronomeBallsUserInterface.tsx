'use client'

// Bespoke settings for MetronomeBalls: a protractor arc where the KICK and
// SNARE start angles are draggable pendulum needles (with faint ghost needles
// hinting each per-ball step direction), fine step sliders beneath, then
// TIMING and ENSEMBLE groups. Presentation only; unplaced keys fall through to
// a generic list at the bottom.

import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isNumberParam } from '../instruments/types'
import { lockCursor, unlockCursor } from '../utils/dragCursor'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const bind = (parameters: readonly UserInterfaceParameter[], key: string) =>
  parameters.find((p) => p.definition.key === key)

const num = (p: UserInterfaceParameter | undefined, fallback: number) =>
  typeof p?.value === 'number' ? p.value : fallback

const PIVOT_X = 100
const PIVOT_Y = 100
const RADIUS = 82

// Degrees (1..180) -> point on the protractor: 0 = left, 90 = top, 180 = right.
function anglePoint(deg: number, radius = RADIUS): [number, number] {
  const rad = Math.PI * (180 - deg) / 180
  return [PIVOT_X + Math.cos(rad) * radius, PIVOT_Y - Math.sin(rad) * radius]
}

function Needle({ deg, color, ghostDeg, label }: { deg: number; color: string; ghostDeg: number; label: string }) {
  const [x, y] = anglePoint(deg)
  const [gx, gy] = anglePoint(Math.max(1, Math.min(180, ghostDeg)))
  return (
    <g>
      <line x1={PIVOT_X} y1={PIVOT_Y} x2={gx} y2={gy} stroke={color} strokeWidth="1" strokeDasharray="2 3" opacity="0.3" />
      <line x1={PIVOT_X} y1={PIVOT_Y} x2={x} y2={y} stroke={color} strokeWidth="1.5" />
      <circle cx={x} cy={y} r="5" fill={color} stroke="var(--bg-app)" strokeWidth="1" />
      <text
        x={x}
        y={y - 8}
        textAnchor="middle"
        fill={color}
        style={{ font: '600 7px monospace', letterSpacing: '0.05em' }}
      >
        {label} {Math.round(deg)}°
      </text>
    </g>
  )
}

function PendulumArc({ kick, snare, kickStep, snareStep }: {
  kick: UserInterfaceParameter
  snare: UserInterfaceParameter
  kickStep: number
  snareStep: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const activeRef = useRef<UserInterfaceParameter | null>(null)
  const kickDef = kick.definition
  const snareDef = snare.definition
  if (!isNumberParam(kickDef) || !isNumberParam(snareDef)) return null
  if (typeof kick.value !== 'number' || typeof snare.value !== 'number') return null

  const angleFromPointer = (clientX: number, clientY: number): number | null => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return null
    const vx = ((clientX - rect.left) / rect.width) * 200
    const vy = ((clientY - rect.top) / rect.height) * 112
    const dx = vx - PIVOT_X
    const dy = PIVOT_Y - vy
    let rad = Math.atan2(dy, dx)
    rad = Math.max(0, Math.min(Math.PI, rad))
    return Math.max(1, Math.min(180, Math.round(180 - (rad * 180) / Math.PI)))
  }

  const applyAngle = (clientX: number, clientY: number) => {
    const bound = activeRef.current
    const deg = angleFromPointer(clientX, clientY)
    if (!bound || deg === null) return
    const d = bound.definition
    if (!isNumberParam(d)) return
    bound.setValue(Math.max(d.min, Math.min(d.max, deg)))
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.preventDefault()
    const deg = angleFromPointer(e.clientX, e.clientY)
    if (deg === null) return
    activeRef.current =
      Math.abs(deg - (kick.value as number)) <= Math.abs(deg - (snare.value as number)) ? kick : snare
    lockCursor('grabbing')
    applyAngle(e.clientX, e.clientY)
    const controller = new AbortController()
    window.addEventListener('pointermove', (ev) => applyAngle(ev.clientX, ev.clientY), { signal: controller.signal })
    window.addEventListener('pointerup', () => { controller.abort(); activeRef.current = null; unlockCursor() }, { signal: controller.signal })
  }

  const ticks: ReactNode[] = []
  for (let deg = 0; deg <= 180; deg += 15) {
    const major = deg % 45 === 0
    const [x1, y1] = anglePoint(deg, RADIUS - (major ? 7 : 4))
    const [x2, y2] = anglePoint(deg, RADIUS)
    ticks.push(<line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--border)" strokeWidth={major ? 1.4 : 1} />)
  }
  const [arcStartX, arcStartY] = anglePoint(0)
  const [arcEndX, arcEndY] = anglePoint(180)

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 200 112"
      role="group"
      aria-label="Kick and snare start angles"
      onPointerDown={onPointerDown}
      className="block h-auto w-full cursor-pointer select-none touch-none"
    >
      <path
        d={`M ${arcStartX} ${arcStartY} A ${RADIUS} ${RADIUS} 0 0 1 ${arcEndX} ${arcEndY}`}
        fill="none"
        stroke="var(--border)"
        strokeWidth="1"
      />
      {ticks}
      <line x1={PIVOT_X - RADIUS} y1={PIVOT_Y} x2={PIVOT_X + RADIUS} y2={PIVOT_Y} stroke="var(--border)" strokeWidth="1" />
      <Needle deg={snare.value} color="var(--text-2)" ghostDeg={snare.value + snareStep * 10} label="SNARE" />
      <Needle deg={kick.value} color="var(--accent)" ghostDeg={kick.value + kickStep * 10} label="KICK" />
      <circle cx={PIVOT_X} cy={PIVOT_Y} r="3" fill="var(--text-muted)" />
    </svg>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 flex select-none items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">
      <svg aria-hidden="true" viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-none stroke-current opacity-70" strokeWidth="1">
        <line x1="5" y1="1" x2="8" y2="7" />
        <circle cx="8.2" cy="7.6" r="1.3" fill="currentColor" stroke="none" />
      </svg>
      {children}
    </p>
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
  'balls', 'kickStart', 'snareStart', 'kickStep', 'snareStep', 'speed',
  'dotSize', 'lineOpacity', 'fgMultiplier', 'bgMultiplier', 'bgRotateRate',
])

export const MetronomeBallsUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const balls = bind(parameters, 'balls')
  const kickStart = bind(parameters, 'kickStart')
  const snareStart = bind(parameters, 'snareStart')
  const kickStep = bind(parameters, 'kickStep')
  const snareStep = bind(parameters, 'snareStep')
  const speed = bind(parameters, 'speed')
  const dotSize = bind(parameters, 'dotSize')
  const lineOpacity = bind(parameters, 'lineOpacity')
  const fgMultiplier = bind(parameters, 'fgMultiplier')
  const bgMultiplier = bind(parameters, 'bgMultiplier')
  const bgRotateRate = bind(parameters, 'bgRotateRate')

  return (
    <div data-testid="metronome-balls-user-interface">
      <div className="mb-4">
        <SectionLabel>SWING</SectionLabel>
        {kickStart && snareStart && (
          <div
            className="mb-2.5 rounded border border-[var(--border)] bg-[var(--bg-app)] px-2 pb-1 pt-2"
            title="Drag a needle to set its start angle"
          >
            <PendulumArc
              kick={kickStart}
              snare={snareStart}
              kickStep={num(kickStep, 3)}
              snareStep={num(snareStep, 2)}
            />
          </div>
        )}
        <NumberRow bound={kickStep} />
        <NumberRow bound={snareStep} />
      </div>

      <div className="mb-4">
        <SectionLabel>TIMING</SectionLabel>
        <NumberRow bound={speed} />
        <NumberRow bound={fgMultiplier} />
        <NumberRow bound={bgMultiplier} />
        <NumberRow bound={bgRotateRate} />
      </div>

      <div className="mb-1">
        <SectionLabel>ENSEMBLE</SectionLabel>
        <NumberRow bound={balls} />
        <NumberRow bound={dotSize} />
        <NumberRow bound={lineOpacity} />
      </div>

      <ExtraParams parameters={parameters} placed={PLACED} />
    </div>
  )
}

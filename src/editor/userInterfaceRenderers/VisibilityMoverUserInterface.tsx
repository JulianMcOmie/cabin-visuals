'use client'

// Bespoke settings surface for the Visibility mover (definition id
// 'visibility'). The envelope editor does not approximate the shape: it
// samples evaluateVisibilityOpacity itself (with a synthetic gate note held
// exactly long enough to reach sustain), so attack ramp, decay-to-sustain,
// hold, and release always match what the engine renders - including the
// hold = max(duration, attack) rule. A/D/S/R are draggable handles with
// pointer capture, arrow keys, and double-click reset; grouping is a
// segmented control over the definition's own options with a strip showing
// how copy indices collapse into MIDI rows (pitch 127 downward).

import { useEffect, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Eye, RotateCcw } from 'lucide-react'
import { evaluateVisibilityOpacity } from '../core/visualCopies/library'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

/** Snap + clamp a raw number into a numeric param's grid before committing. */
function commitNumber(bound: UserInterfaceParameter, raw: number) {
  const definition = bound.definition
  if (!isNumberParam(definition)) return
  const snapped = definition.min + Math.round((raw - definition.min) / definition.step) * definition.step
  bound.setValue(clamp(Number(snapped.toFixed(8)), definition.min, definition.max))
}

function keyStep(bound: UserInterfaceParameter, shiftKey: boolean): number {
  const definition = bound.definition
  if (!isNumberParam(definition)) return 0
  return definition.step * (shiftKey ? 10 : 1)
}

const EMERALD = '#34d399'

/** Sample opacity through the engine's own evaluator with a synthetic gate. */
function sampleEnvelope(a: number, d: number, s: number, r: number, gate: number, beat: number): number {
  return evaluateVisibilityOpacity(
    [{ beat: 0, blockStartBeat: 0, blockEndBeat: 1000, pitch: 127, velocity: 1, durationBeats: gate }],
    beat,
    0,
    1,
    { grouping: 0, attackBeats: a, decayBeats: d, sustainLevel: s, releaseBeats: r },
  )
}

// ── ADSR envelope editor ─────────────────────────────────────────────────────

const ENV_W = 260
const ENV_H = 118
const ENV_PAD_L = 10
const ENV_PAD_R = 10
const ENV_TOP = 14
const ENV_BASE = 96
const ENV_INNER_H = ENV_BASE - ENV_TOP
/** Beats of visible sustain plateau between decay landing and gate-off. */
const HOLD_BEATS = 0.75

type DragKind = 'attack' | 'decaySustain' | 'release' | 'plateau'

interface EnvelopeDrag {
  kind: DragKind
  clientX: number
  clientY: number
  attack: number
  decay: number
  sustain: number
  release: number
  /** Frozen at drag start so the handle never chases a rescaling axis. */
  pxPerBeat: number
  /** Client px → svg units. */
  scale: number
}

function EnvelopeEditor({
  attack,
  decay,
  sustain,
  release,
}: {
  attack: UserInterfaceParameter
  decay: UserInterfaceParameter
  sustain: UserInterfaceParameter
  release: UserInterfaceParameter
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dotRef = useRef<SVGCircleElement>(null)
  const dragRef = useRef<EnvelopeDrag | null>(null)

  const a = Math.max(0, numericValue(attack))
  const d = Math.max(0, numericValue(decay))
  const s = clamp(numericValue(sustain, 1), 0, 1)
  const r = Math.max(0, numericValue(release, 0.05))
  const gate = a + d + HOLD_BEATS
  const total = gate + r
  const windowBeats = Math.max(total * 1.05, 1)
  const pxPerBeat = (ENV_W - ENV_PAD_L - ENV_PAD_R) / windowBeats
  const toX = (beat: number) => ENV_PAD_L + beat * pxPerBeat
  const toY = (opacity: number) => ENV_BASE - opacity * ENV_INNER_H

  const samples = 200
  let path = ''
  for (let i = 0; i <= samples; i++) {
    const beat = (i / samples) * total
    path += `${i === 0 ? 'M' : 'L'}${toX(beat).toFixed(1)},${toY(sampleEnvelope(a, d, s, r, gate, beat)).toFixed(1)}`
  }
  const fillPath = `${path} L${toX(total).toFixed(1)},${ENV_BASE} L${toX(0).toFixed(1)},${ENV_BASE} Z`

  const regions: { from: number; to: number; letter: string }[] = [
    { from: 0, to: a, letter: 'A' },
    { from: a, to: a + d, letter: 'D' },
    { from: a + d, to: gate, letter: 'S' },
    { from: gate, to: total, letter: 'R' },
  ]

  // Looping gate playthrough - the dot rides the exact sampled function.
  const liveRef = useRef({ a, d, s, r, gate, total, pxPerBeat })
  liveRef.current = { a, d, s, r, gate, total, pxPerBeat }

  useEffect(() => {
    let raf = 0
    const started = performance.now()
    const tick = (now: number) => {
      const live = liveRef.current
      const period = clamp(live.total * 0.55, 1.2, 6)
      const progress = (((now - started) / 1000) % (period + 0.4)) / period
      const beat = Math.min(1, progress) * live.total
      const opacity = sampleEnvelope(live.a, live.d, live.s, live.r, live.gate, beat)
      dotRef.current?.setAttribute('cx', (ENV_PAD_L + beat * live.pxPerBeat).toFixed(1))
      dotRef.current?.setAttribute('cy', (ENV_BASE - opacity * ENV_INNER_H).toFixed(1))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const startDrag = (kind: DragKind) => (event: ReactPointerEvent<SVGElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = svgRef.current?.getBoundingClientRect()
    ;(event.currentTarget as SVGElement).setPointerCapture(event.pointerId)
    dragRef.current = {
      kind,
      clientX: event.clientX,
      clientY: event.clientY,
      attack: a,
      decay: d,
      sustain: s,
      release: r,
      pxPerBeat,
      scale: rect ? ENV_W / rect.width : 1,
    }
  }

  const moveDrag = (event: ReactPointerEvent<SVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dxBeats = ((event.clientX - drag.clientX) * drag.scale) / drag.pxPerBeat
    const dyOpacity = ((drag.clientY - event.clientY) * drag.scale) / ENV_INNER_H
    if (drag.kind === 'attack') commitNumber(attack, drag.attack + dxBeats)
    if (drag.kind === 'decaySustain') {
      commitNumber(decay, drag.decay + dxBeats)
      commitNumber(sustain, drag.sustain + dyOpacity)
    }
    if (drag.kind === 'release') commitNumber(release, drag.release + dxBeats)
    if (drag.kind === 'plateau') commitNumber(sustain, drag.sustain + dyOpacity)
  }

  const endDrag = (event: ReactPointerEvent<SVGElement>) => {
    dragRef.current = null
    const target = event.currentTarget as SVGElement
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  }

  const handleProps = (kind: DragKind) => ({
    onPointerDown: startDrag(kind),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  })

  return (
    <div
      data-testid="visibility-envelope-editor"
      className="relative border-y border-white/[0.07]"
      style={{ background: 'radial-gradient(circle at 30% 16%, rgba(52,211,153,0.10), rgba(7,9,14,0.97) 60%), linear-gradient(150deg, #0a1410, #07090e)' }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${ENV_W} ${ENV_H}`}
        className="block h-auto w-full touch-none"
        role="group"
        aria-label="Visibility envelope: draggable attack, decay, sustain, and release handles"
      >
        {/* stage bands */}
        {regions.map((region, index) => {
          const width = (region.to - region.from) * pxPerBeat
          return (
            <g key={region.letter}>
              <rect
                x={toX(region.from)} y={ENV_TOP - 6} width={Math.max(0, width)} height={ENV_BASE - ENV_TOP + 6}
                fill={index % 2 === 0 ? 'rgba(52,211,153,0.045)' : 'rgba(255,255,255,0.015)'}
              />
              {width >= 12 && (
                <text x={toX(region.from) + width / 2} y={ENV_TOP - 8} fill="rgba(52,211,153,0.5)" fontSize="7" fontFamily="monospace" textAnchor="middle">
                  {region.letter}
                </text>
              )}
            </g>
          )
        })}
        <line x1={ENV_PAD_L} x2={ENV_W - ENV_PAD_R} y1={toY(1)} y2={toY(1)} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 4" strokeWidth="1" />
        <line x1={ENV_PAD_L} x2={ENV_W - ENV_PAD_R} y1={ENV_BASE} y2={ENV_BASE} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
        {/* gate-off marker */}
        <line x1={toX(gate)} x2={toX(gate)} y1={ENV_TOP - 4} y2={ENV_BASE} stroke="rgba(255,255,255,0.10)" strokeDasharray="2 3" strokeWidth="1" />

        <path d={fillPath} fill="rgba(52,211,153,0.12)" />
        <path d={path} fill="none" stroke="rgba(52,211,153,0.30)" strokeWidth="4" strokeLinecap="round" />
        <path d={path} fill="none" stroke={EMERALD} strokeWidth="1.5" strokeLinecap="round" />

        {/* sustain plateau drag zone */}
        <line
          x1={toX(a + d)} x2={toX(gate)} y1={toY(s)} y2={toY(s)}
          stroke="transparent" strokeWidth="14" className="cursor-ns-resize"
          {...handleProps('plateau')}
        />

        {/* handles: attack peak, decay/sustain corner, release tail */}
        {([
          {
            kind: 'attack' as const, x: toX(a), y: toY(1), cursor: 'cursor-ew-resize',
            label: `Attack ${a.toFixed(2)} beats`, testId: 'visibility-handle-attack',
            onDoubleClick: () => attack.setValue(attack.definition.default),
            onKeyDown: (event: KeyboardEvent<SVGCircleElement>) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              commitNumber(attack, a + (event.key === 'ArrowRight' ? 1 : -1) * keyStep(attack, event.shiftKey))
            },
          },
          {
            kind: 'decaySustain' as const, x: toX(a + d), y: toY(s), cursor: 'cursor-move',
            label: `Decay ${d.toFixed(2)} beats, sustain ${Math.round(s * 100)} percent`, testId: 'visibility-handle-decay-sustain',
            onDoubleClick: () => { decay.setValue(decay.definition.default); sustain.setValue(sustain.definition.default) },
            onKeyDown: (event: KeyboardEvent<SVGCircleElement>) => {
              if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
              event.preventDefault()
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                commitNumber(decay, d + (event.key === 'ArrowRight' ? 1 : -1) * keyStep(decay, event.shiftKey))
              } else {
                commitNumber(sustain, s + (event.key === 'ArrowUp' ? 1 : -1) * keyStep(sustain, event.shiftKey))
              }
            },
          },
          {
            kind: 'release' as const, x: toX(total), y: ENV_BASE, cursor: 'cursor-ew-resize',
            label: `Release ${r.toFixed(2)} beats`, testId: 'visibility-handle-release',
            onDoubleClick: () => release.setValue(release.definition.default),
            onKeyDown: (event: KeyboardEvent<SVGCircleElement>) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              commitNumber(release, r + (event.key === 'ArrowRight' ? 1 : -1) * keyStep(release, event.shiftKey))
            },
          },
        ]).map((handle) => (
          <g key={handle.kind} className={handle.cursor}>
            {/* generous invisible hit area */}
            <circle cx={handle.x} cy={handle.y} r="10" fill="transparent" {...handleProps(handle.kind)} onDoubleClick={handle.onDoubleClick} />
            <circle
              cx={handle.x} cy={handle.y} r="4.5"
              fill="#0b0e15" stroke={EMERALD} strokeWidth="2"
              data-testid={handle.testId}
              role="slider"
              tabIndex={0}
              aria-label={handle.label}
              aria-valuetext={handle.label}
              className="outline-none focus-visible:stroke-white"
              {...handleProps(handle.kind)}
              onDoubleClick={handle.onDoubleClick}
              onKeyDown={handle.onKeyDown}
            />
          </g>
        ))}

        <circle ref={dotRef} cx={toX(0)} cy={ENV_BASE} r="2.6" fill="#d4fbe9" stroke="rgba(52,211,153,0.5)" strokeWidth="2" />

        <text x={ENV_PAD_L} y={ENV_H - 5} fill="rgba(255,255,255,0.30)" fontSize="7" fontFamily="monospace">note on</text>
        <text x={toX(gate)} y={ENV_H - 5} fill="rgba(255,255,255,0.30)" fontSize="7" fontFamily="monospace" textAnchor="middle">note off</text>
        <text x={ENV_W - ENV_PAD_R} y={ENV_H - 5} fill="rgba(255,255,255,0.30)" fontSize="7" fontFamily="monospace" textAnchor="end">{total.toFixed(2)}b</text>
      </svg>
      <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[7px] text-white/25">drag handles · dbl-click resets</span>
    </div>
  )
}

// ── Grouping ─────────────────────────────────────────────────────────────────

/** Copy indices shown in the mapping strip (a representative population). */
const STRIP_INDEX_COUNT = 20

function GroupingControl({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (definition.type !== 'select') return null
  const grouping = typeof bound.value === 'number' ? bound.value : definition.default

  // Mirrors visibilityGroupCount / noteControlsVisibilityIndex for the strip.
  const groupCount = grouping > 0 ? Math.min(STRIP_INDEX_COUNT, Math.ceil(100 / grouping)) : STRIP_INDEX_COUNT
  const groupOfIndex = (index: number) =>
    grouping <= 0 ? index : Math.min(groupCount - 1, Math.floor((index / STRIP_INDEX_COUNT) * groupCount))
  const groupSizes = Array.from({ length: groupCount }, (_, group) =>
    Array.from({ length: STRIP_INDEX_COUNT }, (_, index) => index).filter((index) => groupOfIndex(index) === group).length,
  )

  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-1.5">
      <span className="px-0.5 text-[8px] font-semibold tracking-[0.1em] text-white/38">NOTE MAPPING</span>
      <div className="mt-1 grid grid-cols-5 gap-1">
        {definition.options.map((option) => {
          const active = option.value === grouping
          return (
            <button
              key={option.value}
              data-testid={`visibility-grouping-${option.value}`}
              aria-pressed={active}
              onClick={() => bound.setValue(option.value)}
              className={`truncate rounded-md border px-1 py-1.5 text-[7px] font-semibold tracking-[0.05em] transition-colors ${active
                ? 'border-emerald-300/40 bg-emerald-500/15 text-emerald-100'
                : 'border-white/[0.07] bg-white/[0.025] text-white/32 hover:bg-white/[0.06] hover:text-white/65'}`}
            >
              {option.label.toUpperCase()}
            </button>
          )
        })}
      </div>

      {/* index → MIDI row strip */}
      <div className="mt-1.5 flex h-4 overflow-hidden rounded border border-white/[0.08]" role="img" aria-label={`How ${STRIP_INDEX_COUNT} copy indices map onto MIDI rows`}>
        {Array.from({ length: STRIP_INDEX_COUNT }, (_, index) => {
          const group = groupOfIndex(index)
          const first = index === 0 || groupOfIndex(index - 1) !== group
          return (
            <span
              key={index}
              className="h-full flex-1"
              style={{
                background: group % 2 === 0 ? 'rgba(52,211,153,0.30)' : 'rgba(52,211,153,0.10)',
                borderLeft: first && index > 0 ? '1px solid rgba(11,14,21,0.9)' : 'none',
              }}
            />
          )
        })}
      </div>
      {groupCount <= 10 ? (
        <div className="mt-0.5 flex">
          {groupSizes.map((size, group) => (
            <span key={group} className="text-center font-mono text-[7px] text-white/35" style={{ flexGrow: size, flexBasis: 0 }}>
              {127 - group}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-0.5 text-center font-mono text-[7px] text-white/35">
          pitches 127 … {127 - groupCount + 1} · one MIDI row per copy index
        </p>
      )}
      <p className="mt-1 px-0.5 font-mono text-[7px] leading-tight text-white/22">
        {grouping <= 0
          ? `each copy gets its own row (${STRIP_INDEX_COUNT} copies shown)`
          : `copies collapse into ${grouping}% groups - one row gates each group`}
      </p>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

const PLACED_KEYS = new Set(['grouping', 'attackBeats', 'decayBeats', 'sustainLevel', 'releaseBeats'])

export const VisibilityMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const grouping = parameter(parameters, 'grouping')
  const attack = parameter(parameters, 'attackBeats')
  const decay = parameter(parameters, 'decayBeats')
  const sustain = parameter(parameters, 'sustainLevel')
  const release = parameter(parameters, 'releaseBeats')

  if (!grouping || !attack || !decay || !sustain || !release) {
    return <ParameterList parameters={parameters} />
  }

  const unplaced = parameters.filter((bound) => !PLACED_KEYS.has(bound.definition.key))

  const resetAll = () => {
    for (const bound of parameters) bound.setValue(bound.definition.default)
  }

  const readouts: { label: string; text: string }[] = [
    { label: 'A', text: `${numericValue(attack).toFixed(2)}b` },
    { label: 'D', text: `${numericValue(decay).toFixed(2)}b` },
    { label: 'S', text: `${Math.round(clamp(numericValue(sustain, 1), 0, 1) * 100)}%` },
    { label: 'R', text: `${numericValue(release, 0.05).toFixed(2)}b` },
  ]

  return (
    <section
      data-testid="visibility-user-interface"
      className="-mx-1 overflow-hidden rounded-xl border border-white/[0.09] bg-[#0b0e15] text-white shadow-[0_18px_42px_rgba(0,0,0,.34)]"
    >
      <header className="flex h-10 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-emerald-300/25 bg-emerald-500/15 text-emerald-200">
            <Eye size={13} strokeWidth={1.75} />
          </div>
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.13em] text-white/85">Visibility</span>
        </div>
        <button
          aria-label="Reset all Visibility parameters"
          title="Reset all"
          onClick={resetAll}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-white/35 transition-colors hover:bg-white/[0.08] hover:text-white/70"
        >
          <RotateCcw size={12} />
        </button>
      </header>

      <EnvelopeEditor attack={attack} decay={decay} sustain={sustain} release={release} />

      <div className="space-y-2 p-2">
        <div className="grid grid-cols-4 gap-1">
          {readouts.map((readout) => (
            <div key={readout.label} className="flex items-baseline justify-center gap-1 rounded border border-white/[0.06] bg-white/[0.025] py-1">
              <span className="text-[8px] font-bold tracking-[0.08em] text-emerald-300/70">{readout.label}</span>
              <span className="font-mono text-[9px] tabular-nums text-white/70">{readout.text}</span>
            </div>
          ))}
        </div>

        <GroupingControl bound={grouping} />

        {unplaced.length > 0 && (
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-2">
            <ParameterList parameters={unplaced} />
          </div>
        )}
      </div>
    </section>
  )
}

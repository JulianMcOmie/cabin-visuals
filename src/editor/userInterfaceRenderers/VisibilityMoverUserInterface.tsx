'use client'

// Bespoke settings for the Visibility mover (definition id 'visibility'),
// rebuilt to docs/instrument-panel-design-guide.md (Laser Sphere is the
// reference): a live preview of a dummy object being gated by the REAL
// envelope up top, the envelope itself as a grabbable signal window, then a
// row of four knobs - ATTACK, DECAY, SUSTAIN, RELEASE. Note mapping lives
// behind MORE as the plain control list.
//
// Nothing here approximates the shape: the preview's fade, the window's
// curve, and the window's playhead all sample evaluateVisibilityOpacity
// (with a synthetic gate note held exactly long enough to reach sustain) off
// the same wall clock, so what fades here is exactly what the engine renders
// - including the hold = max(duration, attack) rule and the gradual release
// tail.

import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useFrame } from '@react-three/fiber'
import { PreviewCanvas, usePreviewLoop } from './console'
import { OrbitControls } from '@react-three/drei'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { MeshStandardMaterial } from 'three'
import { evaluateVisibilityOpacity } from '../core/visualCopies/visibility'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
import { LaserKnob } from './laserKnob'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'
import { VISIBILITY_COLOR } from '../core/visualCopies/identityColors'
import { clamp } from '../utils/math'

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

// The mover has no color param (it gates whatever object it sits under), so
// the panel keeps the emerald it has always worn in the app's chrome.
const EMERALD = VISIBILITY_COLOR
const EMERALD_HSV = hexToHsv(EMERALD)
/** Hue-true dark shade per the guide - never an alpha tint over panel gray. */
const SHADE = hsvToHex(EMERALD_HSV.h, Math.min(EMERALD_HSV.s, 0.5), 0.075)
const ROOM = '#05070c'

// ── The shared demo clock ────────────────────────────────────────────────────
// One synthetic gate, looped forever: held long enough past decay to show the
// sustain plateau, then released, then a beat of darkness. Preview and window
// both derive the beat from the wall clock with this same function, so the
// object's fade and the playhead never drift apart.

/** Beats of visible sustain plateau between decay landing and gate-off. */
const HOLD_BEATS = 0.75
/** Beats of darkness between loops, so "gone" is part of the demonstration. */
const GAP_BEATS = 0.75
const BEATS_PER_SECOND = 2

function loopBeat(nowMs: number, total: number): number {
  return ((nowMs / 1000) * BEATS_PER_SECOND) % (total + GAP_BEATS)
}

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

// ── Live preview ─────────────────────────────────────────────────────────────
// The subject is a deliberately dumb object - a plain cube on a floor - because
// the mover's whole job is making SOMETHING appear and disappear; the floor
// stays so the room still reads when the cube is gone.

function PreviewSubject({ a, d, s, r }: { a: number; d: number; s: number; r: number }) {
  const materialRef = useRef<MeshStandardMaterial>(null)

  useFrame(() => {
    const material = materialRef.current
    if (!material) return
    const gate = a + d + HOLD_BEATS
    const total = gate + r
    material.opacity = sampleEnvelope(a, d, s, r, gate, loopBeat(performance.now(), total))
  })

  return (
    <mesh rotation={[0.34, 0.6, 0]} position={[0, -0.1, 0]}>
      <boxGeometry args={[1.15, 1.15, 1.15]} />
      <meshStandardMaterial ref={materialRef} color="#93a8c4" metalness={0.3} roughness={0.35} transparent />
    </mesh>
  )
}

function FadePreview({ a, d, s, r }: { a: number; d: number; s: number; r: number }) {
  return (
    <div
      data-testid="visibility-fade-preview"
      title="Drag to orbit"
      className="relative h-[118px] cursor-grab overflow-hidden border-b border-white/[0.06] active:cursor-grabbing"
      style={{ background: ROOM }}
    >
      <PreviewCanvas dpr={[1, 2]} camera={{ position: [0, 1.1, 3.6], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        <color attach="background" args={[ROOM]} />
        <PreviewSubject a={a} d={d} s={s} r={r} />
        <directionalLight position={[3, 5, 4]} intensity={1.2} color="#e8f0ff" />
        <pointLight position={[-2.5, 1.5, 2]} intensity={5} color={EMERALD} distance={12} decay={2} />
        <ambientLight intensity={0.18} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.85, 0]}>
          <circleGeometry args={[4.5, 48]} />
          <meshStandardMaterial color="#080b11" roughness={1} metalness={0} />
        </mesh>
        <OrbitControls
          makeDefault
          target={[0, -0.1, 0]}
          enablePan={false}
          enableZoom={false}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI * 0.62}
        />
      </PreviewCanvas>
    </div>
  )
}

// ── ADSR envelope window ─────────────────────────────────────────────────────
// The signal window is also the editor (the guide's sanctioned exception):
// grabbable handles for attack, decay/sustain, and release, with the knobs
// below giving the same values numeric, fine control.

// Percent-space geometry: the SVG viewBox is 0-100 stretched with
// preserveAspectRatio="none" (per the guide), strokes stay clean via
// vectorEffect, and the handles are absolutely-positioned HTML dots so they
// never distort with the stretch (AutomationUserInterface's CurveHandle).
const ENV_X0 = 4
const ENV_X1 = 96
const ENV_Y_TOP = 12
const ENV_Y_BASE = 84

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
  clientPxPerBeat: number
  clientPxPerOpacity: number
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
  const padRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<EnvelopeDrag | null>(null)

  const a = Math.max(0, numericValue(attack))
  const d = Math.max(0, numericValue(decay))
  const s = clamp(numericValue(sustain, 1), 0, 1)
  const r = Math.max(0, numericValue(release, 0.05))
  const gate = a + d + HOLD_BEATS
  const total = gate + r
  const windowBeats = Math.max(total * 1.05, 1)
  const toX = (beat: number) => ENV_X0 + (beat / windowBeats) * (ENV_X1 - ENV_X0)
  const toY = (opacity: number) => ENV_Y_BASE - opacity * (ENV_Y_BASE - ENV_Y_TOP)

  const samples = 200
  let path = ''
  for (let i = 0; i <= samples; i++) {
    const beat = (i / samples) * total
    path += `${i === 0 ? 'M' : 'L'}${toX(beat).toFixed(2)},${toY(sampleEnvelope(a, d, s, r, gate, beat)).toFixed(2)}`
  }
  const fillPath = `${path} L${toX(total).toFixed(2)},${ENV_Y_BASE} L${toX(0).toFixed(2)},${ENV_Y_BASE} Z`

  // The playhead rides the same clock and the same evaluator as the preview
  // cube above, so the dot's height IS the cube's opacity at every instant.
  const liveRef = useRef({ a, d, s, r, gate, total, windowBeats })
  liveRef.current = { a, d, s, r, gate, total, windowBeats }

  const hostRef = usePreviewLoop((tSec) => {
    const live = liveRef.current
    const beat = loopBeat(tSec * 1000, live.total)
    const inGap = beat > live.total
    const opacity = inGap ? 0 : sampleEnvelope(live.a, live.d, live.s, live.r, live.gate, beat)
    const dot = dotRef.current
    if (dot) {
      dot.style.left = `${ENV_X0 + (Math.min(beat, live.total) / live.windowBeats) * (ENV_X1 - ENV_X0)}%`
      dot.style.top = `${ENV_Y_BASE - opacity * (ENV_Y_BASE - ENV_Y_TOP)}%`
      dot.style.opacity = inGap ? '0' : '1'
    }
  })

  const startDrag = (kind: DragKind) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    dragRef.current = {
      kind,
      clientX: event.clientX,
      clientY: event.clientY,
      attack: a,
      decay: d,
      sustain: s,
      release: r,
      clientPxPerBeat: (rect.width * (ENV_X1 - ENV_X0)) / 100 / windowBeats,
      clientPxPerOpacity: (rect.height * (ENV_Y_BASE - ENV_Y_TOP)) / 100,
    }
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dxBeats = (event.clientX - drag.clientX) / drag.clientPxPerBeat
    const dyOpacity = (drag.clientY - event.clientY) / drag.clientPxPerOpacity
    if (drag.kind === 'attack') commitNumber(attack, drag.attack + dxBeats)
    if (drag.kind === 'decaySustain') {
      commitNumber(decay, drag.decay + dxBeats)
      commitNumber(sustain, drag.sustain + dyOpacity)
    }
    if (drag.kind === 'release') commitNumber(release, drag.release + dxBeats)
    if (drag.kind === 'plateau') commitNumber(sustain, drag.sustain + dyOpacity)
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleProps = (kind: DragKind) => ({
    onPointerDown: startDrag(kind),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  })

  const handles = [
    {
      kind: 'attack' as const, x: toX(a), y: toY(1), cursor: 'ew-resize',
      label: `Attack ${a.toFixed(2)} beats`, testId: 'visibility-handle-attack',
      onDoubleClick: () => attack.setValue(attack.definition.default),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        commitNumber(attack, a + (event.key === 'ArrowRight' ? 1 : -1) * keyStep(attack, event.shiftKey))
      },
    },
    {
      kind: 'decaySustain' as const, x: toX(a + d), y: toY(s), cursor: 'move',
      label: `Decay ${d.toFixed(2)} beats, sustain ${Math.round(s * 100)} percent`, testId: 'visibility-handle-decay-sustain',
      onDoubleClick: () => { decay.setValue(decay.definition.default); sustain.setValue(sustain.definition.default) },
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
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
      kind: 'release' as const, x: toX(total), y: ENV_Y_BASE, cursor: 'ew-resize',
      label: `Release ${r.toFixed(2)} beats`, testId: 'visibility-handle-release',
      onDoubleClick: () => release.setValue(release.definition.default),
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        commitNumber(release, r + (event.key === 'ArrowRight' ? 1 : -1) * keyStep(release, event.shiftKey))
      },
    },
  ]

  return (
    <div
      ref={hostRef}
      data-testid="visibility-envelope-editor"
      className="relative h-[96px] select-none overflow-hidden border-b border-white/[0.06]"
      style={{ background: ROOM }}
    >
      <div
        ref={padRef}
        role="group"
        aria-label="Visibility envelope: draggable attack, decay, sustain, and release handles"
        className="absolute inset-0"
      >
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <line x1={ENV_X0} x2={ENV_X1} y1={ENV_Y_BASE} y2={ENV_Y_BASE} stroke="rgba(255,255,255,0.10)" strokeWidth={1} vectorEffect="non-scaling-stroke" />

          <path d={fillPath} fill={withAlpha(EMERALD, 0.1)} stroke="none" />
          {/* Light lives along the path: three stacked strokes of the same
              geometry - wide/dim, medium, thin white-hot - per the guide. */}
          <path d={path} fill="none" stroke={EMERALD} strokeWidth={6} strokeOpacity={0.16} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke={EMERALD} strokeWidth={2.5} strokeOpacity={0.45} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke={towardWhite(EMERALD, 0.7)} strokeWidth={1.25} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>

        {/* sustain plateau drag zone */}
        <div
          className="absolute h-[14px] -translate-y-1/2"
          style={{ left: `${toX(a + d)}%`, width: `${Math.max(0, toX(gate) - toX(a + d))}%`, top: `${toY(s)}%`, cursor: 'ns-resize' }}
          {...handleProps('plateau')}
        />

        {/* the playhead: same clock, same evaluator as the cube above */}
        <div
          ref={dotRef}
          aria-hidden="true"
          className="pointer-events-none absolute h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${ENV_X0}%`, top: `${ENV_Y_BASE}%`, background: '#d4fbe9', boxShadow: `0 0 6px 1px ${withAlpha(EMERALD, 0.8)}` }}
        />

        {/* handles: attack peak, decay/sustain corner, release tail */}
        {handles.map((handle) => (
          <div
            key={handle.kind}
            role="slider"
            tabIndex={0}
            aria-label={handle.label}
            aria-valuetext={handle.label}
            data-testid={handle.testId}
            title={`${handle.label} · drag · double-click to reset`}
            className="absolute z-10 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 touch-none select-none rounded-full border border-white/70 outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            style={{
              left: `${handle.x}%`,
              top: `${handle.y}%`,
              cursor: handle.cursor,
              background: towardWhite(EMERALD, 0.55),
              boxShadow: `0 0 6px 1px ${withAlpha(EMERALD, 0.8)}`,
            }}
            {...handleProps(handle.kind)}
            onDoubleClick={handle.onDoubleClick}
            onKeyDown={handle.onKeyDown}
          />
        ))}
      </div>
    </div>
  )
}

// ── Knobs ────────────────────────────────────────────────────────────────────

function EnvelopeKnob({ parameter: bound, label, format, suffix }: {
  parameter: UserInterfaceParameter
  label: string
  format?: (value: number) => string
  suffix?: string
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
      accent={EMERALD}
      format={format}
      suffix={suffix}
      onChange={bound.setValue}
    />
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

const PLACED_KEYS = new Set(['attackBeats', 'decayBeats', 'sustainLevel', 'releaseBeats'])

const asPercent = (value: number) => `${Math.round(value * 100)}%`

export const VisibilityMoverUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const [showMore, setShowMore] = useState(false)

  const attack = parameter(parameters, 'attackBeats')
  const decay = parameter(parameters, 'decayBeats')
  const sustain = parameter(parameters, 'sustainLevel')
  const release = parameter(parameters, 'releaseBeats')

  if (!attack || !decay || !sustain || !release) {
    return <ParameterList parameters={parameters} />
  }

  const unplaced = parameters.filter((bound) => !PLACED_KEYS.has(bound.definition.key))

  return (
    <section
      data-testid="visibility-user-interface"
      className="-mx-3 -mt-3"
      style={{ background: SHADE }}
    >
      <FadePreview
        a={Math.max(0, numericValue(attack))}
        d={Math.max(0, numericValue(decay))}
        s={clamp(numericValue(sustain, 1), 0, 1)}
        r={Math.max(0, numericValue(release, 0.05))}
      />
      <EnvelopeEditor attack={attack} decay={decay} sustain={sustain} release={release} />
      <div
        className="flex flex-col gap-2 pb-4 pt-3"
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(EMERALD, 0.1)}, transparent)` }}
      >
        <div className="flex items-end gap-5 px-4">
          <EnvelopeKnob parameter={attack} label="ATTACK" suffix="b" />
          <EnvelopeKnob parameter={decay} label="DECAY" suffix="b" />
          <EnvelopeKnob parameter={sustain} label="SUSTAIN" format={asPercent} />
          <EnvelopeKnob parameter={release} label="RELEASE" suffix="b" />
        </div>
        {unplaced.length > 0 && (
          <div className="px-3">
            <button
              aria-expanded={showMore}
              onClick={() => setShowMore((value) => !value)}
              className="flex items-center gap-1 text-[8px] font-bold tracking-[0.18em] text-white/30 hover:text-white/60"
            >
              {showMore ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              MORE
            </button>
            {showMore && (
              <div className="mt-1.5 rounded-md border border-white/[0.06] bg-black/25 p-2">
                <ParameterList parameters={unplaced} />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import type { SynthMod, SynthModLife, SynthModShape } from '../types'
import type { UserInterfaceParameter } from './types'
import {
  DEFAULT_SYNTH_MODS, SYNTH_MOD_TARGETS, mkSynthMod, sampleSynthMod,
  synthModSpanBeats, synthModTargetSpec,
} from '../instruments/modSynthCore'
import { MOD_SYNTH_DEFAULT_COLOR } from '../instruments/ModSynth'
import {
  Console, ControlRow, Knob, ColorPill, LaserKnob, Segmented, ParameterList,
  bindPanel, towardWhite, withAlpha,
} from './console'

// The Mod Synth console (design locked by the 2026-08-25 mock): an OVERVIEW
// window plotting every enabled modulator's curve, the base SIZE/COLOR row,
// then the STACK rack - one row per modulator (power dot · name · sparkline ·
// chevron), expanding into the ENV editor: shape segments, a draggable-handle
// curve window, life segments, and the AMOUNT/VEL/KEY(/BEATS) knobs. The
// window plots through modSynthCore's own sampler, so the picture cannot
// drift from playback. All rack edits go through setTrackSynthMods (the
// videoPads pattern); expansion/hover are view state and stay local.

/** The demo note the plots stretch gate-life curves over. */
const DEMO_NOTE_BEATS = 1.5
/** Loop-life plots show this many cycles. */
const LOOP_PLOT_CYCLES = 3
/** Curve values may overshoot 1 (bezier control Ys past 1); the plot ceiling. */
const PLOT_CEIL = 1.15

const SHAPE_ORDER: readonly SynthModShape[] = ['adsr', 'bezier', 'points']
const LIFE_ORDER: readonly SynthModLife[] = ['gate', 'oneshot', 'loop']

const SHAPE_GLYPHS: Record<SynthModShape, React.ReactNode> = {
  adsr: (
    <svg viewBox="0 0 16 10" className="h-[10px] w-4" aria-hidden>
      <path d="M0,10 3,1 6,5 11,5 16,10" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  bezier: (
    <svg viewBox="0 0 16 10" className="h-[10px] w-4" aria-hidden>
      <path d="M0,10 C5,-3 8,2 16,10" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  points: (
    <svg viewBox="0 0 16 10" className="h-[10px] w-4" aria-hidden>
      <path d="M0,9 4,2 8,6 12,3 16,9" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="2" r="1.4" fill="currentColor" />
      <circle cx="12" cy="3" r="1.4" fill="currentColor" />
    </svg>
  ),
}

/** The demo note duration a plot samples this modulator against - loop lives
 *  get a note long enough to keep cycling for the whole window. */
function plotNoteBeats(mod: SynthMod): number {
  if (mod.life !== 'loop') return DEMO_NOTE_BEATS
  const cycle = mod.shape === 'adsr'
    ? Math.max(mod.attack + mod.decay + mod.release, 1e-3)
    : Math.max(mod.beats, 1e-3)
  return cycle * LOOP_PLOT_CYCLES
}

/** How many beats of signal the window shows for this modulator. */
function plotWindowBeats(mod: SynthMod): number {
  const noteBeats = plotNoteBeats(mod)
  if (mod.life === 'loop') return noteBeats
  return Math.max(synthModSpanBeats(mod, noteBeats), 1e-3)
}

/** SVG path of the raw curve over the plot window, in a W×H box with the
 *  baseline sitting `padY` above the bottom edge. */
function modPlotPath(mod: SynthMod, w: number, h: number, padY = 6): string {
  const win = plotWindowBeats(mod)
  const noteBeats = plotNoteBeats(mod)
  const top = 5
  const y = (v: number) => top + (1 - Math.min(Math.max(v, 0), PLOT_CEIL) / PLOT_CEIL) * (h - top - padY)
  const steps = 72
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * win
    const v = sampleSynthMod(mod, t, noteBeats)
    d += `${i ? 'L' : 'M'}${((i / steps) * w).toFixed(2)},${y(v).toFixed(2)} `
  }
  return d
}

function OverviewWindow({ mods, hoveredId, accent }: {
  mods: readonly SynthMod[]
  hoveredId: string | null
  accent: string
}) {
  return (
    <div className="h-24 border-b border-white/[0.06] bg-[#05070c]">
      <svg viewBox="0 0 300 96" preserveAspectRatio="none" className="block h-full w-full">
        <line x1="0" y1="90" x2="300" y2="90" stroke="rgba(255,255,255,.07)" vectorEffect="non-scaling-stroke" />
        {mods.map((mod) => {
          const d = modPlotPath(mod, 300, 96)
          if (!mod.enabled) {
            return <path key={mod.id} d={d} fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          }
          const hot = mod.id === hoveredId
          return (
            <g key={mod.id}>
              <path d={d} fill="none" stroke={accent} strokeOpacity={hot ? 0.4 : 0.16} strokeWidth="5" vectorEffect="non-scaling-stroke" />
              <path d={d} fill="none" stroke={hot ? '#ffffff' : towardWhite(accent, 0.35)} strokeOpacity={hot ? 1 : 0.75} strokeWidth={hot ? 1.8 : 1.2} vectorEffect="non-scaling-stroke" />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

interface HandleSpec { role: 'attack' | 'ds' | 'release' | 'p1' | 'p2' | 'pt'; index: number; x: number; y: number }

/** The grabbable points of the expanded editor, in window-normalized coords. */
function editorHandles(mod: SynthMod): HandleSpec[] {
  const win = plotWindowBeats(mod)
  if (mod.shape === 'adsr') {
    const relStart = mod.life === 'gate' ? plotNoteBeats(mod) : mod.attack + mod.decay
    return [
      { role: 'attack', index: 0, x: mod.attack / win, y: 1 },
      { role: 'ds', index: 0, x: (mod.attack + mod.decay) / win, y: mod.sustain },
      { role: 'release', index: 0, x: Math.min((relStart + mod.release) / win, 1), y: 0 },
    ]
  }
  // The bezier/points curve occupies one CYCLE of the window (the whole window
  // except under loop, where the first of the three plotted cycles is edited).
  const cycleFrac = mod.life === 'loop' ? 1 / LOOP_PLOT_CYCLES : 1
  if (mod.shape === 'bezier') {
    return mod.bezier.map((p, i): HandleSpec => ({ role: i === 0 ? 'p1' : 'p2', index: i, x: p.x * cycleFrac, y: p.y }))
  }
  return mod.points.map((p, i): HandleSpec => ({ role: 'pt', index: i, x: p.x * cycleFrac, y: p.y }))
}

function applyHandleDrag(mod: SynthMod, role: HandleSpec['role'], index: number, nx: number, ny: number): Partial<SynthMod> {
  const win = plotWindowBeats(mod)
  const t = nx * win
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  if (role === 'attack') return { attack: clamp(t, 0.01, 4) }
  if (role === 'ds') return { decay: clamp(t - mod.attack, 0.02, 4), sustain: clamp(ny, 0, 1) }
  if (role === 'release') {
    const relStart = mod.life === 'gate' ? plotNoteBeats(mod) : mod.attack + mod.decay
    return { release: clamp(t - relStart, 0.02, 8) }
  }
  const cycleFrac = mod.life === 'loop' ? 1 / LOOP_PLOT_CYCLES : 1
  const cx = clamp(nx / cycleFrac, 0, 1)
  const cy = clamp(ny, 0, PLOT_CEIL)
  if (role === 'p1') return { bezier: [{ x: cx, y: cy }, mod.bezier[1]] }
  if (role === 'p2') return { bezier: [mod.bezier[0], { x: cx, y: cy }] }
  const pts = mod.points.map((p) => ({ ...p }))
  const p = pts[index]
  if (!p) return {}
  if (index > 0 && index < pts.length - 1) {
    p.x = clamp(cx, pts[index - 1].x + 0.02, pts[index + 1].x - 0.02)
  }
  p.y = clamp(cy, 0, 1.05)
  return { points: pts }
}

function CurveWindow({ mod, accent, onPatch }: {
  mod: SynthMod
  accent: string
  onPatch: (patch: Partial<SynthMod>) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ role: HandleSpec['role']; index: number } | null>(null)
  const win = plotWindowBeats(mod)
  const noteBeats = plotNoteBeats(mod)
  const d = modPlotPath(mod, 300, 110)
  const top = 5, padY = 6, plotH = 110 - top - padY

  const beatLines: number[] = []
  for (let b = 1; b < win; b++) beatLines.push(b / win)

  const noteFrac = mod.life === 'oneshot' ? 0 : Math.min(noteBeats / win, 1)

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    const host = hostRef.current
    if (!drag || !host) return
    const rect = host.getBoundingClientRect()
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const py = ((e.clientY - rect.top) / rect.height) * 110
    const ny = (1 - (py - top) / plotH) * PLOT_CEIL
    onPatch(applyHandleDrag(mod, drag.role, drag.index, nx, ny))
  }

  return (
    <div
      ref={hostRef}
      className="relative h-[110px] touch-none overflow-hidden rounded-t border-b border-white/[0.06] bg-[#05070c]"
      onPointerMove={onPointerMove}
      onPointerUp={(e) => { dragRef.current = null; (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId) }}
    >
      <svg viewBox="0 0 300 110" preserveAspectRatio="none" className="block h-full w-full">
        {beatLines.map((x) => (
          <line key={x} x1={x * 300} y1="0" x2={x * 300} y2="102" stroke="rgba(255,255,255,.05)" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1="0" y1={110 - padY} x2="300" y2={110 - padY} stroke="rgba(255,255,255,.07)" vectorEffect="non-scaling-stroke" />
        {mod.life === 'gate' && <rect x="0" y="105" width={noteFrac * 300} height="4" fill={withAlpha(accent, 0.35)} />}
        {mod.life === 'oneshot' && <rect x="0" y="105" width="6" height="4" fill={withAlpha(accent, 0.5)} />}
        {mod.life === 'loop' && <rect x="0" y="105" width="300" height="4" fill={withAlpha(accent, 0.2)} />}
        <path d={d} fill="none" stroke={accent} strokeOpacity="0.22" strokeWidth="6" vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke={towardWhite(accent, 0.35)} strokeOpacity="0.7" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
        <path d={d} fill="none" stroke="#fff" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      {editorHandles(mod).map((h) => (
        <div
          key={`${h.role}-${h.index}`}
          role="slider"
          aria-label={`${mod.target} ${h.role}`}
          aria-valuenow={Math.round(h.y * 100)}
          tabIndex={-1}
          className="absolute z-10 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-[1.5px] bg-[#0c0e14] active:cursor-grabbing"
          style={{
            left: `${h.x * 100}%`,
            top: `${((top + (1 - Math.min(Math.max(h.y, 0), PLOT_CEIL) / PLOT_CEIL) * plotH) / 110) * 100}%`,
            borderColor: accent,
            boxShadow: `0 0 7px ${withAlpha(accent, 0.6)}`,
          }}
          onPointerDown={(e) => {
            dragRef.current = { role: h.role, index: h.index }
            hostRef.current?.setPointerCapture(e.pointerId)
            e.preventDefault()
            e.stopPropagation()
          }}
        />
      ))}
    </div>
  )
}

function ModRow({ mod, accent, expanded, onToggle, onHover, onPatch, onRemove }: {
  mod: SynthMod
  accent: string
  expanded: boolean
  onToggle: () => void
  onHover: (id: string | null) => void
  onPatch: (patch: Partial<SynthMod>) => void
  onRemove: () => void
}) {
  const spec = synthModTargetSpec(mod.target)
  const showBeats = mod.shape !== 'adsr' && mod.life !== 'gate'
  return (
    <div
      className={`rounded-md border bg-white/[0.03] ${expanded ? '' : ''} ${mod.enabled ? '' : 'opacity-50'}`}
      style={{ borderColor: expanded ? withAlpha(accent, 0.35) : 'rgba(255,255,255,.07)' }}
      onMouseEnter={() => onHover(mod.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex cursor-pointer items-center gap-2 px-2 py-1.5" onClick={onToggle}>
        <button
          type="button"
          aria-label={mod.enabled ? 'Disable modulator' : 'Enable modulator'}
          aria-pressed={mod.enabled}
          className="h-3 w-3 flex-none cursor-pointer rounded-full border-[1.5px]"
          style={mod.enabled
            ? { borderColor: accent, background: withAlpha(accent, 0.9), boxShadow: `0 0 7px ${withAlpha(accent, 0.7)}` }
            : { borderColor: 'rgba(255,255,255,.25)' }}
          onClick={(e) => { e.stopPropagation(); onPatch({ enabled: !mod.enabled }) }}
        />
        <span
          className="w-[64px] text-[11px] tracking-[0.06em]"
          style={{ color: expanded ? towardWhite(accent, 0.55) : 'rgba(255,255,255,.72)' }}
        >
          {spec.label}
        </span>
        <svg viewBox="0 0 300 96" preserveAspectRatio="none" className="h-[18px] min-w-0 flex-1" aria-hidden>
          <path d={modPlotPath(mod, 300, 96)} fill="none" stroke={accent} strokeOpacity="0.9" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="flex-none px-1 text-[10px] text-white/35">{expanded ? '▾' : '▸'}</span>
      </div>
      {expanded && (
        <div className="px-2 pb-2">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[10px] tracking-[0.12em] text-white/40">ENV</span>
            <Segmented
              name="Curve shape"
              options={SHAPE_ORDER.map((s, i) => ({ value: i, label: s.toUpperCase(), glyph: SHAPE_GLYPHS[s] }))}
              value={SHAPE_ORDER.indexOf(mod.shape)}
              onChange={(v) => onPatch({ shape: SHAPE_ORDER[v] ?? 'adsr' })}
              className="max-w-[190px] flex-1"
            />
            <button
              type="button"
              aria-label="Remove modulator"
              className="ml-auto cursor-pointer px-1 text-[13px] text-white/25 hover:text-red-300"
              onClick={onRemove}
            >
              ✕
            </button>
          </div>
          <CurveWindow mod={mod} accent={accent} onPatch={onPatch} />
          <div className="pt-1.5">
            <Segmented
              name="Lifecycle"
              options={[{ value: 0, label: 'GATE' }, { value: 1, label: 'ONE-SHOT' }, { value: 2, label: 'LOOP' }]}
              value={LIFE_ORDER.indexOf(mod.life)}
              onChange={(v) => onPatch({ life: LIFE_ORDER[v] ?? 'gate' })}
              className="max-w-[220px]"
            />
          </div>
          <div className="flex items-end gap-4 pt-2">
            <LaserKnob
              value={mod.amount} min={spec.amountMin} max={spec.amountMax} step={spec.amountStep}
              defaultValue={spec.amountDefault} label="AMOUNT" accent={accent}
              bipolar={spec.bipolar}
              onChange={(v) => onPatch({ amount: v })}
            />
            <LaserKnob
              value={mod.velocity} min={0} max={1} step={0.01} defaultValue={0.5}
              label="VEL" ariaLabel="Velocity sensitivity" accent={accent}
              onChange={(v) => onPatch({ velocity: v })}
            />
            <LaserKnob
              value={mod.keyTracking} min={0} max={1} step={0.01} defaultValue={0}
              label="KEY" ariaLabel="Key tracking" accent={accent}
              onChange={(v) => onPatch({ keyTracking: v })}
            />
            {showBeats && (
              <LaserKnob
                value={mod.beats} min={0.25} max={8} step={0.25} defaultValue={1}
                label="BEATS" ariaLabel="Flight length in beats" accent={accent} suffix="b"
                onChange={(v) => onPatch({ beats: v })}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function ModSynthUserInterfaceRenderer({ targetId, parameters }: {
  targetId: string
  parameters: readonly UserInterfaceParameter[]
}) {
  // Resolved INSIDE the memo: this panel also subscribes to the store, so a
  // memoized binder would come back drained on store-driven re-renders (the
  // trap in this directory's CLAUDE.md).
  const bound = useMemo(() => {
    const b = bindPanel(parameters)
    return { size: b.num('size'), color: b.color('color'), missing: b.missing }
  }, [parameters])

  const storedMods = useProjectStore((s) => s.tracks[targetId]?.synthMods)
  const setTrackSynthMods = useProjectStore((s) => s.setTrackSynthMods)
  const mods = storedMods ?? DEFAULT_SYNTH_MODS

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(mods[0] ? [mods[0].id] : []))
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuOpen])

  if (bound.missing || !bound.color) return <ParameterList parameters={parameters} />
  const accent = bound.color.value || MOD_SYNTH_DEFAULT_COLOR

  const commit = (next: SynthMod[]) => setTrackSynthMods(targetId, next)
  const patchMod = (id: string, patch: Partial<SynthMod>) =>
    commit(mods.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const addMod = (target: SynthMod['target']) => {
    let n = mods.length
    let id = `mod-${n}`
    while (mods.some((m) => m.id === id)) id = `mod-${++n}`
    const mod = mkSynthMod(target, id)
    commit([...mods, mod])
    setExpanded(new Set([...expanded, id]))
    setMenuOpen(false)
  }
  const toggleExpanded = (id: string) => {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
  }

  return (
    <Console accent={accent} testId="mod-synth-user-interface">
      <OverviewWindow mods={mods} hoveredId={hoveredId} accent={accent} />
      <ControlRow spill className="gap-5 px-4 pb-3 pt-3">
        <Knob b={bound.size} label="SIZE" large />
        <div className="ml-auto">
          <ColorPill b={bound.color} />
        </div>
      </ControlRow>
      <div className="flex flex-col gap-[5px] px-3 pb-3">
        {mods.map((mod) => (
          <ModRow
            key={mod.id}
            mod={mod}
            accent={accent}
            expanded={expanded.has(mod.id)}
            onToggle={() => toggleExpanded(mod.id)}
            onHover={setHoveredId}
            onPatch={(patch) => patchMod(mod.id, patch)}
            onRemove={() => commit(mods.filter((m) => m.id !== mod.id))}
          />
        ))}
        <div ref={menuRef} className="relative self-start">
          <button
            type="button"
            className="cursor-pointer rounded-full border border-dashed border-white/20 px-3 py-1 text-[11px] text-white/45 hover:border-white/40 hover:text-white/80"
            onClick={() => setMenuOpen((open) => !open)}
          >
            + ADD MODULATION
          </button>
          {menuOpen && (
            <div className="absolute bottom-full left-0 z-30 mb-1.5 grid w-[196px] grid-cols-2 gap-[2px] rounded-lg border border-white/15 bg-[#161922] p-1.5 shadow-[0_12px_30px_rgba(0,0,0,.6)]">
              {SYNTH_MOD_TARGETS.map((t) => (
                <button
                  key={t.target}
                  type="button"
                  className="cursor-pointer rounded px-2 py-1 text-left text-[11px] text-white/65 hover:bg-white/10 hover:text-white"
                  onClick={() => addMod(t.target)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Console>
  )
}

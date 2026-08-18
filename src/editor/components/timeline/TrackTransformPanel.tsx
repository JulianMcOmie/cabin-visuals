'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore } from '../../store/ProjectStore'
import { useUIStore } from '../../store/UIStore'
import {
  TF_OPACITY,
  TF_ROT_X,
  TF_ROT_Y,
  TF_ROT_Z,
  TF_SIZE,
  TF_X,
  TF_Y,
  TF_Z,
  TRANSFORM_PARAM_DEFS,
  transformDefault,
} from '../../core/transform'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { clamp } from '../../utils/math'

// ── Scrub + snap model ───────────────────────────────────────────────────────
// Every value is a vertical scrub field (drag up = increase, like riding a DAW
// knob): shift = fine (0.15×), double-click = reset, alt = bypass snapping,
// cmd/ctrl while multi-selected = converge to the dragged value (absolute)
// instead of the default relative delta. A value exactly ON a snap target
// renders in the accent color - the "am I symmetric?" glance.

const ROTATION_SNAPS = [-180, -135, -90, -45, 0, 45, 90, 135, 180]

interface FieldSpec {
  key: string
  label: string
  min: number
  max: number
  step: number
  snaps: number[]
  snapThreshold: number
  decimals: number
  /** Value change per vertical pixel dragged. */
  perPixel: number
  suffix?: string
  format?: (v: number) => string
}

const FIELDS: FieldSpec[] = [
  { key: TF_X, label: 'X', min: -10, max: 10, step: 0.01, snaps: [0], snapThreshold: 0.3, decimals: 2, perPixel: 0.05 },
  { key: TF_Y, label: 'Y', min: -10, max: 10, step: 0.01, snaps: [0], snapThreshold: 0.3, decimals: 2, perPixel: 0.05 },
  { key: TF_Z, label: 'Z', min: -10, max: 10, step: 0.01, snaps: [0], snapThreshold: 0.3, decimals: 2, perPixel: 0.05 },
  { key: TF_ROT_X, label: 'RX', min: -180, max: 180, step: 1, snaps: ROTATION_SNAPS, snapThreshold: 4, decimals: 0, perPixel: 1.2, suffix: '°' },
  { key: TF_ROT_Y, label: 'RY', min: -180, max: 180, step: 1, snaps: ROTATION_SNAPS, snapThreshold: 4, decimals: 0, perPixel: 1.2, suffix: '°' },
  { key: TF_ROT_Z, label: 'RZ', min: -180, max: 180, step: 1, snaps: ROTATION_SNAPS, snapThreshold: 4, decimals: 0, perPixel: 1.2, suffix: '°' },
  { key: TF_SIZE, label: 'SIZE', min: 0.05, max: 4, step: 0.01, snaps: [0.5, 1, 2], snapThreshold: 0.05, decimals: 2, perPixel: 0.015, suffix: '×' },
  {
    key: TF_OPACITY, label: 'OPAC', min: 0, max: 1, step: 0.01, snaps: [0, 0.5, 1], snapThreshold: 0.03, decimals: 0,
    perPixel: 0.005, format: (v) => `${Math.round(v * 100)}%`,
  },
]

function snapValue(spec: Pick<FieldSpec, 'snaps' | 'snapThreshold'>, raw: number, bypass: boolean): number {
  if (bypass) return raw
  for (const target of spec.snaps) if (Math.abs(raw - target) < spec.snapThreshold) return target
  return raw
}

function quantize(spec: Pick<FieldSpec, 'min' | 'max' | 'step'>, raw: number): number {
  return clamp(Number((Math.round(raw / spec.step) * spec.step).toFixed(6)), spec.min, spec.max)
}

export function transformValue(params: Record<string, number> | undefined, key: string): number {
  return params?.[key] ?? transformDefault(key)
}

/** The object tracks a drag applies to: the whole multi-selection when the
 *  edited track is part of one, otherwise just the edited track. */
export function affectedTrackIds(trackId: string): string[] {
  const { selectedTrackIds } = useUIStore.getState()
  if (!selectedTrackIds.has(trackId) || selectedTrackIds.size < 2) return [trackId]
  const { tracks } = useProjectStore.getState()
  const ids = [...selectedTrackIds].filter((id) => {
    const t = tracks[id]
    // Groups carry the same canonical tf* params, so a multi-select drag
    // moves them alongside object tracks.
    return !!t && ((t.type === 'base' && !!t.instrumentId) || t.type === 'group'
      || t.type === 'switcher')
  })
  return ids.length > 0 ? ids : [trackId]
}

/** Shared drag driver for scrub fields, the viewport, and the strip fader.
 *  Captures each affected track's start value once, then per move applies
 *  start + delta (relative, formation preserved) - or the dragged track's
 *  absolute value for every track while cmd/ctrl is held (align). */
export function beginTransformDrag(
  e: ReactPointerEvent<Element>,
  trackId: string,
  key: string,
  spec: Pick<FieldSpec, 'min' | 'max' | 'step' | 'snaps' | 'snapThreshold'>,
  valueAt: (ev: PointerEvent, startValue: number) => number,
) {
  e.preventDefault()
  e.stopPropagation()
  const el = e.currentTarget as Element & { setPointerCapture: (id: number) => void }
  el.setPointerCapture(e.pointerId)
  const project = useProjectStore.getState()
  const ids = affectedTrackIds(trackId)
  const startValues = new Map(ids.map((id) => [id, transformValue(project.tracks[id]?.params, key)]))
  const startPrimary = startValues.get(trackId) ?? transformDefault(key)

  const onMove = (ev: PointerEvent) => {
    const raw = valueAt(ev, startPrimary)
    const snapped = quantize(spec, snapValue(spec, raw, ev.altKey))
    const { setTrackParam } = useProjectStore.getState()
    if (ev.metaKey || ev.ctrlKey) {
      for (const id of ids) setTrackParam(id, key, snapped)
    } else {
      const delta = snapped - startPrimary
      for (const id of ids) {
        const start = startValues.get(id) ?? transformDefault(key)
        setTrackParam(id, key, id === trackId ? snapped : quantize(spec, start + delta))
      }
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

export function resetTransformValues(trackId: string, keys: string[]) {
  const { setTrackParam } = useProjectStore.getState()
  for (const id of affectedTrackIds(trackId)) {
    for (const key of keys) setTrackParam(id, key, transformDefault(key))
  }
}

// ── Scrub field ──────────────────────────────────────────────────────────────

function ScrubField({ trackId, spec }: { trackId: string; spec: FieldSpec }) {
  const value = useProjectStore((s) => transformValue(s.tracks[trackId]?.params, spec.key))
  const onSnap = spec.snaps.includes(value)
  const display = spec.format ? spec.format(value) : `${value.toFixed(spec.decimals)}${spec.suffix ?? ''}`

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-9 flex-shrink-0 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">{spec.label}</span>
      <div
        role="slider"
        aria-label={spec.label}
        aria-valuemin={spec.min}
        aria-valuemax={spec.max}
        aria-valuenow={value}
        title="Drag vertically · shift = fine · double-click = reset · alt = no snap"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          beginTransformDrag(e, trackId, spec.key, spec, (ev, start) => {
            const fine = ev.shiftKey ? 0.15 : 1
            return start + (e.clientY - ev.clientY) * spec.perPixel * fine
          })
        }}
        onDoubleClick={() => resetTransformValues(trackId, [spec.key])}
        className={`flex-1 cursor-ns-resize touch-none select-none rounded border border-[var(--border)] bg-black/25 px-2 py-1 text-right font-mono text-[12px] tabular-nums transition-colors hover:border-[var(--border-strong)] ${
          onSnap ? 'text-[var(--accent)]' : 'text-[var(--text)]'
        }`}
      >
        {display}
      </div>
    </div>
  )
}

// ── Isometric viewport (the "lollipop") ──────────────────────────────────────
// Shadow on the grid floor = x/z (drag it to move on the floor plane); the dot
// is the object at height y (drag it vertically). Dot radius tracks size, dot
// opacity tracks opacity, center floor axes glow when locked to x=0 / z=0.

const ISO_A = 4.2
const ISO_B = 2.1
const ISO_Y = 3.5
const ISO_CX = 95
const ISO_CY = 93
const ISO_W = 190
const ISO_H = 186

const proj = (x: number, y: number, z: number): [number, number] => [
  ISO_CX + (x - z) * ISO_A,
  ISO_CY + (x + z) * ISO_B - y * ISO_Y,
]

const POS_SPEC = FIELDS[0]

function IsoViewport({ trackId, scale }: { trackId: string; scale: number }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const x = useProjectStore((s) => transformValue(s.tracks[trackId]?.params, TF_X))
  const y = useProjectStore((s) => transformValue(s.tracks[trackId]?.params, TF_Y))
  const z = useProjectStore((s) => transformValue(s.tracks[trackId]?.params, TF_Z))
  const size = useProjectStore((s) => transformValue(s.tracks[trackId]?.params, TF_SIZE))
  const opacity = useProjectStore((s) => transformValue(s.tracks[trackId]?.params, TF_OPACITY))
  const multiIds = useUIStore((s) => (s.selectedTrackIds.has(trackId) && s.selectedTrackIds.size > 1 ? [...s.selectedTrackIds] : null))
  const tracks = useProjectStore((s) => s.tracks)

  const grid: ReactNode[] = []
  for (let i = -10; i <= 10; i += 2.5) {
    const [x1, y1] = proj(-10, 0, i)
    const [x2, y2] = proj(10, 0, i)
    const [x3, y3] = proj(i, 0, -10)
    const [x4, y4] = proj(i, 0, 10)
    grid.push(<line key={`gx${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--border)" strokeWidth={i === 0 ? 0 : 0.5} />)
    grid.push(<line key={`gz${i}`} x1={x3} y1={y3} x2={x4} y2={y4} stroke="var(--border)" strokeWidth={i === 0 ? 0 : 0.5} />)
  }
  const [axX1, axY1] = proj(-10, 0, 0)
  const [axX2, axY2] = proj(10, 0, 0)
  const [azX1, azY1] = proj(0, 0, -10)
  const [azX2, azY2] = proj(0, 0, 10)
  const [sx, sy] = proj(x, 0, z)
  const [dx, dy] = proj(x, y, z)

  // One drag surface, two modes: a plain drag moves on the FLOOR (the pointer
  // delta inverted through the iso projection, so the shadow chases the cursor
  // across the x·z grid), and holding SHIFT changes the height instead (drag
  // up = higher y). The mode re-reads every move, so shift can be
  // pressed/released mid-drag; raw accumulators per axis keep snapping
  // magnetic without losing the remainder.
  const dragPosition = (e: ReactPointerEvent<Element>) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as Element & { setPointerCapture: (id: number) => void }).setPointerCapture(e.pointerId)
    const project = useProjectStore.getState()
    const ids = affectedTrackIds(trackId)
    const startValues = new Map(
      ids.map((id) => {
        const p = project.tracks[id]?.params
        return [id, { x: transformValue(p, TF_X), y: transformValue(p, TF_Y), z: transformValue(p, TF_Z) }] as const
      }),
    )
    const startPrimary = startValues.get(trackId) ?? { x: 0, y: 0, z: 0 }
    const raw = { ...startPrimary }
    const rect = svgRef.current!.getBoundingClientRect()
    const pxPerUnit = rect.width / ISO_W
    let last = { x: e.clientX, y: e.clientY }

    const onMove = (ev: PointerEvent) => {
      const dPx = (ev.clientX - last.x) / pxPerUnit
      const dPy = (ev.clientY - last.y) / pxPerUnit
      last = { x: ev.clientX, y: ev.clientY }
      if (ev.shiftKey) {
        raw.y = clamp(raw.y - dPy / ISO_Y, -10, 10)
      } else {
        const u = dPx / ISO_A
        const v = dPy / ISO_B
        raw.x = clamp(raw.x + (u + v) / 2, -10, 10)
        raw.z = clamp(raw.z + (v - u) / 2, -10, 10)
      }
      const { setTrackParam } = useProjectStore.getState()
      const applyAxis = (key: string, rawValue: number, primaryStart: number, pick: (v: { x: number; y: number; z: number }) => number) => {
        const snapped = quantize(POS_SPEC, snapValue(POS_SPEC, rawValue, ev.altKey))
        if (ev.metaKey || ev.ctrlKey) {
          for (const id of ids) setTrackParam(id, key, snapped)
        } else {
          const delta = snapped - primaryStart
          for (const id of ids) {
            const start = pick(startValues.get(id) ?? { x: 0, y: 0, z: 0 })
            setTrackParam(id, key, id === trackId ? snapped : quantize(POS_SPEC, start + delta))
          }
        }
      }
      applyAxis(TF_X, raw.x, startPrimary.x, (v) => v.x)
      applyAxis(TF_Y, raw.y, startPrimary.y, (v) => v.y)
      applyAxis(TF_Z, raw.z, startPrimary.z, (v) => v.z)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const ghosts = (multiIds ?? [])
    .filter((id) => id !== trackId && tracks[id]?.type === 'base' && tracks[id]?.instrumentId)
    .map((id) => {
      const p = tracks[id]?.params
      const gx = transformValue(p, TF_X)
      const gy = transformValue(p, TF_Y)
      const gz = transformValue(p, TF_Z)
      const [a, b] = proj(gx, 0, gz)
      const [c, d] = proj(gx, gy, gz)
      return (
        <g key={id} opacity={0.3}>
          <line x1={a} y1={b} x2={c} y2={d} stroke="var(--accent)" strokeWidth={1} />
          <circle cx={c} cy={d} r={4} fill="none" stroke="var(--accent)" strokeWidth={1} />
        </g>
      )
    })

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${ISO_W} ${ISO_H}`}
      width={Math.round(ISO_W * scale)}
      height={Math.round(ISO_H * scale)}
      className="cursor-crosshair touch-none rounded-md border border-[var(--border)] bg-black/30"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        dragPosition(e)
      }}
      onDoubleClick={() => resetTransformValues(trackId, [TF_X, TF_Y, TF_Z])}
    >
      <g>{grid}</g>
      <line x1={axX1} y1={axY1} x2={axX2} y2={axY2} stroke={z === 0 ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth={1} opacity={z === 0 ? 0.6 : 1} />
      <line x1={azX1} y1={azY1} x2={azX2} y2={azY2} stroke={x === 0 ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth={1} opacity={x === 0 ? 0.6 : 1} />
      {ghosts}
      <line x1={sx} y1={sy} x2={dx} y2={dy} stroke="var(--accent)" strokeWidth={1} opacity={0.5} />
      <ellipse cx={sx} cy={sy} rx={7} ry={3.2} fill="var(--accent)" fillOpacity={0.22} stroke="var(--accent)" strokeOpacity={0.5} strokeWidth={1} />
      <circle
        cx={dx}
        cy={dy}
        r={4 + size * 2}
        fill="var(--accent)"
        fillOpacity={Math.max(0.15, opacity)}
        stroke={y === 0 ? 'var(--accent)' : 'none'}
        strokeOpacity={0.5}
        strokeWidth={1.5}
      />
    </svg>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

const PANEL_BASE_WIDTH = 372
const PANEL_BASE_HEIGHT = 250
const PANEL_MIN_SCALE = 1
const PANEL_MAX_SCALE = 1.8
const PANEL_SCALE_KEY = 'trackTransformPanelScale'

const PANEL_DEFAULT_SCALE = 1.25

function storedPanelScale(): number {
  if (typeof window === 'undefined') return PANEL_DEFAULT_SCALE
  const raw = Number(window.localStorage.getItem(PANEL_SCALE_KEY))
  return Number.isFinite(raw) && raw > 0 ? Math.min(PANEL_MAX_SCALE, Math.max(PANEL_MIN_SCALE, raw)) : PANEL_DEFAULT_SCALE
}

export function TrackTransformPanel({
  trackId,
  anchor,
  onClose,
}: {
  trackId: string
  /** Viewport-space rect of the opener button (position the popover under it). */
  anchor: { left: number; right: number; top: number; bottom: number }
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const trackName = useProjectStore((s) => s.tracks[trackId]?.name)
  const multiCount = useUIStore((s) => (s.selectedTrackIds.has(trackId) && s.selectedTrackIds.size > 1 ? s.selectedTrackIds.size : 0))
  // Drag the bottom-right corner to resize; the size sticks across opens.
  const [scale, setScale] = useState(storedPanelScale)
  useEffect(() => {
    window.localStorage.setItem(PANEL_SCALE_KEY, String(scale))
  }, [scale])

  const beginResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startScale = scale
    const onMove = (ev: PointerEvent) => {
      const next = startScale + (ev.clientX - startX) / PANEL_BASE_WIDTH
      setScale(Math.min(PANEL_MAX_SCALE, Math.max(PANEL_MIN_SCALE, next)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  useEffect(() => {
    // Capture-phase pointerdown: timeline gestures preventDefault() their
    // pointerdowns (which suppresses compatibility mousedown) and stopPropagation
    // freely, so this is the only reliable "clicked anywhere else" signal.
    const onDown = (ev: PointerEvent) => {
      const target = ev.target as HTMLElement
      if (panelRef.current?.contains(target)) return
      // The row's own opener toggles the panel itself - let its click handler win.
      if (target.closest?.('[data-transform-opener]')?.getAttribute('data-transform-opener') === trackId) return
      onClose()
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    // Deferred so the opener click that mounted the panel doesn't instantly close it.
    const id = setTimeout(() => window.addEventListener('pointerdown', onDown, true), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(id)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose, trackId])

  if (!trackName) return null

  // Clamp into the viewport: prefer below the anchor, flip above when cramped.
  // Right-align the panel to the opener so it hangs over the label column
  // instead of covering the timeline lanes to its right.
  const panelWidth = Math.round(PANEL_BASE_WIDTH * scale)
  const panelHeight = Math.round(PANEL_BASE_HEIGHT * scale)
  const left = clamp(anchor.right + 4 - panelWidth, 8, window.innerWidth - panelWidth - 8)
  const top = anchor.bottom + panelHeight + 8 > window.innerHeight
    ? Math.max(8, anchor.top - panelHeight - 6)
    : anchor.bottom + 6

  return createPortal(
    <div
      ref={panelRef}
      data-testid="track-transform-panel"
      className="fixed z-[70] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
      style={{ left, top, width: panelWidth }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[12px] font-semibold text-[var(--text)]">Transform</span>
        <span className="max-w-[140px] truncate text-[11px] text-[var(--text-muted)]">{trackName}</span>
        {multiCount > 0 && (
          <span
            className="rounded px-1.5 py-px text-[10px] font-semibold text-[var(--accent)]"
            style={{ background: 'color-mix(in srgb, var(--accent) 15%, transparent)' }}
          >
            {multiCount} tracks
          </span>
        )}
        <span className="flex-1" />
        <button
          aria-label="Reset all transform values"
          title="Reset every value to its default"
          onClick={() => resetTransformValues(trackId, TRANSFORM_PARAM_DEFS.map((p) => p.key))}
          className="rounded border border-[var(--border)] px-2.5 py-1 text-[10px] font-semibold tracking-[0.05em] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          Reset
        </button>
      </div>
      <div className="flex gap-3">
        <div className="flex-shrink-0">
          <IsoViewport trackId={trackId} scale={scale} />
          <div className="mt-1 text-center text-[10px] text-[var(--text-muted)]">drag = x·z floor · hold shift = y height</div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {FIELDS.map((spec) => (
            <ScrubField key={spec.key} trackId={trackId} spec={spec} />
          ))}
        </div>
      </div>
      <div className="mt-2 pr-3 text-[10px] leading-relaxed text-[var(--text-muted)]">
        drag numbers vertically · shift = fine · double-click = reset · alt = no snap{multiCount > 0 ? ' · cmd = align tracks' : ''}
      </div>
      <div
        aria-label="Resize panel"
        title="Drag to resize"
        onPointerDown={beginResize}
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
      >
        <svg viewBox="0 0 16 16" className="h-full w-full text-[var(--text-muted)] opacity-60">
          <path d="M14 8 L8 14 M14 12 L12 14" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </div>
    </div>,
    document.body,
  )
}

'use client'

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { ParamDef } from '../instruments/types'
import { lockCursor, unlockCursor } from '../utils/dragCursor'

/** One param row: label | 3px slider | mono value - 100px / 1fr / 44px.
 *  Console-styled: square thumb, dampened-blue fill (full accent blue was too
 *  loud for a wall of params; --accent-muted keeps the hue without the shout). */
export function ParamSlider({
  label, value, min, max, step, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pct = ((value - min) / (max - min)) * 100

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const raw = min + t * (max - min)
    const snapped = Math.max(min, Math.min(max, Math.round(raw / step) * step))
    onChange(snapped)
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
    <div className="grid grid-cols-[100px_1fr_44px] items-center gap-2.5 mb-[13px]">
      <span className="text-[11px] text-[var(--text-3)] truncate" title={label}>{label}</span>
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        className="relative h-[3px] bg-[var(--border)] cursor-pointer select-none"
      >
        <div
          className="absolute left-0 top-0 h-full bg-[var(--accent-muted)]"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-[9px] h-[9px] bg-[var(--text-2)] border border-[var(--border-strong)]"
          style={{ left: `calc(${pct}% - 4px)` }}
        />
      </div>
      <span className="font-mono text-[10px] text-[var(--text-muted)] text-right tabular-nums">
        {value.toFixed(2)}
      </span>
    </div>
  )
}

/** THE toggle switch for settings panels (boolean params, IN FRONT, etc.) -
 *  one component so every panel gets the same tile: square-ish with rounded
 *  corners, dampened-blue when on, matching the slider family. */
export function ParamToggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-8 h-4 rounded-[3px] relative transition-colors flex-shrink-0 cursor-pointer ${on ? 'bg-[var(--accent-muted)]' : 'bg-[var(--border)]'}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      {/* Vertical centering via transform, not a pixel offset: a hand-tuned
          top offset rounds differently at fractional display scales (125%,
          150%) and reads high or low; the transform centers at any DPR. */}
      <span className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-[2px] bg-[var(--text-2)] transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}

/** The existing stock control mapping, shared by renderer-driven and legacy panels. */
export function ParamControl({ param, numValue, strValue, onNum, onStr }: {
  param: ParamDef
  numValue: number | undefined
  strValue: string | undefined
  onNum: (v: number) => void
  onStr?: (v: string) => void
}) {
  if (param.type === 'select') {
    return (
      <div className="grid grid-cols-[100px_1fr] items-center gap-2.5 mb-[13px]">
        <span className="text-[11px] text-[var(--text-3)] truncate" title={param.label}>{param.label}</span>
        <select
          value={numValue ?? param.default}
          onChange={(e) => onNum(Number(e.target.value))}
          className="w-full h-6 px-1.5 rounded bg-[var(--bg-app)] text-[11px] text-[var(--text-2)] border border-[var(--border)] outline-none cursor-pointer"
        >
          {param.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    )
  }
  if (param.type === 'boolean') {
    const on = (numValue ?? param.default) >= 0.5
    return (
      <div className="grid grid-cols-[100px_1fr] items-center gap-2.5 mb-[13px]">
        <span className="text-[11px] text-[var(--text-3)] truncate" title={param.label}>{param.label}</span>
        <div className="flex justify-end">
          <ParamToggle on={on} onChange={(v) => onNum(v ? 1 : 0)} label={param.label} />
        </div>
      </div>
    )
  }
  if (param.type === 'color') {
    return (
      <div className="grid grid-cols-[100px_1fr] items-center gap-2.5 mb-[13px]">
        <span className="text-[11px] text-[var(--text-3)] truncate" title={param.label}>{param.label}</span>
        <div className="flex justify-end">
          <input
            type="color"
            value={strValue ?? param.default}
            onChange={(e) => onStr?.(e.target.value)}
            className="w-8 h-5 rounded bg-transparent border border-[var(--border)] cursor-pointer flex-shrink-0"
          />
        </div>
      </div>
    )
  }
  if (param.type === 'string') {
    const value = strValue ?? param.default
    return (
      <div className="mb-[13px]">
        <div className="text-[11px] text-[var(--text-3)] mb-1.5">{param.label}</div>
        {param.multiline
          ? <textarea value={value} onChange={(e) => onStr?.(e.target.value)} rows={3} className="w-full px-2 py-1 rounded bg-[var(--bg-app)] text-[11px] text-[var(--text-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)] resize-y" />
          : <input type="text" value={value} onChange={(e) => onStr?.(e.target.value)} className="w-full h-6 px-2 rounded bg-[var(--bg-app)] text-[11px] text-[var(--text-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)]" />}
      </div>
    )
  }
  return (
    <ParamSlider
      label={param.label}
      value={numValue ?? param.default}
      min={param.min}
      max={param.max}
      step={param.step}
      onChange={onNum}
    />
  )
}

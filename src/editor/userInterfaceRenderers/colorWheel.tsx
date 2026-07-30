'use client'

// The canonical color control from docs/instrument-panel-design-guide.md,
// extracted from Laser Sphere so every bespoke panel shares one wheel: a round
// swatch pill with label + hex readout, opening a continuous HSV wheel popover
// (hue around the ring, saturation toward the white center, brightness bar
// beneath) - never the native browser picker. Opens upward (`bottom-full`) so
// the host panel never scrolls; closes on outside click or Escape.

import { useEffect, useRef, useState, type PointerEvent } from 'react'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// ── Color math (HSV ↔ hex) ──────────────────────────────────────────────────

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, x, 0]
  const to = (u: number) => Math.round((u + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** Alpha-suffixed accent (`#rrggbbaa`) from a 0..1 alpha. */
export function withAlpha(hex: string, alpha: number): string {
  return hex + Math.round(clamp(alpha, 0, 1) * 255).toString(16).padStart(2, '0')
}

/** The accent pushed toward white - the white-hot core color of a light whose
 *  beam is `hex`. */
export function towardWhite(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const channel = (shift: number) => {
    const c = (n >> shift) & 255
    return Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')
  }
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

// ── The pill + wheel ────────────────────────────────────────────────────────

const WHEEL_SIZE = 132
const WHEEL_RADIUS = WHEEL_SIZE / 2

/** The floating wheel surface alone - hosts that anchor it themselves (pills,
 *  segmented controls) render it inside a `relative` wrapper while managing
 *  their own open state / outside-click close. */
export function ColorWheelPopover({ value, onChange, align = 'right', edge = 'top', testId }: {
  value: string
  onChange: (hex: string) => void
  /** Which edge of the anchor the popover hugs. */
  align?: 'left' | 'right'
  /** Which side of the anchor it opens on: 'top' (default) floats above,
   *  'bottom' drops below - for anchors sitting near their panel's top. */
  edge?: 'top' | 'bottom'
  testId?: string
}) {
  const wheelRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [hsv, setHsv] = useState(() => hexToHsv(value))

  const commit = (h: number, s: number, v: number) => {
    setHsv({ h, s, v })
    onChange(hsvToHex(h, s, v))
  }

  const wheelFromPointer = (clientX: number, clientY: number) => {
    const rect = wheelRef.current?.getBoundingClientRect()
    if (!rect) return
    const dx = clientX - (rect.left + rect.width / 2)
    const dy = clientY - (rect.top + rect.height / 2)
    const h = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360
    const s = clamp(Math.hypot(dx, dy) / (rect.width / 2), 0, 1)
    commit(h, s, hsv.v)
  }

  const barFromPointer = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return
    commit(hsv.h, hsv.s, clamp((clientX - rect.left) / rect.width, 0, 1))
  }

  const dragHandlers = (setFrom: (x: number, y: number) => void) => ({
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
      setFrom(event.clientX, event.clientY)
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) setFrom(event.clientX, event.clientY)
    },
  })

  // Marker position from the CURRENT hsv (kept in state so a desaturated or
  // dark color still remembers its hue while being edited).
  const markerAngle = hsv.h * Math.PI / 180
  const markerRadius = hsv.s * (WHEEL_RADIUS - 7)
  const markerX = WHEEL_RADIUS + Math.sin(markerAngle) * markerRadius
  const markerY = WHEEL_RADIUS - Math.cos(markerAngle) * markerRadius
  const fullColor = hsvToHex(hsv.h, hsv.s, 1)

  return (
    <div
      data-testid={testId}
      className={`absolute z-50 rounded-md border border-white/10 bg-[#0d1017] p-3 shadow-[0_8px_24px_rgba(0,0,0,.5)] ${edge === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2'} ${align === 'right' ? 'right-0' : 'left-0'}`}
    >
      <div
        ref={wheelRef}
        {...dragHandlers(wheelFromPointer)}
        className="relative cursor-crosshair touch-none rounded-full"
        style={{
          width: WHEEL_SIZE,
          height: WHEEL_SIZE,
          background: `radial-gradient(circle closest-side, #fff, rgba(255,255,255,0) 100%), conic-gradient(#f00, #ff0 60deg, #0f0 120deg, #0ff 180deg, #00f 240deg, #f0f 300deg, #f00 360deg)`,
        }}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_4px_rgba(0,0,0,.8)]"
          style={{ left: markerX, top: markerY, background: fullColor }}
        />
      </div>
      <div
        ref={barRef}
        {...dragHandlers((x) => barFromPointer(x))}
        aria-label="Brightness"
        className="relative mt-3 h-3 cursor-pointer touch-none rounded-full"
        style={{ background: `linear-gradient(to right, #000, ${fullColor})` }}
      >
        <span
          className="absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-white/60 bg-white/90"
          style={{ left: `${hsv.v * 100}%` }}
        />
      </div>
    </div>
  )
}

export function ColorWheelPill({ value, onChange, label, ariaLabel, title, halo, align = 'right', dimmed = false, pillTestId, wheelTestId }: {
  value: string
  onChange: (hex: string) => void
  /** Short caps label under the pill (COLOR, BACKDROP, ...). */
  label: string
  ariaLabel: string
  title?: string
  /** Optional box-shadow worn by the pill (the host decides what glow means). */
  halo?: string
  /** Which panel edge the popover hugs - pick the pill's own side. */
  align?: 'left' | 'right'
  /** Visually quieted (e.g. the value currently has no effect). Still editable. */
  dimmed?: boolean
  pillTestId?: string
  wheelTestId?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    window.addEventListener('pointerdown', (event) => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false)
    }, { signal: controller.signal, capture: true })
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false)
    }, { signal: controller.signal })
    return () => controller.abort()
  }, [open])

  return (
    <div ref={hostRef} className="relative flex min-w-0 flex-col items-center">
      <button
        data-testid={pillTestId}
        aria-label={ariaLabel}
        aria-expanded={open}
        title={title ?? `${ariaLabel} ${value}`}
        onClick={() => setOpen((o) => !o)}
        className={`h-8 w-8 cursor-pointer rounded-full border border-white/15 transition-transform active:scale-95 ${dimmed ? 'opacity-45' : ''}`}
        style={{ background: value, boxShadow: halo }}
      />
      <span className="mt-1 text-[8px] font-semibold tracking-[0.12em] text-white/40">{label}</span>
      <span className="font-mono text-[9px] uppercase text-white/70">{value}</span>

      {open && <ColorWheelPopover value={value} onChange={onChange} align={align} testId={wheelTestId} />}
    </div>
  )
}

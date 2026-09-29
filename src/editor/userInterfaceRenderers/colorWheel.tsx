'use client'

// The canonical color control from docs/instrument-panel-design-guide.md,
// extracted from Laser Sphere so every bespoke panel shares one wheel: a round
// swatch pill with label + hex readout, opening a continuous HSV wheel popover
// (hue around the ring, saturation toward the white center, brightness bar
// beneath) - never the native browser picker. Floats in the browser top layer,
// above the icon when it fits and below otherwise; closes on outside click or Escape.
//
// `ColorPicker` owns the circle and interaction. `ColorWheelPill` adds the
// console caption/readout; inline rows and gradient stops use ColorPicker.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { clamp } from '../utils/math'

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
  // The last sextant is [c, 0, x], NOT [c, x, 0] (that's the first sextant's
  // formula): shipped wrong for months, it swapped G and B above 300° so every
  // magenta/pink pick came out orange - hue 330 gave #ff8000, not #ff0080.
  // colorWheel.test.ts pins all six sextants and the hex→HSV round trip.
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
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

// ── Shared drag plumbing ────────────────────────────────────────────────────

/** Pointer-captured drag on a 2D surface (wheel, rail, field): the same
 *  gesture in every one of this module's controls. */
function dragHandlers(setFrom: (clientX: number, clientY: number) => void) {
  return {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
      setFrom(event.clientX, event.clientY)
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) setFrom(event.clientX, event.clientY)
    },
  }
}

/** The arrow-key nudge every slider-ish surface here answers to, returned as a
 *  signed step (0 = not an arrow key, so the host leaves the event alone). */
function arrowStep(event: KeyboardEvent, step: number): number {
  if (event.key === 'ArrowRight' || event.key === 'ArrowUp') return step
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') return -step
  return 0
}

// ── The pill + wheel ────────────────────────────────────────────────────────

const WHEEL_SIZE = 132
const WHEEL_RADIUS = WHEEL_SIZE / 2

/** Keep top-layer color controls anchored and inside the viewport. */
export function useColorPopoverPosition(
  popupRef: RefObject<HTMLDivElement | null>,
  anchorRef: RefObject<HTMLButtonElement | null>,
  open: boolean,
  align: 'left' | 'right' = 'right',
) {
  useLayoutEffect(() => {
    if (!open) return
    const popup = popupRef.current
    const anchor = anchorRef.current
    if (!popup || !anchor) return
    const position = () => {
      const gap = 8
      const rect = anchor.getBoundingClientRect()
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      const right = left + (viewport?.width ?? window.innerWidth)
      const bottom = top + (viewport?.height ?? window.innerHeight)
      popup.style.maxWidth = `${Math.max(1, right - left - gap * 2)}px`
      const above = Math.max(0, rect.top - top - gap * 2)
      const below = Math.max(0, bottom - rect.bottom - gap * 2)
      const naturalHeight = popup.scrollHeight + popup.offsetHeight - popup.clientHeight
      // If neither side fits, use the larger side and allow scrolling.
      const opensAbove = naturalHeight <= above || (naturalHeight > below && above > below)
      popup.style.maxHeight = `${Math.max(1, opensAbove ? above : below)}px`
      const { width, height } = popup.getBoundingClientRect()
      const x = align === 'right' ? rect.right - width : rect.left
      const y = opensAbove ? rect.top - height - gap : rect.bottom + gap
      popup.style.left = `${Math.max(left + gap, Math.min(x, right - width - gap))}px`
      popup.style.top = `${Math.max(top + gap, Math.min(y, bottom - height - gap))}px`
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(anchor)
    observer.observe(popup)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    window.visualViewport?.addEventListener('resize', position)
    window.visualViewport?.addEventListener('scroll', position)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      window.visualViewport?.removeEventListener('resize', position)
      window.visualViewport?.removeEventListener('scroll', position)
    }
  }, [open, align, anchorRef, popupRef])
}

/** A top-layer surface that retains DOM ancestry for outside-click handling. */
export function ColorWheelPopover({ value, onChange, anchorRef, align = 'right', testId, ariaLabel = 'Color' }: {
  value: string
  onChange: (hex: string) => void
  anchorRef: RefObject<HTMLButtonElement | null>
  /** Which edge of the anchor the popover hugs. */
  align?: 'left' | 'right'
  testId?: string
  ariaLabel?: string
}) {
  const popupRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const popup = popupRef.current
    popup?.showPopover()
    return () => { popup?.hidePopover() }
  }, [])
  useColorPopoverPosition(popupRef, anchorRef, true, align)

  return (
    <div
      ref={popupRef}
      popover="manual"
      role="dialog"
      aria-label={ariaLabel}
      onKeyDown={(event) => event.stopPropagation()}
      data-testid={testId}
      className="fixed m-0 w-max overflow-auto rounded-md border border-[color-mix(in_srgb,var(--text)_10%,transparent)] bg-[var(--bg-panel)] p-3 text-[var(--text)] shadow-[0_8px_24px_rgba(0,0,0,.5)]"
      style={{ inset: 'auto' }}
    >
      <ColorWheelPicker value={value} onChange={onChange} />
      <label className="mt-3 flex items-center gap-2 text-[10px] text-[var(--text-3)]">
        Hex
        <input
          key={value}
          defaultValue={value.toUpperCase()}
          aria-label={`${ariaLabel} hex color`}
          spellCheck={false}
          maxLength={7}
          onBlur={(event) => {
            const hex = event.currentTarget.value.trim()
            if (/^#[\da-f]{6}$/i.test(hex)) onChange(hex)
            else event.currentTarget.value = value.toUpperCase()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          className="w-24 min-w-0 rounded border border-[color-mix(in_srgb,var(--text)_10%,transparent)] bg-[color-mix(in_srgb,var(--text)_5%,transparent)] px-2 py-1 font-mono text-[11px] text-[var(--text-2)]"
        />
      </label>
    </div>
  )
}

/** Shared wheel contents for hosts that supply their own floating surface. */
export function ColorWheelPicker({ value, onChange }: {
  value: string
  onChange: (hex: string) => void
}) {
  const wheelRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  const emitted = useRef(value)
  const [previousValue, setPreviousValue] = useState(value)

  // Resolve external edits before committing the next render, so a keyboard
  // nudge immediately after a hex edit cannot use the previous color's HSV.
  if (value !== previousValue) {
    setPreviousValue(value)
    if (value.toLowerCase() !== emitted.current.toLowerCase()) {
      emitted.current = value
      setHsv(hexToHsv(value))
    }
  }

  const commit = (h: number, s: number, v: number) => {
    const hex = hsvToHex(h, s, v)
    emitted.current = hex
    setHsv({ h, s, v })
    onChange(hex)
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

  // Marker position from the CURRENT hsv (kept in state so a desaturated or
  // dark color still remembers its hue while being edited).
  const markerAngle = hsv.h * Math.PI / 180
  const markerRadius = hsv.s * (WHEEL_RADIUS - 7)
  const markerX = WHEEL_RADIUS + Math.sin(markerAngle) * markerRadius
  const markerY = WHEEL_RADIUS - Math.cos(markerAngle) * markerRadius
  const fullColor = hsvToHex(hsv.h, hsv.s, 1)

  return (
    <div style={{ width: WHEEL_SIZE }}>
      <div
        ref={wheelRef}
        {...dragHandlers(wheelFromPointer)}
        role="slider"
        tabIndex={0}
        aria-label="Hue and saturation"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        aria-valuetext={`Hue ${Math.round(hsv.h)} degrees, saturation ${Math.round(hsv.s * 100)} percent`}
        onKeyDown={(event) => {
          const step = arrowStep(event, event.shiftKey ? 10 : 1)
          if (!step) return
          event.preventDefault()
          event.stopPropagation()
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') commit(hsv.h, clamp(hsv.s + step / 100, 0, 1), hsv.v)
          else commit((hsv.h + step + 360) % 360, hsv.s, hsv.v)
        }}
        className="relative cursor-crosshair touch-none rounded-full"
        style={{
          width: WHEEL_SIZE,
          height: WHEEL_SIZE,
          background: `radial-gradient(circle closest-side, #fff, rgba(255,255,255,0) 100%), conic-gradient(#f00, #ff0 60deg, #0f0 120deg, #0ff 180deg, #00f 240deg, #f0f 300deg, #f00 360deg)`,
        }}
      >
        <span
          className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[color-mix(in_srgb,var(--text)_100%,transparent)] shadow-[0_0_4px_rgba(0,0,0,.8)]"
          style={{ left: markerX, top: markerY, background: fullColor }}
        />
      </div>
      <div
        ref={barRef}
        {...dragHandlers((x) => barFromPointer(x))}
        aria-label="Brightness"
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.v * 100)}
        onKeyDown={(event) => {
          const step = arrowStep(event, event.shiftKey ? 0.1 : 0.01)
          if (!step) return
          event.preventDefault()
          event.stopPropagation()
          commit(hsv.h, hsv.s, clamp(hsv.v + step, 0, 1))
        }}
        className="relative mt-3 h-3 cursor-pointer touch-none rounded-full"
        style={{ background: `linear-gradient(to right, #000, ${fullColor})` }}
      >
        <span
          className="absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-[color-mix(in_srgb,var(--text)_60%,transparent)] bg-[color-mix(in_srgb,var(--text)_90%,transparent)]"
          style={{ left: `${hsv.v * 100}%` }}
        />
      </div>
    </div>
  )
}

/**
 * Close-on-outside-pointer / Escape for an anchor that opens a
 * `ColorWheelPopover`. Returns the ref to hang on the anchor's positioned host:
 * a pointerdown INSIDE that host is the picker being used, not a dismissal, so
 * the wheel and its bar keep working while the listener is armed. Shared so a
 * second anchor (Text Display's per-lane swatch) can't drift from the pill's
 * behaviour - the `close` callback is read through a ref, so passing an inline
 * arrow doesn't re-arm the listeners on every render.
 */
export function useColorPopoverDismiss(open: boolean, close: () => void) {
  const hostRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    window.addEventListener('pointerdown', (event) => {
      if (!hostRef.current?.contains(event.target as Node)) closeRef.current()
    }, { signal: controller.signal, capture: true })
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeRef.current()
    }, { signal: controller.signal, capture: true })
    return () => controller.abort()
  }, [open])

  return hostRef
}

/** The Colorizer's current-color circle and wheel, shared by every color input.
 * Caption layout belongs to the caller; picker interaction lives only here. */
export function ColorPicker({ value, onChange, ariaLabel, title, halo, align = 'right', dimmed = false, size = 32, selected, pillTestId, wheelTestId }: {
  value: string
  onChange: (hex: string) => void
  ariaLabel: string
  title?: string
  halo?: string
  align?: 'left' | 'right'
  dimmed?: boolean
  size?: number
  selected?: boolean
  pillTestId?: string
  wheelTestId?: string
}) {
  const [open, setOpen] = useState(false)
  const hostRef = useColorPopoverDismiss(open, () => setOpen(false))
  const anchorRef = useRef<HTMLButtonElement>(null)

  return (
    <div ref={hostRef} className="relative flex shrink-0">
      <button
        type="button"
        ref={anchorRef}
        data-testid={pillTestId}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-pressed={selected}
        aria-haspopup="dialog"
        title={title ?? `${ariaLabel} ${value}`}
        onClick={() => setOpen((o) => !o)}
        className={`shrink-0 cursor-pointer rounded-full border border-[color-mix(in_srgb,var(--text)_15%,transparent)] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${dimmed ? 'opacity-45' : ''} ${selected ? 'ring-2 ring-[var(--accent)]' : ''}`}
        style={{ width: size, height: size, background: value, boxShadow: halo }}
      />
      {open && <ColorWheelPopover anchorRef={anchorRef} value={value} onChange={onChange} align={align} testId={wheelTestId} ariaLabel={ariaLabel} />}
    </div>
  )
}

/** Captioned console layout for the shared picker, used by Colorizer. */
export function ColorWheelPill({ label, ...pickerProps }: {
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
  return (
    <div className="relative flex min-w-0 flex-col items-center">
      <ColorPicker {...pickerProps} />
      <span className="mt-1 text-[8px] font-semibold tracking-[0.12em] text-[var(--text-3)]">{label}</span>
      <span className="font-mono text-[9px] uppercase text-[var(--text-2)]">{pickerProps.value}</span>
    </div>
  )
}

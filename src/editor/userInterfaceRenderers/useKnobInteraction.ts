'use client'

import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { clamp } from '../utils/math'

export interface KnobInteractionOptions {
  value: number; min: number; max: number; step: number; defaultValue: number
  onChange: (value: number) => void; disabled?: boolean; curve?: number
  detents?: readonly number[]; catchDetent?: number
  gesture?: 'vertical' | 'horizontal' | 'angular' | 'track'
  travel?: number; angularPeriod?: number; wrap?: boolean; keyStep?: boolean
}
export function nearestDetent(detents: readonly number[], value: number): number {
  let best = 0
  for (let i = 1; i < detents.length; i++) if (Math.abs(detents[i] - value) < Math.abs(detents[best] - value)) best = i
  return best
}
export function knobPosition(value: number, min: number, max: number, curve = 1, detents?: readonly number[]): number {
  if (detents?.length) return nearestDetent(detents, value) / Math.max(1, detents.length - 1)
  return max === min ? 0 : Math.pow(clamp((value - min) / (max - min), 0, 1), 1 / curve)
}
export function knobValueAt(position: number, options: KnobInteractionOptions): number {
  const { min, max, step, curve = 1, detents } = options
  const t = clamp(position, 0, 1)
  if (detents?.length) return detents[Math.round(t * (detents.length - 1))]
  const raw = min + t ** curve * (max - min)
  const snapped = curve === 1 ? min + Math.round((raw - min) / step) * step : raw === 0 ? 0 : Number(raw.toPrecision(3))
  return clamp(Number(snapped.toFixed(8)), min, max)
}

/** All knob skins share pointer ownership, cancellation, snapping, reset and
 * keyboard behavior. Geometry and deliberate gesture variations are options. */
export function useKnobInteraction(options: KnobInteractionOptions) {
  const { value, min, max, step, curve = 1, detents, catchDetent, disabled,
    onChange, defaultValue, gesture = 'vertical', travel = 140, angularPeriod = 360, wrap, keyStep } = options
  const drag = useRef<{ id: number; capture: HTMLElement; start: number; position: number; catchAt: number | null } | null>(null)
  const percent = knobPosition(value, min, max, curve, detents)
  const catchPosition = catchDetent === undefined ? null : knobPosition(catchDetent, min, max, curve)
  const crosses = (target: number) => catchPosition !== null && ((percent < catchPosition && target > catchPosition) || (percent > catchPosition && target < catchPosition))
  const commit = (position: number) => onChange(knobValueAt(position, options))
  const coordinate = (event: PointerEvent<HTMLDivElement>) => {
    if (gesture === 'angular') {
      const rect = event.currentTarget.getBoundingClientRect()
      return Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2) / (2 * Math.PI) * angularPeriod
    }
    return gesture === 'vertical' ? -event.clientY : event.clientX
  }
  const trackPosition = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return rect.width ? (event.clientX - rect.left) / rect.width : 0
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return
    const capture = drag.current.capture
    drag.current = null
    if (capture.hasPointerCapture(event.pointerId)) capture.releasePointerCapture(event.pointerId)
  }
  return {
    percent,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (disabled || event.button !== 0 || drag.current) return
        event.preventDefault(); event.currentTarget.focus()
        // Numeric cells keep dragging, but their readout must retain the click
        // target so a double-click opens entry instead of resetting the parent.
        const capture = (event.target as HTMLElement).closest<HTMLElement>('[data-knob-value]') ?? event.currentTarget
        try { capture.setPointerCapture(event.pointerId) } catch {}
        drag.current = { id: event.pointerId, capture, start: coordinate(event), position: percent, catchAt: null }
        if (gesture === 'track') commit(trackPosition(event))
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const state = drag.current
        if (!state || state.id !== event.pointerId) return
        if (disabled) { onPointerUp(event); return }
        const at = coordinate(event)
        let delta = at - state.start
        if (gesture === 'angular') {
          if (delta > angularPeriod / 2) delta -= angularPeriod
          if (delta < -angularPeriod / 2) delta += angularPeriod
        }
        let target = gesture === 'track' ? trackPosition(event) : state.position + delta / (gesture === 'angular' ? max - min || 1 : travel)
        if (wrap && max !== min) {
          const raw = min + target * (max - min)
          target = (((raw % angularPeriod + angularPeriod) % angularPeriod) - min) / (max - min)
        }
        if (catchPosition !== null) {
          if (state.catchAt !== null) {
            if (Math.abs(at - state.catchAt) < 16) { commit(catchPosition); return }
            state.position = catchPosition; state.start = at; state.catchAt = null; return
          }
          if (crosses(target)) { state.catchAt = at; commit(catchPosition); return }
        }
        commit(target)
      },
      onPointerUp,
      onPointerCancel: onPointerUp,
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => { if (drag.current?.id === event.pointerId) drag.current = null },
      onDoubleClick: () => { if (!disabled) onChange(defaultValue) },
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled || !['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        if (event.key === 'Home' || event.key === 'End') { commit(event.key === 'Home' ? 0 : 1); return }
        const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
        const tick = detents?.length ? 1 / Math.max(1, detents.length - 1) : max === min ? 0 : step / (max - min)
        const target = percent + direction * (keyStep ? tick : Math.max(0.03, tick))
        commit(crosses(target) && catchPosition !== null ? catchPosition : target)
      },
    },
  }
}

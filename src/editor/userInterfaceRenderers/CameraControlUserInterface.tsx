'use client'

import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { isNumberParam } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for the Camera instrument, laid out like a rig readout:
// position and rotation as draggable mono-numeric axis cells (drag vertically,
// double-click to reset), lens and aim below, then the note-response section.
// Purely presentational - every value flows through the passed parameters.

function findParam(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numberOf(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

/** One axis of the rig: a mono numeric cell, dragged vertically to adjust. */
function AxisCell({ bound, axis, suffix = '' }: {
  bound: UserInterfaceParameter | undefined
  axis: string
  suffix?: string
}) {
  const dragRef = useRef<{ y: number; value: number } | null>(null)
  if (!bound) return null
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  const value = bound.value
  const range = definition.max - definition.min

  const commit = (raw: number) => {
    const snapped = definition.min + Math.round((raw - definition.min) / definition.step) * definition.step
    bound.setValue(Math.max(definition.min, Math.min(definition.max, Number(snapped.toFixed(6)))))
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { y: event.clientY, value }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    commit(dragRef.current.value + ((dragRef.current.y - event.clientY) / 160) * range)
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    commit(value + direction * definition.step)
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={definition.label}
      aria-valuemin={definition.min}
      aria-valuemax={definition.max}
      aria-valuenow={value}
      title={`${definition.label} · drag vertically · double-click to reset`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => bound.setValue(definition.default)}
      onKeyDown={onKeyDown}
      className="flex min-w-0 cursor-ns-resize touch-none select-none flex-col items-center gap-0.5 rounded border border-[var(--border)] bg-[var(--bg-app)] py-1.5 outline-none transition-colors hover:border-[var(--border-strong)] focus-visible:border-[var(--accent)]"
    >
      <span className="text-[8px] font-semibold tracking-[0.1em] text-[var(--text-muted)]">{axis}</span>
      <span className="font-mono text-[11px] tabular-nums text-[var(--text-2)]">
        {value.toFixed(1)}{suffix}
      </span>
    </div>
  )
}

function RigSection({ label, children, dimmed, note }: {
  label: string
  children: ReactNode
  dimmed?: boolean
  note?: string
}) {
  return (
    <div className={`mb-3 transition-opacity ${dimmed ? 'opacity-40' : ''}`}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">{label}</span>
        {note && <span className="text-[8px] text-[var(--text-muted)]">{note}</span>}
      </div>
      <div className="grid grid-cols-3 gap-1">{children}</div>
    </div>
  )
}

function BoundSlider({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound) return null
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  return (
    <ParamSlider
      label={definition.label}
      value={bound.value}
      min={definition.min}
      max={definition.max}
      step={definition.step}
      onChange={bound.setValue}
    />
  )
}

export const CameraControlUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const lookMode = findParam(parameters, 'lookMode')
  const fov = findParam(parameters, 'fov')
  const lookAtOrigin = numberOf(lookMode) >= 0.5

  const placed = new Set([
    'posX', 'posY', 'posZ', 'rotX', 'rotY', 'rotZ', 'fov', 'lookMode',
    'punchAmount', 'punchDecay', 'shakeAmount',
  ])
  const leftovers = parameters.filter((bound) => !placed.has(bound.definition.key))

  return (
    <section data-testid="camera-control-user-interface" className="mb-3">
      {/* --- The rig readout --- */}
      <RigSection label="POSITION">
        <AxisCell bound={findParam(parameters, 'posX')} axis="X" />
        <AxisCell bound={findParam(parameters, 'posY')} axis="Y" />
        <AxisCell bound={findParam(parameters, 'posZ')} axis="Z" />
      </RigSection>

      <RigSection label="ROTATION" dimmed={lookAtOrigin} note={lookAtOrigin ? 'aimed at origin' : undefined}>
        <AxisCell bound={findParam(parameters, 'rotX')} axis="TILT" suffix="°" />
        <AxisCell bound={findParam(parameters, 'rotY')} axis="PAN" suffix="°" />
        <AxisCell bound={findParam(parameters, 'rotZ')} axis="ROLL" suffix="°" />
      </RigSection>

      {/* --- Aim mode --- */}
      {lookMode && lookMode.definition.type === 'select' && (
        <div className="mb-3">
          <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">AIM</span>
          <div className="flex rounded border border-[var(--border)] p-0.5">
            {lookMode.definition.options.map((option) => {
              const active = Math.round(numberOf(lookMode)) === option.value
              return (
                <button
                  key={option.value}
                  onClick={() => lookMode.setValue(option.value)}
                  aria-pressed={active}
                  className={`flex-1 rounded-[2px] py-1 text-[10px] transition-colors cursor-pointer ${active
                    ? 'bg-[var(--bg-elevated)] text-[var(--text)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* --- Lens: fov slider with a focal-feel readout --- */}
      {fov && (
        <div className="mb-3 border-t border-[var(--border-subtle)] pt-3">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">LENS</span>
            <span className="font-mono text-[9px] text-[var(--text-muted)]">
              {numberOf(fov) <= 30 ? 'tele' : numberOf(fov) <= 70 ? 'normal' : 'wide'}
            </span>
          </div>
          <BoundSlider bound={fov} />
        </div>
      )}

      {/* --- Note response: the dolly punch + shake --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        <span className="mb-1.5 block text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">NOTE RESPONSE</span>
        <BoundSlider bound={findParam(parameters, 'punchAmount')} />
        <BoundSlider bound={findParam(parameters, 'punchDecay')} />
        <BoundSlider bound={findParam(parameters, 'shakeAmount')} />
      </div>

      {/* Anything the layout does not know about still gets a control. */}
      {leftovers.length > 0 && (
        <div className="border-t border-[var(--border-subtle)] pt-3">
          {leftovers.map((bound) => {
            const numeric = typeof bound.value === 'number'
            return (
              <ParamControl
                key={bound.definition.key}
                param={bound.definition}
                numValue={numeric ? (bound.value as number) : undefined}
                strValue={numeric ? undefined : (bound.value as string)}
                onNum={bound.setValue}
                onStr={bound.setValue}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

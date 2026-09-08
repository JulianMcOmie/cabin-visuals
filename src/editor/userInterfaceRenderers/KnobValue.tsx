'use client'

import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { exactKnobValue, numberEntry, type KnobValueCodec } from './knobValueParsing'

/** Shared exact-value readout for every knob skin. Drafts never reach the
 * document: Enter/valid blur commits, Escape cancels, invalid blur cancels. */
export function KnobValue({ value, min, max, label, disabled, draggable, integer, codec = numberEntry(), onChange, children, className, style }: {
  value: number; min: number; max: number; label: string; disabled?: boolean; draggable?: boolean; integer?: boolean
  codec?: KnobValueCodec; onChange: (value: number) => void
  children: React.ReactNode; className?: string; style?: CSSProperties
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const finished = useRef(false)
  const initial = useRef('')
  const editCodec = useRef(codec)
  const restore = useRef(false)
  const focusInput = useCallback((element: HTMLInputElement | null) => { if (element) { element.focus(); element.select() } }, [])
  useLayoutEffect(() => { if (draft === null && restore.current) { restore.current = false; button.current?.focus() } }, [draft])
  const finish = (commit: boolean, restoreFocus: boolean) => {
    if (finished.current) return
    const parsed = draft === null ? null : exactKnobValue(draft, editCodec.current, min, max, integer)
    if (commit && parsed === null && restoreFocus) { setInvalid(true); return }
    finished.current = true
    if (commit && !disabled && parsed !== null && draft !== initial.current && parsed !== value) onChange(parsed)
    restore.current = restoreFocus
    setDraft(null)
    setInvalid(false)
  }
  return (
    <span className={`relative min-w-0 max-w-full ${className ?? ''}`} style={style}>
      <button data-knob-value ref={button} type="button" disabled={disabled} aria-label={`Edit ${label} value`}
        title="Double-click to type an exact value · Enter to edit"
        className={`max-w-full cursor-text rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-white/50 disabled:cursor-default ${draft !== null ? 'invisible' : ''}`}
        onPointerDown={event => { if (!draggable) event.stopPropagation() }}
        onDoubleClick={event => { event.stopPropagation(); if (!disabled) { editCodec.current = codec; initial.current = codec.edit(value); finished.current = false; setDraft(initial.current) } }}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === 'F2') {
            event.preventDefault(); event.stopPropagation()
            editCodec.current = codec; initial.current = codec.edit(value); finished.current = false; setDraft(initial.current)
          }
        }}
      >{children}</button>
      {draft !== null && <input type="text" inputMode="decimal" disabled={disabled} aria-label={`${label} exact value`}
        aria-invalid={invalid || undefined}
        title={invalid ? 'Enter a finite value within the control’s range' : 'Enter to commit · Escape to cancel'}
        ref={focusInput}
        value={draft} onChange={event => { setDraft(event.target.value); setInvalid(false) }}
        onBlur={() => finish(true, false)}
        onPointerDown={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()}
        onKeyDown={event => {
          event.stopPropagation()
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') { event.preventDefault(); finish(true, true) }
          if (event.key === 'Escape') { event.preventDefault(); finish(false, true) }
        }}
        className={`absolute inset-0 w-full min-w-[4ch] rounded-sm border bg-[#14171f] text-center font-mono text-inherit outline-none ${invalid ? 'border-red-400' : 'border-white/50'}`}
      />}
      {invalid && <span role="alert" className="absolute left-1/2 top-full z-50 mt-1 w-40 -translate-x-1/2 rounded border border-red-400/50 bg-[#14171f] p-1 text-[10px] text-red-200 whitespace-normal">{integer ? 'Enter a whole number within this control’s range.' : 'Enter a finite value within this control’s range.'}</span>}
    </span>
  )
}

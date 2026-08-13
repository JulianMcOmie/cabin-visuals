'use client'

// The guide's segmented control: for a param whose values are KINDS, not
// amounts, and above all for a panel's biggest decision. Recessed track, one
// lit segment wearing the accent as light, inactive segments neutral. When the
// values have SHAPES, pass a glyph per option and the segment IS the shape —
// the choice is made by looking rather than by reading option names.

import type { ReactNode } from 'react'
import { towardWhite, withAlpha } from '../colorWheel'
import { useConsoleAccent } from './Console'
import type { SelectBinding } from './bindings'

export interface SegmentOption {
  value: number
  label: string
  /** Drawn instead of the label (an SVG sketch of the behaviour); the label
   *  still speaks through aria-label and the title. */
  glyph?: ReactNode
}

export function Segmented({ b, options, value, onChange, name, accent, testId, className = '' }: {
  /** Bound form: options/value/onChange come from the select param. */
  b?: SelectBinding | null
  /** Overrides the def's options (short labels, glyphs); required unbound. */
  options?: readonly SegmentOption[]
  /** Unbound form, for view-state segments (a preview's rate picker). */
  value?: number
  onChange?: (value: number) => void
  /** Spoken name of the choice; defaults to the bound def's label. */
  name?: string
  accent?: string
  testId?: string
  className?: string
}) {
  const consoleAccent = useConsoleAccent()
  if (b === null) return null
  const resolvedOptions: readonly SegmentOption[] = options ?? b?.def.options ?? []
  const selected = Math.round(value ?? b?.value ?? 0)
  const commit = onChange ?? b?.set
  const lit = accent ?? consoleAccent
  if (resolvedOptions.length === 0 || !commit) return null

  return (
    <div
      role="radiogroup"
      aria-label={name ?? b?.def.label}
      data-testid={testId}
      className={`flex gap-[2px] rounded-[7px] border border-white/[0.07] bg-black/30 p-[2px] ${className}`}
    >
      {resolvedOptions.map((option) => {
        const active = option.value === selected
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => commit(option.value)}
            className={`flex h-6 min-w-0 flex-1 cursor-pointer items-center justify-center truncate rounded-[5px] px-1 text-[9px] font-semibold tracking-[0.1em] transition-colors ${
              active ? '' : 'text-white/40 hover:bg-white/[0.04] hover:text-white/70'
            }`}
            style={active ? { background: withAlpha(lit, 0.22), color: towardWhite(lit, 0.6) } : undefined}
          >
            {option.glyph ?? option.label.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}

'use client'

// The disclosure for a panel's unplaced params: a quiet chevron row that
// opens the generic ParameterList in a recessed box. Feed it `bindings.rest()`
// — everything the panel didn't claim — so a param added to the definition
// later is reachable from day one instead of silently invisible.

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { ParameterList } from '../ParametersUserInterface'
import type { UserInterfaceParameter } from '../types'

export function More({ parameters, label = 'MORE', className = 'px-3 pb-3' }: {
  parameters: readonly UserInterfaceParameter[]
  /** The caps caption on the chevron row (MORE, BASIS, …). */
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (parameters.length === 0) return null
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex cursor-pointer items-center gap-1 text-[8px] font-bold tracking-[0.18em] text-white/30 transition-colors hover:text-white/60"
      >
        {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        {label}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md border border-white/[0.06] bg-black/25 p-2">
          <ParameterList parameters={parameters} />
        </div>
      )}
    </div>
  )
}

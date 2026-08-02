'use client'

// The chassis of a guide-built panel (docs/instrument-panel-design-guide.md):
// the full-bleed section washed in the accent's dark shade, plus the accent
// context every kit control reads so panels state their color exactly once.
// The chassis owns bleed and wash; the panel owns everything inside it.

import { createContext, useContext, type ReactNode } from 'react'
import { shadeOf, spillOf } from './accent'

// A neutral slate for a control rendered outside any Console (previews,
// storybook-style labs). Real panels always provide their own.
const AccentContext = createContext('#9aa4b8')

/** The accent the enclosing <Console> declared. */
export function useConsoleAccent(): string {
  return useContext(AccentContext)
}

export function Console({ accent, bleed = 'top', shade, testId, children }: {
  /** The instrument's live color param, or the definition's identityColor for
   *  movers/splitters/colorizers — never a hard-coded theme hue. */
  accent: string
  /**
   * How the section cancels the chassis card's p-3. 'top' (the guide default)
   * bleeds sides and top, keeping the card's bottom padding under the last
   * controls row. 'full' fills the card on all sides and rounds itself to sit
   * inside the card's 10px border (Laser Sphere) — for a panel whose last row
   * carries its own bottom padding.
   */
  bleed?: 'top' | 'full'
  /** Overrides the computed accent shade — for a panel whose accent is one of
   *  SEVERAL live colors (the Colorizer's palette), where a wash that re-tints
   *  on every palette edit would make the whole room flicker. */
  shade?: string
  testId?: string
  children: ReactNode
}) {
  return (
    <AccentContext.Provider value={accent}>
      <section
        data-testid={testId}
        className={bleed === 'full' ? '-m-3 rounded-[9px]' : '-mx-3 -mt-3'}
        style={{ background: shade ?? shadeOf(accent) }}
      >
        {children}
      </section>
    </AccentContext.Provider>
  )
}

/**
 * One row of controls under the preview: knobs and segments bottom-aligned so
 * captions land on a shared baseline. The FIRST row under a preview passes
 * `spill` to catch the window's light through the seam — later rows don't
 * (the glow is at the seam, not everywhere).
 *
 * `className` replaces the default gap and spacing (not appends), so a panel
 * that needs a tighter rhythm states the whole thing rather than fighting the
 * default's Tailwind classes.
 */
export function ControlRow({ spill = false, className = 'gap-5 px-4 pb-4 pt-3', children }: {
  spill?: boolean
  className?: string
  children: ReactNode
}) {
  const accent = useConsoleAccent()
  return (
    <div
      className={`flex items-end ${className}`}
      style={spill ? { background: spillOf(accent) } : undefined}
    >
      {children}
    </div>
  )
}

/**
 * One row of a multi-row console: a quiet section word in the left gutter,
 * controls spread after it (Meteor Impact's IMPACT / FEEL / MOTION / VORTEX
 * rows are the reference). For a panel with more knobs than one row holds,
 * this is the shape that keeps the captions short: the gutter says what the
 * row is about, the knob captions say only which number.
 */
export function GutterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-3">
      <span className="w-[46px] flex-shrink-0 pt-4 text-right text-[7px] font-bold tracking-[0.22em] text-white/25">
        {label}
      </span>
      <div className="flex flex-1 items-end justify-between gap-1">{children}</div>
    </div>
  )
}

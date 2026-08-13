"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { Instrument_Serif, Manrope, DM_Mono } from "next/font/google"
import { CabinLogo } from "../CabinLogo"

// The editorial type stack (2026 redesign): serif display, humanist sans body,
// mono for chrome. Loaded once here and shared by the landing cover and every
// skinned screen; the .variable classes expose them as --lp-font-* custom
// properties for CSS to reach.
export const displayFont = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--lp-font-display",
})
export const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--lp-font-body",
})
export const monoFont = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--lp-font-mono",
})

export const editorialFontClasses = `${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`

/** Wraps a screen in the editorial look without rewriting it: the
 *  .editorial-skin class (globals.css) remaps the app-wide design tokens -
 *  surfaces, borders, text, THE accent - to the editorial palette, and reroutes
 *  the font-sans/font-mono utilities onto Manrope / DM Mono. Everything inside
 *  that was built on the global tokens follows along. Reverting a screen is
 *  removing this wrapper. */
export function EditorialSkin({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`editorial-skin ${editorialFontClasses} ${className}`}>
      {children}
    </div>
  )
}

/** The editorial nav: cabin logo (smoke and all) + serif italic wordmark on
 *  the left, the page's links on the right, hairline below. */
export function EditorialHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="border-b border-[var(--lp-border,var(--border-subtle))]">
      <div className="flex items-center justify-between px-6 py-5 sm:px-16 sm:py-6">
        <Link href="/" className="flex items-center gap-3 select-none cursor-pointer">
          <CabinLogo className="h-[30px] w-auto flex-shrink-0" />
          <span className="translate-y-[3px] text-[24px] italic leading-none text-[var(--lp-text,var(--text))] [font-family:var(--lp-font-display)]">
            Cabin Visuals
          </span>
        </Link>
        <nav className="flex flex-shrink-0 items-center gap-5 sm:gap-9">{children}</nav>
      </div>
    </header>
  )
}

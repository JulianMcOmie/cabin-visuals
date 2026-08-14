// Landing-page covers. Each cover is a complete, self-contained landing page;
// app/page.tsx renders whichever one ACTIVE_LANDING names. Adding a cover is
// one new file + one entry here; swapping (or reverting) is the one-line
// ACTIVE_LANDING change below.
import { LandingClassic } from "./LandingClassic"
import { LandingEditorial } from "./LandingEditorial"

export const LANDING_COVERS = {
  // The pre-2026 design: bold sans hero, full-screen showcase videos.
  classic: LandingClassic,
  // The 2026 redesign: serif display type, single cyan accent, cursor trail.
  editorial: LandingEditorial,
} as const

export type LandingCover = keyof typeof LANDING_COVERS

// To revert to the previous landing page, change "editorial" to "classic".
export const ACTIVE_LANDING: LandingCover = "editorial"

export const LandingPage = LANDING_COVERS[ACTIVE_LANDING]

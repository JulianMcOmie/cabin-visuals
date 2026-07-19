import { CabinLogo } from './CabinLogo'

/**
 * THE loading cabin: one shape (the "Loading the studio…" screen's - h-24,
 * default stroke) with the billowing smoke, reused by EVERY loading state -
 * the studio shell, route transitions, the lyric setup pipeline. Per-screen
 * text varies; the cabin never does.
 */
export function LoadingCabin() {
  return <CabinLogo className="smoking h-24 w-auto" />
}

/**
 * The transition screen: full-viewport page background with the one loading
 * cabin. Used by route-level loading states (app/editor) and the projects
 * page's instant create/open overlay. `label` (same styling as the editor
 * shell's "Loading the studio…") keeps the text up for the WHOLE transition -
 * open-project shows three loading surfaces back to back, and the text must
 * not pop in partway through.
 */
export function LoadingScreen({ label }: { label?: string }) {
  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-4 bg-[var(--bg-page)]">
      <LoadingCabin />
      {label && <p className="text-sm text-[var(--text-muted)] select-none">{label}</p>}
    </div>
  )
}

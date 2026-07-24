import { CabinLogo } from './CabinLogo'

/** The shared smoking-cabin mark used by every loading state. */
export function LoadingCabin() {
  return <CabinLogo className="smoking h-24 w-auto" />
}

/**
 * The transition screen: full-viewport page background with the one loading
 * cabin. Used by route-level loading states (app/editor) and the projects
 * page's instant create/open overlay.
 */
export function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--bg-page)]">
      <LoadingCabin />
    </div>
  )
}

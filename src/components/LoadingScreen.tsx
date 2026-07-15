import { CabinLogo } from './CabinLogo'

/**
 * The transition screen: full-viewport page background with the cabin logo
 * puffing smoke. The cabin-logo-loading class uses negative animation delays,
 * so the smoke is mid-billow on the first painted frame - it never appears
 * static and then starts. Used by route-level loading states (app/editor);
 * pages with their own on-screen logo (auth shell, projects skeleton) animate
 * that logo in place instead of covering the page.
 */
export function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--bg-page)]">
      <div className="w-16">
        <CabinLogo className="cabin-logo-loading" strokeWidth={200} />
      </div>
    </div>
  )
}

'use client'

import { useSyncExternalStore } from 'react'

// One breakpoint for "this is a phone" decisions that CSS alone can't make
// (layout forks, flow redirects). Matches Tailwind's md boundary so JS and
// `md:` classes never disagree about which side of the line a viewport is on.
const QUERY = '(max-width: 767px)'

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

/** True on phone-sized viewports. Always false during SSR - callers render the
 *  desktop layout on the server and correct on first client paint. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}

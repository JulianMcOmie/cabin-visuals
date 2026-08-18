'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import { LoadingScreen } from './LoadingScreen'

/**
 * Navigation that shows the loading screen BEFORE anything else happens.
 *
 * `router.push` alone leaves a visible gap: Next has to fetch the destination
 * route before its `loading.tsx` (if it even has one) can take over, so for a
 * moment the click appears to do nothing. `go()` first commits the overlay
 * synchronously (flushSync - it is on screen before this handler returns),
 * then starts the navigation. Render `overlay` anywhere in the tree; it is
 * portaled to <body> so a transformed ancestor (motion wrappers) can't turn
 * its `fixed` positioning into a local one.
 */
export function useInstantNavigation(prefetch?: string | null) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (prefetch) router.prefetch(prefetch)
  }, [router, prefetch])

  const go = useCallback((href: string) => {
    flushSync(() => setPending(true))
    router.push(href)
  }, [router])

  const overlay = pending && typeof document !== 'undefined'
    ? createPortal(<LoadingScreen />, document.body)
    : null

  return { go, overlay }
}

'use client'

import { Suspense, useCallback, useEffect, useSyncExternalStore, type MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import NextLink from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LoadingScreen } from './LoadingScreen'

/**
 * Navigation that shows the loading screen BEFORE anything else happens.
 *
 * `router.push` (or a plain <Link>) alone leaves a visible gap: Next has to
 * fetch the destination route before its `loading.tsx` - if it even has one -
 * can take over, so for a moment the click appears to do nothing. Here every
 * internal navigation first commits the loading screen SYNCHRONOUSLY
 * (flushSync: it is on screen before the click handler returns), then starts
 * the navigation. One <NavigationOverlay/> in the root layout renders it;
 * it clears itself when the URL actually changes, i.e. when the destination
 * (or its own loading state) has taken over.
 *
 * Three ways in:
 *  - `useInstantNavigation().go(href, { replace })` for programmatic pushes.
 *  - `<InstantLink>` - a drop-in for next/link (same props, same prefetch);
 *    modifier-clicks, middle-clicks, `target="_blank"` and external hrefs fall
 *    through to the browser untouched.
 *  - `beginNavigation()` right before a hard `window.location.href = ...`.
 */

let pending = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const getPending = () => pending
const getServerPending = () => false

/** Put the loading screen up NOW (synchronously). Idempotent. */
export function beginNavigation(): void {
  if (pending) return
  flushSync(() => { pending = true; notify() })
}

function endNavigation(): void {
  if (!pending) return
  pending = false
  notify()
}

function currentUrl(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname + window.location.search
}

/** True for hrefs the app router handles (same-origin path). */
function isInternal(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//')
}

/** Strip a hash: navigating to `/page#x` from `/page` never changes the
 *  pathname/search the overlay watches, so it must not put the overlay up. */
function withoutHash(href: string): string {
  const i = href.indexOf('#')
  return i === -1 ? href : href.slice(0, i)
}

function shouldOverlay(href: string): boolean {
  if (!isInternal(href)) return false
  const target = withoutHash(href)
  return target !== '' && target !== currentUrl()
}

/** `prefetch`: a destination to warm on mount (a <Link> does this for itself;
 *  a button-driven push has to ask). */
export function useInstantNavigation(prefetch?: string | null) {
  const router = useRouter()
  useEffect(() => { if (prefetch) router.prefetch(prefetch) }, [router, prefetch])
  const go = useCallback((href: string, opts?: { replace?: boolean }) => {
    if (shouldOverlay(href)) beginNavigation()
    if (opts?.replace) router.replace(href)
    else router.push(href)
  }, [router])
  return { go }
}

/** Mounted once, in the root layout. Clears the overlay when the URL changes -
 *  the destination (or its loading.tsx) is on screen by then. */
function OverlayInner() {
  const isPending = useSyncExternalStore(subscribe, getPending, getServerPending)
  const pathname = usePathname()
  const search = useSearchParams()
  const searchKey = search.toString()
  useEffect(() => { endNavigation() }, [pathname, searchKey])
  // Back/forward during a pending navigation also lands somewhere; the URL
  // effect above catches the common case, this catches a same-URL bounce.
  useEffect(() => {
    const onPop = () => endNavigation()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return isPending ? <LoadingScreen /> : null
}

export function NavigationOverlay() {
  // useSearchParams needs a Suspense boundary on statically rendered routes.
  return (
    <Suspense fallback={null}>
      <OverlayInner />
    </Suspense>
  )
}

type InstantLinkProps = React.ComponentProps<typeof NextLink>

/** next/link, but the click paints the loading screen before navigating. */
export function InstantLink({ href, onClick, replace, target, ...rest }: InstantLinkProps) {
  const router = useRouter()
  const hrefString = typeof href === 'string' ? href : ((href.pathname ?? '') + (href.search ?? '') + (href.hash ?? ''))
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented) return
    // Let the browser handle anything that isn't a plain same-tab left click.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (target && target !== '_self') return
    if (!isInternal(hrefString)) return
    e.preventDefault()
    if (shouldOverlay(hrefString)) beginNavigation()
    if (replace) router.replace(hrefString)
    else router.push(hrefString)
  }
  return <NextLink href={href} onClick={handleClick} replace={replace} target={target} {...rest} />
}

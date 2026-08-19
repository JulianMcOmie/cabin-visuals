// Lazy instrument components: a def stays a small, synchronous piece of
// metadata (id, params, midi rows, transforms - everything resolve.ts, the
// stores, the picker and the tests read), while the R3F visual - the bulk of
// an instrument's code plus its GLSL and any instrument-only library - lives in
// a sibling `<Name>Visual.tsx` that is only fetched when a project actually
// mounts that instrument. So a project downloads the instruments it uses, not
// all forty.
//
// Not React.lazy: React.lazy suspends on its FIRST render even when the module
// is already in memory, which would blank every object for a tick after mount
// and hand export an empty frame. This wrapper renders synchronously once the
// module has loaded (`preload()` on hydrate/track add gets it there long before
// anything mounts) and only suspends - per object, under the render site's own
// <Suspense> - when a chunk genuinely isn't here yet.

import { createElement, use, useLayoutEffect, type FC } from 'react'

export type InstrumentComponent = FC<{ trackId: string }>

export interface LazyInstrumentComponent extends InstrumentComponent {
  /** Start (or join) the chunk fetch; resolves once the component is in memory. */
  preload: () => Promise<void>
}

// Fetches in flight anywhere in the app: export's readiness gate awaits them
// all so a frame is never captured while a chunk is still on the wire.
const inflight = new Set<Promise<unknown>>()

export function lazyInstrument(load: () => Promise<InstrumentComponent>): LazyInstrumentComponent {
  let loaded: InstrumentComponent | null = null
  let promise: Promise<InstrumentComponent> | null = null
  const start = (): Promise<InstrumentComponent> => {
    if (!promise) {
      const p = load().then((c) => { loaded = c; return c })
      promise = p
      inflight.add(p)
      p.then(
        () => inflight.delete(p),
        // A failed fetch (offline, stale deploy) is retried on the next
        // render/preload rather than remembered forever.
        () => { inflight.delete(p); if (promise === p) promise = null },
      )
    }
    return promise
  }
  const Lazy = ((props: { trackId: string }) => {
    // `use` may be called conditionally - that is its contract; once the module
    // is here this is a plain synchronous render.
    const Component = loaded ?? use(start())
    return createElement(Component, props)
  }) as LazyInstrumentComponent
  Lazy.preload = () => start().then(() => undefined)
  return Lazy
}

/** Kick a def's chunk fetch (no-op for instruments whose component is inline). */
export function preloadComponent(component: InstrumentComponent | undefined): Promise<void> {
  const preload = (component as Partial<LazyInstrumentComponent> | undefined)?.preload
  return preload ? preload() : Promise.resolve()
}

// ── Mount readiness (export gate) ───────────────────────────────────────────
//
// A suspended object shows the render site's fallback, which is
// <InstrumentPending/> - it counts itself in while mounted, out when the real
// component commits in its place. So "no pending fallbacks and no fetch in
// flight" is exactly "every mounted object is drawing", which is what export
// must know before it captures frame 0: a fallback frame is an empty frame.

let pendingMounts = 0
const settledListeners = new Set<() => void>()

/** The fallback every instrument render site passes to its <Suspense>: draws
 *  nothing, counts itself as a not-yet-drawing object while it is mounted. */
export function InstrumentPending(): null {
  useLayoutEffect(() => {
    pendingMounts++
    return () => {
      pendingMounts--
      if (pendingMounts === 0) settledListeners.forEach((l) => l())
    }
  }, [])
  return null
}

/** Resolves once every started chunk fetch has landed AND no object is still
 *  showing its pending fallback. Never wedges: after `timeoutMs` it resolves
 *  anyway (an export with a blank object beats an export that never starts). */
export function whenInstrumentsSettled(timeoutMs = 10_000): Promise<void> {
  if (inflight.size === 0 && pendingMounts === 0) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, timeoutMs)
    function finish() {
      clearTimeout(timer)
      settledListeners.delete(check)
      resolve()
    }
    // Fetches first: each resolved fetch lets React retry its boundaries,
    // which is what drives pendingMounts back down and pings `check` again.
    function check() {
      if (inflight.size > 0) Promise.allSettled([...inflight]).then(check)
      else if (pendingMounts === 0) finish()
    }
    settledListeners.add(check)
    check()
  })
}

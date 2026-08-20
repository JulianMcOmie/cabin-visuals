'use client'

// The one rAF driver every inspector preview animation rides. Each panel used
// to run its own wall-clock 60fps loop for as long as it was mounted; this
// hook is the shared replacement, and it makes three deliberate choices:
//
// - **~30fps, not display rate.** These previews are 100-230 CSS px of panel
//   chrome; at that size half rate is indistinguishable while halving the
//   per-frame main-thread tax. The cap IS user-visible in principle - a
//   preview animates at 30fps beside a 60fps viewport - accepted on purpose.
//   (The throttle is a timeout BETWEEN frames rather than a skipped-vsync
//   check, so the loop also requests half as many animation frames instead
//   of waking every vsync to do nothing.)
// - **It stops while the host is offscreen.** Attach the returned ref to the
//   preview's element and an IntersectionObserver gates the loop - scrolled
//   out of the inspector, or in a collapsed pane, the preview costs nothing.
//   A hidden TAB is gated separately via visibilitychange (rAF starvation
//   would otherwise bank the whole hidden span into one giant time step).
//   With no ref attached only the tab gate applies.
// - **`t` is continuous across pauses.** Elapsed time accumulates only while
//   the loop runs, so a resume never jumps the animation - the picture takes
//   up exactly where it froze. Callers therefore derive their clocks from the
//   given tSec, never from performance.now().
//
// The draw callback is read through a ref, so callers may pass a fresh
// closure every render (the usual "loop reads the LATEST settings" pattern)
// without ever restarting the loop - and a panel that builds its drawing
// state inside an effect (a WebGL setup, say) can stash the real draw in a
// ref of its own and hand this hook a `(t) => drawImpl.current?.(t)` shim.

import { useEffect, useRef, type RefObject } from 'react'

/** Target cadence. Each frame schedules the next via a timeout aimed just
 *  short of this boundary, then a rAF - so on a vsynced display the next
 *  frame lands on the second vsync out (30fps at 60Hz), and the loop only
 *  REQUESTS ~30 animation frames a second instead of waking every vsync to
 *  do nothing. The cap is a budget, not a metronome - under load it just
 *  gets slower. */
const FRAME_MS = 1000 / 30
/** Aim the timeout this much before the boundary; the rAF covers the rest. */
const TIMER_SLACK_MS = 2

export function usePreviewLoop<T extends Element = HTMLDivElement>(
  draw: (tSec: number) => void,
): RefObject<T | null> {
  const drawRef = useRef(draw)
  drawRef.current = draw
  const hostRef = useRef<T | null>(null)

  useEffect(() => {
    let raf = 0
    let timer = 0
    let running = false
    // The pause-proof clock: `lastNow` is nulled on every resume so the
    // paused span never lands in `elapsedMs`.
    let lastNow: number | null = null
    let elapsedMs = 0

    const tick = (now: number) => {
      raf = 0
      if (lastNow !== null) elapsedMs += now - lastNow
      lastNow = now
      drawRef.current(elapsedMs / 1000)
      if (running) {
        const spent = performance.now() - now
        timer = window.setTimeout(schedule, Math.max(0, FRAME_MS - spent - TIMER_SLACK_MS))
      }
    }
    const schedule = () => {
      timer = 0
      raf = requestAnimationFrame(tick)
    }
    const start = () => {
      if (running) return
      running = true
      lastNow = null
      schedule()
    }
    const stop = () => {
      running = false
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      if (timer) { window.clearTimeout(timer); timer = 0 }
    }

    // Two independent gates; the loop runs only while both say visible.
    let hostVisible = true
    let tabVisible = document.visibilityState !== 'hidden'
    const sync = () => { if (hostVisible && tabVisible) start(); else stop() }

    const onVisibility = () => {
      tabVisible = document.visibilityState !== 'hidden'
      sync()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const host = hostRef.current
    let observer: IntersectionObserver | null = null
    if (host && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        hostVisible = entries[entries.length - 1]?.isIntersecting ?? true
        sync()
      })
      observer.observe(host)
    }
    // Run until the observer's first (async) callback says otherwise, so a
    // visible preview never waits to begin.
    sync()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
      stop()
    }
  }, [])

  return hostRef
}

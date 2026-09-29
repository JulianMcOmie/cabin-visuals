'use client'

// The r3f canvas every panel preview mounts. It exists so panel previews get
// the same resize behaviour the main viewport has (see VisualPanel in
// editor/App.tsx): the inspector is one of the panes the sidebar toggles
// GLIDE, so a preview's width changes on every frame of a 400ms animation.
//
// Two things go wrong with a bare <Canvas> there, both fixed here:
//
//  - three writes inline px width/height on the canvas element on every
//    setSize, driven by a ResizeObserver → React state round-trip. Under
//    render load that lands a frame or more late, so the canvas ELEMENT
//    visibly steps inside its smoothly-moving window. `.preview-canvas-smooth`
//    (globals.css) pins the canvas to its container in CSS instead, so layout
//    is continuous and only the drawing buffer catches up.
//  - resizing a WebGL drawing buffer CLEARS it, and a demand canvas only
//    draws when something asks it to. Without a render bound to the resize,
//    a glide leaves the preview black or stale. ResizeSync renders this root
//    synchronously, pre-paint, on every size change.
//
// It also owns the preview's FRAME BUDGET. r3f has ONE render loop for every
// root on the page, and it keeps spinning at display rate as long as any root
// runs `frameloop='always'` - which was the default here, so one open panel
// defeated the main viewport's demand mode (RenderGovernor) and a paused
// editor rendered its 130px preview at 60fps forever. The mirror-image bug was
// the old "black until play": a root mounted while the loop was parked never
// got the `invalidate()` that restarts it. Both go away by making every
// preview a demand root that asks for its own frames: `PreviewLoop` invalidates
// at ~30fps (the cadence `usePreviewLoop` picked for the 2D previews, for the
// same reasons) and only while the preview is on screen and the tab visible.
// Its first invalidate is what wakes a freshly mounted root. A preview whose
// picture is static passes `animate={false}` and renders only when a prop
// change or its controls invalidate it.

import { Canvas, advance, useThree, type CanvasProps } from '@react-three/fiber'
import { useEffect, useLayoutEffect } from 'react'

/** Renders THIS root (not every root) synchronously on resize. r3f applies
 *  gl.setSize and the camera update in its store subscription BEFORE this
 *  component sees the new size, so advancing from a layout effect paints the
 *  resized frame in the same visual frame as the element's new geometry. */
function ResizeSync() {
  const size = useThree((s) => s.size)
  const get = useThree((s) => s.get)
  useLayoutEffect(() => {
    const state = get()
    // 'never' is the export pin; advance() is what drives it, so leave it alone.
    if (state.frameloop === 'never') return
    // runGlobalEffects false: this is one root catching up, not a global tick.
    advance(performance.now(), false, state)
  }, [size, get])
  return null
}

/** Same cadence as `usePreviewLoop` (previewLoop.ts): at panel size half rate
 *  is indistinguishable and halves the per-frame tax. */
const FRAME_MS = 1000 / 30

/** Asks the demand root for a frame every FRAME_MS while the canvas is on
 *  screen and the tab is visible; parked otherwise. The interval is a budget,
 *  not a metronome: an invalidate only ever books ONE frame, so a slow frame
 *  just drops the cadence instead of queueing work. */
function PreviewLoop({ animate }: { animate: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  const canvas = useThree((s) => s.gl.domElement)
  useEffect(() => {
    // The root is active by the time effects run, so this is the wake-up call
    // that a paused r3f loop otherwise never gives a newly mounted root.
    invalidate()
    if (!animate) return

    let timer = 0
    let hostVisible = true
    let tabVisible = document.visibilityState !== 'hidden'
    const sync = () => {
      const on = hostVisible && tabVisible
      if (on && !timer) {
        invalidate()
        timer = window.setInterval(invalidate, FRAME_MS)
      } else if (!on && timer) {
        window.clearInterval(timer)
        timer = 0
      }
    }
    const onVisibility = () => {
      tabVisible = document.visibilityState !== 'hidden'
      sync()
    }
    document.addEventListener('visibilitychange', onVisibility)
    let observer: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        hostVisible = entries[entries.length - 1]?.isIntersecting ?? true
        sync()
      })
      observer.observe(canvas)
    }
    sync()
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
      if (timer) window.clearInterval(timer)
    }
  }, [animate, invalidate, canvas])
  return null
}

export type PreviewCanvasProps = CanvasProps & {
  /** false = a still: render on invalidation only (prop changes, controls). */
  animate?: boolean
}

export function PreviewCanvas({ className = '', children, animate = true, frameloop = 'demand', ...props }: PreviewCanvasProps) {
  return (
    <Canvas className={`preview-canvas-smooth ${className}`} frameloop={frameloop} {...props}>
      <ResizeSync />
      {frameloop === 'demand' && <PreviewLoop animate={animate} />}
      {children}
    </Canvas>
  )
}

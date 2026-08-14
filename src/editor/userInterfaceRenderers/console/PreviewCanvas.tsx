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
//  - resizing a WebGL drawing buffer CLEARS it, and a panel canvas is often
//    not looping (a paused transport leaves panel previews idle - see the
//    black-until-play note in this directory's CLAUDE.md). Without a render
//    bound to the resize, a glide leaves the preview black or stale.
//    ResizeSync renders this root synchronously, pre-paint, on every size
//    change.

import { Canvas, advance, useThree, type CanvasProps } from '@react-three/fiber'
import { useLayoutEffect } from 'react'

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

export function PreviewCanvas({ className = '', children, ...props }: CanvasProps) {
  return (
    <Canvas className={`preview-canvas-smooth ${className}`} {...props}>
      <ResizeSync />
      {children}
    </Canvas>
  )
}

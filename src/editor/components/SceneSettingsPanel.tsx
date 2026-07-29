'use client'

// Bespoke scene settings, following docs/instrument-panel-design-guide.md the
// way an instrument panel would - but tuned to what a scene IS: an empty room
// waiting to be lit. Full-bleed in the inspector, no card chrome, no title.
// The hero is a live miniature stage you can orbit: an R3F room whose clear
// color is the scene's real backdrop and a grid floor whose lines are a
// contrast-mix of that same backdrop - nothing else. A faint "SCENE" wordmark
// is etched into the stage like a console engraving, not a heading. Turning on
// transparency removes the room's walls for real: the canvas clears to alpha
// over a checkerboard, exactly what the export will do. Below, one console
// row: a segmented backdrop control - the backdrop IS a choice (a color, or
// nothing) - whose color segment opens the shared HSV wheel.

import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { ChevronDown } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { ColorWheelPopover, hexToHsv, hsvToHex, withAlpha } from '../userInterfaceRenderers/colorWheel'
import type { Scene } from '../types'

/** Relative luminance (0..1) of a hex color - decides whether stage lines and
 *  the etched wordmark read light-on-dark or dark-on-light. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

/** `hex` mixed toward black or white (whichever pole contrasts) by exactly
 *  enough to GUARANTEE a luminance delta of `delta` - a fixed mix ratio dies
 *  on mid-tone backdrops, so the ratio adapts: near-black and near-white
 *  rooms need only a nudge, a #808080 room automatically mixes harder. Keeps
 *  the backdrop's hue in the lines instead of painting neutral gray over a
 *  colored room. */
function contrastMix(hex: string, delta: number): string {
  const n = parseInt(hex.slice(1), 16)
  const lum = luminance(hex)
  const toward = lum > 0.5 ? 0 : 255
  const distance = toward === 0 ? lum : 1 - lum
  const t = distance <= 0 ? 1 : Math.min(1, delta / distance)
  const channel = (shift: number) => {
    const c = (n >> shift) & 255
    return Math.round(c + (toward - c) * t).toString(16).padStart(2, '0')
  }
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

function StagePreview({ scene }: { scene: Scene }) {
  const transparent = scene.backgroundTransparent
  // Over the real backdrop the lines are a hue-true contrast mix; over the
  // checkerboard (transparent) they're fixed neutrals.
  const cellColor = transparent ? '#5a5f6b' : contrastMix(scene.backgroundColor, 0.14)
  const sectionColor = transparent ? '#767c89' : contrastMix(scene.backgroundColor, 0.24)
  const etch = transparent ? '#9298a4' : contrastMix(scene.backgroundColor, 0.42)

  return (
    <div
      data-testid="scene-stage-preview"
      title="Drag to orbit the stage"
      className="relative h-[148px] cursor-grab overflow-hidden border-b border-white/[0.06] active:cursor-grabbing"
      // The checkerboard is the "nothing behind this" of the compositor - it
      // only shows when the canvas actually clears to alpha.
      style={transparent ? {
        backgroundImage: 'repeating-conic-gradient(#23262d 0% 25%, #31353e 0% 50%)',
        backgroundSize: '16px 16px',
      } : { background: scene.backgroundColor }}
    >
      <Canvas dpr={[1, 2]} camera={{ position: [0, 1.9, 5.6], fov: 38 }} gl={{ antialias: true, alpha: true }}>
        {/* The room's walls ARE the setting being edited: attach the scene's
            real backdrop as clear color, or nothing at all when transparent -
            the checkerboard behind the canvas shows through, same as export. */}
        {!transparent && <color attach="background" args={[scene.backgroundColor]} />}
        <Grid
          args={[10.5, 10.5]}
          cellSize={0.55}
          cellThickness={0.7}
          cellColor={cellColor}
          sectionSize={2.2}
          sectionThickness={1.1}
          sectionColor={sectionColor}
          fadeDistance={11}
          fadeStrength={1.4}
          infiniteGrid
        />
        <OrbitControls
          makeDefault
          target={[0, 0.45, 0]}
          enablePan={false}
          enableZoom={false}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI * 0.55}
        />
      </Canvas>
      {/* Etched into the room like an engraving on the console, not a title -
          identity carried by the surface itself. */}
      <span
        className="pointer-events-none absolute bottom-2 left-3 text-[9px] font-semibold tracking-[0.42em] select-none"
        style={{ color: etch }}
      >
        SCENE
      </span>
    </div>
  )
}

/** The backdrop is a CHOICE - a color, or nothing - so it reads as a two-way
 *  segmented control, not a switch bolted next to a swatch. The color segment
 *  shows the live swatch + hex; clicking it while active opens the shared HSV
 *  wheel. The transparent segment wears a tiny checkerboard - the same
 *  "nothing behind this" the stage shows at full size. */
function BackdropControl({ scene }: { scene: Scene }) {
  const setSceneBackgroundColor = useProjectStore((s) => s.setSceneBackgroundColor)
  const setSceneBackgroundTransparent = useProjectStore((s) => s.setSceneBackgroundTransparent)
  const hostRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const transparent = scene.backgroundTransparent

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    window.addEventListener('pointerdown', (event) => {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false)
    }, { signal: controller.signal, capture: true })
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false)
    }, { signal: controller.signal })
    return () => controller.abort()
  }, [open])

  return (
    <div ref={hostRef} className="relative">
      <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-0.5">
        <button
          data-testid="scene-backdrop-color-segment"
          aria-label={`Backdrop color ${scene.backgroundColor}`}
          aria-pressed={!transparent}
          aria-expanded={open}
          title={transparent ? 'Use a backdrop color' : 'Change the backdrop color'}
          onClick={() => {
            if (transparent) setSceneBackgroundTransparent(scene.id, false)
            else setOpen((o) => !o)
          }}
          className={`flex h-6 cursor-pointer items-center gap-1.5 rounded-full px-2.5 transition-colors ${
            transparent ? 'hover:bg-white/[0.05]' : 'bg-[var(--bg-elevated)]'
          }`}
        >
          <span
            className={`h-3.5 w-3.5 rounded-full border border-white/20 ${transparent ? 'opacity-50' : ''}`}
            style={{ background: scene.backgroundColor }}
          />
          <span className={`font-mono text-[9px] uppercase ${transparent ? 'text-white/40' : 'text-white/85'}`}>
            {scene.backgroundColor}
          </span>
          {!transparent && <ChevronDown size={10} className="text-white/50" />}
        </button>
        <button
          data-testid="scene-backdrop-transparent-segment"
          aria-label="Transparent backdrop"
          aria-pressed={transparent}
          title="No backdrop - the scene exports with alpha"
          onClick={() => { setOpen(false); setSceneBackgroundTransparent(scene.id, true) }}
          className={`flex h-6 cursor-pointer items-center gap-1.5 rounded-full px-2.5 transition-colors ${
            transparent ? 'bg-[var(--bg-elevated)]' : 'hover:bg-white/[0.05]'
          }`}
        >
          <span
            className={`h-3.5 w-3.5 rounded-full border border-white/20 ${transparent ? '' : 'opacity-50'}`}
            style={{
              backgroundImage: 'repeating-conic-gradient(#777d88 0% 25%, #2e323a 0% 50%)',
              backgroundSize: '5px 5px',
            }}
          />
          <span className={`text-[10px] ${transparent ? 'font-semibold text-white/85' : 'font-medium text-white/40'}`}>
            Transparent
          </span>
        </button>
      </div>

      {open && !transparent && (
        <ColorWheelPopover
          value={scene.backgroundColor}
          onChange={(hex) => setSceneBackgroundColor(scene.id, hex)}
          align="right"
          testId="scene-backdrop-wheel"
        />
      )}
    </div>
  )
}

export function SceneSettingsPanel({ scene }: { scene: Scene }) {
  const backdropHsv = hexToHsv(scene.backgroundColor)
  // Hue-true dark shade of the backdrop for the console (never an alpha tint -
  // the guide's mud rule), plus the stage's light spilling through the seam.
  const shade = hsvToHex(backdropHsv.h, Math.min(backdropHsv.s, 0.5), 0.075)

  return (
    // -mx-3/-mt-3 cancel the inspector container's padding (full-bleed rule);
    // -mb-12 cancels its pb-12 so the panel owns its exact height and the
    // container never gains a scrollbar.
    <section data-testid="scene-settings-panel" className="-mx-3 -mt-3 -mb-12" style={{ background: shade }}>
      <StagePreview scene={scene} />
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={scene.backgroundTransparent ? undefined : {
          background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(scene.backgroundColor, 0.14)}, transparent)`,
        }}
      >
        <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40 select-none">BACKDROP</span>
        <BackdropControl scene={scene} />
      </div>
    </section>
  )
}

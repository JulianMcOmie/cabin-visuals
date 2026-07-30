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
// row: a segmented backdrop control - the backdrop IS a choice (a color, a
// gradient, or nothing). The color segment opens the shared HSV wheel; the
// gradient segment reveals a second console row: kind, the two stops, and the
// angle knob. The CSS gradient previews here are pixel-honest - the renderer's
// backdrop shader mixes the same stops in sRGB, exactly as CSS does.

import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { ChevronDown } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { ColorWheelPopover, ColorWheelPill, hexToHsv, hsvToHex, withAlpha } from '../userInterfaceRenderers/colorWheel'
import { LaserKnob } from '../userInterfaceRenderers/laserKnob'
import { defaultSceneGradient, sceneBackdropMode, type Scene, type SceneGradient, type SceneGradientKind } from '../types'

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

/** The CSS twin of the renderer's backdrop gradient shader - same kinds, same
 *  sRGB stop mixing, same CSS angle convention - so everywhere the panel
 *  previews the gradient it shows exactly what the scene will render. */
function cssGradient(gradient: SceneGradient): string {
  if (gradient.kind === 'radial') return `radial-gradient(circle at 50% 50%, ${gradient.from}, ${gradient.to})`
  if (gradient.kind === 'mirror') return `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to}, ${gradient.from})`
  return `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})`
}

/** Even sRGB mix of two hexes - the "average" color the stage's contrast
 *  heuristics read when the backdrop is a gradient rather than one color. */
function mixHex(a: string, b: string): string {
  const na = parseInt(a.slice(1), 16)
  const nb = parseInt(b.slice(1), 16)
  const channel = (shift: number) =>
    Math.round((((na >> shift) & 255) + ((nb >> shift) & 255)) / 2).toString(16).padStart(2, '0')
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

function StagePreview({ scene }: { scene: Scene }) {
  const mode = sceneBackdropMode(scene)
  const gradient = scene.backgroundGradient ?? defaultSceneGradient()
  const transparent = mode === 'transparent'
  // Gradient mode adds a second console row below; the stage cedes the height
  // so the panel keeps owning its exact height (the no-scrollbar rule).
  const height = mode === 'gradient' ? 'h-[118px]' : 'h-[148px]'
  // Over the real backdrop the lines are a hue-true contrast mix - against a
  // gradient they contrast with its average - and over the checkerboard
  // (transparent) they're fixed neutrals.
  const anchor = mode === 'gradient' ? mixHex(gradient.from, gradient.to) : scene.backgroundColor
  const cellColor = transparent ? '#5a5f6b' : contrastMix(anchor, 0.14)
  const sectionColor = transparent ? '#767c89' : contrastMix(anchor, 0.24)
  const etch = transparent ? '#9298a4' : contrastMix(anchor, 0.42)

  return (
    <div
      data-testid="scene-stage-preview"
      title="Drag to orbit the stage"
      className={`relative ${height} cursor-grab overflow-hidden border-b border-white/[0.06] active:cursor-grabbing`}
      // The checkerboard is the "nothing behind this" of the compositor - it
      // only shows when the canvas actually clears to alpha. A gradient
      // backdrop paints here in CSS while the canvas stays alpha: same stops,
      // same sRGB mixing as the renderer's shader, so it IS the real look.
      style={transparent ? {
        backgroundImage: 'repeating-conic-gradient(#23262d 0% 25%, #31353e 0% 50%)',
        backgroundSize: '16px 16px',
      } : mode === 'gradient' ? { background: cssGradient(gradient) } : { background: scene.backgroundColor }}
    >
      <Canvas dpr={[1, 2]} camera={{ position: [0, 1.9, 5.6], fov: 38 }} gl={{ antialias: true, alpha: true }}>
        {/* The room's walls ARE the setting being edited: attach the scene's
            real backdrop as clear color, or nothing at all when transparent
            or gradient - the div behind the canvas shows through, same as
            export (checkerboard) or the renderer's gradient pass. */}
        {mode === 'color' && <color attach="background" args={[scene.backgroundColor]} />}
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

/** The backdrop is a CHOICE - a color, a gradient, or nothing - so it reads as
 *  a three-way segmented control, not switches bolted next to swatches. Only
 *  the active segment wears its text (three choices still fit one pill); the
 *  others are just their swatch. Clicking the active color segment opens the
 *  shared HSV wheel; the gradient segment's editing lives in its own console
 *  row below. The transparent segment wears a tiny checkerboard - the same
 *  "nothing behind this" the stage shows at full size. */
function BackdropControl({ scene }: { scene: Scene }) {
  const setSceneBackgroundColor = useProjectStore((s) => s.setSceneBackgroundColor)
  const setSceneBackdropMode = useProjectStore((s) => s.setSceneBackdropMode)
  const hostRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const mode = sceneBackdropMode(scene)
  const gradient = scene.backgroundGradient ?? defaultSceneGradient()

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

  const segment = (active: boolean) =>
    `flex h-6 cursor-pointer items-center gap-1.5 rounded-full px-2.5 transition-colors ${
      active ? 'bg-[var(--bg-elevated)]' : 'hover:bg-white/[0.05]'
    }`

  return (
    <div ref={hostRef} className="relative">
      <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-0.5">
        <button
          data-testid="scene-backdrop-color-segment"
          aria-label={`Backdrop color ${scene.backgroundColor}`}
          aria-pressed={mode === 'color'}
          aria-expanded={open}
          title={mode === 'color' ? 'Change the backdrop color' : 'Use a backdrop color'}
          onClick={() => {
            if (mode !== 'color') setSceneBackdropMode(scene.id, 'color')
            else setOpen((o) => !o)
          }}
          className={segment(mode === 'color')}
        >
          <span
            className={`h-3.5 w-3.5 rounded-full border border-white/20 ${mode === 'color' ? '' : 'opacity-50'}`}
            style={{ background: scene.backgroundColor }}
          />
          {mode === 'color' && (
            <>
              <span className="font-mono text-[9px] uppercase text-white/85">{scene.backgroundColor}</span>
              <ChevronDown size={10} className="text-white/50" />
            </>
          )}
        </button>
        <button
          data-testid="scene-backdrop-gradient-segment"
          aria-label="Gradient backdrop"
          aria-pressed={mode === 'gradient'}
          title="Backdrop is a two-stop gradient"
          onClick={() => { setOpen(false); if (mode !== 'gradient') setSceneBackdropMode(scene.id, 'gradient') }}
          className={segment(mode === 'gradient')}
        >
          <span
            className={`h-3.5 w-3.5 rounded-full border border-white/20 ${mode === 'gradient' ? '' : 'opacity-50'}`}
            style={{ background: cssGradient(gradient) }}
          />
          {mode === 'gradient' && <span className="text-[10px] font-semibold text-white/85">Gradient</span>}
        </button>
        <button
          data-testid="scene-backdrop-transparent-segment"
          aria-label="Transparent backdrop"
          aria-pressed={mode === 'transparent'}
          title="No backdrop - the scene exports with alpha"
          onClick={() => { setOpen(false); setSceneBackdropMode(scene.id, 'transparent') }}
          className={segment(mode === 'transparent')}
        >
          <span
            className={`h-3.5 w-3.5 rounded-full border border-white/20 ${mode === 'transparent' ? '' : 'opacity-50'}`}
            style={{
              backgroundImage: 'repeating-conic-gradient(#777d88 0% 25%, #2e323a 0% 50%)',
              backgroundSize: '5px 5px',
            }}
          />
          {mode === 'transparent' && <span className="text-[10px] font-semibold text-white/85">Transparent</span>}
        </button>
      </div>

      {open && mode === 'color' && (
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

/** The gradient's own console row: which kind, the two stops, the angle.
 *  Radial has no angle, so the knob dims instead of vanishing - the row never
 *  reflows under the pointer. */
function GradientControls({ scene }: { scene: Scene }) {
  const setSceneBackgroundGradient = useProjectStore((s) => s.setSceneBackgroundGradient)
  const gradient = scene.backgroundGradient ?? defaultSceneGradient()
  // The knob's laser reads from the brighter stop, so the arc stays legible
  // over gradients that fade into black.
  const accent = luminance(gradient.from) >= luminance(gradient.to) ? gradient.from : gradient.to
  const kinds: { kind: SceneGradientKind; label: string; title: string }[] = [
    { kind: 'linear', label: 'Linear', title: 'One sweep along the angle' },
    { kind: 'mirror', label: 'Mirror', title: 'From at both edges, to in the middle' },
    { kind: 'radial', label: 'Radial', title: 'From at the center, to at the corners' },
  ]

  return (
    <div data-testid="scene-gradient-controls" className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pb-2">
      <div className="mt-2.5 flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-0.5">
        {kinds.map(({ kind, label, title }) => (
          <button
            key={kind}
            data-testid={`scene-gradient-kind-${kind}`}
            aria-pressed={gradient.kind === kind}
            title={title}
            onClick={() => setSceneBackgroundGradient(scene.id, { kind })}
            className={`h-5 cursor-pointer rounded-full px-2 text-[9px] transition-colors ${
              gradient.kind === kind
                ? 'bg-[var(--bg-elevated)] font-semibold text-white/85'
                : 'font-medium text-white/40 hover:bg-white/[0.05]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-start gap-3">
        <ColorWheelPill
          value={gradient.from}
          onChange={(hex) => setSceneBackgroundGradient(scene.id, { from: hex })}
          label="FROM"
          ariaLabel="Gradient start color"
          align="left"
          pillTestId="scene-gradient-from-pill"
          wheelTestId="scene-gradient-from-wheel"
        />
        <ColorWheelPill
          value={gradient.to}
          onChange={(hex) => setSceneBackgroundGradient(scene.id, { to: hex })}
          label="TO"
          ariaLabel="Gradient end color"
          align="right"
          pillTestId="scene-gradient-to-pill"
          wheelTestId="scene-gradient-to-wheel"
        />
        <div
          className={gradient.kind === 'radial' ? 'pointer-events-none opacity-30' : ''}
          title={gradient.kind === 'radial' ? 'Radial gradients have no angle' : undefined}
        >
          <LaserKnob
            value={gradient.angle}
            min={0}
            max={360}
            step={1}
            defaultValue={0}
            label="ANGLE"
            ariaLabel="Gradient angle"
            accent={accent}
            suffix="°"
            onChange={(value) => setSceneBackgroundGradient(scene.id, { angle: value })}
          />
        </div>
      </div>
    </div>
  )
}

export function SceneSettingsPanel({ scene }: { scene: Scene }) {
  const mode = sceneBackdropMode(scene)
  const gradient = scene.backgroundGradient ?? defaultSceneGradient()
  // The console's own tint anchors to what the backdrop actually shows: the
  // flat color, or the gradient's average when that's what the scene wears.
  const anchor = mode === 'gradient' ? mixHex(gradient.from, gradient.to) : scene.backgroundColor
  const backdropHsv = hexToHsv(anchor)
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
        style={mode === 'transparent' ? undefined : {
          background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(anchor, 0.14)}, transparent)`,
        }}
      >
        <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40 select-none">BACKDROP</span>
        <BackdropControl scene={scene} />
      </div>
      {mode === 'gradient' && <GradientControls scene={scene} />}
    </section>
  )
}

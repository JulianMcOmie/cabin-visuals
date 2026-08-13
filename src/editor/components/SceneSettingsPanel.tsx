'use client'

// Bespoke scene settings, following docs/instrument-panel-design-guide.md the
// way an instrument panel would - but tuned to what a scene IS: an empty room
// waiting to be lit. Full-bleed in the inspector, no card chrome, no title.
// The hero is a live miniature stage you can orbit: an R3F room whose clear
// color is the scene's real backdrop and a grid floor whose lines are a
// contrast-mix of that same backdrop - nothing else, not even a wordmark.
// Turning on transparency removes the room's walls for real: the canvas clears
// to alpha over a checkerboard, exactly what the export will do.
//
// Below the stage, the backdrop IS a choice - fill, gradient, or nothing - so
// it reads as a segmented deck whose three segments always wear their NAME and
// their real preview (an unlabelled swatch can only be read by clicking it).
// Under the deck, one anatomy in every state: a captioned `ColorField` laid
// flat in the panel. Fill has one (BACKGROUND); gradient has the SAME control
// twice, FROM stacked over TO, both live at once - no selector deciding which
// one a drag lands on - with the angle knob and the kind below them. Nothing
// floats: the old wheel popover opened over the very stage you were judging.
// The stage holds ONE height across all three modes, so reaching for a
// gradient no longer re-lays the console out under the pointer. The CSS
// gradient previews here are pixel-honest - the renderer's backdrop shader
// mixes the same stops in sRGB, exactly as CSS does.

import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls } from '@react-three/drei'
import { useProjectStore } from '../store/ProjectStore'
import { ColorField, hexToHsv, hsvToHex, withAlpha } from '../userInterfaceRenderers/colorWheel'
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
  // ONE height in every mode. The stage used to cede 30px to gradient's extra
  // row, which bought a shorter panel at the price of the whole console
  // jumping the moment you reached for a gradient - the wrong trade for the
  // control you are actively judging by eye.
  // Over the real backdrop the lines are a hue-true contrast mix - against a
  // gradient they contrast with its average - and over the checkerboard
  // (transparent) they're fixed neutrals.
  const anchor = mode === 'gradient' ? mixHex(gradient.from, gradient.to) : scene.backgroundColor
  const cellColor = transparent ? '#5a5f6b' : contrastMix(anchor, 0.14)
  const sectionColor = transparent ? '#767c89' : contrastMix(anchor, 0.24)

  return (
    <div
      data-testid="scene-stage-preview"
      title="Drag to orbit the stage"
      className="relative h-[132px] cursor-grab overflow-hidden border-b border-white/[0.06] active:cursor-grabbing"
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
      {/* No wordmark. The stage carried an etched "SCENE" as identity-in-the-
          surface; with the name already on the tab rail it was a caption over
          the picture, and the picture is the point. */}
    </div>
  )
}

/** The backdrop is a CHOICE - a fill, a gradient, or nothing - so it reads as
 *  a three-way segmented deck. Every segment wears its NAME and its real
 *  preview at all times: the fill segment IS the color, the gradient segment IS
 *  the gradient, and "None" wears the checkerboard - the same "nothing behind
 *  this" the stage shows at full size. (The old deck labelled only the active
 *  segment, which left the other two choices as unlabelled 14px dots you could
 *  only read by clicking them.) Editing lives below the deck, never inside it. */
function BackdropDeck({ scene }: { scene: Scene }) {
  const setSceneBackdropMode = useProjectStore((s) => s.setSceneBackdropMode)
  const mode = sceneBackdropMode(scene)
  const gradient = scene.backgroundGradient ?? defaultSceneGradient()

  const segments = [
    {
      kind: 'color' as const, label: 'Fill', testId: 'scene-backdrop-color-segment',
      ariaLabel: `Fill backdrop ${scene.backgroundColor}`, title: 'Backdrop is one flat color',
      swatch: { background: scene.backgroundColor },
    },
    {
      kind: 'gradient' as const, label: 'Gradient', testId: 'scene-backdrop-gradient-segment',
      ariaLabel: 'Gradient backdrop', title: 'Backdrop is a two-stop gradient',
      swatch: { background: cssGradient(gradient) },
    },
    {
      kind: 'transparent' as const, label: 'None', testId: 'scene-backdrop-transparent-segment',
      ariaLabel: 'No backdrop', title: 'No backdrop - the scene renders and exports with alpha',
      swatch: {
        backgroundImage: 'repeating-conic-gradient(#777d88 0% 25%, #2e323a 0% 50%)',
        backgroundSize: '5px 5px',
      },
    },
  ]

  return (
    <div className="flex w-full items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-0.5">
      {segments.map(({ kind, label, testId, ariaLabel, title, swatch }) => (
        <button
          key={kind}
          data-testid={testId}
          aria-label={ariaLabel}
          aria-pressed={mode === kind}
          title={title}
          onClick={() => { if (mode !== kind) setSceneBackdropMode(scene.id, kind) }}
          // min-w-0 + nowrap: the deck is three EQUAL segments in a panel the
          // user can drag narrow - let them shrink rather than wrap a label
          // onto a second line and grow the pill.
          className={`flex h-6 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 overflow-hidden rounded-full px-2 text-[10px] font-semibold whitespace-nowrap transition-colors ${
            mode === kind ? 'bg-[var(--bg-elevated)] text-white/85' : 'text-white/40 hover:bg-white/[0.05] hover:text-white/70'
          }`}
        >
          <span
            className={`h-3.5 w-3.5 flex-none rounded-full border border-white/20 ${mode === kind ? '' : 'opacity-50'}`}
            style={swatch}
          />
          {label}
        </button>
      ))}
    </div>
  )
}

/** Gradient's editor: the fill control REPEATED - FROM stacked over TO, both
 *  armed, so editing the second stop costs reaching for it and nothing else -
 *  then the angle knob and the kind, centered, below both. Radial has no angle,
 *  so the knob dims instead of vanishing: the rows never reflow under the
 *  pointer. */
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
    <div data-testid="scene-gradient-controls">
      <div className="px-4 pb-3">
        <ColorField
          value={gradient.from}
          onChange={(hex) => setSceneBackgroundGradient(scene.id, { from: hex })}
          label="From"
          ariaLabel="Gradient start color"
          testId="scene-gradient-from-field"
        />
      </div>
      <div className="px-4 pb-3">
        <ColorField
          value={gradient.to}
          onChange={(hex) => setSceneBackgroundGradient(scene.id, { to: hex })}
          label="To"
          ariaLabel="Gradient end color"
          testId="scene-gradient-to-field"
        />
      </div>
      <div className="flex justify-center pb-1.5">
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
      <div className="flex justify-center pb-3">
        <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-0.5">
          {kinds.map(({ kind, label, title }) => (
            <button
              key={kind}
              data-testid={`scene-gradient-kind-${kind}`}
              aria-pressed={gradient.kind === kind}
              title={title}
              onClick={() => setSceneBackgroundGradient(scene.id, { kind })}
              className={`h-5 cursor-pointer rounded-full px-2.5 text-[9px] transition-colors ${
                gradient.kind === kind
                  ? 'bg-[var(--bg-elevated)] font-semibold text-white/85'
                  : 'font-medium text-white/40 hover:bg-white/[0.05]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function SceneSettingsPanel({ scene }: { scene: Scene }) {
  const setSceneBackgroundColor = useProjectStore((s) => s.setSceneBackgroundColor)
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
    // -mb-12 cancels its pb-12 so the panel owns its exact height. Gradient's
    // two stacked fields DO run past the pane's opening height - the sanctioned
    // trade for "both stops visible at once, no selector" (design guide, grid
    // console): the pane scrolls, and it is the caller's explicit ask.
    <section data-testid="scene-settings-panel" className="-mx-3 -mt-3 -mb-12" style={{ background: shade }}>
      <StagePreview scene={scene} />
      <div
        className="px-4 pt-3 pb-2.5"
        style={mode === 'transparent' ? undefined : {
          background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(anchor, 0.14)}, transparent)`,
        }}
      >
        <BackdropDeck scene={scene} />
      </div>
      {mode === 'color' && (
        <div className="px-4 pb-3">
          <ColorField
            value={scene.backgroundColor}
            onChange={(hex) => setSceneBackgroundColor(scene.id, hex)}
            label="Background"
            ariaLabel="Backdrop color"
            testId="scene-backdrop-field"
          />
        </div>
      )}
      {mode === 'gradient' && <GradientControls scene={scene} />}
      {mode === 'transparent' && (
        // The one state with no header: there is no color to name.
        <p className="px-4 pb-4 text-center text-[11px] text-white/45 select-none">
          Rendering with transparent background
        </p>
      )}
    </section>
  )
}

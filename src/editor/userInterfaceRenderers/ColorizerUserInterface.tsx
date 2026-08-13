'use client'

// Bespoke settings for the Colorizer, built from the console kit (./console).
//
// The preview is a FIELD OF OBJECTS, not a diagram: a grid of solids, indexed
// row-major exactly the way a Grid splitter indexes its copies, each one fed
// the definition's real evaluateColorizer() over a looping performance. What
// you see is what the colorizer does - INTENSITY is how far the objects go,
// ATTACK and RELEASE and SHAPE are how they get there and back, STAGGER rakes
// the flash across the field, and the PALETTE is the colors they flash.
//
// The accent is color slot 1, per the guide: the palette's first pill is both
// the panel's light source and an input for it, and it wears the
// INTENSITY-driven halo. The panel wash is a FIXED near-black rather than the
// accent's shade - with five live palette colors, a wash that re-tinted on
// every palette edit would make the whole room flicker.
//
// The demo performance deliberately plays SEVERAL slots, including one genuine
// two-slot chord, because the palette and the blend between its colors are the
// things a single-color preview cannot show.

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { Color, InstancedMesh, Object3D, type OrthographicCamera } from 'three'
import {
  BLEND_LINEAR,
  COLORIZER_FLASH_SLOTS,
  SHAPE_EVEN,
  SHAPE_SPIKE,
  SHAPE_SWELL,
  COLORIZER_RAINBOW_PITCH,
  colorizerPalette,
  evaluateColorizer,
  noteColorizer,
  rainbowDiagonal,
  type ColorizerSettings,
} from '../core/visualCopies/colorizer'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import type { ResolvedNote } from '../core/visual/types'
import { mixOklabLinearRgb } from '../utils/oklch'
import {
  bindPanel,
  Console,
  ControlRow,
  ColorWheelPill,
  emitterHalo,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  useConsoleAccent,
  type SelectBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// The stand-in for "the objects' own color". Cool and dim so the flash is
// unmistakably the colorizer's doing and not the material's - but not so dark
// that the field disappears between hits: you have to see the objects sitting
// there to read what the flash does to them.
const OBJECT_COLOR = '#2c3760'
const PANEL_SHADE = '#080a12'
const ROOM = '#05070c'
const FIELD_HEIGHT = 150

// ── The looping demo performance ─────────────────────────────────────────────
// Two bars at a notional 120 BPM. Bar 1 is the palette alone: a phrase walking
// through slots 1-3 with accents and ghost notes, so both the colors and the
// dynamics read, ending on a genuine two-slot chord (slot 1 loud, slot 4 soft)
// - the blend, which is the case a single-color preview cannot show. Bar 2
// holds the rainbow row with flashes riding on top, the other case worth
// seeing: the two channels composing rather than one replacing the other.

const LOOP_BEATS = 8

const at = (beat: number, durationBeats: number, velocity: number, pitch: number): ResolvedNote => ({
  beat,
  pitch,
  durationBeats,
  velocity,
  blockStartBeat: 0,
  blockEndBeat: LOOP_BEATS,
})

/** `slot` is a 0-based index into the palette, not a pitch - the panel should
 *  not have to know which pitches the definition happened to pick. */
const flash = (slot: number, beat: number, durationBeats: number, velocity: number) =>
  at(beat, durationBeats, velocity, COLORIZER_FLASH_SLOTS[slot].pitch)
const rainbow = (beat: number, durationBeats: number, velocity: number) =>
  at(beat, durationBeats, velocity, COLORIZER_RAINBOW_PITCH)

const PERFORMANCE: ResolvedNote[] = [
  flash(0, 0, 0.05, 1),
  flash(1, 1, 0.05, 0.45),
  flash(1, 1.5, 0.05, 0.75),
  flash(2, 2, 0.05, 1),
  // The chord: two slots at once, unequal, so the field lands between their
  // colors and leans toward the louder.
  flash(0, 3, 0.05, 0.9),
  flash(3, 3, 0.05, 0.55),
  rainbow(4.25, 3.25, 1),
  flash(1, 5, 0.05, 0.8),
  flash(4, 6, 0.05, 1),
  flash(2, 7, 0.05, 0.7),
]

// The loop is seamless: the neighbouring passes are present as real notes, so a
// tail crosses the wrap and a negative STAGGER can reach into the next bar.
const LOOP_NOTES: ResolvedNote[] = [-LOOP_BEATS, 0, LOOP_BEATS].flatMap((offset) =>
  PERFORMANCE.map((n) => ({ ...n, beat: n.beat + offset })),
)

// ── The field ────────────────────────────────────────────────────────────────

// Wide enough to bleed off both edges at any panel width - a field that stops
// short of the frame reads as a diagram of a field rather than as one.
const FIELD_COLUMNS = 26
const FIELD_ROWS = 4
const FIELD_COUNT = FIELD_COLUMNS * FIELD_ROWS
const SPACING = 1.15
/** World-space height the camera frames: the rows plus a little air. */
const FIELD_WORLD_HEIGHT = (FIELD_ROWS - 1) * SPACING + 1.6

function ObjectField({ settings }: { settings: ColorizerSettings }) {
  const meshRef = useRef<InstancedMesh>(null)
  const scratch = useRef({
    dummy: new Object3D(),
    color: new Color(),
    base: new Color(OBJECT_COLOR),
    tint: new Color(),
  }).current

  // Parsed once per settings change, exactly as resolve() does it on stage -
  // the field evaluates the palette once per cube per frame.
  const palette = useMemo(() => colorizerPalette(settings), [settings])
  const live = useRef({ palette, settings })
  live.current = { palette, settings }

  useFrame(({ clock, camera, gl }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const { dummy, color, base, tint } = scratch
    const current = live.current
    const perceptual = current.settings.blend !== BLEND_LINEAR
    const beat = (clock.getElapsedTime() * 2) % LOOP_BEATS

    // The frustum is derived from the canvas ELEMENT rather than left to the
    // renderer's measured size: this panel lives in a resizable pane and can
    // mount while it is still collapsed, and a stale measurement leaves the
    // field framed for a width the panel no longer has. Reading the DOM is the
    // one source that cannot go stale.
    const width = gl.domElement.clientWidth
    const height = gl.domElement.clientHeight
    const orthographic = camera as OrthographicCamera
    if (width > 0 && height > 0) {
      const halfHeight = FIELD_WORLD_HEIGHT / 2
      const halfWidth = halfHeight * (width / height)
      if (orthographic.top !== halfHeight || orthographic.right !== halfWidth) {
        orthographic.top = halfHeight
        orthographic.bottom = -halfHeight
        orthographic.right = halfWidth
        orthographic.left = -halfWidth
        orthographic.zoom = 1
        orthographic.updateProjectionMatrix()
      }
    }

    // Placement is rewritten every frame rather than cached: a settings change
    // rebuilds the instanced mesh's buffers, and a "laid out once" flag that
    // outlives them leaves every cube stacked at the origin.
    for (let index = 0; index < FIELD_COUNT; index++) {
      const column = index % FIELD_COLUMNS
      const row = Math.floor(index / FIELD_COLUMNS)
      const x = (column - (FIELD_COLUMNS - 1) / 2) * SPACING
      const y = ((FIELD_ROWS - 1) / 2 - row) * SPACING
      dummy.position.set(x, y, 0)
      dummy.rotation.set(0.35, 0.62, 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      // Row-major, the order a Grid splitter hands its copies downstream, so
      // STAGGER sweeps the field the same way it will sweep a real split. The
      // rainbow's phase comes from the same rainbowDiagonal() the mover uses,
      // so the sweep angle here is the sweep angle on stage.
      const { tintAmount, hue, tint: target } = evaluateColorizer(
        LOOP_NOTES, current.settings, beat, index, rainbowDiagonal(x, y), current.palette,
      )
      // Same order and the same two mixes instrumentColor.ts uses: absolute
      // tint first (perceptual or straight, per MIX), relative hue on top.
      color.copy(base)
      if (target && tintAmount > 0) {
        tint.set(target)
        const amount = clamp(tintAmount, 0, 1)
        if (perceptual) mixOklabLinearRgb(color, tint, amount)
        else color.lerp(tint, amount)
      }
      if (hue !== 0) color.offsetHSL(hue, 0, 0)
      mesh.setColorAt(index, color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, FIELD_COUNT]} frustumCulled={false}>
      <boxGeometry args={[0.72, 0.72, 0.72]} />
      <meshStandardMaterial metalness={0.25} roughness={0.42} color="#ffffff" />
    </instancedMesh>
  )
}

function FieldPreview({ settings }: { settings: ColorizerSettings }) {
  return (
    <PreviewWindow height={FIELD_HEIGHT} testId="colorizer-preview">
      {/* Orthographic on purpose: the panel is short and very wide, so a
          perspective frustum wide enough to fill it shears the outer columns
          into trapezoids. Flat projection keeps every object in the field the
          same size and shape, which is what makes the color comparable across
          it. The frustum itself is set per frame in ObjectField. */}
      <Canvas orthographic dpr={[1, 2]} camera={{ position: [0, 0, 12] }} gl={{ antialias: true }}>
        <color attach="background" args={[ROOM]} />
        <ObjectField settings={settings} />
        <directionalLight position={[3, 5, 6]} intensity={1.5} color="#cfd8ff" />
        <ambientLight intensity={0.55} />
        {/* Only a flashed object crosses the threshold, so the field blooms
            exactly when the colorizer fires and stays dark otherwise. */}
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.7} luminanceThreshold={0.5} luminanceSmoothing={0.2} mipmapBlur radius={0.72} levels={6} />
        </EffectComposer>
      </Canvas>
    </PreviewWindow>
  )
}

// ── Selectors ────────────────────────────────────────────────────────────────

/** Segmented release-curve selector. Each option draws its own falloff, so the
 *  choice is legible without reading the word. */
const SHAPE_GLYPHS: Record<number, string> = {
  [SHAPE_SPIKE]: 'M1 11 L3 1 C4.5 8 7 10 15 10.6',
  [SHAPE_EVEN]: 'M1 11 L3 1 L15 10.6',
  [SHAPE_SWELL]: 'M1 11 L3 1 C9 1.4 11 4 15 10.6',
}

/** The solid-fill segment family this panel already speaks (shared with Bass
 *  Ripple's pattern picker): the active segment is a full accent block with a
 *  dark glyph, deliberately hotter than the kit's recessed Segmented. */
function ShapeSelector({ b }: { b: SelectBinding }) {
  const accent = useConsoleAccent()
  const selected = Math.round(b.value)
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex overflow-hidden rounded-md border border-white/10">
        {b.def.options.map((option) => {
          const active = option.value === selected
          return (
            <button
              key={option.value}
              aria-label={option.label}
              aria-pressed={active}
              title={`${option.label} falloff`}
              onClick={() => b.set(option.value)}
              className={`px-1 pb-0.5 pt-1 transition-colors ${active ? '' : 'bg-black/25 hover:bg-white/5'}`}
              style={active ? { background: accent } : undefined}
            >
              <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
                <path
                  d={SHAPE_GLYPHS[option.value] ?? SHAPE_GLYPHS[SHAPE_EVEN]}
                  stroke={active ? '#000' : 'rgba(255,255,255,0.45)'}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )
        })}
      </div>
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">SHAPE</span>
      <span className="font-mono text-[9px] text-white/70">
        {b.def.options.find((option) => option.value === selected)?.label.toUpperCase() ?? ''}
      </span>
    </div>
  )
}

/** Word-labelled segmented control, for a select whose options are not curves.
 *  Same chassis as ShapeSelector so the two read as one family. */
function WordSelector({ b, label }: { b: SelectBinding; label: string }) {
  const accent = useConsoleAccent()
  const selected = Math.round(b.value)
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex overflow-hidden rounded-md border border-white/10">
        {b.def.options.map((option) => {
          const active = option.value === selected
          return (
            <button
              key={option.value}
              aria-pressed={active}
              onClick={() => b.set(option.value)}
              className={`px-1.5 py-[3px] text-[8px] font-semibold tracking-[0.1em] transition-colors ${
                active ? 'text-black' : 'bg-black/25 text-white/45 hover:bg-white/5'
              }`}
              style={active ? { background: accent } : undefined}
            >
              {option.label.slice(0, 4).toUpperCase()}
            </button>
          )
        })}
      </div>
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">{label}</span>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export const ColorizerUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const intensity = b.num('intensity')
  const attackBeats = b.num('attackBeats')
  const releaseBeats = b.num('releaseBeats')
  const staggerBeats = b.num('staggerBeats')
  const shape = b.select('shape')
  const blend = b.select('blend')
  const rainbowRate = b.num('rainbowRate')
  const rainbowSpread = b.num('rainbowSpread')
  const slots = COLORIZER_FLASH_SLOTS.map((slot) => b.color(slot.key))

  // Memoized on the VALUES, so the field's resolve() reruns only on a real
  // change. Computed before the fallback return - hooks run unconditionally.
  const valuesKey = parameters.map((p) => `${p.definition.key}:${p.value}`).join('|')
  const settings = useMemo(() => {
    const values: Record<string, number> = {}
    const strings: Record<string, string> = {}
    for (const p of parameters) {
      if (typeof p.value === 'number') values[p.definition.key] = p.value
      else strings[p.definition.key] = p.value
    }
    return mergeDefinitionSettings(noteColorizer, values, strings) as unknown as ColorizerSettings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey])

  if (!intensity || !attackBeats || !releaseBeats || !staggerBeats || !shape || !blend
    || !rainbowRate || !rainbowSpread || slots.some((slot) => !slot)) {
    return <ParameterList parameters={parameters} />
  }

  const accent = settings.color
  const intensityValue = clamp(settings.intensity, 0, 1)

  return (
    <Console accent={accent} shade={PANEL_SHADE} testId="colorizer-user-interface">
      <FieldPreview settings={settings} />
      <ControlRow spill className="gap-1 px-3 pb-3 pt-2.5">
        <Knob b={intensity} label="INTENSITY" large />
        <Knob b={attackBeats} label="ATTACK" />
        <Knob b={releaseBeats} label="RELEASE" />
        <Knob b={staggerBeats} label="STAGGER" />
        {/* The two rainbow knobs belong to the second MIDI row, so they get a
            spectrum rule instead of a caption - it says "different row" in the
            one language this panel already speaks. */}
        <div
          aria-hidden
          className="mb-4 h-9 w-px flex-shrink-0 self-end rounded-full"
          style={{ background: 'linear-gradient(#ff4d4d, #ffd166, #4dff88, #4dd2ff, #b84dff)' }}
        />
        <Knob b={rainbowRate} label="SPIN" />
        <Knob b={rainbowSpread} label="SPREAD" />
        <ShapeSelector b={shape} />
        <div className="ml-auto">
          <WordSelector b={blend} label="MIX" />
        </div>
      </ControlRow>
      {/* The palette gets its own shelf rather than a slot in the knob row:
          five pills are the panel's second subject, and the piano roll shows
          these same five colors on its five rows, so they need to read as a
          set you can scan against it. */}
      <div className="flex items-end gap-1.5 border-t border-white/[0.06] px-3 pb-3 pt-2.5">
        {COLORIZER_FLASH_SLOTS.map((slot, index) => (
          <ColorWheelPill
            key={slot.key}
            value={settings[slot.key]}
            onChange={(hex) => slots[index]!.set(hex)}
            label={String(index + 1)}
            ariaLabel={`${slot.label} flash color`}
            title={`${slot.label} - the color that row's notes flash toward`}
            align={index < 3 ? 'left' : 'right'}
            // Slot 1 is the panel's light source, so it alone wears the
            // INTENSITY halo; five blazing pills would just be noise.
            halo={index === 0 ? emitterHalo(accent, intensityValue) : undefined}
            pillTestId={index === 0 ? 'colorizer-color-pill' : `colorizer-color-pill-${index + 1}`}
          />
        ))}
        <span className="mb-1 ml-auto text-[8px] font-semibold tracking-[0.12em] text-white/25">PALETTE</span>
      </div>
      <More parameters={b.rest()} />
    </Console>
  )
}

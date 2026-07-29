'use client'

// Bespoke settings for Laser Sphere, following docs/instrument-panel-design-guide.md:
// the UI is full-bleed in the panel (edge to edge, no card chrome, no in-panel
// title, nothing that needs scrolling), washed with a low-alpha tint of the
// instrument's color. A live bloomed orb you can orbit, then one row of four
// flat knobs - SIZE, GLOW, CORE, LIGHT - with the color pill on the far right.
// The pill opens a continuous HSV wheel, not the native swatch picker. Every
// control takes its accent from the color param, and the knobs carry a passive
// halo whose strength IS the glow param - the instrument speaking, not the
// cursor. The preview reuses the instrument's real rim shader and the app's
// laser bloom pass, so what glows here is what glows on stage.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { Color, type ShaderMaterial } from 'three'
import {
  DEFAULT_LASER_SPHERE_COLOR,
  LASER_FRAGMENT_SHADER,
  LASER_VERTEX_SHADER,
} from '../instruments/LaserSphere'
import { evaluateCoreAppearance } from '../instruments/laserSphereCore'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const WHITE = new Color(1, 1, 1)

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function stringValue(bound: UserInterfaceParameter | undefined, fallback: string): string {
  return typeof bound?.value === 'string' ? bound.value : fallback
}

// ── Color math (HSV ↔ hex) for the wheel ────────────────────────────────────

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, x, 0]
  const to = (u: number) => Math.round((u + m) * 255).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** Alpha-suffixed accent (`#rrggbbaa`) from a 0..1 alpha. */
function withAlpha(hex: string, alpha: number): string {
  return hex + Math.round(clamp(alpha, 0, 1) * 255).toString(16).padStart(2, '0')
}

/** The accent pushed toward white - the white-hot core color of a laser whose
 *  beam is `hex`. */
function towardWhite(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const channel = (shift: number) => {
    const c = (n >> shift) & 255
    return Math.round(c + (255 - c) * t).toString(16).padStart(2, '0')
  }
  return `#${channel(16)}${channel(8)}${channel(0)}`
}

// ── Live preview ────────────────────────────────────────────────────────────

/** The orb, driven by the same shader + color math as the instrument at rest
 *  (energy 0, full opacity). Uniform values are written in useFrame so color
 *  edits land without remounting the material (same one-identity rule as the
 *  instrument's uniforms object). */
function PreviewOrb({ color, size, glow, whiteCore }: {
  color: string
  size: number
  glow: number
  whiteCore: number
}) {
  const base = useRef(new Color())
  const uniforms = useRef({
    coreColor: { value: new Color(DEFAULT_LASER_SPHERE_COLOR) },
    rimColor: { value: new Color(DEFAULT_LASER_SPHERE_COLOR).multiplyScalar(5.5) },
    uOpacity: { value: 1 },
  }).current
  const materialRef = useRef<ShaderMaterial>(null)

  useFrame(() => {
    const material = materialRef.current
    if (!material) return
    base.current.set(color)
    const core = evaluateCoreAppearance(whiteCore, glow, 0)
    ;(material.uniforms.coreColor.value as Color).copy(base.current)
      .lerp(WHITE, core.whiteMix)
      .multiplyScalar(core.intensity)
    ;(material.uniforms.rimColor.value as Color).copy(base.current)
      .lerp(WHITE, 0.13)
      .multiplyScalar(glow)
  })

  return (
    <mesh scale={clamp(size / 1.6, 0.22, 1.25) * 0.78}>
      <sphereGeometry args={[0.9, 64, 48]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={LASER_VERTEX_SHADER}
        fragmentShader={LASER_FRAGMENT_SHADER}
        uniforms={uniforms}
        toneMapped={false}
      />
    </mesh>
  )
}

function OrbPreview({ color, size, glow, whiteCore, light }: {
  color: string
  size: number
  glow: number
  whiteCore: number
  light: number
}) {
  return (
    <div
      data-testid="laser-orb-preview"
      title="Drag to orbit the laser"
      className="relative h-[148px] cursor-grab overflow-hidden border-b border-white/[0.06] bg-[#05070c] active:cursor-grabbing"
    >
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0.9, 4.3], fov: 40 }} gl={{ antialias: true, alpha: true }}>
        {/* Opaque scene background: bloom composited onto a transparent canvas
            leaves visible alpha seams around the halo; an in-scene near-black
            keeps the glow falloff clean like the main compositor's. */}
        <color attach="background" args={['#05070c']} />
        <PreviewOrb color={color} size={size} glow={glow} whiteCore={whiteCore} />
        {/* The instrument's scene light at rest, dimmed for the tiny room so
            the floor pool stays a hint - it still tracks the LIGHT knob live. */}
        <pointLight position={[0, 0, 0]} color={color} intensity={light * 0.4} distance={14} decay={2} />
        <ambientLight intensity={0.05} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, 0]}>
          <circleGeometry args={[4.2, 48]} />
          <meshStandardMaterial color="#080b11" roughness={1} metalness={0} />
        </mesh>
        {/* Same pass as LaserPreviewBloom (InstrumentHoverPreview) - kept inline
            to avoid importing the sidebar module graph into the settings panel. */}
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.9} luminanceThreshold={1.15} luminanceSmoothing={0.08} mipmapBlur radius={0.72} levels={7} />
        </EffectComposer>
        <OrbitControls
          makeDefault
          target={[0, -0.1, 0]}
          enablePan={false}
          enableZoom={false}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI * 0.66}
        />
      </Canvas>
    </div>
  )
}

// ── Controls ────────────────────────────────────────────────────────────────

/** Flat console knob whose value arc IS a laser: a near-white hot core drawn
 *  over a blurred accent-colored copy of the same arc, so the glow lives only
 *  where the arc is lit - no uniform drop shadow. A white-hot dot burns at the
 *  arc's tip, the beam's terminus. Interaction never brightens anything. Drag
 *  vertically, double-click resets, arrows nudge. Honors the param's response
 *  curve the same way ParamSlider does (curved knobs round to 3 significant
 *  digits so the low end the curve exists for stays reachable). */
function LaserKnob({ parameter: bound, label, accent, large = false }: {
  parameter: UserInterfaceParameter
  label: string
  accent: string
  /** The instrument's primary param reads a step larger (SIZE here). */
  large?: boolean
}) {
  const dragRef = useRef<{ y: number; norm: number } | null>(null)
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null

  const value = bound.value
  const curve = definition.curve ?? 1
  const range = definition.max - definition.min
  const norm = range === 0 ? 0 : clamp((value - definition.min) / range, 0, 1)
  const percent = Math.pow(norm, 1 / curve)
  const angle = -135 + percent * 270

  const commitNorm = (t: number) => {
    const raw = definition.min + Math.pow(clamp(t, 0, 1), curve) * range
    const snapped = curve === 1
      ? definition.min + Math.round((raw - definition.min) / definition.step) * definition.step
      : raw === 0 ? 0 : Number(raw.toPrecision(3))
    bound.setValue(clamp(Number(snapped.toFixed(8)), definition.min, definition.max))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    // Capture can throw for exotic/synthetic pointers; the drag still works
    // through the move/up handlers on the element itself.
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
    dragRef.current = { y: event.clientY, norm: percent }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    commitNorm(dragRef.current.norm + (dragRef.current.y - event.clientY) / 140)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    commitNorm(percent + direction * 0.03)
  }

  return (
    <div className="flex min-w-0 flex-col items-center">
      <div
        role="slider"
        tabIndex={0}
        aria-label={definition.label}
        aria-valuemin={definition.min}
        aria-valuemax={definition.max}
        aria-valuenow={value}
        title="Drag vertically · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => bound.setValue(definition.default)}
        onKeyDown={onKeyDown}
        className={`relative ${large ? 'h-[52px] w-[52px]' : 'h-11 w-11'} cursor-ns-resize touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/50`}
      >
        {/* Emission is sold by exponential falloff: a wide soft accent bloom,
            a tight whiter bloom, then the white-hot core - all copies of the
            same arc, so light exists only where the arc is lit. */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${accent} 0deg ${percent * 270}deg, transparent ${percent * 270}deg 360deg)`,
            filter: 'blur(6px)',
            transform: 'scale(1.16)',
            opacity: 0.9,
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${towardWhite(accent, 0.35)} 0deg ${percent * 270}deg, transparent ${percent * 270}deg 360deg)`,
            filter: 'blur(1.5px)',
          }}
        />
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${towardWhite(accent, 0.82)} 0deg ${percent * 270}deg, rgba(255,255,255,0.08) ${percent * 270}deg 270deg, transparent 270deg)`,
          }}
        />
        <div className="absolute inset-[3px] rounded-full border border-white/10 bg-[#14171f]" />
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="absolute left-1/2 top-[5px] h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-white/90" />
          {/* The laser terminus: a white-hot point at the arc's tip. */}
          <span
            className="absolute left-1/2 top-[-1px] h-1 w-1 -translate-x-1/2 rounded-full bg-white"
            style={{ boxShadow: `0 0 5px 1.5px ${accent}` }}
          />
        </div>
      </div>
      <span className="mt-1 text-[8px] font-semibold tracking-[0.12em] text-white/40">{label}</span>
      <span className="font-mono text-[9px] tabular-nums text-white/70">
        {definition.step >= 1
          ? value.toFixed(0)
          : value !== 0 && Math.abs(value) < 0.01 ? value.toPrecision(1) : value.toFixed(2)}
      </span>
    </div>
  )
}

const WHEEL_SIZE = 132
const WHEEL_RADIUS = WHEEL_SIZE / 2

/** The color pill + its continuous picker: a true HSV wheel (hue around the
 *  ring, saturation toward the center) with a brightness bar - no native
 *  swatch list. Opens upward over the preview so the panel never scrolls.
 *  The pill is the panel's emitter: a flat fill of the color wearing the halo
 *  the GLOW param dictates. */
function ColorWheel({ bound, halo }: { bound: UserInterfaceParameter; halo: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const wheelRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [hsv, setHsv] = useState(() => hexToHsv(typeof bound.value === 'string' ? bound.value : DEFAULT_LASER_SPHERE_COLOR))

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

  if (typeof bound.value !== 'string') return null
  const hex = bound.value

  const commit = (h: number, s: number, v: number) => {
    setHsv({ h, s, v })
    bound.setValue(hsvToHex(h, s, v))
  }

  const wheelFromPointer = (clientX: number, clientY: number) => {
    const rect = wheelRef.current?.getBoundingClientRect()
    if (!rect) return
    const dx = clientX - (rect.left + rect.width / 2)
    const dy = clientY - (rect.top + rect.height / 2)
    const h = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360
    const s = clamp(Math.hypot(dx, dy) / (rect.width / 2), 0, 1)
    commit(h, s, hsv.v)
  }

  const barFromPointer = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect) return
    commit(hsv.h, hsv.s, clamp((clientX - rect.left) / rect.width, 0, 1))
  }

  const dragHandlers = (setFrom: (x: number, y: number) => void) => ({
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch {}
      setFrom(event.clientX, event.clientY)
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) setFrom(event.clientX, event.clientY)
    },
  })

  // Marker position from the CURRENT hsv (kept in state so a desaturated or
  // dark color still remembers its hue while being edited).
  const markerAngle = hsv.h * Math.PI / 180
  const markerRadius = hsv.s * (WHEEL_RADIUS - 7)
  const markerX = WHEEL_RADIUS + Math.sin(markerAngle) * markerRadius
  const markerY = WHEEL_RADIUS - Math.cos(markerAngle) * markerRadius
  const fullColor = hsvToHex(hsv.h, hsv.s, 1)

  return (
    <div ref={hostRef} className="relative flex min-w-0 flex-col items-center">
      <button
        data-testid="laser-color-pill"
        aria-label="Laser color"
        aria-expanded={open}
        title={`Laser color ${hex}`}
        onClick={() => setOpen((o) => !o)}
        className="h-8 w-8 cursor-pointer rounded-full border border-white/15 transition-transform active:scale-95"
        style={{ background: hex, boxShadow: halo }}
      />
      <span className="mt-1 text-[8px] font-semibold tracking-[0.12em] text-white/40">COLOR</span>
      <span className="font-mono text-[9px] uppercase text-white/70">{hex}</span>

      {open && (
        <div
          data-testid="laser-color-wheel"
          className="absolute bottom-full right-0 z-50 mb-2 rounded-md border border-white/10 bg-[#0d1017] p-3 shadow-[0_8px_24px_rgba(0,0,0,.5)]"
        >
          <div
            ref={wheelRef}
            {...dragHandlers(wheelFromPointer)}
            className="relative cursor-crosshair touch-none rounded-full"
            style={{
              width: WHEEL_SIZE,
              height: WHEEL_SIZE,
              background: `radial-gradient(circle closest-side, #fff, rgba(255,255,255,0) 100%), conic-gradient(#f00, #ff0 60deg, #0f0 120deg, #0ff 180deg, #00f 240deg, #f0f 300deg, #f00 360deg)`,
            }}
          >
            <span
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_4px_rgba(0,0,0,.8)]"
              style={{ left: markerX, top: markerY, background: fullColor }}
            />
          </div>
          <div
            ref={barRef}
            {...dragHandlers((x) => barFromPointer(x))}
            aria-label="Brightness"
            className="relative mt-3 h-3 cursor-pointer touch-none rounded-full"
            style={{ background: `linear-gradient(to right, #000, ${fullColor})` }}
          >
            <span
              className="absolute top-1/2 h-4 w-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-white/60 bg-white/90"
              style={{ left: `${hsv.v * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

export const LaserSphereUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const size = parameter(parameters, 'size')
  const color = parameter(parameters, 'color')
  const glow = parameter(parameters, 'glow')
  const whiteCore = parameter(parameters, 'whiteCore')
  const light = parameter(parameters, 'light')

  if (!size || !color || !glow || !whiteCore || !light) return <ParameterList parameters={parameters} />

  const accent = stringValue(color, DEFAULT_LASER_SPHERE_COLOR)
  const accentHsv = hexToHsv(accent)
  const glowValue = numericValue(glow, 5.5)
  // The section background is a hue-true DARK SHADE of the accent, not an
  // alpha tint: low-alpha color over the panel's mid-gray mixes into mud,
  // while keeping the hue at low value stays alive.
  const shade = hsvToHex(accentHsv.h, Math.min(accentHsv.s, 0.5), 0.075)
  // The COLOR pill is the emitter - its halo alone follows the GLOW param
  // (1.5..12) in reach and strength. Knob glow lives in the arcs themselves.
  const pillHalo = `0 0 ${Math.round(5 + glowValue * 1.8)}px ${withAlpha(accent, 0.18 + (glowValue / 12) * 0.55)}`

  return (
    // Full-bleed: cancel the settings container's p-3 so the instrument runs
    // edge to edge (the guide's "just another panel" rule), washed with a
    // low-alpha tint of the instrument's own color.
    <section
      data-testid="laser-sphere-user-interface"
      className="-mx-3 -mt-3"
      style={{ background: shade }}
    >
      <OrbPreview
        color={accent}
        size={numericValue(size, 1.6)}
        glow={glowValue}
        whiteCore={numericValue(whiteCore, 1)}
        light={numericValue(light, 14)}
      />
      <div
        className="flex items-end gap-5 px-4 pb-4 pt-3"
        // The orb's light spilling through the seam onto the console - the
        // room is lit by the instrument, not painted.
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(accent, 0.14)}, transparent)` }}
      >
        <LaserKnob parameter={size} label="SIZE" accent={accent} large />
        <LaserKnob parameter={glow} label="GLOW" accent={accent} />
        <LaserKnob parameter={whiteCore} label="CORE" accent={accent} />
        <LaserKnob parameter={light} label="LIGHT" accent={accent} />
        <div className="ml-auto">
          <ColorWheel bound={color} halo={pillHalo} />
        </div>
      </div>
    </section>
  )
}

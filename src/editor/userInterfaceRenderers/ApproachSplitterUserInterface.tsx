'use client'

// Bespoke settings for the Approach splitter, built from the console kit
// (./console): a full-bleed panel washed in the splitter's warp-blue shade, a
// LIVE preview up top, then one row of flat knobs - SPEED, DENSITY, DISTANCE,
// SIZE - with the two segmented mode selectors on the right.
//
// The preview is not a mockup: it feeds the splitter's real resolve() and
// applies the returned transforms to a field of small gems every frame, from a
// camera parked at APPROACH_CAMERA_Z - the same place the splitter's defaults
// assume the stage camera sits. So the preview shows the actual illusion,
// including copies swelling past the lens and being recycled off-screen, and
// every knob reads live.
//
// The preview deliberately does NOT loop a fixed pattern in STREAM mode: the
// stream is already periodic, so the raw beat is fed straight in. NOTES mode
// gets a short demo rhythm whose loop length is derived from how long a flight
// actually takes at the current speed, so the last arrival always lands before
// the loop wraps.

import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { Music, Waves, ZoomIn, ZoomOut } from 'lucide-react'
import { Color, InstancedMesh, Matrix4, Object3D } from 'three'
import {
  APPROACH_CAMERA_Z,
  APPROACH_SPAWN_PITCH,
  approachCount,
  approachSplitter,
  type ApproachSettings,
} from '../core/visualCopies/approach'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import type { ResolvedNote } from '../core/visual/types'
import {
  bindPanel,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  spillOf,
  useConsoleAccent,
  type SelectBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'
import { APPROACH_COLOR } from '../core/visualCopies/identityColors'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// The splitter has no color param (it only moves and scales copies), so the
// panel wears the sensation it produces: warp-drive blue.
const WARP = APPROACH_COLOR
const ROOM = '#03060b'

const MAX_PREVIEW_SLOTS = 48
// Each flight is drawn as a RING of objects rather than one object. The splitter
// itself is single-file - its job is depth, not layout - so a literal preview
// would stack every copy on one line and show you a single object with the rest
// hidden directly behind it. A ring reads as a thing you fly THROUGH, and its
// rotational symmetry is what makes NOTES mode stable to look at: the lateral
// offset is keyed to the ring point, never to the slot index, so the
// newest-note-first slot reshuffle can no longer jog a copy sideways mid-flight.
const RING_POINTS = 6
const RING_RADIUS = 1.5
const MAX_PREVIEW_COPIES = MAX_PREVIEW_SLOTS * RING_POINTS

// ── The live preview ─────────────────────────────────────────────────────────

/** Beats a single flight takes to cover the run at the current settings. */
function runBeats(settings: ApproachSettings): number {
  const speed = Math.abs(settings.speed)
  return speed <= 1e-9 ? 8 : Math.max(0.25, settings.depth / speed)
}

/**
 * A short demo rhythm for NOTES mode. The loop runs a little longer than one
 * flight so the last arrival always lands before it wraps, and the spacing is
 * deliberately uneven - a regular pattern would be indistinguishable from
 * STREAM mode and the segmented control would look like it did nothing.
 */
const DEMO_BEAT_FRACTIONS = [0, 0.16, 0.27, 0.52, 0.68, 0.74]
const DEMO_VELOCITIES = [1, 0.65, 0.85, 1, 0.5, 0.9]

function demoNotes(loopBeats: number): ResolvedNote[] {
  return DEMO_BEAT_FRACTIONS.map((fraction, i) => ({
    beat: fraction * loopBeats,
    pitch: APPROACH_SPAWN_PITCH,
    durationBeats: 0.25,
    velocity: DEMO_VELOCITIES[i],
    blockStartBeat: 0,
    blockEndBeat: loopBeats,
  }))
}

function ApproachField({ settings }: { settings: ApproachSettings }) {
  const meshRef = useRef<InstancedMesh>(null)
  const scratch = useRef({
    dummy: new Object3D(),
    base: new Matrix4(),
    color: new Color(),
    room: new Color(ROOM),
    warp: new Color(WARP),
    hot: new Color('#eaf7ff'),
  }).current

  const noteMode = Math.round(settings.spawnMode) === 1
  const loopBeats = runBeats(settings) * 1.35
  const notes = useMemo(() => (noteMode ? demoNotes(loopBeats) : []), [noteMode, loopBeats])
  // resolve() closes over the settings and notes; apply() is then a cheap pure
  // sample per copy per frame.
  const resolved = useMemo(() => approachSplitter.resolve({ settings, notes }), [settings, notes])
  const count = approachCount(settings)

  const live = useRef({ resolved, count, noteMode, loopBeats })
  live.current = { resolved, count, noteMode, loopBeats }

  useFrame(({ clock }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const { dummy, base, color, room, warp, hot } = scratch
    const current = live.current
    // 2 beats per second - a notional 120 BPM, matching the other previews.
    const elapsed = clock.getElapsedTime() * 2
    // STREAM is already periodic, so it takes the raw beat; NOTES wraps to the
    // demo loop.
    const beat = current.noteMode ? elapsed % current.loopBeats : elapsed

    // One apply() per ring POINT, not per instance: each call already returns
    // every flight, so this is RING_POINTS evaluations per frame instead of the
    // quadratic sweep an instance-major loop would do.
    for (let point = 0; point < RING_POINTS; point++) {
      const angle = (point / RING_POINTS) * Math.PI * 2
      base.makeTranslation(Math.cos(angle) * RING_RADIUS, Math.sin(angle) * RING_RADIUS, 0)
      const copies = current.resolved.apply(
        { transform: base, opacity: 1, colorShift: { hue: 0, saturation: 0, lightness: 0, tint: null, tintAmount: 0 } },
        { beat, index: 0, count: 1 },
      )
      for (let slot = 0; slot < MAX_PREVIEW_SLOTS; slot++) {
        const instance = slot * RING_POINTS + point
        const result = slot < current.count ? copies[slot] : undefined
        if (!result) {
          // Park unused instances at zero scale rather than resizing the buffer.
          dummy.matrix.makeScale(0, 0, 0)
          mesh.setMatrixAt(instance, dummy.matrix)
          continue
        }
        dummy.matrix.copy(result.transform)
        mesh.setMatrixAt(instance, dummy.matrix)
        // Distance reads as temperature: the far, newborn copies sit near the
        // room color and ignite toward white as they arrive. Instanced meshes
        // cannot fade alpha, so the opacity gate sinks the color into the room.
        const nearness = clamp((result.transform.elements[14] - (settings.nearEnd - settings.depth)) / Math.max(1, settings.depth), 0, 1)
        color.copy(warp).lerp(hot, nearness * 0.7)
        color.lerp(room, 1 - clamp(result.opacity, 0, 1))
        mesh.setColorAt(instance, color)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_PREVIEW_COPIES]} frustumCulled={false}>
      <octahedronGeometry args={[0.42, 0]} />
      <meshStandardMaterial metalness={0.3} roughness={0.35} color="#ffffff" />
    </instancedMesh>
  )
}

function ApproachPreview({ settings }: { settings: ApproachSettings }) {
  return (
    <PreviewWindow height={172} testId="approach-preview">
      {/* The camera sits exactly where the splitter's defaults assume the stage
          camera sits, and does NOT orbit: the whole illusion is defined
          relative to the lens, so a free camera would misrepresent it. */}
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, APPROACH_CAMERA_Z], fov: 55 }} gl={{ antialias: true, alpha: true }}>
        <color attach="background" args={[ROOM]} />
        <ApproachField settings={settings} />
        <pointLight position={[0, 1.5, APPROACH_CAMERA_Z - 1]} color={WARP} intensity={14} distance={30} decay={2} />
        <directionalLight position={[3, 4, 6]} intensity={0.7} color="#cfe6ff" />
        <ambientLight intensity={0.14} />
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.6} luminanceThreshold={0.7} luminanceSmoothing={0.16} mipmapBlur radius={0.72} levels={6} />
        </EffectComposer>
      </Canvas>
    </PreviewWindow>
  )
}

// ── Controls ─────────────────────────────────────────────────────────────────

/** Segmented icon selector for a two-option select param, in the solid-fill
 *  family (Colorizer, Bass Ripple): the icon carries the meaning and the
 *  tooltip carries the words, so the row stays narrow enough to sit beside the
 *  knobs. */
function IconSegmented({ b, label, icons, testId }: {
  b: SelectBinding
  label: string
  icons: Record<number, { icon: typeof Waves; title: string }>
  testId: string
}) {
  const accent = useConsoleAccent()
  const selected = Math.round(b.value)

  return (
    <div className="flex flex-col items-center gap-1" data-testid={testId}>
      <div className="flex overflow-hidden rounded-md border border-white/10">
        {b.def.options.map((option) => {
          const entry = icons[option.value]
          const Icon = entry?.icon
          const active = option.value === selected
          return (
            <button
              key={option.value}
              aria-label={option.label}
              aria-pressed={active}
              title={entry?.title ?? option.label}
              onClick={() => b.set(option.value)}
              className={`flex h-[22px] w-[26px] items-center justify-center transition-colors ${
                active ? 'text-black' : 'bg-black/25 text-white/40 hover:text-white/70'
              }`}
              style={active ? { background: accent } : undefined}
            >
              {Icon ? <Icon size={12} strokeWidth={2.4} /> : option.label}
            </button>
          )
        })}
      </div>
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">{label}</span>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export const ApproachSplitterUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const speed = b.num('speed')
  const density = b.num('density')
  const depth = b.num('depth')
  const size = b.num('size')
  const direction = b.select('direction')
  const spawnMode = b.select('spawnMode')

  // Memoized on the VALUES, not the parameter objects, so the preview's
  // resolve() reruns only on a real change. Declared before the fallback return
  // below - hooks must run unconditionally.
  const valuesKey = parameters
    .map((p) => `${p.definition.key}:${typeof p.value === 'number' ? p.value : ''}`)
    .join('|')
  const settings = useMemo(() => {
    const values: Record<string, number> = {}
    for (const p of parameters) if (typeof p.value === 'number') values[p.definition.key] = p.value
    return mergeDefinitionSettings(approachSplitter, values) as unknown as ApproachSettings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey])

  if (!speed || !density || !depth || !size || !direction || !spawnMode) {
    return <ParameterList parameters={parameters} />
  }

  return (
    <Console accent={WARP} testId="approach-user-interface">
      <ApproachPreview settings={settings} />
      <div className="flex flex-col gap-2 pb-3 pt-3" style={{ background: spillOf(WARP) }}>
        <ControlRow className="gap-3 px-4">
          <Knob b={speed} label="SPEED" large />
          <Knob b={density} label="DENSITY" />
          <Knob b={depth} label="DISTANCE" />
          <Knob b={size} label="SIZE" />
          <div className="ml-auto flex items-end gap-2">
            <IconSegmented
              b={direction}
              label="DIR"
              testId="approach-direction"
              icons={{
                0: { icon: ZoomIn, title: 'Toward camera — copies grow as they arrive' },
                1: { icon: ZoomOut, title: 'Away into the distance — copies shrink as they leave' },
              }}
            />
            <IconSegmented
              b={spawnMode}
              label="SPAWN"
              testId="approach-spawn"
              icons={{
                0: { icon: Waves, title: 'Stream — a steady flow, always something arriving' },
                1: { icon: Music, title: 'On notes — one flight per note, velocity sets its size' },
              }}
            />
          </div>
        </ControlRow>
        <More parameters={b.rest()} label="MORE" className="px-4" />
      </div>
    </Console>
  )
}

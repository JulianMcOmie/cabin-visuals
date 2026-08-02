'use client'

// Bespoke settings for the Tunnel splitter, following
// docs/instrument-panel-design-guide.md (Approach's panel is the nearest
// sibling — both stream copies down the camera axis): a full-bleed panel washed
// in the tunnel's corridor blue, a LIVE preview up top, then two console rows —
// STRUCTURE (ring counts + radius / depth / twist) and SPEED (the FREE/SYNC
// segmented control and whichever rate knob that mode reads).
//
// The preview is not a mockup: it feeds the splitter's real resolve() (with NO
// notes — the corridor's endless flow is passive, MIDI accents it) and applies
// the returned transforms to a field of thin tiles from a camera parked at
// TUNNEL_CAMERA_Z, the same place the splitter's own defaults assume the stage
// camera sits. Tiles rather than spheres so the FACING control is legible: a
// wall of tiles visibly turns toward the axis, spheres would hide it.
//
// The SYNC knob is STEPPED, like a tempo-synced rate switch on an audio
// plugin: it walks TUNNEL_SYNC_DETENTS (one ring arrival per 8/4/2/1/½/¼
// beats, either direction, or stopped) over an index domain so the detents sit
// evenly on the arc, and the readout speaks beats-per-ring. The stored value
// stays continuous rings-per-beat, so an automated off-grid value keeps an
// honest numeric readout until the knob is touched and snaps it.

import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Color, InstancedMesh, Object3D } from 'three'
import { mergeDefinitionSettings } from '../core/visualCopies/definitions'
import { identityVisualCopy } from '../core/visualCopies/identityVisualCopy'
import {
  TUNNEL_CAMERA_Z,
  TUNNEL_SYNC_DETENTS,
  tunnelCounts,
  tunnelSplitter,
  tunnelSyncDetentIndex,
  tunnelSyncDetentLabel,
  type TunnelSettings,
} from '../core/visualCopies/tunnel'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { withAlpha } from './colorWheel'
import { LaserKnob, formatKnobValue } from './laserKnob'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'
import { TUNNEL_COLOR } from '../core/visualCopies/identityColors'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

// The splitter has no color param (it only arranges and streams), so the panel
// wears the sensation it produces: corridor-light blue over a hue-true dark
// shade (never an alpha tint — see the design guide).
const CORRIDOR = TUNNEL_COLOR
const CORRIDOR_SHADE = '#0a0f18'
const ROOM = '#04070d'

// ── The live preview ─────────────────────────────────────────────────────────

function TunnelField({ settings }: { settings: TunnelSettings }) {
  const meshRef = useRef<InstancedMesh>(null)
  const scratch = useRef({
    dummy: new Object3D(),
    color: new Color(),
    room: new Color(ROOM),
    glow: new Color(CORRIDOR),
    hot: new Color('#eef6ff'),
  }).current

  // resolve() closes over the settings; apply() is then a cheap pure sample per
  // frame. No notes: the endless flow is the splitter's passive claim.
  const resolved = useMemo(() => tunnelSplitter.resolve({ settings, notes: [] }), [settings])
  const { copiesPerRing, rings } = tunnelCounts(settings)
  const count = copiesPerRing * rings

  const live = useRef({ resolved, settings, count })
  live.current = { resolved, settings, count }

  useFrame(({ clock }) => {
    const mesh = meshRef.current
    if (!mesh) return
    const { dummy, color, room, glow, hot } = scratch
    const current = live.current
    // 2 beats per second — a notional 120 BPM, matching the other previews, so
    // the SYNC detents read at their real cadence.
    const beat = clock.getElapsedTime() * 2
    const copies = current.resolved.apply(identityVisualCopy(), { beat, index: 0, count: 1 })
    const farEnd = current.settings.nearEnd - current.settings.depth
    for (let index = 0; index < copies.length && index < current.count; index++) {
      const copy = copies[index]
      dummy.matrix.copy(copy.transform)
      mesh.setMatrixAt(index, dummy.matrix)
      // Distance reads as temperature: far, newborn tiles sit near the room
      // color and ignite as they arrive. Instanced meshes cannot fade alpha,
      // so the fade band's opacity sinks the color into the room instead.
      const nearness = clamp((copy.transform.elements[14] - farEnd) / Math.max(1, current.settings.depth), 0, 1)
      color.copy(glow).lerp(hot, nearness * 0.65)
      color.lerp(room, 1 - clamp(copy.opacity, 0, 1))
      mesh.setColorAt(index, color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh key={count} ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      {/* Thin tiles, not spheres: FACING is a rotation, and only a flat face
          makes it visible — a wall of tiles turns toward the axis. */}
      <boxGeometry args={[0.66, 0.66, 0.14]} />
      <meshStandardMaterial metalness={0.25} roughness={0.4} color="#ffffff" />
    </instancedMesh>
  )
}

function TunnelPreview({ settings }: { settings: TunnelSettings }) {
  return (
    <div
      data-testid="tunnel-preview"
      className="relative h-[150px] overflow-hidden border-b border-white/[0.06]"
      style={{ background: ROOM }}
    >
      {/* The camera sits exactly where the splitter's defaults assume the stage
          camera sits, and does NOT orbit: the corridor is a camera-relative
          illusion, so a free camera would misrepresent it (the wrap would show). */}
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0, TUNNEL_CAMERA_Z], fov: 60 }} gl={{ antialias: true, alpha: true }}>
        <color attach="background" args={[ROOM]} />
        <TunnelField settings={settings} />
        <pointLight position={[0, 0, TUNNEL_CAMERA_Z - 2]} color={CORRIDOR} intensity={16} distance={40} decay={2} />
        <directionalLight position={[3, 4, 6]} intensity={0.6} color="#d5e6ff" />
        <ambientLight intensity={0.15} />
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.55} luminanceThreshold={0.72} luminanceSmoothing={0.16} mipmapBlur radius={0.7} levels={6} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}

// ── Controls ─────────────────────────────────────────────────────────────────

function BoundKnob({ bound, label, large = false, bipolar = false }: {
  bound: UserInterfaceParameter
  label: string
  large?: boolean
  bipolar?: boolean
}) {
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  return (
    <LaserKnob
      value={bound.value}
      min={definition.min}
      max={definition.max}
      step={definition.step}
      defaultValue={definition.default}
      curve={definition.curve ?? 1}
      label={label}
      ariaLabel={definition.label}
      accent={CORRIDOR}
      large={large}
      bipolar={bipolar}
      onChange={bound.setValue}
    />
  )
}

/** The SYNC rate knob: turns in DETENT INDICES so the musical divisions sit
 *  evenly on the arc, converted back to stored rings-per-beat on the way out. */
function SyncRateKnob({ bound }: { bound: UserInterfaceParameter }) {
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  const value = bound.value
  const index = tunnelSyncDetentIndex(value)
  const onGrid = TUNNEL_SYNC_DETENTS[index] === value
  return (
    <LaserKnob
      value={index}
      min={0}
      max={TUNNEL_SYNC_DETENTS.length - 1}
      step={1}
      defaultValue={tunnelSyncDetentIndex(definition.default)}
      label="RATE"
      ariaLabel="Sync rate, beats per ring"
      accent={CORRIDOR}
      large
      bipolar
      // An off-grid (automated) value keeps an honest numeric readout until
      // the knob is touched and snaps it to a division.
      format={(knobIndex) => (onGrid
        ? tunnelSyncDetentLabel(TUNNEL_SYNC_DETENTS[Math.round(knobIndex)] ?? 0)
        : formatKnobValue(value, 0.05))}
      onChange={(knobIndex) => {
        const detent = TUNNEL_SYNC_DETENTS[clamp(Math.round(knobIndex), 0, TUNNEL_SYNC_DETENTS.length - 1)]
        if (detent !== value) bound.setValue(detent)
      }}
    />
  )
}

/** Small −/+ stepper for the two structural counts: exact small integers where
 *  a smooth knob would make the value a hunt (same reasoning as Radial
 *  Motion's seat counts). */
function CountStepper({ bound, label }: { bound: UserInterfaceParameter; label: string }) {
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  const value = Math.round(bound.value)

  const step = (direction: -1 | 1) => (
    <button
      aria-label={`${direction < 0 ? 'Fewer' : 'More'}: ${definition.label}`}
      disabled={direction < 0 ? value <= definition.min : value >= definition.max}
      onClick={() => bound.setValue(clamp(value + direction, definition.min, definition.max))}
      className="flex h-[16px] w-[16px] items-center justify-center rounded-[3px] border border-white/10 bg-black/30 font-mono text-[10px] leading-none text-white/45 transition-colors hover:text-white/80 disabled:opacity-25 disabled:hover:text-white/45"
    >
      {direction < 0 ? '−' : '+'}
    </button>
  )

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1">
        {step(-1)}
        <span className="w-[18px] text-center font-mono text-[11px] tabular-nums text-white/75">{value}</span>
        {step(1)}
      </div>
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">{label}</span>
    </div>
  )
}

/** Segmented selector over a select param's options, with short display labels
 *  (the full option label rides on the tooltip and aria). */
function Segmented({ bound, label, shortLabels, testId }: {
  bound: UserInterfaceParameter
  label: string
  shortLabels: Record<number, string>
  testId: string
}) {
  const definition = bound.definition
  if (definition.type !== 'select') return null
  const selected = typeof bound.value === 'number' ? Math.round(bound.value) : definition.default

  return (
    <div className="flex flex-col items-center gap-1" data-testid={testId}>
      <div className="flex overflow-hidden rounded-md border border-white/10">
        {definition.options.map((option) => {
          const active = option.value === selected
          return (
            <button
              key={option.value}
              aria-label={option.label}
              aria-pressed={active}
              title={option.label}
              onClick={() => bound.setValue(option.value)}
              className={`flex h-[22px] min-w-[30px] items-center justify-center px-1.5 text-[8px] font-bold tracking-[0.1em] transition-colors ${
                active ? 'text-black' : 'bg-black/25 text-white/40 hover:text-white/70'
              }`}
              style={active ? { background: CORRIDOR } : undefined}
            >
              {shortLabels[option.value] ?? option.label}
            </button>
          )
        })}
      </div>
      <span className="text-[8px] font-semibold tracking-[0.12em] text-white/40">{label}</span>
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

// Both speed keys are PLACED even though only the active mode's knob renders:
// the inactive one must not leak into MORE as a stray slider.
const PLACED_KEYS = new Set([
  'copiesPerRing', 'rings', 'radius', 'depth', 'twistDegrees',
  'speedMode', 'speed', 'syncRingsPerBeat', 'midiSpeed', 'orientation',
])
const REQUIRED_KEYS = [...PLACED_KEYS]

export const TunnelSplitterUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const [showMore, setShowMore] = useState(false)

  const bound = Object.fromEntries(parameters.map((p) => [p.definition.key, p]))

  // Memoized on the VALUES, not the parameter objects, so the preview's
  // resolve() reruns only on a real change. Declared before the fallback
  // return below — hooks must run unconditionally.
  const valuesKey = parameters
    .map((p) => `${p.definition.key}:${typeof p.value === 'number' ? p.value : ''}`)
    .join('|')
  const settings = useMemo(() => {
    const values: Record<string, number> = {}
    for (const p of parameters) if (typeof p.value === 'number') values[p.definition.key] = p.value
    return mergeDefinitionSettings(tunnelSplitter, values) as unknown as TunnelSettings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey])

  if (REQUIRED_KEYS.some((key) => !bound[key])) return <ParameterList parameters={parameters} />

  const unplaced = parameters.filter((p) => !PLACED_KEYS.has(p.definition.key))
  const synced = Math.round(typeof bound.speedMode.value === 'number' ? bound.speedMode.value : 0) === 1

  return (
    <section
      data-testid="tunnel-user-interface"
      className="-mx-3 -mt-3"
      style={{ background: CORRIDOR_SHADE }}
    >
      <TunnelPreview settings={settings} />
      <div
        className="flex flex-col gap-2.5 pb-3 pt-3"
        // The corridor's light spilling through the seam onto the console — the
        // room is lit by the splitter, not painted.
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(CORRIDOR, 0.13)}, transparent)` }}
      >
        <div className="flex items-end gap-3 px-4">
          <BoundKnob bound={bound.radius} label="RADIUS" large />
          <BoundKnob bound={bound.depth} label="DEPTH" />
          <BoundKnob bound={bound.twistDegrees} label="TWIST" bipolar />
          <div className="ml-auto flex flex-col items-center gap-2 pb-0.5">
            <CountStepper bound={bound.copiesPerRing} label="SPOKES" />
            <CountStepper bound={bound.rings} label="RINGS" />
          </div>
        </div>
        <div className="flex items-end gap-3 border-t border-white/[0.05] px-4 pt-2.5">
          {synced
            ? <SyncRateKnob bound={bound.syncRingsPerBeat} />
            : <BoundKnob bound={bound.speed} label="SPEED" large bipolar />}
          <BoundKnob bound={bound.midiSpeed} label="MIDI" />
          <div className="ml-auto flex items-end gap-2">
            <Segmented
              bound={bound.speedMode}
              label="CLOCK"
              testId="tunnel-speed-mode"
              shortLabels={{ 0: 'FREE', 1: 'SYNC' }}
            />
            <Segmented
              bound={bound.orientation}
              label="FACING"
              testId="tunnel-facing"
              shortLabels={{ 0: 'OFF', 1: 'IN', 2: 'OUT' }}
            />
          </div>
        </div>
        {unplaced.length > 0 && (
          <div className="px-4">
            <button
              aria-expanded={showMore}
              onClick={() => setShowMore((v) => !v)}
              className="flex items-center gap-1 text-[8px] font-bold tracking-[0.18em] text-white/30 transition-colors hover:text-white/60"
            >
              {showMore ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              MORE
            </button>
            {showMore && (
              <div className="mt-1.5 rounded-md border border-white/[0.06] bg-black/25 p-2">
                <ParameterList parameters={unplaced} />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

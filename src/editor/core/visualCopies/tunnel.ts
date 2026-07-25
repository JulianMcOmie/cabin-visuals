// Tunnel splitter: rings of copies strung down an axis, all sliding toward the
// viewer at a steady rate. The endlessness is an illusion - there are only
// `rings * copiesPerRing` structural copies, and a copy that slides past the
// near end wraps straight back to the far end (its axial distance is taken
// modulo the tunnel depth). Because the near end defaults to sitting BEHIND the
// camera and copies fade out before reaching it, the respawn is never visible:
// the same handful of rings reads as an infinite corridor rushing past you.
//
// Everything is a closed-form function of the beat - the wrap is `mod`, not an
// accumulator - so pause, scrub, playback, and export agree exactly.
//
// Two things the defaults deliberately protect, because getting them wrong is
// what makes the illusion visible:
//  - The near end sits BEHIND the default camera (z = 5) by at least the fade
//    distance, so the fade-out happens where nothing can see it. Pulled in
//    front of the camera it reads as copies dimming out in your face, at the
//    exact moment they are largest on screen.
//  - Distances are world-metric: the offsets divide out the placement's scale,
//    so an instrument that draws itself at half size does not shrink the
//    corridor (and pull the near end back in front of the camera) with it.
//  - Every copy is a full instrument (its own material, geometry, and - for the
//    lasers - its own point light), so copy count is the expensive setting
//    here, not depth or speed.
//
// Slot order is ring-major: slot = ring * copiesPerRing + spoke, ring 0 being
// the one that starts at the near end. Downstream index-based movers (a
// Visibility set to 'Each index') therefore walk one ring at a time.

import { Matrix4, Quaternion, Vector3 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { normalizedVelocity } from './motionBasis'
import type { VisualCopy } from './types'

export interface TunnelSettings {
  /** Copies evenly spaced around each ring (1 collapses the tunnel to single file). */
  copiesPerRing: number
  /** Ring count down the axis. */
  rings: number
  radius: number
  /** Axial length the rings are spread over, and the wrap period. */
  depth: number
  /** Axial coordinate copies wrap AT. Keep it at least `fadeDistance` behind
   *  the camera (which sits at z = 5 by default) so the fade-out is off-screen. */
  nearEnd: number
  /** Units travelled per beat; negative sends the tunnel away from you. */
  speed: number
  /** Per-ring rotation about the axis, for a spiral corridor. */
  twistDegrees: number
  /** 0 = Z (toward the default camera), 1 = X, 2 = Y. */
  axis: number
  /** 0 = fixed, 1 = face the tunnel axis, 2 = face away from it. */
  orientation: number
  /** Ramp length at both ends of the tunnel; 0 makes copies pop. */
  fadeDistance: number
  /** Extra units per beat contributed by a held speed note at full velocity. */
  midiSpeed: number
  /** Lateral distance of the outermost origin rows from the axis. The origin
   *  rows latch fractions of this (see TUNNEL_ORIGIN_STEPS); 0 disables them. */
  originSpread: number
}

export const TUNNEL_FORWARD_PITCH = 60
export const TUNNEL_REVERSE_PITCH = 61

// ── Origin rows: where the corridor comes FROM ───────────────────────────────
// The destination (the near end, at the camera) never moves; these rows move
// the far end laterally, so copies fly the same corridor from a different
// direction. Two independent sets of five - one per cross-section axis - and
// each copy keeps the origin that was latched when IT spawned, so a note bends
// the corridor as new copies stream in from the new direction instead of
// snapping the whole column sideways.
export const TUNNEL_ORIGIN_X_PITCHES = [62, 63, 64, 65, 66]
export const TUNNEL_ORIGIN_Y_PITCHES = [67, 68, 69, 70, 71]

/** The five latchable positions per axis, as fractions of `originSpread`. */
export const TUNNEL_ORIGIN_STEPS = [-1, -0.5, 0, 0.5, 1]

const ORIGIN_X_LABELS = ['Origin X: far left', 'Origin X: left', 'Origin X: centre', 'Origin X: right', 'Origin X: far right']
const ORIGIN_Y_LABELS = ['Origin Y: far down', 'Origin Y: down', 'Origin Y: centre', 'Origin Y: up', 'Origin Y: far up']

const TUNNEL_ROWS: MidiRowDef[] = [
  { pitch: TUNNEL_FORWARD_PITCH, label: 'Rush forward' },
  { pitch: TUNNEL_REVERSE_PITCH, label: 'Rush backward' },
  ...TUNNEL_ORIGIN_X_PITCHES.map((pitch, step) => ({ pitch, label: ORIGIN_X_LABELS[step] })),
  ...TUNNEL_ORIGIN_Y_PITCHES.map((pitch, step) => ({ pitch, label: ORIGIN_Y_LABELS[step] })),
]

/** Lateral spawn point of the corridor, in the ring plane's own axes. */
export interface TunnelOrigin {
  x: number
  y: number
}

const ORIGIN_CENTRE: TunnelOrigin = { x: 0, y: 0 }

const TUNNEL_MAX_COPIES = 256
const MAX_COPIES_PER_RING = 32
const MAX_RINGS = 64
const DEGREES = Math.PI / 180
const Z_AXIS = new Vector3(0, 0, 1)

/** Axis vector plus the two ring-plane vectors, per `axis` setting. */
const TUNNEL_FRAMES: [Vector3, Vector3, Vector3][] = [
  [new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)], // Z
  [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)], // X
  [new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0)], // Y
]

function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period
}

/** Structural slot counts, clamped so a chain of splitters cannot fan out past
 *  the tunnel's own budget (rings give way first - a partial ring would break
 *  the corridor's symmetry). */
export function tunnelCounts(settings: TunnelSettings): { copiesPerRing: number; rings: number } {
  const copiesPerRing = Math.max(1, Math.min(MAX_COPIES_PER_RING, Math.round(settings.copiesPerRing)))
  const rings = Math.max(
    1,
    Math.min(MAX_RINGS, Math.floor(TUNNEL_MAX_COPIES / copiesPerRing), Math.round(settings.rings)),
  )
  return { copiesPerRing, rings }
}

/**
 * How far the whole tunnel has slid at `beat`: the base speed integrated over
 * the beat, plus the displacement contributed by the two speed rows. A held
 * note adds `midiSpeed * velocity` to the speed for exactly the portion of its
 * duration the playhead has reached, so the extra distance grows while the note
 * is held and is RETAINED afterwards (the tunnel keeps rolling from its new
 * phase rather than snapping back) - the same accumulate-while-held contract
 * Force Field Push uses. Overlapping forward/backward notes cancel.
 */
export function evaluateTunnelTravel(
  notes: readonly ResolvedNote[],
  settings: Pick<TunnelSettings, 'speed' | 'midiSpeed'>,
  beat: number,
): number {
  let travel = settings.speed * beat
  for (const note of notes) {
    const direction = note.pitch === TUNNEL_FORWARD_PITCH
      ? 1
      : note.pitch === TUNNEL_REVERSE_PITCH
        ? -1
        : 0
    if (direction === 0 || beat <= note.beat) continue
    const heldBeats = Math.min(Math.max(0, note.durationBeats), beat - note.beat)
    travel += direction * heldBeats * normalizedVelocity(note.velocity) * settings.midiSpeed
  }
  return travel
}

/**
 * The origin latch, as a function of the travel distance a copy SPAWNED at.
 *
 * Travel, not beat, is the lookup coordinate: a copy's spawn beat cannot be
 * recovered in closed form once MIDI speed notes make travel non-linear, but
 * the travel it spawned at can (see tunnelSlotPlacement). So each origin note
 * is recorded at the travel its onset happened at, and a copy takes the last
 * X row and the last Y row to have fired by the time it spawned - independently,
 * so X and Y latch separately. No origin notes yet = dead centre, which is
 * exactly the pre-origin-rows corridor.
 *
 * Velocity deliberately does not scale the offset: these rows are a discrete
 * selector, and a half-velocity 'far left' that lands somewhere between rows
 * would make the same note mean different directions take to take.
 */
export function tunnelOriginLookup(
  notes: readonly ResolvedNote[],
  settings: Pick<TunnelSettings, 'speed' | 'midiSpeed' | 'originSpread'>,
): (travelAtSpawn: number) => TunnelOrigin {
  const events = notes
    .map((note) => {
      const xStep = TUNNEL_ORIGIN_X_PITCHES.indexOf(note.pitch)
      const yStep = TUNNEL_ORIGIN_Y_PITCHES.indexOf(note.pitch)
      if (xStep < 0 && yStep < 0) return null
      const step = TUNNEL_ORIGIN_STEPS[xStep >= 0 ? xStep : yStep] ?? 0
      return {
        beat: note.beat,
        travel: evaluateTunnelTravel(notes, settings, note.beat),
        axis: xStep >= 0 ? ('x' as const) : ('y' as const),
        offset: step * settings.originSpread,
      }
    })
    .filter((event): event is NonNullable<typeof event> => event !== null)
    .sort((a, b) => a.beat - b.beat)

  if (events.length === 0) return () => ORIGIN_CENTRE
  return (travelAtSpawn) => {
    const origin = { ...ORIGIN_CENTRE }
    for (const event of events) {
      // Fired after this copy spawned: it belongs to the copies behind it.
      if (event.travel > travelAtSpawn + 1e-9) continue
      if (event.axis === 'x') origin.x = event.offset
      else origin.y = event.offset
    }
    return origin
  }
}

/**
 * One slot's placement at a given travel distance. `depthIntoTunnel` is the
 * distance back from the near end, always inside `[0, depth)` - that wrap IS
 * the endless-tunnel trick. Opacity ramps from 0 at both ends over
 * `fadeDistance` so a wrapping copy dissolves out and reappears faded in.
 *
 * `originAt` moves where the copy came FROM: its lateral offset is the latched
 * origin scaled by how far back the copy still is, so it is full at the far end
 * and exactly zero at the near end - same destination, different approach.
 */
export function tunnelSlotPlacement(
  slot: number,
  settings: TunnelSettings,
  travel: number,
  originAt: (travelAtSpawn: number) => TunnelOrigin = () => ORIGIN_CENTRE,
): { position: Vector3; depthIntoTunnel: number; opacity: number } {
  const { copiesPerRing, rings } = tunnelCounts(settings)
  const ring = Math.floor(slot / copiesPerRing)
  const spoke = slot % copiesPerRing
  const depth = Math.max(0.0001, settings.depth)
  const [axis, ringX, ringY] = TUNNEL_FRAMES[Math.round(settings.axis)] ?? TUNNEL_FRAMES[0]

  const angle = (spoke / copiesPerRing) * Math.PI * 2 + ring * settings.twistDegrees * DEGREES
  const spacing = depth / rings
  // Rings are laid out back from the near end, then the whole column slides by
  // `travel`; the modulo recycles whatever passes the near end to the far one.
  const depthIntoTunnel = positiveModulo(ring * spacing - travel, depth)

  // The copy has travelled `depth - depthIntoTunnel` since it wrapped in, so
  // that is the travel value it spawned at - the lookup key for its origin.
  // The offset tapers to nothing as it reaches the near end, which is why the
  // destination holds still while the direction of approach changes.
  const origin = originAt(travel - (depth - depthIntoTunnel))
  const remaining = depthIntoTunnel / depth

  const position = new Vector3()
    .addScaledVector(ringX, Math.cos(angle) * settings.radius + origin.x * remaining)
    .addScaledVector(ringY, Math.sin(angle) * settings.radius + origin.y * remaining)
    .addScaledVector(axis, settings.nearEnd - depthIntoTunnel)

  const fade = Math.max(0, settings.fadeDistance)
  // Energy-linear ramp. An emissive instrument scales BOTH its HDR color and
  // its alpha by this value, so what reaches the screen goes as opacity² - a
  // linear ramp therefore spends most of its length below the bloom threshold,
  // reading as a dull unglowing streak that suddenly ignites near the end. The
  // square root makes emitted energy rise linearly with distance instead, and
  // costs an ordinary alpha-blended object nothing but a slightly earlier
  // arrival.
  const linear = fade <= 0
    ? 1
    : Math.max(0, Math.min(1, depthIntoTunnel / fade, (depth - depthIntoTunnel) / fade))
  const opacity = Math.sqrt(linear)

  return { position, depthIntoTunnel, opacity }
}

/** Per-axis scale of a placement matrix (1 for a missing or degenerate one). */
export function placementAxisScale(placementTransform?: Matrix4): [number, number, number] {
  if (!placementTransform) return [1, 1, 1]
  const e = placementTransform.elements
  const lengths: [number, number, number] = [
    Math.hypot(e[0], e[1], e[2]),
    Math.hypot(e[4], e[5], e[6]),
    Math.hypot(e[8], e[9], e[10]),
  ]
  return lengths.map((length) => (length > 1e-9 ? length : 1)) as [number, number, number]
}

function slotTransform(
  slot: number,
  settings: TunnelSettings,
  travel: number,
  placementScale: [number, number, number],
  originAt: (travelAtSpawn: number) => TunnelOrigin,
): { transform: Matrix4; opacity: number } {
  const { position, opacity } = tunnelSlotPlacement(slot, settings, travel, originAt)
  const orientation = Math.round(settings.orientation)
  const transform = new Matrix4()

  const [axis] = TUNNEL_FRAMES[Math.round(settings.axis)] ?? TUNNEL_FRAMES[0]
  // Radial component only: facing is about the corridor wall, not the copy's
  // depth. A copy exactly on the axis has no radial direction and stays fixed.
  const radial = position.clone().addScaledVector(axis, -position.dot(axis))
  if (orientation !== 0 && radial.lengthSq() > 1e-12) {
    const direction = radial.normalize().multiplyScalar(orientation === 1 ? -1 : 1)
    transform.makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(Z_AXIS, direction))
  }
  // The corridor is a CAMERA-relative illusion, so its geometry has to be
  // world-metric. The renderer composes placement * transform, which would
  // multiply these offsets by however large the instrument draws itself: a
  // Laser Sphere at size 0.5 shrank a 40-deep tunnel to 12.5 and dragged the
  // near end - fade band and all - from behind the camera to in front of it,
  // so copies visibly dimmed mid-corridor at a fixed phase. Dividing the offset
  // by the placement's scale keeps Depth and Near end in scene units. Only the
  // offsets are normalised; each copy still RENDERS at the object's own size.
  position.set(position.x / placementScale[0], position.y / placementScale[1], position.z / placementScale[2])
  return { transform: transform.setPosition(position), opacity }
}

export const tunnelSplitter: MoverOrSplitterDefinition<TunnelSettings> = {
  id: 'tunnel',
  label: 'Tunnel',
  kind: 'splitter',
  params: [
    // 6 x 8 = 48 copies: enough for a corridor wall, and in the same weight
    // class as the other splitters (Parametric Pattern defaults to 48). Every
    // copy is a whole instrument, so this is the setting that costs frames.
    { key: 'copiesPerRing', label: 'Copies per ring', min: 1, max: MAX_COPIES_PER_RING, step: 1, default: 6 },
    { key: 'rings', label: 'Rings', min: 1, max: MAX_RINGS, step: 1, default: 8 },
    { key: 'radius', label: 'Radius', min: 0, max: 20, step: 0.1, default: 3 },
    { key: 'depth', label: 'Depth', min: 1, max: 200, step: 1, default: 40 },
    // Default camera z = 5, default fade 6: wrapping at 12 keeps the whole
    // fade-out band (6..12) behind it.
    { key: 'nearEnd', label: 'Near end (past camera)', min: -20, max: 40, step: 0.5, default: 12 },
    { key: 'speed', label: 'Speed / beat', min: -40, max: 40, step: 0.1, default: 4 },
    { key: 'twistDegrees', label: 'Twist / ring (°)', min: -180, max: 180, step: 1, default: 0 },
    {
      key: 'axis',
      label: 'Axis',
      type: 'select',
      options: [
        { value: 0, label: 'Z (toward camera)' },
        { value: 1, label: 'X' },
        { value: 2, label: 'Y' },
      ],
      default: 0,
    },
    {
      key: 'orientation',
      label: 'Orientation',
      type: 'select',
      options: [
        { value: 0, label: 'Fixed' },
        { value: 1, label: 'Face the axis' },
        { value: 2, label: 'Face outward' },
      ],
      default: 0,
    },
    { key: 'fadeDistance', label: 'Fade distance', min: 0, max: 50, step: 0.5, default: 6 },
    { key: 'midiSpeed', label: 'MIDI speed / beat', min: 0, max: 80, step: 0.5, default: 8 },
    // How far off-axis the outermost origin rows sit. Wider than the radius by
    // default, so 'far left' reads as a corridor swinging in from the side
    // rather than as a slightly thicker ring.
    { key: 'originSpread', label: 'Origin spread', min: 0, max: 60, step: 0.5, default: 8 },
  ],
  midiRows: () => TUNNEL_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const { copiesPerRing, rings } = tunnelCounts(settings)
    const count = copiesPerRing * rings
    // Beat-independent (each event is keyed by the travel it fired at), so the
    // origin timeline is built once per resolve rather than per copy.
    const originAt = tunnelOriginLookup(notes, settings)
    return {
      apply(visualCopy, { beat, placementTransform }) {
        const travel = evaluateTunnelTravel(notes, settings, beat)
        const placementScale = placementAxisScale(placementTransform)
        return Array.from({ length: count }, (_, slot) => {
          const { transform, opacity } = slotTransform(slot, settings, travel, placementScale, originAt)
          // LOCAL composition (previous * delta), the chain default: each slot's
          // transform becomes the reference frame for movers BELOW it, so a
          // Burst 'Forward (+Z)' under a Tunnel pushes every copy along its own
          // orientation rather than in world Z.
          const next: VisualCopy = {
            transform: visualCopy.transform.clone().multiply(transform),
            opacity: visualCopy.opacity * opacity,
            colorShift: { ...visualCopy.colorShift },
          }
          return next
        })
      },
    }
  },
}

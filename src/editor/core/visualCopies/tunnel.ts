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
// The 'Mute at camera' row is the escape hatch for choreography that must never
// touch the lens: while one of its notes is held, copies inside the camera zone
// (the stretch from the near end back to the camera plane, plus a margin in
// front of it) are muted to opacity zero. It is a pure opacity gate - the
// copies keep flowing underneath and pop back wherever the note releases them,
// so the count stays structural and scrubbing stays exact.
//
// Slot order is ring-major: slot = ring * copiesPerRing + spoke, ring 0 being
// the one that starts at the near end. Downstream index-based movers (a
// Visibility set to 'Each index') therefore walk one ring at a time.

import { Matrix4, Quaternion, Vector3 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import type { ResolvedNote } from '../visual/types'
import type { MoverOrSplitterDefinition } from './definitions'
import { normalizedVelocity } from './motionBasis'
import { applySplitterSize, splitterSize, SPLITTER_SIZE_PARAM } from './splitterSize'
import type { VisualCopy } from './types'
import { TUNNEL_COLOR } from './identityColors'

export interface TunnelSettings {
  /** Copies evenly spaced around each ring (1 collapses the tunnel to single file). */
  copiesPerRing: number
  /** Ring count down the axis. */
  rings: number
  radius: number
  /** Uniform scale on each copy, about its own center. Independent of the
   *  corridor's geometry: radius, depth and near end stay world-metric. */
  size: number
  /** Axial length the rings are spread over, and the wrap period. */
  depth: number
  /** Axial coordinate copies wrap AT. Keep it at least `fadeDistance` behind
   *  the camera (which sits at z = 5 by default) so the fade-out is off-screen. */
  nearEnd: number
  /** 0 = Free (`speed` in units/beat), 1 = Beat-synced (`syncRingsPerBeat`
   *  paces the corridor so rings arrive on musical divisions). */
  speedMode: number
  /** Units travelled per beat in Free mode; negative sends the tunnel away from you. */
  speed: number
  /** Rings arriving per beat in Beat-synced mode: 1 lands a ring on every
   *  beat, 0.5 on every other, negative runs the corridor backward. The
   *  stored unit stays continuous so automation lanes can sweep it; the panel
   *  steps it over TUNNEL_SYNC_DETENTS like an audio plugin's synced rate. */
  syncRingsPerBeat: number
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
  /** Extra units IN FRONT of the camera plane the 'Mute at camera' row covers,
   *  so the huge last-frame flash before impact is hidden too. */
  cameraMuteMargin: number
}

export const TUNNEL_FORWARD_PITCH = 60
export const TUNNEL_REVERSE_PITCH = 61
export const TUNNEL_CAMERA_MUTE_PITCH = 72

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
  { pitch: TUNNEL_CAMERA_MUTE_PITCH, label: 'Mute at camera' },
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
/** Where the default camera sits on the corridor axis - the same assumption
 *  `nearEnd`'s default and docs already make. */
export const TUNNEL_CAMERA_Z = 5

/** Axis vector plus the two ring-plane vectors, per `axis` setting. */
const TUNNEL_FRAMES: [Vector3, Vector3, Vector3][] = [
  [new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)], // Z
  [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)], // X
  [new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0)], // Y
]

function positiveModulo(value: number, period: number): number {
  return ((value % period) + period) % period
}

// ── Beat-synced speed ────────────────────────────────────────────────────────
// Same contract as Radial Motion's stepped spin knobs: every detent is a
// musical division (one RING ARRIVAL per power-of-two beats, either direction,
// or stopped), the STORED value stays a continuous number so old saves and
// automation lanes keep working, and quantization happens at the panel.

/** Beats between ring arrivals, slow → fast. */
export const TUNNEL_SYNC_BEATS_PER_RING = [8, 4, 2, 1, 0.5, 0.25] as const

/** Every synced knob position, ascending, zero dead centre: −(fast…slow), 0, slow…fast. */
export const TUNNEL_SYNC_DETENTS: readonly number[] = (() => {
  const rates = TUNNEL_SYNC_BEATS_PER_RING.map((beats) => 1 / beats)
  return [...[...rates].reverse().map((rate) => -rate), 0, ...rates]
})()

/** Nearest detent for a stored rate — how the stepped knob reads a value that
 *  was automated or typed off the grid. */
export function tunnelSyncDetentIndex(rate: number): number {
  let best = 0
  for (let index = 1; index < TUNNEL_SYNC_DETENTS.length; index++) {
    if (Math.abs(TUNNEL_SYNC_DETENTS[index] - rate) < Math.abs(TUNNEL_SYNC_DETENTS[best] - rate)) {
      best = index
    }
  }
  return best
}

/** A detent's readout: beats per ring arrival, signed — "2b" is a ring every
 *  2 beats, "1/4b" four rings per beat, "−1b" one per beat the other way. */
export function tunnelSyncDetentLabel(rate: number): string {
  if (rate === 0) return '0'
  const sign = rate < 0 ? '−' : ''
  const beats = 1 / Math.abs(rate)
  return beats >= 1 ? `${sign}${beats}b` : `${sign}1/${Math.round(1 / beats)}b`
}

/** The settings the travel integral needs. The sync fields are optional so
 *  callers that predate Beat-synced mode (and the origin-lookup tests) can
 *  keep passing the narrow Free-mode shape. */
export type TunnelSpeedSettings = Pick<TunnelSettings, 'speed' | 'midiSpeed'> &
  Partial<Pick<TunnelSettings, 'speedMode' | 'syncRingsPerBeat' | 'copiesPerRing' | 'rings' | 'depth'>>

/**
 * The corridor's base rate in units/beat, whichever mode picks it: Free reads
 * the `speed` knob verbatim; Beat-synced converts rings-per-beat through the
 * CURRENT ring spacing (`depth / rings`), so "1" means a ring crosses any
 * fixed point on every beat regardless of how the corridor is proportioned.
 */
export function tunnelBaseSpeed(settings: TunnelSpeedSettings): number {
  if (Math.round(settings.speedMode ?? 0) !== 1) return settings.speed
  const { rings } = tunnelCounts({ copiesPerRing: settings.copiesPerRing ?? 1, rings: settings.rings ?? 1 })
  const spacing = Math.max(0.0001, settings.depth ?? 0) / rings
  return spacing * (settings.syncRingsPerBeat ?? 0)
}

/** Structural slot counts, clamped so a chain of splitters cannot fan out past
 *  the tunnel's own budget (rings give way first - a partial ring would break
 *  the corridor's symmetry). */
export function tunnelCounts(settings: Pick<TunnelSettings, 'copiesPerRing' | 'rings'>): { copiesPerRing: number; rings: number } {
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
  settings: TunnelSpeedSettings,
  beat: number,
): number {
  let travel = tunnelBaseSpeed(settings) * beat
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
 * The 'Mute at camera' gate: true while any note on that row covers `beat`.
 * Velocity is ignored - like the origin rows this is a switch, not a dial, so
 * the same note can never mean two different amounts of hidden.
 */
export function isTunnelCameraMuteActive(notes: readonly ResolvedNote[], beat: number): boolean {
  for (const note of notes) {
    if (note.pitch !== TUNNEL_CAMERA_MUTE_PITCH) continue
    if (beat >= note.beat && beat < note.beat + Math.max(0, note.durationBeats)) return true
  }
  return false
}

/**
 * How far back from the near end the camera zone reaches, in corridor units:
 * everything from the wrap point to the camera plane (`nearEnd - camera z`,
 * clamped at 0 for a near end pulled in front of the lens), plus the margin
 * that hides the approach. A copy with `depthIntoTunnel` inside this zone is
 * the one that would hit the camera.
 */
export function tunnelCameraMuteZone(
  settings: Pick<TunnelSettings, 'nearEnd' | 'cameraMuteMargin'>,
): number {
  return Math.max(0, settings.nearEnd - TUNNEL_CAMERA_Z) + Math.max(0, settings.cameraMuteMargin)
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
  settings: TunnelSpeedSettings & Pick<TunnelSettings, 'originSpread'>,
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
): { transform: Matrix4; opacity: number; depthIntoTunnel: number } {
  const { position, opacity, depthIntoTunnel } = tunnelSlotPlacement(slot, settings, travel, originAt)
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
  // SIZE is the shared splitter knob (splitterSize.ts) and is deliberately NOT
  // divided by the placement scale: it is a multiplier on whatever size the
  // object draws itself at, not a world measurement. Post-multiplied, so it
  // scales the copy about its own center and the corridor's geometry - radius,
  // depth, near end, and therefore the off-screen wrap - is untouched.
  const transformed = transform.setPosition(position)
  return { transform: applySplitterSize(transformed, splitterSize(settings.size)), opacity, depthIntoTunnel }
}

export const tunnelSplitter: MoverOrSplitterDefinition<TunnelSettings> = {
  id: 'tunnel',
  label: 'Tunnel',
  kind: 'splitter',
  identityColor: TUNNEL_COLOR,
  params: [
    // 6 x 8 = 48 copies: enough for a corridor wall, and in the same weight
    // class as the other splitters (Parametric Pattern defaults to 48). Every
    // copy is a whole instrument, so this is the setting that costs frames.
    { key: 'copiesPerRing', label: 'Copies per ring', min: 1, max: MAX_COPIES_PER_RING, step: 1, default: 6 },
    { key: 'rings', label: 'Rings', min: 1, max: MAX_RINGS, step: 1, default: 8 },
    { key: 'radius', label: 'Radius', min: 0, max: 20, step: 0.1, default: 3 },
    SPLITTER_SIZE_PARAM,
    { key: 'depth', label: 'Depth', min: 1, max: 200, step: 1, default: 40 },
    // Default camera z = 5, default fade 6: wrapping at 12 keeps the whole
    // fade-out band (6..12) behind it.
    { key: 'nearEnd', label: 'Near end (past camera)', min: -20, max: 40, step: 0.5, default: 12 },
    // Free by default so every save from before the mode existed keeps its
    // exact `speed`; Beat-synced reinterprets travel as rings-per-beat.
    {
      key: 'speedMode',
      label: 'Speed mode',
      type: 'select',
      options: [
        { value: 0, label: 'Free (units / beat)' },
        { value: 1, label: 'Beat-synced' },
      ],
      default: 0,
    },
    { key: 'speed', label: 'Speed / beat', min: -40, max: 40, step: 0.1, default: 4 },
    // Continuous storage, stepped presentation (TUNNEL_SYNC_DETENTS) — same
    // contract as Radial Motion's spin rates, so automation can still sweep it.
    { key: 'syncRingsPerBeat', label: 'Sync rate (rings / beat)', min: -4, max: 4, step: 0.05, default: 1 },
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
      label: 'Facing',
      type: 'select',
      options: [
        { value: 0, label: 'Fixed' },
        { value: 1, label: 'Face center' },
        { value: 2, label: 'Face outward' },
      ],
      // Face center: each copy turns toward its ring's own middle, so the
      // corridor reads as a wall you fly through rather than a field of
      // identically-posed objects. (Changed from Fixed in 2026-08 — a save
      // that never touched the param picks up the new default.)
      default: 1,
    },
    { key: 'fadeDistance', label: 'Fade distance', min: 0, max: 50, step: 0.5, default: 6 },
    { key: 'midiSpeed', label: 'MIDI speed / beat', min: 0, max: 80, step: 0.5, default: 8 },
    // How far off-axis the outermost origin rows sit. Wider than the radius by
    // default, so 'far left' reads as a corridor swinging in from the side
    // rather than as a slightly thicker ring.
    { key: 'originSpread', label: 'Origin spread', min: 0, max: 60, step: 0.5, default: 8 },
    // 2 units in front of the default camera plane (near end 12 - camera 5 +
    // margin 2 = 9 corridor units hidden while the row is held).
    { key: 'cameraMuteMargin', label: 'Camera mute margin', min: 0, max: 20, step: 0.5, default: 2 },
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
        // 'Mute at camera': a pure opacity gate over the copies that would hit
        // the lens while the note is held - positions are untouched, so the
        // corridor keeps flowing underneath and nothing snaps on release.
        const cameraMuted = isTunnelCameraMuteActive(notes, beat)
        const muteZone = tunnelCameraMuteZone(settings)
        return Array.from({ length: count }, (_, slot) => {
          const { transform, opacity, depthIntoTunnel } = slotTransform(slot, settings, travel, placementScale, originAt)
          const gate = cameraMuted && depthIntoTunnel <= muteZone ? 0 : 1
          // LOCAL composition (previous * delta), the chain default: each slot's
          // transform becomes the reference frame for movers BELOW it, so a
          // Burst 'Forward (+Z)' under a Tunnel pushes every copy along its own
          // orientation rather than in world Z.
          const next: VisualCopy = {
            transform: visualCopy.transform.clone().multiply(transform),
            opacity: visualCopy.opacity * opacity * gate,
            colorShift: { ...visualCopy.colorShift },
          }
          return next
        })
      },
    }
  },
}

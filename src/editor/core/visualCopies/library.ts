// Production mover-and-splitter definitions, collected for the registry (the
// new-registry analogue of core/visual/movers/library.ts). Each definition owns
// its complete MIDI grammar - the kernel and the chain resolver know nothing
// about pitches or velocities.

import { Matrix4, Vector3 } from 'three'
import type { MidiRowDef } from '../../instruments/types'
import { cycleValueAt, extractValueGates, valueLaneRows } from './valueLane'
import type { MoverOrSplitterDefinition } from './definitions'
import type { VisualCopy } from './types'
import { moverDefinition } from './mover'
import { noteColorizer } from './colorizer'
import { gradientColorizer } from './gradientColorizer'
import { cosinePaletteColorizer } from './cosinePalette'
import { risoDuotoneColorizer } from './risoDuotone'
import { hueRotateColorizer } from './hueRotate'
import { forceFieldPushMover } from './forceFieldPush'
import { meteorImpactMover } from './meteorImpact'
import { impactScatterMover } from './impactScatter'
import { impactPulseMover } from './impactPulse'
import { waveTerrainMover } from './waveTerrain'
import { contourMover } from './contour'
import { visibilityMover } from './visibility'
import { freezeMover } from './freeze'
import { bypassMover } from './bypass'
import { consolidatedMover } from './consolidatedMover'
import { BURST_EASINGS } from './burstEasings'
import { BURST_DIRECTIONS, evaluateBurstOffset, type BurstSettings } from './burstOffset'
import { motionMover } from './motion'
import { symmetricMotionMover } from './symmetricMotion'
import { symmetricRotationMover } from './symmetricRotation'
import { conveyorMover } from './conveyor'
import { waypointsMover } from './waypoints'
import { physicsMover } from './physicsInterp'
import { radialMotionMover } from './radialMotion'
import { parametricPatternSplitter } from './parametricPattern'
import { polyhedronSplitter } from './polyhedron'
import { symmetrySplitter } from './symmetry'
import { tunnelSplitter } from './tunnel'
import { duplicateTrailSplitter } from './duplicateTrail'
import { approachSplitter } from './approach'
import { noteDisablesSplitterSlot, splitterMidiRows } from './splitterMidi'
import { applySplitterSize, splitterSize, SPLITTER_SIZE_MIN, SPLITTER_SIZE_PARAM } from './splitterSize'
import { GRID_COLOR, LINE_COLOR, RADIAL_COLOR } from './identityColors'

// ── Burst (RETIRED) ──────────────────────────────────────────────────────────
// Directional step mover: each note permanently steps the object a fixed
// distance in one cardinal direction, animated by an ease-out "burst" (violent
// start, soft landing). Steps accumulate - repeated +X notes keep walking the
// object right, a -X note steps it back - so position is fully choreographed by
// the note history, and the summed offset stays a closed-form function of the
// beat (the pause invariant: scrub == playback == export).
//
// Retired from the registry (2026-08): the unified `mover` definition's
// translate-burst cell is this exact behaviour, and persistence UPGRADES[12]
// rewrites old saves onto it. The definition object stays exported for the
// parity tests that pin the unified Mover against it.

// The vocabulary and the offset evaluator live in burstOffset.ts so Motion can
// reuse them without importing this library (a cycle); re-exported here because
// the burst tests import them from this module.
export { BURST_DIRECTIONS, evaluateBurstOffset, type BurstSettings }

const BURST_ROWS: MidiRowDef[] = [
  { pitch: 62, label: 'Up (+Y)' },
  { pitch: 63, label: 'Down (−Y)' },
  { pitch: 60, label: 'Right (+X)' },
  { pitch: 61, label: 'Left (−X)' },
  { pitch: 64, label: 'Forward (+Z)' },
  { pitch: 65, label: 'Back (−Z)' },
]

export { BURST_EASINGS }

export const burstMover: MoverOrSplitterDefinition<BurstSettings> = {
  id: 'burst',
  label: 'Burst',
  kind: 'mover',
  params: [
    { key: 'burstBeats', label: 'Burst beats', min: 0.05, max: 16, step: 0.05, default: 1 },
    {
      key: 'easing',
      label: 'Easing',
      type: 'select',
      options: BURST_EASINGS.map((e, value) => ({ value, label: e.label })),
      default: 0,
    },
    { key: 'sharpness', label: 'Sharpness', min: 0.25, max: 4, step: 0.05, default: 1 },
    { key: 'distanceX', label: 'Distance X', min: 0, max: 10, step: 0.1, default: 1 },
    { key: 'distanceY', label: 'Distance Y', min: 0, max: 10, step: 0.1, default: 1 },
    { key: 'distanceZ', label: 'Distance Z', min: 0, max: 10, step: 0.1, default: 1 },
    { key: 'distance', label: 'Distance ×', min: 0, max: 10, step: 0.1, default: 1 },
  ],
  midiRows: () => BURST_ROWS,
  resolve({ settings, notes }) {
    return {
      apply(visualCopy, { beat }) {
        const [x, y, z] = evaluateBurstOffset(notes, settings, beat)
        // LOCAL composition (previous * delta): the burst translates in the
        // reference frame established by the entries above it, so a splitter
        // above this mover re-frames each copy's directions (a Radial above a
        // Burst blooms every copy outward along its own axes).
        const next: VisualCopy = {
          transform: visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(x, y, z)),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }
        return [next]
      },
    }
  },
}

// ── Radial ───────────────────────────────────────────────────────────────────
// Radial splitter: N structural copies, copy i rotated by i/N of a full turn
// about the chosen plane's normal. The rotation composes LOCALLY (previous *
// delta), so it changes each copy's REFERENCE FRAME: movers BELOW it operate
// in their copy's rotated axes - one Burst +X note blooms every copy outward
// in its own direction. Movers above it are unaffected by the split frames
// (each copy inherits their motion, then rotates in place).
// Slot count comes only from settings, never from MIDI, so downstream indices
// and the React occurrence list stay stable.
//
// The MIDI lane is a VALUE lane, not a mute map (reworked 2026-08): a note's
// pitch names a radius through the same 36-84 encoding automation lanes use,
// and between consecutive note ONSETS the radius swells 0 → r → 0 along the
// cycle-automation default curve (y = 4u(1-u), the DEFAULT_CYCLE bezier's
// closed form) where r is the earlier onset's pitch-value. Outside the onset
// span - before the first note, at/after the last, or with fewer than two -
// the ring rests at the RADIUS knob: the panel says what the piece looks
// like, MIDI bends it. Duration and velocity are deliberately ignored (onsets
// only), chords collapse to one boundary keeping the largest radius, and
// out-of-span pitches (including the retired mute rows at 122-127) are
// no-ops, so old saves degrade to their knob radius instead of misreading.
//
// The polar options (2026-08) are four knobs on top of that ring, chosen so
// each one buys a whole family of shapes and every default is the plain ring
// - an absent key merges to neutral, so no save needed an upgrade:
//
// - SWEEP is the arc the copies span, not always a full turn. Under 360 the
//   copies land on BOTH ends (i/(count-1)), so a 180° sweep is a half-ring
//   with a copy at each tip; at any whole number of turns they distribute
//   i/count instead, because the seam would otherwise carry two copies on
//   top of each other. Fans, arcs and multi-turn windings all come from here.
// - SHAPE picks circular or SPIRAL, and spiral is where GROWTH applies:
//   radius · growth^i, a per-copy RATIO anchored at the first copy - Line's
//   GROWTH convention (a ratio can never cross zero; 1 is neutral). It is a
//   ratio on the RADIUS, where Line's is on the size.
// - RISE steps each copy along the ring's own axis - also per copy, so it
//   reads like Line's spacing. Ring + sweep > 360 + rise = a helix; add
//   spiral growth and it is a cone or a vortex.
// - TILT nods every copy about its OWN tangent to the ring - the one rotation
//   a ring can wear that is still radially symmetric, so the formation reads
//   as an umbrella opening and closing (and, past 90 deg, turning itself
//   inside out) rather than as a rigid lean. Signed: + leans each copy's
//   outward side toward the ring's +axis, - away from it. It is stated ONCE,
//   in the slot's frame, and the slot rotation carries it around the ring for
//   free; it rides inside the slot like FACING, so nothing moves.
// - FACING says what each copy's frame does, which is a bigger decision than
//   it looks: it also picks the axes every mover BELOW the splitter works in.
//   Outward is the shipped behavior (local +X points away from the center);
//   Upright cancels the slot rotation so copies keep the object's own
//   orientation and the movers below get unrotated axes; Along path aims
//   each copy down the ring's tangent; Face center turns the object's own
//   FORWARD axis (local +Z, what lookAt aims) onto the center, which is the
//   one an oriented instrument - a plane, a photo, text - actually reads as
//   "pointing at" something.
//
// RINGS (2026-08) repeats that whole ring outward: N concentric copies of the
// same slot set, each ring stepped by four INDEPENDENT per-ring amounts, all
// anchored at ring 0 so the innermost ring is exactly the single ring that was
// there before. Rings default to 1, which makes all four inert - an old save
// is matrix-identical whatever the four amounts merge to, so none of this
// needed a persistence upgrade either (radial.test.ts pins it).
//
// - SPACING is a radius STEP, additive (radius + spacing·ring), not a ratio.
//   A ratio is right for the spiral's GROWTH because it walks a radius that
//   is already there; ring spacing has to work from the DEFAULT radius of 0,
//   where every ratio collapses to the same point. Negative spacing marches
//   the rings inward and CLAMPS at the center rather than passing through it
//   - a negative radius would re-emerge on the far side, reading as a ring
//   that flipped rather than one that ran out of room.
// - RING SIZE is a ratio on the shared SIZE knob (size · ringSize^ring),
//   independent of spacing on purpose: shrinking copies while the rings
//   spread, or growing them while the rings close in, are both the point.
//   Floored at the shared knob's own minimum so a long ring stack can't reach
//   a degenerate scale.
// - RING DEPTH steps each ring along the ring's axis, exactly as RISE steps
//   each copy - it joins the same translation, for the same reason (the slot
//   rotation is ABOUT that axis, so it leaves the axial component alone).
// - RING TWIST is degrees per ring about that same axis, and it is added to
//   the SLOT ANGLE rather than applied as a rotation of its own. That is what
//   keeps it a pure bearing change: a twist matrix wrapped around the slot
//   would also carry the copy's rise and its facing fix, where joining the
//   angle leaves the radius, the axial step and UPRIGHT's cancellation
//   (which subtracts the FULL bearing) exactly as they were. Half a slot's
//   worth - 180°/copies - interleaves the rings; anything else fans them.
//
// Copies come out RING-MAJOR - ring 0's whole slot set, then ring 1's - so
// each ring is a contiguous run of indices and copy targeting's `runs` rule
// addresses a ring directly.
//
// Everything still composes LOCALLY and the offsets stay inside one
// translation, so SIZE keeps scaling each copy about its own center and the
// ring radius stays exactly the sampled radius.

export interface RadialSettings {
  copies: number
  radius: number
  /** Uniform scale on each copy, about its own center — independent of radius. */
  size: number
  /** 0 = XY (about Z), 1 = XZ (about Y), 2 = YZ (about X). */
  plane: number
  /** Arc the copies span, in degrees. 360 = the full ring. */
  sweep: number
  /** 0 = circular (constant radius), 1 = spiral (GROWTH applies). */
  shape: number
  /** Per-copy radius ratio in spiral mode, anchored at copy 0. */
  growth: number
  /** Per-copy step along the ring's axis, in world units. 0 = flat ring. */
  rise: number
  /** Nod about each copy's own tangent, in degrees. + leans the copy's
   *  outward side toward the ring's +axis; - leans it away. 0 = flat. */
  tilt: number
  /** 0 = outward, 1 = upright (no slot rotation), 2 = along the path,
   *  3 = facing the center. */
  facing: number
  /** Concentric copies of the whole ring. 1 = the plain single ring. */
  rings: number
  /** Radius step between rings, in world units (additive, anchored at ring 0). */
  ringSpacing: number
  /** Per-ring size ratio on the SIZE knob, anchored at ring 0. */
  ringSize: number
  /** Per-ring step along the ring's axis, in world units. 0 = flat stack. */
  ringDepth: number
  /** Per-ring rotation about the ring's axis, in degrees. 0 = rings aligned. */
  ringTwist: number
}

const RADIAL_MAX_COPIES = 32
const RADIAL_MAX_RINGS = 8
const RADIAL_RADIUS_MIN = 0
const RADIAL_RADIUS_MAX = 10
const RADIAL_AXES = [new Vector3(0, 0, 1), new Vector3(0, 1, 0), new Vector3(1, 0, 0)]
const RADIAL_DIRECTIONS: [number, number, number][] = [[1, 0, 0], [1, 0, 0], [0, 1, 0]]
// Each plane's LOCAL tangent and its face-the-center fix. Both are constants
// per plane because the slot rotation is about `axis` and the outward radial is
// the fixed basis vector `direction`, so the slot frame's own axes never
// depend on the angle - which is exactly what makes both effects radially
// symmetric for free (see the TILT and FACING notes above).
//   tangent = direction x axis, so a POSITIVE tilt leans every copy's outward
//   side toward the ring's +axis (the umbrella closing) whichever plane it is.
const RADIAL_TANGENTS = RADIAL_AXES.map((axis, plane) => new Vector3(...RADIAL_DIRECTIONS[plane]).cross(axis))
//   the face-center fix is the quarter turn taking local +Z (three's forward,
//   what lookAt aims) onto the INWARD radial, -direction: about z x -direction.
const RADIAL_FACE_CENTER_AXES = RADIAL_DIRECTIONS.map(
  (direction) => new Vector3(0, 0, 1).cross(new Vector3(...direction).negate()),
)
export const RADIAL_SHAPE_CIRCULAR = 0
export const RADIAL_SHAPE_SPIRAL = 1
export const RADIAL_FACING_OUTWARD = 0
export const RADIAL_FACING_UPRIGHT = 1
export const RADIAL_FACING_PATH = 2
export const RADIAL_FACING_CENTER = 3

/** Where copy `index` sits along the sweep, in [0, 1]. A sweep of a whole
 *  number of turns is CLOSED - its two ends are the same place, so the copies
 *  divide it i/count and nothing doubles up at the seam. Any other arc is open
 *  and puts a copy on each end (i/(count-1)), which is what makes a 180° sweep
 *  read as a half-ring rather than as a gap-toothed one. */
export function radialSweepFraction(index: number, count: number, sweepDegrees: number): number {
  if (count <= 1) return 0
  const turns = sweepDegrees / 360
  const closed = Math.abs(turns - Math.round(turns)) < 1e-6 && Math.round(turns) !== 0
  return closed ? index / count : index / (count - 1)
}

// Rows span the automation pitch range top-down (top row = full radius,
// bottom = 0) so the roll reads like an automation lane's value rows.
const RADIAL_VALUE_ROWS: MidiRowDef[] = valueLaneRows('R', RADIAL_RADIUS_MIN, RADIAL_RADIUS_MAX)

export const radialSplitter: MoverOrSplitterDefinition<RadialSettings> = {
  id: 'radial',
  label: 'Radial',
  kind: 'splitter',
  identityColor: RADIAL_COLOR,
  params: [
    { key: 'copies', label: 'Copies', min: 1, max: RADIAL_MAX_COPIES, step: 1, default: 6 },
    { key: 'radius', label: 'Radius', min: 0, max: 10, step: 0.1, default: 0 },
    SPLITTER_SIZE_PARAM,
    {
      key: 'plane',
      label: 'Plane',
      type: 'select',
      options: [
        { value: 0, label: 'XY' },
        { value: 1, label: 'XZ' },
        { value: 2, label: 'YZ' },
      ],
      default: 0,
    },
    {
      key: 'shape',
      label: 'Shape',
      type: 'select',
      options: [
        { value: RADIAL_SHAPE_CIRCULAR, label: 'Circular' },
        { value: RADIAL_SHAPE_SPIRAL, label: 'Spiral' },
      ],
      default: RADIAL_SHAPE_CIRCULAR,
    },
    { key: 'growth', label: 'Growth', min: 0.5, max: 2, step: 0.01, default: 1 },
    { key: 'sweep', label: 'Sweep', min: 0, max: 1440, step: 5, default: 360 },
    { key: 'rise', label: 'Rise', min: -2, max: 2, step: 0.05, default: 0 },
    { key: 'tilt', label: 'Tilt', min: -180, max: 180, step: 1, default: 0 },
    { key: 'rings', label: 'Rings', min: 1, max: RADIAL_MAX_RINGS, step: 1, default: 1 },
    { key: 'ringSpacing', label: 'Ring spacing', min: -5, max: 5, step: 0.1, default: 1 },
    { key: 'ringSize', label: 'Ring size', min: 0.25, max: 2, step: 0.01, default: 1 },
    { key: 'ringDepth', label: 'Ring depth', min: -4, max: 4, step: 0.05, default: 0 },
    { key: 'ringTwist', label: 'Ring twist', min: -180, max: 180, step: 1, default: 0 },
    {
      key: 'facing',
      label: 'Facing',
      type: 'select',
      options: [
        { value: RADIAL_FACING_OUTWARD, label: 'Outward' },
        { value: RADIAL_FACING_UPRIGHT, label: 'Upright' },
        { value: RADIAL_FACING_PATH, label: 'Along path' },
        { value: RADIAL_FACING_CENTER, label: 'Face center' },
      ],
      default: RADIAL_FACING_OUTWARD,
    },
  ],
  midiRows: () => RADIAL_VALUE_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const count = Math.max(1, Math.min(RADIAL_MAX_COPIES, Math.round(settings.copies)))
    const plane = settings.plane === 1 || settings.plane === 2 ? settings.plane : 0
    const axis = RADIAL_AXES[plane]
    const direction = RADIAL_DIRECTIONS[plane]
    const size = splitterSize(settings.size)
    const sweep = Math.max(0, settings.sweep ?? 360)
    const rise = settings.rise ?? 0
    const growth = settings.shape === RADIAL_SHAPE_SPIRAL ? Math.max(0.05, settings.growth ?? 1) : 1
    const facing = settings.facing === RADIAL_FACING_UPRIGHT
      || settings.facing === RADIAL_FACING_PATH
      || settings.facing === RADIAL_FACING_CENTER
      ? settings.facing
      : RADIAL_FACING_OUTWARD
    // TILT is ONE rotation shared by every slot, because it is stated in the
    // SLOT's frame: the same local nod becomes that slot's own tangent once the
    // slot rotation places it (R . tilt . R^-1 = a turn about the WORLD
    // tangent), so the formation keeps its radial symmetry with no per-copy
    // math - RINGS and RING TWIST included, since both only change which
    // bearing a slot wears. Identity at 0, which keeps an untouched save exact.
    const tilt = settings.tilt ?? 0
    const tiltFix = tilt === 0
      ? null
      : new Matrix4().makeRotationAxis(RADIAL_TANGENTS[plane], (tilt * Math.PI) / 180)
    const rings = Math.max(1, Math.min(RADIAL_MAX_RINGS, Math.round(settings.rings ?? 1)))
    const ringSpacing = settings.ringSpacing ?? 1
    const ringSize = Math.max(0.05, settings.ringSize ?? 1)
    const ringDepth = settings.ringDepth ?? 0
    const ringTwist = ((settings.ringTwist ?? 0) * Math.PI) / 180
    // Structural slots, RING-MAJOR (ring 0's whole slot set first, so a ring is
    // a contiguous run of copy indices). Within a ring, slot 0 is unrotated and
    // sits at the ring's own radius - it is the spiral's anchor and the arc's
    // first end. Everything here is beat-independent; only the radius the
    // translation is built from moves, so the three per-ring amounts are all
    // resolved once, here.
    const slots = Array.from({ length: rings * count }, (_, i) => {
      const ring = Math.floor(i / count)
      const slot = i % count
      // TWIST turns each whole ring about the axis before its slots are laid
      // out, so it joins the slot angle rather than becoming a second rotation:
      // the copies stay on their radius and only their bearing moves, and
      // UPRIGHT still cancels the FULL bearing below.
      const angle = radialSweepFraction(slot, count, sweep) * (sweep * Math.PI) / 180 + ringTwist * ring
      const rotation = new Matrix4().makeRotationAxis(axis, angle)
      // The facing fix rides INSIDE the slot (after the translation), so it
      // re-aims the copy without moving it: cancelling the slot rotation
      // leaves the copy wearing the object's own orientation, and a quarter
      // turn about the axis points it down the tangent.
      const faceFix = facing === RADIAL_FACING_UPRIGHT
        ? new Matrix4().makeRotationAxis(axis, -angle)
        : facing === RADIAL_FACING_PATH
          ? new Matrix4().makeRotationAxis(axis, Math.PI / 2)
          : facing === RADIAL_FACING_CENTER
            // A quarter turn onto the INWARD radial, so the object's forward
            // axis looks at the ring's center from wherever it sits. Same
            // constant in every plane, because "which way is local +Z" is the
            // only thing that decides it - which makes it a turn within the
            // ring plane for a ring seen edge-on (XZ, YZ) and a pitch out of
            // the ring plane for one seen face-on (XY).
            ? new Matrix4().makeRotationAxis(RADIAL_FACE_CENTER_AXES[plane], Math.PI / 2)
            : null
      return {
        rotation,
        faceFix,
        radiusFactor: Math.pow(growth, slot),
        // Additive radius step, and the ring's axial step joins RISE's - both
        // are world distances along the axis the slot rotation leaves alone.
        radiusOffset: ringSpacing * ring,
        rise: rise * slot + ringDepth * ring,
        // Ratio on the shared knob, floored at the knob's own minimum so a
        // shrinking stack can't reach a degenerate scale.
        size: Math.max(SPLITTER_SIZE_MIN, size * Math.pow(ringSize, ring)),
      }
    })
    // The shared value-lane grammar (valueLane.ts): pitch-mapped cycle gates,
    // radius swelling 0 -> r -> 0 between onsets, resting at the knob outside.
    const gates = extractValueGates(notes, RADIAL_RADIUS_MIN, RADIAL_RADIUS_MAX)
    return {
      apply(visualCopy, { beat }) {
        const radius = cycleValueAt(gates, beat, settings.radius)
        // Size composes AFTER the translation - R · T(radius) · S(size) - so
        // it scales each copy about its own center and the ring radius stays
        // exactly the sampled radius, whatever the size. (The shared splitter
        // knob; see splitterSize.ts.) RISE joins the same translation: the
        // slot rotation is ABOUT the axis, so the axial component is
        // untouched by it and one translation says both.
        return slots.map((slot) => {
          // Rings step the radius additively and CLAMP at the center: a
          // negative radius would come back out on the opposite side.
          const slotRadius = Math.max(0, radius + slot.radiusOffset) * slot.radiusFactor
          const transform = visualCopy.transform.clone()
            .multiply(slot.rotation)
            .multiply(new Matrix4().makeTranslation(
              direction[0] * slotRadius + axis.x * slot.rise,
              direction[1] * slotRadius + axis.y * slot.rise,
              direction[2] * slotRadius + axis.z * slot.rise,
            ))
          // TILT before FACING: the nod is measured on the slot's own frame,
          // where it is radially symmetric, and the facing fix then re-aims
          // whatever it left. The other order would let Upright cancel the
          // slot rotation FIRST, and every copy would nod the same way in
          // world space - a rigid lean, not a ring closing.
          if (tiltFix) transform.multiply(tiltFix)
          if (slot.faceFix) transform.multiply(slot.faceFix)
          return {
            transform: applySplitterSize(transform, slot.size),
            opacity: visualCopy.opacity,
            colorShift: { ...visualCopy.colorShift },
          }
        })
      },
    }
  },
}

// ── Line ─────────────────────────────────────────────────────────────────────
// Line splitter: N copies marching along one axis, the axis aimed anywhere by
// two angles instead of a plane select. The FIRST copy is the base object
// itself - unmoved and unscaled, so adding the splitter never disturbs the
// object's placement - and the rest step away behind it. The default aim is
// -Z (straight back from the camera), so an untouched Line reads as depth;
// ANGLE swings the aim left/right about +Y and TILT lifts it toward +Y, and
// both stay ordinary automatable number params. The aim rotation is IDENTITY
// at the default, so copies keep facing whatever the object faces; a non-zero
// aim rotates each copy's frame WITH the axis (the same LOCAL re-framing as
// Radial's slots), so movers below the splitter work in line-aligned axes.
//
// GROWTH is a per-step size ratio anchored at the base copy: copy i wears
// scale growth^i, so the original keeps its size and the tail ramps
// geometrically - a RATIO can never cross zero (size is an exponent, the
// scale-mover rule). SIZE is the shared splitter size knob and multiplies the
// whole run (size · growth^i), so the two read as what they say: SIZE moves
// every copy including the base, GROWTH only tilts the ramp between them. The
// scale composes AFTER the translation
// (R · T(spacing·i) · S) so each copy grows about its own center and spacing
// stays exactly spacing, whatever the growth. Growth is a WORLD-space ratio
// on purpose - the default backward aim additionally shrinks copies by
// perspective, but the axis is not always depth, so nothing here divides the
// camera's shrink out (that apparent-size treatment belongs to the dedicated
// depth splitters - see duplicateTrail).
//
// The MIDI lane is the shared slot mute map (Polyhedron's convention): one row
// per copy, a held note hides that copy; animation beyond that belongs to
// automation lanes on the knobs.

export interface LineSettings {
  copies: number
  /** Distance between adjacent copy centers, in world units. */
  spacing: number
  /** Per-step size ratio between neighboring copies, anchored at the base copy. */
  growth: number
  /** Uniform scale on every copy, about its own center — independent of spacing. */
  size: number
  /** Aim swing left/right, in degrees about +Y (0 = straight back, -Z). */
  angle: number
  /** Aim lift up/down, in degrees toward +Y. */
  tilt: number
}

const LINE_MAX_COPIES = 32

export const lineSplitter: MoverOrSplitterDefinition<LineSettings> = {
  id: 'line',
  label: 'Line',
  kind: 'splitter',
  identityColor: LINE_COLOR,
  params: [
    { key: 'copies', label: 'Copies', min: 1, max: LINE_MAX_COPIES, step: 1, default: 5 },
    { key: 'spacing', label: 'Spacing', min: 0, max: 4, step: 0.05, default: 1 },
    SPLITTER_SIZE_PARAM,
    { key: 'growth', label: 'Growth', min: 0.5, max: 2, step: 0.01, default: 1 },
    { key: 'angle', label: 'Angle', min: -180, max: 180, step: 1, default: 0 },
    { key: 'tilt', label: 'Tilt', min: -90, max: 90, step: 1, default: 0 },
  ],
  midiRows: (settings) => {
    const count = Math.max(1, Math.min(LINE_MAX_COPIES, Math.round(settings.copies)))
    return splitterMidiRows(count, 'copy', 'copies')
  },
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const count = Math.max(1, Math.min(LINE_MAX_COPIES, Math.round(settings.copies)))
    const spacing = Math.max(0, settings.spacing ?? 1)
    const growth = Math.max(0.05, settings.growth ?? 1)
    const uniformSize = splitterSize(settings.size)
    const angle = ((settings.angle ?? 0) * Math.PI) / 180
    const tilt = ((settings.tilt ?? 0) * Math.PI) / 180
    // Aim the step direction: identity at (0, 0) stepping along local -Z, so
    // R·(0,0,-1) = (cos t · sin a, sin t, -cos t · cos a) - lift about X
    // first, then swing about Y.
    const rotation = new Matrix4()
      .makeRotationY(-angle)
      .multiply(new Matrix4().makeRotationX(tilt))
    const slots = Array.from({ length: count }, (_, index) => {
      const size = uniformSize * Math.pow(growth, index)
      const slot = rotation.clone()
        .multiply(new Matrix4().makeTranslation(0, 0, -spacing * index))
      return applySplitterSize(slot, size)
    })
    return {
      apply(visualCopy, { beat }) {
        return slots.map((slot, index) => ({
          transform: visualCopy.transform.clone().multiply(slot),
          opacity: noteDisablesSplitterSlot(notes, beat, index, slots.length) ? 0 : visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }))
      },
    }
  },
}

// ── Grid ────────────────────────────────────────────────────────────────────
// Three structural dimensions - columns, rows, depth - each INDEPENDENTLY laid
// out as a grid (a run of evenly spaced offsets along its world axis) or as a
// circle (the same count wrapped into a ring about a fixed world axis, with its
// own radius knob). The combinations are the point: one circular dimension is a
// ring, circular columns + linear depth is a tunnel of rings, circular depth +
// linear rows is a standing cylinder, circular columns + circular depth nest
// into a true torus facing the camera - and ANY circular pair collapses to a
// sphere when the outer ring's radius is dialled to 0.
//
// Composition rules (deliberate, and load-bearing for predictability):
// - LINEAR offsets sum in WORLD axes, outside everything circular - the sliders
//   promise "copies along X/Y/Z", so a linear dimension never gets swept into
//   another dimension's rotation (no accidental pinwheels).
// - CIRCULAR steps compose LOCALLY in dimension order (columns, rows, depth):
//   R(axis, index/count · 2π) · T(radius), so an outer ring re-frames the inner
//   one - which is exactly what makes two rings a torus.
// - Rotation axes are fixed per dimension (columns about the plane NORMAL, rows
//   about the HORIZONTAL axis, depth about the VERTICAL axis), so with the
//   default X/Y plane: circular columns face the camera, circular rows are a
//   wheel, circular depth is a floor ring. The ring's radius direction is the
//   dimension's own linear axis, so slot 0 sits unrotated on that axis.
// The rotation lands in each copy's frame (copies face around their ring), the
// same convention as the Radial splitter.
//
// SIZE is the shared splitter size knob (Radial's convention): a uniform scale
// composed AFTER every offset, so it grows each copy about its own center and
// spacing/radius stay exactly what their knobs say - the two are independent
// axes of the layout, which is the whole point of having both.
//
// The MIDI lane is a VALUE lane on SPACING (Radial's radius grammar,
// valueLane.ts): a note's pitch names a spacing through the automation 36-84
// encoding and the lattice swells 0 -> s -> 0 between onsets on the cycle
// default's closed form, resting at the SPACING knob outside the span - so an
// empty lane is exactly the knob, and notes breathe the whole lattice. The
// rows are DETENTS, every 6th pitch, so the roll shows 9 rows over 0-4 in 0.5
// steps (bottom row = exactly 0, a full collapse) instead of Radial's 49; any
// pitch dragged between detents still decodes through the same encoding. Only
// the LINEAR offsets scale - ring radii keep their own knobs - and spacing is
// floored at 0, matching the knob's own floor. The per-cell mute map retired
// in favor of this (2026-08); old mute notes (pitch 96 up) fall out of the
// value span and no-op, so those saves degrade to the knob.

export interface GridSettings {
  rows: number
  columns: number
  /** Copy count along the plane normal - the grid's third dimension. */
  depth: number
  /** Distance between adjacent cell centers along every linear dimension. */
  spacing: number
  /** Uniform scale on each copy, about its own center — independent of spacing. */
  size: number
  /** 0 = XY, 1 = XZ, 2 = YZ. */
  plane: number
  /** 0 = English, 1 = reverse English, 2 = columns first, 3 = reverse columns. */
  indexing: number
  /** Per-dimension layout: 0 = grid (linear), 1 = circular. */
  columnsMode: number
  rowsMode: number
  depthMode: number
  /** Ring radius per circular dimension, in world units. */
  columnsRadius: number
  rowsRadius: number
  depthRadius: number
}

const GRID_MAX_DIMENSION = 32
const GRID_SPACING_MIN = 0
const GRID_SPACING_MAX = 4
// 9 detent rows over 0-4: every 6th pitch of the 36-84 span lands exactly on
// a 0.5 step, endpoints included (84 = 4.0 down to 36 = 0.0).
const GRID_VALUE_ROWS: MidiRowDef[] = valueLaneRows('S', GRID_SPACING_MIN, GRID_SPACING_MAX, 6)
const GRID_PLANES: [0 | 1 | 2, 0 | 1 | 2][] = [
  [0, 1],
  [0, 2],
  [1, 2],
]
const GRID_AXIS_VECTORS = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]

/** Cell coordinates in the exact order downstream movers will see them. */
export function gridCellOrder(rows: number, columns: number, indexing: number): [number, number][] {
  const cells: [number, number][] = []
  if (indexing === 2 || indexing === 3) {
    for (let column = 0; column < columns; column++) {
      for (let row = 0; row < rows; row++) cells.push([row, column])
    }
  } else {
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) cells.push([row, column])
    }
  }
  return indexing === 1 || indexing === 3 ? cells.reverse() : cells
}

/** [row, column, layer] triples: layers are the OUTERMOST loop (cell 1 is the
 *  front layer's first cell), each layer walks the 2D indexing order, and the
 *  reversed modes reverse the whole sequence - so depth 1 reproduces
 *  gridCellOrder exactly and existing projects keep their note mapping. */
export function gridCellOrder3(
  rows: number,
  columns: number,
  depth: number,
  indexing: number,
): [number, number, number][] {
  const forwardIndexing = indexing === 2 || indexing === 3 ? 2 : 0
  const planeOrder = gridCellOrder(rows, columns, forwardIndexing)
  const cells: [number, number, number][] = []
  for (let layer = 0; layer < depth; layer++) {
    for (const [row, column] of planeOrder) cells.push([row, column, layer])
  }
  return indexing === 1 || indexing === 3 ? cells.reverse() : cells
}

export const gridSplitter: MoverOrSplitterDefinition<GridSettings> = {
  id: 'grid',
  label: 'Grid',
  kind: 'splitter',
  identityColor: GRID_COLOR,
  params: [
    { key: 'rows', label: 'Rows', min: 1, max: GRID_MAX_DIMENSION, step: 1, default: 3 },
    { key: 'columns', label: 'Columns', min: 1, max: GRID_MAX_DIMENSION, step: 1, default: 3 },
    { key: 'depth', label: 'Depth', min: 1, max: GRID_MAX_DIMENSION, step: 1, default: 1 },
    { key: 'spacing', label: 'Spacing', min: 0, max: 40, step: 0.1, default: 1 },
    SPLITTER_SIZE_PARAM,
    {
      key: 'columnsMode',
      label: 'Columns layout',
      type: 'select',
      options: [
        { value: 0, label: 'Grid' },
        { value: 1, label: 'Circular' },
      ],
      default: 0,
    },
    {
      key: 'rowsMode',
      label: 'Rows layout',
      type: 'select',
      options: [
        { value: 0, label: 'Grid' },
        { value: 1, label: 'Circular' },
      ],
      default: 0,
    },
    {
      key: 'depthMode',
      label: 'Depth layout',
      type: 'select',
      options: [
        { value: 0, label: 'Grid' },
        { value: 1, label: 'Circular' },
      ],
      default: 0,
    },
    { key: 'columnsRadius', label: 'Columns radius', min: 0, max: 20, step: 0.1, default: 2, showIf: 'columnsMode=1' },
    { key: 'rowsRadius', label: 'Rows radius', min: 0, max: 20, step: 0.1, default: 2, showIf: 'rowsMode=1' },
    { key: 'depthRadius', label: 'Depth radius', min: 0, max: 20, step: 0.1, default: 2, showIf: 'depthMode=1' },
    {
      key: 'plane',
      label: 'Axes',
      type: 'select',
      options: [
        { value: 0, label: 'X / Y' },
        { value: 1, label: 'X / Z' },
        { value: 2, label: 'Y / Z' },
      ],
      default: 0,
    },
    {
      key: 'indexing',
      label: 'Indexing',
      type: 'select',
      options: [
        { value: 0, label: 'English reading order' },
        { value: 1, label: 'English, reversed' },
        { value: 2, label: 'Columns first' },
        { value: 3, label: 'Columns first, reversed' },
      ],
      default: 0,
    },
  ],
  midiRows: () => GRID_VALUE_ROWS,
  strictMidiRows: true,
  resolve({ settings, notes }) {
    const rows = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.rows)))
    const columns = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.columns)))
    const depth = Math.max(1, Math.min(GRID_MAX_DIMENSION, Math.round(settings.depth ?? 1)))
    const [horizontalAxis, verticalAxis] = GRID_PLANES[settings.plane] ?? GRID_PLANES[0]
    const normalAxis = (3 - horizontalAxis - verticalAxis) as 0 | 1 | 2
    const size = splitterSize(settings.size)
    // One record per dimension, in composition order. `unitOffset` keeps the
    // exact legacy centering (rows grow downward from the top, layer 0 is the
    // front) at spacing 1; the sampled spacing scales it per frame.
    const dimensions = [
      {
        count: columns,
        circular: settings.columnsMode === 1,
        radius: Math.max(0, settings.columnsRadius ?? 0),
        offsetAxis: horizontalAxis,
        rotationAxis: normalAxis,
        unitOffset: (index: number) => index - (columns - 1) / 2,
      },
      {
        count: rows,
        circular: settings.rowsMode === 1,
        radius: Math.max(0, settings.rowsRadius ?? 0),
        offsetAxis: verticalAxis,
        rotationAxis: horizontalAxis,
        unitOffset: (index: number) => (rows - 1) / 2 - index,
      },
      {
        count: depth,
        circular: settings.depthMode === 1,
        radius: Math.max(0, settings.depthRadius ?? 0),
        offsetAxis: normalAxis,
        rotationAxis: verticalAxis,
        unitOffset: (index: number) => (depth - 1) / 2 - index,
      },
    ]
    // Everything except the linear translation is beat-independent, so each
    // cell precomputes a unit lattice vector (the spacing's coefficient) plus
    // the circular steps and SIZE folded into one tail matrix: the per-frame
    // cell is T(spacing * unit) * tail.
    const cells = gridCellOrder3(rows, columns, depth, settings.indexing).map(([row, column, layer]) => {
      const indices = [column, row, layer]
      // Grid is a layout, not a fit-to-frame operation: adding rows/columns
      // expands the occupied area while every copy retains the incoming size
      // (scaled only by the SIZE knob, which is applied last so it never feeds
      // back into the offsets). Linear offsets sum in world axes, outside the
      // circular steps.
      const unit = new Vector3()
      for (let d = 0; d < 3; d++) {
        const dim = dimensions[d]
        if (!dim.circular) unit.addScaledVector(GRID_AXIS_VECTORS[dim.offsetAxis], dim.unitOffset(indices[d]))
      }
      const tail = new Matrix4()
      for (let d = 0; d < 3; d++) {
        const dim = dimensions[d]
        if (!dim.circular) continue
        const arm = GRID_AXIS_VECTORS[dim.offsetAxis].clone().multiplyScalar(dim.radius)
        tail
          .multiply(new Matrix4().makeRotationAxis(GRID_AXIS_VECTORS[dim.rotationAxis], (indices[d] / dim.count) * Math.PI * 2))
          .multiply(new Matrix4().makeTranslation(arm.x, arm.y, arm.z))
      }
      return { unit, tail: applySplitterSize(tail, size) }
    })
    // The value lane: notes name spacings, the lattice breathes between
    // onsets, the knob (floored at 0) holds outside the span. Only the linear
    // offsets scale - ring radii are their own knobs.
    const gates = extractValueGates(notes, GRID_SPACING_MIN, GRID_SPACING_MAX)
    const restingSpacing = Math.max(0, settings.spacing ?? 1)
    return {
      apply(visualCopy, { beat }) {
        const spacing = cycleValueAt(gates, beat, restingSpacing)
        return cells.map((cell) => ({
          transform: visualCopy.transform.clone()
            .multiply(new Matrix4().makeTranslation(
              cell.unit.x * spacing,
              cell.unit.y * spacing,
              cell.unit.z * spacing,
            ))
            .multiply(cell.tail),
          opacity: visualCopy.opacity,
          colorShift: { ...visualCopy.colorShift },
        }))
      },
    }
  },
}

export { evaluateVisibilityOpacity, visibilityMover, type VisibilitySettings } from './visibility'
export { bypassGated, bypassMover, evaluateBypassed, BYPASS_ID, type BypassSettings } from './bypass'

/** Every production definition, in picker order. Seeded into the registry.
 *
 *  The six single-behavior motion movers (`burst`, `rotateBurst`,
 *  `orbitBurst`, `constantRotate`, `constantOrbit`, `translationOscillator`)
 *  were retired in 2026-08: the unified `mover` covers their whole
 *  (translate | rotate | orbit) x (burst | constant | oscillate) matrix, and
 *  persistence UPGRADES[12] rewrites old saves onto it, so their ids never
 *  reach the registry any more. Their definition objects remain exported for
 *  All Movers' banks and the parity tests. */
export const MOVER_OR_SPLITTER_DEFINITIONS: MoverOrSplitterDefinition<any>[] = [
  moverDefinition,
  waypointsMover,
  physicsMover,
  consolidatedMover,
  motionMover,
  conveyorMover,
  radialMotionMover,
  meteorImpactMover,
  impactScatterMover,
  impactPulseMover,
  symmetricMotionMover,
  symmetricRotationMover,
  forceFieldPushMover,
  waveTerrainMover,
  contourMover,
  visibilityMover,
  freezeMover,
  bypassMover,
  noteColorizer,
  gradientColorizer,
  cosinePaletteColorizer,
  risoDuotoneColorizer,
  hueRotateColorizer,
  radialSplitter,
  lineSplitter,
  symmetrySplitter,
  gridSplitter,
  polyhedronSplitter,
  parametricPatternSplitter,
  tunnelSplitter,
  duplicateTrailSplitter,
  approachSplitter,
]
